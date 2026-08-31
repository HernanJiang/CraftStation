import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IPty } from "node-pty";
import { RequestError } from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent, ThreadConfig } from "@/shared/contracts";
import {
  Crafter,
  BUILTIN_MODEL_ITEMS,
  CraftingError,
  FakeCodexParityHarness,
  type HarnessRuntimeAdapter,
} from "@/shared/crafting";
import { TranscriptBuffer } from "@/shared/transcriptBuffer";
import type { SessionRuntime } from "./runtime/sessionTypes";

const taskkillSpawnSyncMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const ptySpawnMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const appendFileMock = vi.hoisted(() =>
  vi.fn<(path: string, data: string, encoding: string) => Promise<void>>(),
);
const nativeHarnessFactoryOverrides = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>(),
);

vi.mock("node:child_process", async (importActual) => {
  const actual = await importActual<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: ((command, args, options) => {
      if (command === "taskkill") {
        return taskkillSpawnSyncMock(command, args, options);
      }
      return actual.spawnSync(command, args, options);
    }) as typeof actual.spawnSync,
  };
});

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    appendFile: appendFileMock,
  };
});

vi.mock("node-pty", () => ({
  spawn: ptySpawnMock,
}));

vi.mock("./runtime/nativeHarness", async (importActual) => {
  const actual = await importActual<typeof import("./runtime/nativeHarness")>();
  return {
    ...actual,
    createNativeHarnessRuntimeAdapter: (harnessKind: string, options: unknown) => {
      const override = nativeHarnessFactoryOverrides.get(harnessKind);
      return override
        ? (override(harnessKind, options) as HarnessRuntimeAdapter | undefined)
        : actual.createNativeHarnessRuntimeAdapter(harnessKind, options as never);
    },
  };
});

// Skip the slow $SHELL -l -c probe on non-Windows hosts. The tests using
// `windowsProject` only exercise argv-shaping logic; resolving the binary
// against the host PATH is irrelevant and adds 1-2s per cold call on macOS.
vi.mock("./agents/binaryResolver", async (importActual) => {
  const actual = await importActual<typeof import("./agents/binaryResolver")>();
  return {
    ...actual,
    resolveAgentBinaryPath: (location: { kind: string }, binary: string) =>
      location.kind === "windows" && process.platform !== "win32"
        ? undefined
        : actual.resolveAgentBinaryPath(location as never, binary),
  };
});

// Suppress supervisor [supervisor] console output during tests so vitest's
// onUserConsoleLog RPC does not remain pending at worker teardown.
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "log").mockImplementation(() => {});

import { codexExtraArgsPosition } from "./agents/codex/argv";
import { SupervisorRuntime } from "./supervisorRuntime";

const tempDirs: string[] = [];
const runtimesToDispose: SupervisorRuntime[] = [];
const poracodeDataDirBeforeTests = process.env.PORACODE_DATA_DIR;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "poracode-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function makeRuntime(emit: ConstructorParameters<typeof SupervisorRuntime>[0]): SupervisorRuntime {
  const runtime = new SupervisorRuntime(emit);
  runtimesToDispose.push(runtime);
  return runtime;
}

afterEach(() => {
  // Dispose any runtimes the test created so their owned services (LSP
  // manager, project watcher, session manager, hook coordinator) stop
  // scheduling async work. Without this, lingering operations can log to
  // console after the test file completes — vitest's worker IPC then
  // rejects the queued `onUserConsoleLog` forward as it tears down,
  // surfacing as an unhandled rejection that fails the CI run.
  for (const runtime of runtimesToDispose.splice(0)) {
    try {
      runtime.dispose();
    } catch {
      // best-effort cleanup
    }
  }
  // Restoring an env var to `undefined` coerces it to the literal string
  // "undefined" (Node stringifies anything assigned to `process.env.X`).
  // That bug used to cause the supervisor to resolve its baseDir as the
  // string "undefined" and create `./undefined/settings.json` in cwd on
  // the next `SupervisorRuntime` construction. Use `delete` when the
  // original value was absent; assign otherwise.
  if (poracodeDataDirBeforeTests === undefined) {
    delete process.env.PORACODE_DATA_DIR;
  } else {
    process.env.PORACODE_DATA_DIR = poracodeDataDirBeforeTests;
  }
  taskkillSpawnSyncMock.mockReset();
  ptySpawnMock.mockReset();
  appendFileMock.mockReset();
  nativeHarnessFactoryOverrides.clear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createMockPty() {
  let onDataHandler: ((data: string) => void) | undefined;
  let onExitHandler: ((event: { exitCode: number | null }) => void) | undefined;

  return {
    pid: 4242,
    write: vi.fn<(data: string) => void>(),
    resize: vi.fn<(cols: number, rows: number) => void>(),
    kill: vi.fn<() => void>(),
    onData: vi.fn<(handler: (data: string) => void) => void>((handler) => {
      onDataHandler = handler;
    }),
    onExit: vi.fn<(handler: (event: { exitCode: number | null }) => void) => void>((handler) => {
      onExitHandler = handler;
    }),
    emitData(data: string) {
      onDataHandler?.(data);
    },
    emitExit(exitCode: number | null) {
      onExitHandler?.({ exitCode });
    },
  };
}

function decodeSpawnCommand(spawnArgs: string[]): string {
  // On Windows hosts, supervisor wraps spawns through PowerShell with
  // -EncodedCommand and quoted args; on non-Windows hosts the test sees the
  // cmd.exe fallback (raw, unquoted). Strip surrounding quotes so assertions
  // can search for the same tokens regardless of host.
  const raw = spawnArgs.includes("-EncodedCommand")
    ? Buffer.from(spawnArgs.at(-1)!, "base64").toString("utf16le")
    : spawnArgs.join(" ");
  return raw.replaceAll("'", "");
}

function createRuntimeSession(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: "instance-1",
    threadId: "thread-1",
    agentKind: "codex",
    adapter: {
      kind: "codex",
      label: "Codex",
      capabilities: {
        models: [],
        efforts: [],
        modes: [],
        approvalPolicies: [],
        sandboxModes: [],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "server",
        presentationMode: "terminal",
      },
    },
    pty: {
      write: vi.fn<(data: string) => void>(),
      resize: vi.fn<(cols: number, rows: number) => void>(),
      kill: vi.fn<() => void>(),
    },
    projectLocation: {
      kind: "windows",
      path: "C:\\repo",
    },
    config: {
      model: "gpt-5.4",
    },
    runtimeLaunchConfig: {
      model: "gpt-5.4",
    },
    mcpLaunchSnapshot: {
      mcpServers: [],
      disabledBuiltInMcpServerIds: [],
    },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    terminalSize: {
      cols: 120,
      rows: 30,
    },
    logPath: "thread.log",
    outputLength: 0,
    prevChunk: "",
    lastStrippedPtyChunk: "",
    structuredSession: {
      launchOptions: {},
      activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      startTurn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      resolveServerRequest: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      setListener: vi.fn<(listener: unknown) => void>(),
      dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe("SupervisorRuntime thread input", () => {
  beforeEach(() => {
    vi.useRealTimers();
    taskkillSpawnSyncMock.mockReset();
    ptySpawnMock.mockReset();
    appendFileMock.mockReset();
  });

  it("routes server-controlled thread input through structured turn start", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const session = createRuntimeSession();

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    await runtime.threadSessionManager.sendThreadInput({
      threadId: session.threadId,
      prompt: "hello",
      config: {
        model: "gpt-5.4",
      },
    });

    expect(session.structuredSession.startTurn).toHaveBeenCalledWith(
      "hello",
      {
        model: "gpt-5.4",
      },
      undefined,
      undefined,
    );
    expect(session.pty.write).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it("returns immediately while server-controlled turn start continues in the background", async () => {
    let resolveStartTurn: (() => void) | undefined;
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const session = createRuntimeSession({
      structuredSession: {
        launchOptions: {},
        activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn: vi.fn<() => Promise<void>>(
          () =>
            new Promise<void>((resolve) => {
              resolveStartTurn = resolve;
            }),
        ),
        resolveServerRequest: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
    });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    await expect(
      runtime.threadSessionManager.sendThreadInput({
        threadId: session.threadId,
        prompt: "hello",
        config: {
          model: "gpt-5.4",
        },
      }),
    ).resolves.toBeUndefined();

    expect(session.structuredSession.startTurn).toHaveBeenCalledWith(
      "hello",
      {
        model: "gpt-5.4",
      },
      undefined,
      undefined,
    );
    expect(emitted).toEqual([]);

    resolveStartTurn?.();
  });

  it("marks the thread as error when server-controlled turn start fails asynchronously", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const session = createRuntimeSession({
      structuredSession: {
        launchOptions: {},
        activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("request failed")),
        resolveServerRequest: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
    });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    await runtime.threadSessionManager.sendThreadInput({
      threadId: session.threadId,
      prompt: "hello",
      config: {
        model: "gpt-5.4",
      },
    });
    await Promise.resolve();

    expect(emitted).toEqual([
      expect.objectContaining({
        type: "thread-state",
        threadId: session.threadId,
        status: "error",
        attention: "error",
        errorMessage: "request failed",
      }),
    ]);
  });

  it("rolls back provider conversation through the structured session", async () => {
    const runtime = makeRuntime(() => undefined);
    const rollbackThread = vi
      .fn<
        (
          numTurns: number,
          config?: ThreadConfig,
        ) => Promise<{ providerSessionId: string; messages: [] }>
      >()
      .mockResolvedValue({ providerSessionId: "provider-session-1", messages: [] });
    const session = createRuntimeSession({
      sessionRef: { providerSessionId: "provider-session-1" },
      structuredSession: {
        launchOptions: {},
        activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        rollbackThread,
        resolveServerRequest: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
    });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    const config: ThreadConfig = {
      model: "gpt-5.6-terra",
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    };
    await runtime.threadSessionManager.rollbackThreadConversation({
      threadId: session.threadId,
      numTurns: 2,
      config,
    });

    expect(rollbackThread).toHaveBeenCalledWith(2, config);
  });

  it("rejects checkpoint rollback when the provider does not support it", async () => {
    const runtime = makeRuntime(() => undefined);
    const session = createRuntimeSession();

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    await expect(
      runtime.threadSessionManager.rollbackThreadConversation({
        threadId: session.threadId,
        numTurns: 1,
      }),
    ).rejects.toThrow("Codex does not support checkpoint rollback.");
    expect(session.structuredSession.startTurn).not.toHaveBeenCalled();
  });

  it("stages GUI submit-while-working as a single pending steer with replace-latest, interrupts once, and drains the latest on idle", async () => {
    const runtime = makeRuntime(() => undefined);
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const interruptTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          structuredSession: Record<string, unknown>;
          presentationMode: "gui";
          mcpLaunchSnapshot: {
            mcpServers: [];
            disabledBuiltInMcpServerIds: [];
          };
        }) => { status: string };
      }
    ).spawnThread({
      threadId: "thread-gui-queue",
      agentKind: "codex",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "gpt-5.4",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      structuredSession: {
        launchOptions: {},
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn,
        interruptTurn,
      },
      presentationMode: "gui",
      mcpLaunchSnapshot: {
        mcpServers: [],
        disabledBuiltInMcpServerIds: [],
      },
    });

    (
      runtime as unknown as {
        sessions: Map<
          string,
          {
            status: string;
            structuredSession: { setListener: ReturnType<typeof vi.fn> };
          }
        >;
      }
    ).sessions.get("thread-gui-queue")!.status = "working";

    await runtime.threadSessionManager.sendThreadInput({
      threadId: "thread-gui-queue",
      prompt: "first",
      config: {
        model: "gpt-5.4",
      },
      userMessageItemId: "user-first",
    });
    await runtime.threadSessionManager.sendThreadInput({
      threadId: "thread-gui-queue",
      prompt: "second",
      config: {
        model: "gpt-5.4",
      },
      userMessageItemId: "user-second",
    });

    // Replace-latest: both submits stage into the same slot. interruptTurn
    // fires once; startTurn waits for cancel-ack via the idle transition.
    expect(interruptTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).not.toHaveBeenCalled();

    const listener = (
      (
        runtime as unknown as {
          sessions: Map<
            string,
            {
              structuredSession: { setListener: ReturnType<typeof vi.fn> };
            }
          >;
        }
      ).sessions.get("thread-gui-queue")!.structuredSession.setListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as { onUpdate: (update: { status: string; attention: string }) => void };

    listener.onUpdate({ status: "idle", attention: "none" });
    await Promise.resolve();

    // Only the latest submit drains; the earlier one was replaced.
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledWith(
      "second",
      {
        model: "gpt-5.4",
      },
      undefined,
      { userMessageItemId: "user-second" },
    );
  });

  it("flushes buffered runtime events before emitting a structured turn-end idle", () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });

    (
      runtime as unknown as {
        spawnThread: (input: Record<string, unknown>) => { status: string };
      }
    ).spawnThread({
      threadId: "thread-gui-flush",
      agentKind: "codex",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "gpt-5.4",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      structuredSession: {
        launchOptions: {},
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
      presentationMode: "gui",
      mcpLaunchSnapshot: {
        mcpServers: [],
        disabledBuiltInMcpServerIds: [],
      },
    });

    const session = (
      runtime as unknown as {
        sessions: Map<
          string,
          {
            status: string;
            attention: string;
            structuredSession: { setListener: ReturnType<typeof vi.fn> };
          }
        >;
      }
    ).sessions.get("thread-gui-flush")!;
    session.status = "working";
    session.attention = "working";

    const listener = (session.structuredSession.setListener as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      onUpdate: (update: { status: string; attention: string }) => void;
      onRuntimeEvent: (event: RuntimeEvent) => void;
    };

    // Isolate the turn-end sequence from any spawn-time emits.
    emitted.length = 0;

    // The turn's final assistant delta is appended to the 16ms runtime-event
    // batch buffer (timer not yet fired — no emit yet).
    listener.onRuntimeEvent({
      type: "content.delta",
      threadId: "thread-gui-flush",
      itemId: "assistant-1",
      stream: "assistant_text",
      delta: "done",
    });

    // Turn completes: the structured session reports idle. The status
    // `thread-state` is emitted immediately, so without flushing first it would
    // overtake the still-buffered runtime event on the wire and let the renderer
    // re-open the GUI turn to "working".
    listener.onUpdate({ status: "idle", attention: "none" });

    const runtimeIdx = emitted.findIndex(
      (e) =>
        e.type === "thread-runtime-event" ||
        e.type === "thread-runtime-events" ||
        e.type === "thread-runtime-events-multi",
    );
    const idleIdx = emitted.findIndex((e) => e.type === "thread-state" && e.status === "idle");

    expect(runtimeIdx).toBeGreaterThanOrEqual(0);
    expect(idleIdx).toBeGreaterThanOrEqual(0);
    expect(runtimeIdx).toBeLessThan(idleIdx);
  });

  it("drains a pending steer when the working turn fails with error status", async () => {
    const runtime = makeRuntime(() => undefined);
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const interruptTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    (
      runtime as unknown as {
        spawnThread: (input: Record<string, unknown>) => { status: string };
      }
    ).spawnThread({
      threadId: "thread-gui-error",
      agentKind: "codex",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
        },
      },
      projectLocation: { kind: "windows", path: "C:\\repo" },
      config: { model: "gpt-5.4" },
      initialSize: { cols: 120, rows: 30 },
      launchPrompt: "",
      structuredSession: {
        launchOptions: {},
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn,
        interruptTurn,
      },
      presentationMode: "gui",
      mcpLaunchSnapshot: {
        mcpServers: [],
        disabledBuiltInMcpServerIds: [],
      },
    });

    (
      runtime as unknown as {
        sessions: Map<string, { status: string }>;
      }
    ).sessions.get("thread-gui-error")!.status = "working";

    await runtime.threadSessionManager.sendThreadInput({
      threadId: "thread-gui-error",
      prompt: "redirect",
      config: { model: "gpt-5.4" },
      userMessageItemId: "user-redirect",
    });

    expect(interruptTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).not.toHaveBeenCalled();

    const listener = (
      (
        runtime as unknown as {
          sessions: Map<string, { structuredSession: { setListener: ReturnType<typeof vi.fn> } }>;
        }
      ).sessions.get("thread-gui-error")!.structuredSession.setListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as {
      onUpdate: (update: { status: string; attention: string; errorMessage?: string }) => void;
    };

    // The turn fails instead of reaching idle. The steer must still drain —
    // otherwise the strip sticks on "waiting for agent to stop" forever.
    listener.onUpdate({ status: "error", attention: "error", errorMessage: "Claude turn failed." });
    await Promise.resolve();

    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledWith("redirect", { model: "gpt-5.4" }, undefined, {
      userMessageItemId: "user-redirect",
    });
  });

  it("drains a steer staged after the turn already errored", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => emitted.push(event as Record<string, unknown>));
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const interruptTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    (
      runtime as unknown as {
        spawnThread: (input: Record<string, unknown>) => { status: string };
      }
    ).spawnThread({
      threadId: "thread-gui-post-error",
      agentKind: "codex",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
        },
      },
      projectLocation: { kind: "windows", path: "C:\\repo" },
      config: { model: "gpt-5.4" },
      initialSize: { cols: 120, rows: 30 },
      launchPrompt: "",
      structuredSession: {
        launchOptions: {},
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn,
        interruptTurn,
      },
      presentationMode: "gui",
      mcpLaunchSnapshot: {
        mcpServers: [],
        disabledBuiltInMcpServerIds: [],
      },
    });

    // The turn already failed before the user types their steer.
    (
      runtime as unknown as {
        sessions: Map<string, { status: string }>;
      }
    ).sessions.get("thread-gui-post-error")!.status = "error";

    await runtime.threadSessionManager.sendThreadInput({
      threadId: "thread-gui-post-error",
      prompt: "retry this",
      config: { model: "gpt-5.4" },
      userMessageItemId: "user-retry",
    });

    // Nothing to interrupt — the agent already stopped — so the steer drains
    // immediately into a fresh turn rather than waiting on a stop that never comes.
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledWith("retry this", { model: "gpt-5.4" }, undefined, {
      userMessageItemId: "user-retry",
    });
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "thread-runtime-event",
        threadId: "thread-gui-post-error",
        event: expect.objectContaining({
          type: "item.started",
          itemId: "user-retry",
          itemType: "user_message",
        }),
      }),
    );
  });

  it("does not emit runtime status updates for raw terminal writes", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const session = createRuntimeSession({
      adapter: {
        kind: "claude",
        label: "Claude Code",
        capabilities: {
          models: [],
          efforts: [],
          modes: [],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
        },
      },
      structuredSession: undefined,
    });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    await runtime.threadSessionManager.writeTerminal({
      threadId: session.threadId,
      data: "hello\r",
    });

    expect(session.pty.write).toHaveBeenCalledWith("hello\r");
    expect(emitted).toHaveLength(0);
  });

  it("promotes routed CLI hook session ids into resumable thread session refs", () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const session = createRuntimeSession({
      sessionRef: undefined,
      canResumeWithConfig: false,
      hasCliHookPluginActivity: true,
    }) as unknown as SessionRuntime;

    (runtime as unknown as { sessions: Map<string, SessionRuntime> }).sessions.set(
      session.threadId,
      session,
    );

    const manager = (
      runtime as unknown as {
        threadSessionManager: {
          findSessionForCliHookPlugin(input: {
            threadId?: string;
            sessionId?: string;
          }): SessionRuntime | undefined;
          noteCliHookPluginActivity(
            runtimeSession: SessionRuntime,
            envelope: {
              protocolVersion: 1;
              agentKind: "codex";
              pluginVersion: string;
              threadId: string;
              sessionId: string;
              ts: number;
              intent: "session.started";
            },
          ): void;
        };
      }
    ).threadSessionManager;

    manager.noteCliHookPluginActivity(session, {
      protocolVersion: 1,
      agentKind: "codex",
      pluginVersion: "1.0.0",
      threadId: session.threadId,
      sessionId: "codex-session-1",
      ts: Date.now(),
      intent: "session.started",
    });

    expect(session.sessionRef?.providerSessionId).toBe("codex-session-1");
    expect(session.canResumeWithConfig).toBe(true);
    expect(manager.findSessionForCliHookPlugin({ sessionId: "codex-session-1" })).toBe(session);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "thread-state",
        threadId: session.threadId,
        canResumeWithConfig: true,
        sessionRef: expect.objectContaining({
          providerSessionId: "codex-session-1",
        }),
      }),
    );
  });

  it("starts terminal session ref discovery immediately after spawn without hooks", async () => {
    vi.useFakeTimers();
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const pty = createMockPty();
    const discoverSessionRef = vi
      .fn<() => Promise<{ providerSessionId: string; discoveredAt: string } | undefined>>()
      .mockResolvedValue({
        providerSessionId: "codex-rollout-session-1",
        discoveredAt: "2026-05-11T00:00:00.000Z",
      });

    ptySpawnMock.mockReturnValueOnce(pty);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          command: { command: string; args: string[] };
        }) => SessionRuntime;
      }
    ).spawnThread({
      threadId: "thread-codex-no-hooks",
      agentKind: "codex",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["high"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
        },
        initialSessionRefDiscoveryDelayMs: 1000,
        discoverSessionRef,
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "gpt-5.4",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      command: {
        command: "codex",
        args: [],
      },
    });

    expect(discoverSessionRef).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(discoverSessionRef).toHaveBeenCalledTimes(1);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "thread-state",
        threadId: "thread-codex-no-hooks",
        canResumeWithConfig: true,
        sessionRef: {
          providerSessionId: "codex-rollout-session-1",
          discoveredAt: "2026-05-11T00:00:00.000Z",
        },
      }),
    );
    vi.useRealTimers();
  });

  it("allows session ref watcher events to discover after timed polling expires", async () => {
    vi.useFakeTimers();
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const pty = createMockPty();
    let onWatcherChanged: (() => void) | undefined;
    const stopWatcher = vi.fn<() => void>();
    const discoverSessionRef =
      vi.fn<() => Promise<{ providerSessionId: string; discoveredAt: string } | undefined>>();
    discoverSessionRef
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        providerSessionId: "antigravity-conversation-1",
        discoveredAt: "2026-05-20T00:00:00.000Z",
      });

    ptySpawnMock.mockReturnValueOnce(pty);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          command: { command: string; args: string[] };
        }) => SessionRuntime;
      }
    ).spawnThread({
      threadId: "thread-antigravity-late-session",
      agentKind: "antigravity",
      adapter: {
        kind: "antigravity",
        label: "Antigravity",
        capabilities: {
          models: [{ id: "Gemini 3.5 Flash", label: "Gemini 3.5 Flash" }],
          efforts: [],
          modelEfforts: {},
          modes: [],
          approvalPolicies: [{ id: "default", label: "Default" }],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
        },
        initialSessionRefDiscoveryDelayMs: 1000,
        discoverSessionRef,
        watchSessionRef: vi.fn<(_location: unknown, onChanged: () => void) => () => void>(
          (_location, onChanged) => {
            onWatcherChanged = onChanged;
            return stopWatcher;
          },
        ),
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "Gemini 3.5 Flash",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      command: {
        command: "agy",
        args: [],
      },
    });

    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(3000);
    }

    expect(discoverSessionRef).toHaveBeenCalledTimes(5);
    expect(
      emitted.some(
        (event) =>
          event.type === "thread-state" &&
          (event.sessionRef as { providerSessionId?: string } | undefined)?.providerSessionId ===
            "antigravity-conversation-1",
      ),
    ).toBe(false);

    onWatcherChanged?.();
    await Promise.resolve();

    expect(discoverSessionRef).toHaveBeenCalledTimes(6);
    expect(stopWatcher).toHaveBeenCalledTimes(1);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "thread-state",
        threadId: "thread-antigravity-late-session",
        canResumeWithConfig: true,
        sessionRef: {
          providerSessionId: "antigravity-conversation-1",
          discoveredAt: "2026-05-20T00:00:00.000Z",
        },
      }),
    );
    vi.useRealTimers();
  });

  it("keeps terminal scrollback in a capped transcript buffer", () => {
    const runtime = makeRuntime(() => undefined);
    const session = createRuntimeSession({ prevChunk: "" });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    (
      runtime as unknown as {
        handlePtyData: (runtimeSession: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "a".repeat(120_000));
    (
      runtime as unknown as {
        handlePtyData: (runtimeSession: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "b".repeat(120_000));

    const scrollback = runtime.threadSessionManager.readTerminalScrollback(session.threadId);
    expect(scrollback).toHaveLength(100_000);
    expect(scrollback.startsWith("b")).toBe(true);
  });

  it("lists and reads running workspace terminal panes", () => {
    const runtime = makeRuntime(() => undefined);
    const outputTranscript = new TranscriptBuffer(200_000);
    outputTranscript.append("workspace output");
    const shell = {
      instanceId: "shell-instance-1",
      shellId: "shell:workspace",
      pty: createMockPty() as unknown as IPty,
      projectLocation: { kind: "windows" as const, path: "C:\\repo\\worktree" },
      worktreePath: "C:\\repo\\worktree",
      outputLength: 16,
      outputTranscript,
    };
    runtime.threadSessionManager.shellSessions.set(shell.shellId, shell);

    expect(runtime.threadSessionManager.getTerminalShellSnapshots()).toEqual([
      {
        terminalId: shell.shellId,
        projectLocation: shell.projectLocation,
        worktreePath: shell.worktreePath,
        outputLength: shell.outputLength,
      },
    ]);
    expect(runtime.threadSessionManager.readTerminalScrollback(shell.shellId)).toBe(
      "workspace output",
    );
  });

  it("buffers dev PTY log writes instead of writing each chunk synchronously", async () => {
    vi.useFakeTimers();
    process.env.VITE_DEV_SERVER_URL = "http://localhost:5173";
    const tempDir = makeTempDir();
    process.env.PORACODE_DATA_DIR = tempDir;
    const runtime = makeRuntime(() => undefined);
    const session = createRuntimeSession({ prevChunk: "" });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    (
      runtime as unknown as {
        handlePtyData: (runtimeSession: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "first");
    (
      runtime as unknown as {
        handlePtyData: (runtimeSession: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "second");

    expect(appendFileMock).not.toHaveBeenCalled();
    // Advance only past the 25ms dev-log buffer flush, not `runAllTimersAsync`:
    // the runtime's UsageService auto-refresh tick reschedules itself forever
    // (by design), so draining every timer trips fake-timers' 10000-iteration
    // infinite-loop guard non-deterministically under load.
    await vi.advanceTimersByTimeAsync(25);
    expect(appendFileMock).toHaveBeenCalledTimes(1);
    expect(appendFileMock.mock.calls[0]?.[1]).toBe("firstsecond");
    delete process.env.VITE_DEV_SERVER_URL;
    vi.useRealTimers();
  });

  it("keeps a working thread active when the last corroborated terminal hint is still working", async () => {
    vi.useFakeTimers();
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const session = createRuntimeSession({
      status: "working",
      attention: "working",
      prevChunk: "",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [],
          efforts: [],
          modes: [],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
        },
        detectTerminalStatus: (text: string) =>
          text.includes("Working (3m 38s")
            ? {
                status: "working" as const,
                attention: "working" as const,
                corroborated: true,
              }
            : null,
      },
    });

    (
      runtime as unknown as {
        handlePtyData: (session: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "Working (3m 38s • esc to interrupt)");

    await vi.advanceTimersByTimeAsync(2000);

    expect(session.status).toBe("working");
    expect(
      emitted.filter((event) => event.type === "thread-state" && event.status === "idle"),
    ).toHaveLength(0);
    vi.useRealTimers();
  });

  it("promotes Codex question screens to needs_reply before silence can mark them idle", async () => {
    vi.useFakeTimers();
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const session = createRuntimeSession({
      status: "working",
      attention: "working",
      prevChunk: "",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [],
          efforts: [],
          modes: [],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
        },
        detectTerminalStatus: (text: string) =>
          text.includes("enter to submit answer")
            ? {
                status: "needs_reply" as const,
                attention: "needs_reply" as const,
                corroborated: true,
              }
            : null,
      },
    });

    (
      runtime as unknown as {
        handlePtyData: (session: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(
      session,
      [
        "Question 1/2 (2 unanswered)",
        "For the project tree search, what should v1 search across?",
        "",
        "tab to add notes | enter to submit answer | ←/→ to navigate questions | esc to interrupt",
      ].join("\n"),
    );

    await vi.advanceTimersByTimeAsync(2000);

    expect(session.status).toBe("needs_reply");
    expect(session.attention).toBe("needs_reply");
    expect(
      emitted.filter((event) => event.type === "thread-state" && event.status === "idle"),
    ).toHaveLength(0);
    vi.useRealTimers();
  });

  it("still falls back to idle after silence when no strong terminal hint remains", async () => {
    vi.useFakeTimers();
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const session = createRuntimeSession({
      status: "working",
      attention: "working",
      prevChunk: "",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [],
          efforts: [],
          modes: [],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
        },
        detectTerminalStatus: () => null,
      },
    });

    (
      runtime as unknown as {
        handlePtyData: (session: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "Partial output without a strong status marker");

    await vi.advanceTimersByTimeAsync(2000);

    expect(session.status).toBe("idle");
    expect(
      emitted.filter((event) => event.type === "thread-state" && event.status === "idle"),
    ).toHaveLength(1);
    vi.useRealTimers();
  });

  it("does not fall back to idle when the adapter disables the silence watchdog", async () => {
    vi.useFakeTimers();
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const session = createRuntimeSession({
      agentKind: "claude",
      status: "working",
      attention: "working",
      prevChunk: "",
      adapter: {
        kind: "claude",
        label: "Claude Code",
        capabilities: {
          models: [],
          efforts: [],
          modes: [],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
        },
        detectTerminalStatus: () => null,
        workingSilenceTimeoutMs: null,
      },
    });

    (
      runtime as unknown as {
        handlePtyData: (session: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "Puttering… (1m 34s · ↑ 3.4k tokens · thinking with high effort)");

    await vi.advanceTimersByTimeAsync(2000);

    expect(session.status).toBe("working");
    expect(
      emitted.filter((event) => event.type === "thread-state" && event.status === "idle"),
    ).toHaveLength(0);
    vi.useRealTimers();
  });

  it("uses taskkill instead of pty.kill when closing a Windows shell session", async () => {
    const runtime = makeRuntime(() => undefined);
    const shell = {
      instanceId: "shell-instance-1",
      shellId: "shell-1",
      pty: {
        pid: 4242,
        kill: vi.fn<() => void>(),
        write: vi.fn<(data: string) => void>(),
        resize: vi.fn<(cols: number, rows: number) => void>(),
      },
      logPath: "shell.log",
      outputLength: 0,
    };
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

    taskkillSpawnSyncMock.mockReturnValue({
      pid: 0,
      output: [],
      stdout: null,
      stderr: null,
      status: 0,
      signal: null,
    });

    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    (runtime as unknown as { shellSessions: Map<string, typeof shell> }).shellSessions.set(
      shell.shellId,
      shell,
    );

    try {
      await runtime.threadSessionManager.closeThread({ threadId: shell.shellId });
    } finally {
      processKillSpy.mockRestore();
      if (platformDescriptor) {
        Object.defineProperty(process, "platform", platformDescriptor);
      }
    }

    expect(taskkillSpawnSyncMock).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "4242", "/T", "/F"],
      expect.objectContaining({
        stdio: "ignore",
        windowsHide: true,
      }),
    );
    expect(shell.pty.kill).not.toHaveBeenCalled();
  });

  it("starts the queued launch prompt when isReadyForInitialPrompt fires", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const pty = createMockPty();
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    ptySpawnMock.mockReturnValueOnce(pty);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          command: { command: string; args: string[] };
          structuredSession: Record<string, unknown>;
          pendingLaunchPrompt: string;
          mcpLaunchSnapshot: {
            mcpServers: [];
            disabledBuiltInMcpServerIds: [];
          };
        }) => unknown;
      }
    ).spawnThread({
      threadId: "thread-2",
      agentKind: "codex",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["high"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
        },
        createInitialSessionRef: vi
          .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
          .mockReturnValue(undefined),
        buildLaunchArgv: vi.fn<() => void>(),
        buildResumeArgv: vi.fn<() => void>(),
        isReadyForInitialPrompt: (text: string) =>
          text.includes("OpenAI Codex") &&
          text.includes("directory:") &&
          text.includes("/model to change"),
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "gpt-5.4",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      command: {
        command: "codex",
        args: [],
      },
      structuredSession: {
        launchOptions: {},
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn,
      },
      pendingLaunchPrompt: "hi",
      mcpLaunchSnapshot: {
        mcpServers: [],
        disabledBuiltInMcpServerIds: [],
      },
    });

    pty.emitData(
      [
        "OpenAI Codex (v0.116.0)",
        "model: gpt-5.4-mini high /model to change",
        "directory: ~/work/site-search-ui",
      ].join("\n"),
    );
    await Promise.resolve();

    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledWith("hi", {
      model: "gpt-5.4",
    });
  });

  it.skipIf(process.platform !== "win32")(
    "does not eagerly start a queued Codex turn during thread startup",
    async () => {
      const runtime = makeRuntime(() => undefined);
      const pty = createMockPty();
      const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const activate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const openThread = vi.fn<() => Promise<string>>().mockResolvedValue("session-1");
      const ensureResumeArtifacts = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      ptySpawnMock.mockReturnValueOnce(pty);

      const adapter = {
        kind: "codex" as const,
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["high"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server" as const,
          presentationMode: "terminal" as const,
        },
        detectInstall: vi.fn<() => void>(),
        buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
          binary: "codex",
          args: ["resume", "session-1"],
        })),
        buildResumeArgv: vi.fn<() => void>(),
        createInitialSessionRef: vi
          .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
          .mockReturnValue(undefined),
        createStructuredSession: vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({
          launchOptions: {},
          activate,
          openThread,
          ensureResumeArtifacts,
          startTurn,
          setListener: vi.fn<(listener: unknown) => void>(),
          dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        }),
        isReadyForInitialPrompt: vi.fn<(text: string) => boolean>(() => false),
      };

      (
        runtime as unknown as {
          adapters: Map<string, typeof adapter>;
        }
      ).adapters.set("codex", adapter);

      await runtime.threadSessionManager.startThread({
        threadId: "thread-3",
        projectLocation: {
          kind: "windows",
          path: "C:\\repo",
        },
        agentKind: "codex",
        config: {
          model: "gpt-5.4",
        },
        prompt: "hi",
        initialSize: {
          cols: 132,
          rows: 42,
        },
      });

      expect(activate).toHaveBeenCalledTimes(1);
      expect(openThread).toHaveBeenCalledTimes(1);
      expect(ensureResumeArtifacts).toHaveBeenCalledTimes(1);
      expect(startTurn).not.toHaveBeenCalled();
      expect(ptySpawnMock).toHaveBeenCalledTimes(1);
      const [, spawnArgs, spawnOpts] = ptySpawnMock.mock.calls[0] as [
        string,
        string[],
        { cols: number; rows: number },
      ];
      // argv is wrapped by resolveLaunchSpec (PowerShell on Windows); the
      // resume argument appears inside the encoded script.
      const encoded = spawnArgs.includes("-EncodedCommand")
        ? Buffer.from(spawnArgs.at(-1)!, "base64").toString("utf16le")
        : spawnArgs.join(" ");
      expect(encoded).toContain("session-1");
      expect(spawnOpts).toMatchObject({ cols: 132, rows: 42 });
    },
  );

  it("starts Codex GUI presentation on the structured session without a PTY and stays visually working", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const setListener = vi.fn<
      (listener: { onUpdate(update: Record<string, unknown>): void }) => void
    >((listener) => {
      listener.onUpdate({
        status: "idle",
        attention: "none",
        sessionRef: {
          providerSessionId: "session-1",
          discoveredAt: "2026-05-10T12:00:00.000Z",
        },
      });
    });

    const adapter = {
      kind: "generic-gui" as const,
      label: "Codex",
      capabilities: {
        models: [{ id: "gpt-5.4", label: "5.4" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
        presentationModes: ["terminal", "gui"] as const,
      },
      detectInstall: vi.fn<() => void>(),
      buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "generic-gui",
        args: ["should-not-spawn"],
      })),
      buildResumeArgv: vi.fn<() => void>(),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
      createStructuredSession: vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({
        launchOptions: { suppressResumeConfigOverrides: true, resumeThreadId: "session-1" },
        activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openThread: vi.fn<() => Promise<string>>().mockResolvedValue("session-1"),
        startTurn,
        setListener,
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      }),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "codex",
      adapter,
    );

    await runtime.threadSessionManager.startThread({
      threadId: "thread-gui-start",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "codex",
      config: {
        model: "gpt-5.4",
      },
      prompt: "hi",
      presentationMode: "gui",
      initialSize: {
        cols: 132,
        rows: 42,
      },
    });

    expect(adapter.buildLaunchArgv).not.toHaveBeenCalled();
    expect(ptySpawnMock).not.toHaveBeenCalled();
    expect(setListener).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledWith("hi", { model: "gpt-5.4" }, undefined, {
      userMessageItemId: expect.stringMatching(/^user-/),
    });
    expect(
      (runtime as unknown as { sessions: Map<string, { pty?: unknown }> }).sessions.get(
        "thread-gui-start",
      )?.pty,
    ).toBeUndefined();
    const threadStates = emitted.filter(
      (event) => event.type === "thread-state" && event.threadId === "thread-gui-start",
    );
    expect(threadStates[0]).toMatchObject({
      type: "thread-state",
      threadId: "thread-gui-start",
      status: "working",
      attention: "working",
      threadStatusSource: "server",
    });
    expect(threadStates).not.toContainEqual(
      expect.objectContaining({
        status: "launching",
      }),
    );
    expect(threadStates).not.toContainEqual(
      expect.objectContaining({
        status: "idle",
      }),
    );
    expect(threadStates.at(-1)).toMatchObject({
      status: "working",
      sessionRef: {
        providerSessionId: "session-1",
      },
    });
  });

  it("lets canonical turn completion close an optimistic GUI launch turn without assistant items", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    let runtimeListener:
      | {
          onUpdate(update: Record<string, unknown>): void;
          onRuntimeEvent(event: RuntimeEvent): void;
        }
      | undefined;
    const startTurn = vi.fn<() => Promise<void>>(async () => {
      runtimeListener?.onRuntimeEvent({
        type: "turn.completed",
        threadId: "thread-gui-complete-only",
        turnId: "turn-1",
        state: "completed",
      });
      runtimeListener?.onUpdate({ status: "idle", attention: "none" });
    });
    const setListener = vi.fn<
      (listener: {
        onUpdate(update: Record<string, unknown>): void;
        onRuntimeEvent(event: RuntimeEvent): void;
      }) => void
    >((listener) => {
      runtimeListener = listener;
      listener.onUpdate({
        status: "idle",
        attention: "none",
        sessionRef: {
          providerSessionId: "session-1",
          discoveredAt: "2026-05-10T12:00:00.000Z",
        },
      });
    });

    const adapter = {
      kind: "generic-gui" as const,
      label: "Generic GUI Provider",
      capabilities: {
        models: [{ id: "gpt-5.4", label: "5.4" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
        presentationModes: ["terminal", "gui"] as const,
      },
      detectInstall: vi.fn<() => void>(),
      buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "generic-gui",
        args: ["should-not-spawn"],
      })),
      buildResumeArgv: vi.fn<() => void>(),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
      createStructuredSession: vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({
        launchOptions: { suppressResumeConfigOverrides: true, resumeThreadId: "session-1" },
        activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openThread: vi.fn<() => Promise<string>>().mockResolvedValue("session-1"),
        startTurn,
        setListener,
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      }),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "generic-gui",
      adapter,
    );

    await runtime.threadSessionManager.startThread({
      threadId: "thread-gui-complete-only",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "generic-gui",
      config: {
        model: "gpt-5.4",
      },
      prompt: "hi",
      presentationMode: "gui",
      initialSize: {
        cols: 132,
        rows: 42,
      },
    });
    await Promise.resolve();

    const threadStates = emitted.filter(
      (event) => event.type === "thread-state" && event.threadId === "thread-gui-complete-only",
    );
    expect(threadStates[0]).toMatchObject({
      status: "working",
      attention: "working",
    });
    expect(threadStates.at(-1)).toMatchObject({
      status: "idle",
      attention: "none",
      sessionRef: {
        providerSessionId: "session-1",
      },
    });
  });

  it("lets a quick stop close an optimistic GUI launch turn before provider output", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    let runtimeListener: { onUpdate(update: Record<string, unknown>): void } | undefined;
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const interruptTurn = vi.fn<() => Promise<void>>(async () => {
      runtimeListener?.onUpdate({ status: "idle", attention: "none" });
    });
    const setListener = vi.fn<
      (listener: { onUpdate(update: Record<string, unknown>): void }) => void
    >((listener) => {
      runtimeListener = listener;
      listener.onUpdate({
        status: "idle",
        attention: "none",
        sessionRef: {
          providerSessionId: "session-1",
          discoveredAt: "2026-05-10T12:00:00.000Z",
        },
      });
    });

    const adapter = {
      kind: "generic-gui" as const,
      label: "Generic GUI Provider",
      capabilities: {
        models: [{ id: "gpt-5.4", label: "5.4" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
        presentationModes: ["terminal", "gui"] as const,
      },
      detectInstall: vi.fn<() => void>(),
      buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "generic-gui",
        args: ["should-not-spawn"],
      })),
      buildResumeArgv: vi.fn<() => void>(),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
      createStructuredSession: vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({
        launchOptions: { suppressResumeConfigOverrides: true, resumeThreadId: "session-1" },
        activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openThread: vi.fn<() => Promise<string>>().mockResolvedValue("session-1"),
        startTurn,
        interruptTurn,
        setListener,
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      }),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "generic-gui",
      adapter,
    );

    await runtime.threadSessionManager.startThread({
      threadId: "thread-gui-quick-stop",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "generic-gui",
      config: {
        model: "gpt-5.4",
      },
      prompt: "hi",
      presentationMode: "gui",
      initialSize: {
        cols: 132,
        rows: 42,
      },
    });

    emitted.length = 0;
    await runtime.threadSessionManager.interruptThread({ threadId: "thread-gui-quick-stop" });

    expect(interruptTurn).toHaveBeenCalledTimes(1);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "thread-state",
        threadId: "thread-gui-quick-stop",
        status: "idle",
        attention: "none",
      }),
    );
  });

  it("queues stop during GUI startup before the provider session exists", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    let resolveStructuredSession:
      | ((session: {
          launchOptions: Record<string, never>;
          activate: () => Promise<void>;
          openThread: () => Promise<string>;
          startTurn: () => Promise<void>;
          interruptTurn: () => Promise<void>;
          setListener: (listener: { onUpdate(update: Record<string, unknown>): void }) => void;
          dispose: () => Promise<void>;
        }) => void)
      | undefined;
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const interruptTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const setListener =
      vi.fn<(listener: { onUpdate(update: Record<string, unknown>): void }) => void>();
    const structuredSessionPromise = new Promise<{
      launchOptions: Record<string, never>;
      activate: () => Promise<void>;
      openThread: () => Promise<string>;
      startTurn: () => Promise<void>;
      interruptTurn: () => Promise<void>;
      setListener: (listener: { onUpdate(update: Record<string, unknown>): void }) => void;
      dispose: () => Promise<void>;
    }>((resolve) => {
      resolveStructuredSession = resolve;
    });

    const adapter = {
      kind: "generic-gui" as const,
      label: "Generic GUI Provider",
      capabilities: {
        models: [{ id: "model-a", label: "Model A" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
        presentationModes: ["terminal", "gui"] as const,
      },
      detectInstall: vi.fn<() => void>(),
      buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "generic-gui",
        args: ["should-not-spawn"],
      })),
      buildResumeArgv: vi.fn<() => void>(),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
      createStructuredSession: vi.fn<() => Promise<Record<string, unknown>>>(
        () => structuredSessionPromise,
      ),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "generic-gui",
      adapter,
    );

    const startPromise = runtime.threadSessionManager.startThread({
      threadId: "thread-gui-pre-session-stop",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "generic-gui",
      config: {
        model: "model-a",
      },
      prompt: "hi",
      presentationMode: "gui",
      initialSize: {
        cols: 132,
        rows: 42,
      },
    });
    await vi.waitFor(() =>
      expect(emitted).toContainEqual(
        expect.objectContaining({
          type: "thread-state",
          threadId: "thread-gui-pre-session-stop",
          status: "working",
        }),
      ),
    );

    emitted.length = 0;
    await runtime.threadSessionManager.interruptThread({ threadId: "thread-gui-pre-session-stop" });
    const dispose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "thread-state",
        threadId: "thread-gui-pre-session-stop",
        status: "idle",
        attention: "none",
        forceCloseActiveTurn: true,
      }),
    );

    resolveStructuredSession?.({
      launchOptions: {},
      activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      openThread: vi.fn<() => Promise<string>>().mockResolvedValue("session-1"),
      startTurn,
      interruptTurn,
      setListener,
      dispose,
    });
    await startPromise;

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(setListener).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "thread-state",
        threadId: "thread-gui-pre-session-stop",
        status: "idle",
        attention: "none",
      }),
    );
  });

  it("settles a queued GUI startup stop when ACP closes during activate", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    let resolveStructuredSession:
      | ((session: {
          launchOptions: Record<string, never>;
          activate: () => Promise<void>;
          openThread: () => Promise<string>;
          startTurn: () => Promise<void>;
          interruptTurn: () => Promise<void>;
          setListener: (listener: { onUpdate(update: Record<string, unknown>): void }) => void;
          dispose: () => Promise<void>;
        }) => void)
      | undefined;
    const activate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("ACP connection closed"));
    const openThread = vi.fn<() => Promise<string>>().mockResolvedValue("session-1");
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const interruptTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const setListener =
      vi.fn<(listener: { onUpdate(update: Record<string, unknown>): void }) => void>();
    const dispose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const structuredSessionPromise = new Promise<{
      launchOptions: Record<string, never>;
      activate: () => Promise<void>;
      openThread: () => Promise<string>;
      startTurn: () => Promise<void>;
      interruptTurn: () => Promise<void>;
      setListener: (listener: { onUpdate(update: Record<string, unknown>): void }) => void;
      dispose: () => Promise<void>;
    }>((resolve) => {
      resolveStructuredSession = resolve;
    });

    const adapter = {
      kind: "generic-gui" as const,
      label: "Generic GUI Provider",
      capabilities: {
        models: [{ id: "model-a", label: "Model A" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
        presentationModes: ["terminal", "gui"] as const,
      },
      detectInstall: vi.fn<() => void>(),
      buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "generic-gui",
        args: ["should-not-spawn"],
      })),
      buildResumeArgv: vi.fn<() => void>(),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
      createStructuredSession: vi.fn<() => Promise<Record<string, unknown>>>(
        () => structuredSessionPromise,
      ),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "generic-gui",
      adapter,
    );

    const startPromise = runtime.threadSessionManager.startThread({
      threadId: "thread-gui-activate-stop",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "generic-gui",
      config: {
        model: "model-a",
      },
      prompt: "hi",
      presentationMode: "gui",
      initialSize: {
        cols: 132,
        rows: 42,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    await runtime.threadSessionManager.interruptThread({ threadId: "thread-gui-activate-stop" });

    resolveStructuredSession?.({
      launchOptions: {},
      activate,
      openThread,
      startTurn,
      interruptTurn,
      setListener,
      dispose,
    });

    await expect(startPromise).resolves.toEqual({ threadId: "thread-gui-activate-stop" });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(openThread).not.toHaveBeenCalled();
    expect(setListener).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("settles a Codex GUI /goal initial turn after the goal item is emitted", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    let runtimeListener:
      | {
          onUpdate(update: Record<string, unknown>): void;
          onRuntimeEvent(event: RuntimeEvent): void;
        }
      | undefined;
    const startTurn = vi.fn<() => Promise<void>>(async () => {
      runtimeListener?.onRuntimeEvent({
        type: "item.started",
        threadId: "thread-gui-goal",
        itemId: "goal-turn-1",
        itemType: "goal",
        payload: {
          action: "set",
          objective: "ship GUI goal support",
          status: "active",
        },
      });
      runtimeListener?.onRuntimeEvent({
        type: "item.completed",
        threadId: "thread-gui-goal",
        itemId: "goal-turn-1",
      });
      runtimeListener?.onUpdate({ status: "idle", attention: "none" });
    });
    const setListener = vi.fn<
      (listener: {
        onUpdate(update: Record<string, unknown>): void;
        onRuntimeEvent(event: RuntimeEvent): void;
      }) => void
    >((listener) => {
      runtimeListener = listener;
      listener.onUpdate({
        status: "idle",
        attention: "none",
        sessionRef: {
          providerSessionId: "session-1",
          discoveredAt: "2026-05-10T12:00:00.000Z",
        },
      });
    });

    const adapter = {
      kind: "codex" as const,
      label: "Codex",
      capabilities: {
        models: [{ id: "gpt-5.4", label: "5.4" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
        presentationModes: ["terminal", "gui"] as const,
      },
      detectInstall: vi.fn<() => void>(),
      buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "codex",
        args: ["should-not-spawn"],
      })),
      buildResumeArgv: vi.fn<() => void>(),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
      createStructuredSession: vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({
        launchOptions: { suppressResumeConfigOverrides: true, resumeThreadId: "session-1" },
        activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openThread: vi.fn<() => Promise<string>>().mockResolvedValue("session-1"),
        startTurn,
        setListener,
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      }),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "codex",
      adapter,
    );

    await runtime.threadSessionManager.startThread({
      threadId: "thread-gui-goal",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "codex",
      config: {
        model: "gpt-5.4",
      },
      prompt: "/goal ship GUI goal support",
      presentationMode: "gui",
      initialSize: {
        cols: 132,
        rows: 42,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    const goalEvents = emitted.filter(
      (event) =>
        (event.type === "thread-runtime-event" || event.type === "thread-runtime-events") &&
        event.threadId === "thread-gui-goal",
    );
    const runtimeEvents = goalEvents.flatMap((event) =>
      event.type === "thread-runtime-events"
        ? ((event.events as RuntimeEvent[] | undefined) ?? [])
        : event.event
          ? [event.event as RuntimeEvent]
          : [],
    );
    expect(runtimeEvents).toContainEqual(
      expect.objectContaining({
        type: "item.started",
        itemType: "goal",
      }),
    );
    const threadStates = emitted.filter(
      (event) => event.type === "thread-state" && event.threadId === "thread-gui-goal",
    );
    expect(threadStates[0]).toMatchObject({
      status: "working",
      attention: "working",
    });
    expect(threadStates.at(-1)).toMatchObject({
      status: "idle",
      attention: "none",
      sessionRef: {
        providerSessionId: "session-1",
      },
    });
  });

  it("inserts Codex hook enable flags before the positional prompt", async () => {
    const runtime = makeRuntime(() => undefined);
    const pty = createMockPty();

    ptySpawnMock.mockReturnValueOnce(pty);

    const adapter = {
      kind: "codex" as const,
      label: "Codex",
      capabilities: {
        models: [{ id: "gpt-5.4", label: "5.4" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
      },
      detectInstall: vi.fn<() => void>(),
      extraArgsPosition: codexExtraArgsPosition,
      buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "codex",
        args: ["hello"],
      })),
      buildResumeArgv: vi.fn<() => void>(),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "codex",
      adapter,
    );
    (
      runtime as unknown as {
        cliHookPluginCoordinator: {
          resolvePluginEnvForSpawn: (input: unknown) => Promise<{
            env: Record<string, string>;
            extraArgs: string[];
          }>;
        };
      }
    ).cliHookPluginCoordinator.resolvePluginEnvForSpawn = vi.fn<
      (input: unknown) => Promise<{ env: Record<string, string>; extraArgs: string[] }>
    >(async () => ({
      env: { PORACODE_HOOK_URL: "http://127.0.0.1:43123/v1/agent-event" },
      extraArgs: ["--enable", "hooks"],
    }));

    await runtime.threadSessionManager.startThread({
      threadId: "thread-hook-order",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "codex",
      config: {
        model: "gpt-5.4",
      },
      prompt: "hello",
      initialSize: {
        cols: 120,
        rows: 30,
      },
    });

    const [, spawnArgs] = ptySpawnMock.mock.calls[0] as [string, string[]];
    const command = decodeSpawnCommand(spawnArgs);
    expect(command.indexOf("--enable")).toBeGreaterThan(-1);
    expect(command.indexOf("hooks")).toBeGreaterThan(command.indexOf("--enable"));
    expect(command.indexOf("hello")).toBeGreaterThan(command.indexOf("hooks"));
  });

  it("inserts Codex hook enable flags before the resume session id", async () => {
    const runtime = makeRuntime(() => undefined);
    const pty = createMockPty();

    ptySpawnMock.mockReturnValueOnce(pty);

    const adapter = {
      kind: "codex" as const,
      label: "Codex",
      capabilities: {
        models: [{ id: "gpt-5.4", label: "5.4" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
      },
      detectInstall: vi.fn<() => void>(),
      extraArgsPosition: codexExtraArgsPosition,
      buildLaunchArgv: vi.fn<() => void>(),
      buildResumeArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "codex",
        args: ["resume", "session-123", "next prompt"],
      })),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "codex",
      adapter,
    );
    (
      runtime as unknown as {
        cliHookPluginCoordinator: {
          resolvePluginEnvForSpawn: (input: unknown) => Promise<{
            env: Record<string, string>;
            extraArgs: string[];
          }>;
        };
      }
    ).cliHookPluginCoordinator.resolvePluginEnvForSpawn = vi.fn<
      (input: unknown) => Promise<{ env: Record<string, string>; extraArgs: string[] }>
    >(async () => ({
      env: { PORACODE_HOOK_URL: "http://127.0.0.1:43123/v1/agent-event" },
      extraArgs: ["--enable", "hooks"],
    }));

    await runtime.threadSessionManager.startThread({
      threadId: "thread-hook-resume-order",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "codex",
      config: {
        model: "gpt-5.4",
      },
      sessionRef: {
        providerSessionId: "session-123",
        discoveredAt: new Date().toISOString(),
      },
      prompt: "next prompt",
      initialSize: {
        cols: 120,
        rows: 30,
      },
    });

    const [, spawnArgs] = ptySpawnMock.mock.calls[0] as [string, string[]];
    const command = decodeSpawnCommand(spawnArgs);
    expect(command.indexOf("--enable")).toBeGreaterThan(-1);
    expect(command.indexOf("hooks")).toBeGreaterThan(command.indexOf("--enable"));
    expect(command.indexOf("session-123")).toBeGreaterThan(command.indexOf("hooks"));
    expect(command.indexOf("next prompt")).toBeGreaterThan(command.indexOf("session-123"));
  });

  it("skips TUI parsing hooks for server-backed GUI presentation", () => {
    const runtime = makeRuntime(() => undefined);
    const pty = createMockPty();
    const detectAutoResponse = vi.fn<(text: string) => unknown>(() => null);
    const isReadyForInitialPrompt = vi.fn<(text: string) => boolean>(() => false);
    const detectTerminalStatus = vi.fn<(text: string) => unknown>(() => null);

    ptySpawnMock.mockReturnValueOnce(pty);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          command: { command: string; args: string[] };
        }) => unknown;
      }
    ).spawnThread({
      threadId: "thread-gui",
      agentKind: "codex",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["high"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
        },
        createInitialSessionRef: vi
          .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
          .mockReturnValue(undefined),
        buildLaunchArgv: vi.fn<() => void>(),
        buildResumeArgv: vi.fn<() => void>(),
        detectAutoResponse,
        isReadyForInitialPrompt,
        detectTerminalStatus,
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "gpt-5.4",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      command: {
        command: "codex",
        args: [],
      },
    });

    pty.emitData("Update available!\nOpenAI Codex");

    expect(detectAutoResponse).not.toHaveBeenCalled();
    expect(isReadyForInitialPrompt).not.toHaveBeenCalled();
    expect(detectTerminalStatus).not.toHaveBeenCalled();
  });

  it.each(
    [
      {
        name: "posix",
        projectLocation: { kind: "posix" as const, path: "/tmp/repo" },
      },
      {
        name: "windows",
        projectLocation: { kind: "windows" as const, path: "C:\\repo" },
      },
    ].filter((variant) => variant.name !== "windows" || process.platform === "win32"),
  )(
    "passes a text + attachment prompt with special chars through to the launch arg unchanged on $name",
    async ({ projectLocation }) => {
      const runtime = makeRuntime(() => undefined);
      const pty = createMockPty();
      ptySpawnMock.mockReturnValueOnce(pty);

      const buildLaunchArgv = vi.fn<
        (location: unknown, config: unknown, prompt: string) => { binary: string; args: string[] }
      >((_location, _config, prompt) => ({
        binary: "claude",
        args: prompt.length > 0 ? ["--allow-dangerously-skip-permissions", prompt] : [],
      }));

      const adapter = {
        kind: "claude" as const,
        label: "Claude",
        capabilities: {
          models: [{ id: "opus", label: "Opus" }],
          efforts: ["high"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "default", label: "Default" }],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal" as const,
          presentationMode: "terminal" as const,
        },
        detectInstall: vi.fn<() => void>(),
        buildLaunchArgv,
        buildResumeArgv: vi.fn<() => void>(),
        createInitialSessionRef: vi.fn<() => undefined>().mockReturnValue(undefined),
        formatPromptSegments: (
          segments: Array<{ kind: string; content?: string; path?: string }>,
        ) => {
          const attachments = segments.filter((s) => s.kind === "attachment");
          const rest = segments.filter((s) => s.kind !== "attachment");
          const restStr = rest
            .map((s) => (s.kind === "file" ? `@${s.path}` : (s.content ?? "")))
            .join("");
          const attachmentLines = attachments.map((s) => `@${s.path}`).join(" ");
          return attachmentLines ? `${restStr}\n\n${attachmentLines} ` : restStr;
        },
      };

      (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
        "claude",
        adapter,
      );

      const spicyPrompt = "let's `do` $this\nwith 'quotes'";
      await runtime.threadSessionManager.startThread({
        threadId: "thread-prompt-quoting",
        projectLocation,
        agentKind: "claude",
        config: { model: "opus" },
        prompt: spicyPrompt,
        segments: [
          { kind: "text", content: spicyPrompt },
          { kind: "attachment", path: "/tmp/Image 1.png" },
        ],
        initialSize: { cols: 120, rows: 30 },
      });

      const formattedPrompt = `${spicyPrompt}\n\n@/tmp/Image 1.png `;
      const launchArgvCalls = buildLaunchArgv.mock.calls;
      expect(launchArgvCalls.length).toBeGreaterThan(0);
      expect(launchArgvCalls[0]![2]).toBe(formattedPrompt);

      const [, spawnArgs] = ptySpawnMock.mock.calls[0] as [string, string[]];
      const command = decodeSpawnCommand(spawnArgs);
      // Each problematic substring must survive the shell-quoting layer.
      expect(command).toContain("let");
      expect(command).toContain("do");
      expect(command).toContain("$this");
      expect(command).toContain("with");
      expect(command).toContain("quotes");
      expect(command).toContain("@/tmp/Image 1.png");
    },
  );
});

describe("SupervisorRuntime Codex profile login", () => {
  const windowsLocation = { kind: "windows" as const, path: "C:\\repo" };
  const posixLocation = { kind: "posix" as const, path: "/srv/repo" };
  const wslLocation = {
    kind: "wsl" as const,
    distro: "Ubuntu",
    linuxPath: "/home/demo/repo",
    uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\repo",
  };

  async function withPlatform<T>(platform: NodeJS.Platform, callback: () => Promise<T>) {
    const original = process.platform;
    Object.defineProperty(process, "platform", { configurable: true, value: platform });
    try {
      return await callback();
    } finally {
      Object.defineProperty(process, "platform", { configurable: true, value: original });
    }
  }

  async function startLoginForHost(platform: NodeJS.Platform) {
    return withPlatform(platform, async () => {
      const tempDir = makeTempDir();
      process.env.PORACODE_DATA_DIR = tempDir;
      const emitted: unknown[] = [];
      const runtime = makeRuntime((event) => emitted.push(event));
      const account = runtime.createCodexProfile({ label: `${platform} profile` });
      const pty = createMockPty();
      ptySpawnMock.mockReturnValueOnce(pty);
      const projectLocation = platform === "win32" ? windowsLocation : posixLocation;
      const result = await runtime.startCodexProfileLogin({
        accountId: account.accountId,
        shellId: `login:${platform}`,
        projectLocation,
        completionToken: "lc_supervisor_test",
        ...(platform === "win32" ? { windowsShellRuntime: "powershell" as const } : {}),
      });
      return { account, emitted, pty, projectLocation, result, runtime };
    });
  }

  it("starts an isolated Windows login with CODEX_HOME only in the trusted PTY environment", async () => {
    const { account, emitted, pty, result, runtime } = await startLoginForHost("win32");
    const spawnCall = ptySpawnMock.mock.calls.at(-1);
    if (!spawnCall) throw new Error("Expected a PTY spawn call.");
    const spawnOptions = spawnCall[2] as { cwd?: string; env?: Record<string, string> };
    const managedHome = runtime.codexProfileService.managedCodexHome(account.accountId);
    const script = pty.write.mock.calls[0]?.[0] ?? "";

    expect(result).toEqual({
      shellId: "login:win32",
      label: "win32 profile",
      completionToken: "lc_supervisor_test",
    });
    expect(spawnOptions.cwd?.replaceAll("\\", "/")).toMatch(/CraftStation\/.local\/codex-login$/i);
    expect(spawnOptions.env?.CODEX_HOME).toBe(managedHome);
    expect(script).toContain(
      "codex -c model_provider=openai -c sandbox_mode=danger-full-access login",
    );
    expect(script).not.toContain("model_catalog_json");
    expect(script).toContain("poracode-login-complete=lc_supervisor_test");
    expect(script).not.toContain(managedHome);
    expect(JSON.stringify(result)).not.toContain(managedHome);
    expect(emitted).toContainEqual({ type: "thread-reset", threadId: "login:win32" });
  });

  it("starts a POSIX login with a shell-native script and the isolated environment", async () => {
    const { account, pty, result, runtime } = await startLoginForHost("linux");
    const spawnCall = ptySpawnMock.mock.calls.at(-1);
    if (!spawnCall) throw new Error("Expected a PTY spawn call.");
    const spawnOptions = spawnCall[2] as { cwd?: string; env?: Record<string, string> };
    const managedHome = runtime.codexProfileService.managedCodexHome(account.accountId);
    const script = pty.write.mock.calls[0]?.[0] ?? "";

    expect(result.shellId).toBe("login:linux");
    expect(spawnOptions.cwd?.replaceAll("\\", "/")).toMatch(/CraftStation\/.local\/codex-login$/i);
    expect(spawnOptions.env?.CODEX_HOME).toBe(managedHome);
    expect(script).toMatch(/^command bash -lc '/u);
    expect(script).toContain(
      "codex -c model_provider=openai -c sandbox_mode=danger-full-access login",
    );
    expect(script).not.toContain("model_catalog_json");
    expect(script).toContain("poracode-login-complete=lc_supervisor_test");
    expect(script).not.toContain(managedHome);
  });

  it("rejects WSL projection instead of passing a Windows managed home into another host", async () => {
    await withPlatform("win32", async () => {
      const tempDir = makeTempDir();
      process.env.PORACODE_DATA_DIR = tempDir;
      const runtime = makeRuntime(() => undefined);
      const account = runtime.createCodexProfile({ label: "WSL blocked" });

      await expect(
        runtime.startCodexProfileLogin({
          accountId: account.accountId,
          shellId: "login:wsl-blocked",
          projectLocation: wslLocation,
          completionToken: "lc_wsl_test",
        }),
      ).rejects.toMatchObject({ code: "ACCOUNT_RUNTIME_UNSUPPORTED" });
      expect(ptySpawnMock).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["unknown", "missing-account", "ACCOUNT_NOT_FOUND"],
    ["non-codex", "non-codex", "ACCOUNT_RUNTIME_UNSUPPORTED"],
    ["disabled", "disabled", "ACCOUNT_RUNTIME_UNSUPPORTED"],
  ] as const)("rejects %s account login before spawning a shell", async (kind, label, code) => {
    await withPlatform("win32", async () => {
      const tempDir = makeTempDir();
      process.env.PORACODE_DATA_DIR = tempDir;
      const runtime = makeRuntime(() => undefined);
      const account =
        kind === "unknown"
          ? undefined
          : kind === "non-codex"
            ? runtime.addAccount({ provider: "claude", label })
            : runtime.createCodexProfile({ label });
      if (kind === "disabled" && account) runtime.setAccountEnabled(account.accountId, false);
      const accountId = account?.accountId ?? "codex:does-not-exist";

      await expect(
        runtime.startCodexProfileLogin({
          accountId,
          shellId: `login:${kind}`,
          projectLocation: windowsLocation,
          completionToken: "lc_rejection_test",
        }),
      ).rejects.toMatchObject({ code });
      expect(ptySpawnMock).not.toHaveBeenCalled();
    });
  });
});

describe("SupervisorRuntime Grok profile login", () => {
  const windowsLocation = { kind: "windows" as const, path: "C:\\repo" };

  function makeGrokRuntime() {
    const tempDir = makeTempDir();
    process.env.PORACODE_DATA_DIR = tempDir;
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => emitted.push(event));
    return { emitted, runtime };
  }

  function officialAuth(identity: Record<string, string>): string {
    return JSON.stringify({
      "https://auth.x.ai::test-client": {
        key: "access-token",
        refresh_token: "refresh-token",
        expires_at: "9999999999999",
        ...identity,
      },
    });
  }

  it("creates a pending Grok login without an AccountStore row", () => {
    const { runtime } = makeGrokRuntime();
    const pending = runtime.createGrokProfileLogin({ label: "Grok A" });
    expect(pending.pendingRef).toMatch(/^grok-pending:/u);
    expect(runtime.accountStore.list("grok")).toEqual([]);
    expect(runtime.grokPendingLogins.size).toBe(1);
  });

  it("starts the official device-auth login with the managed GROK_HOME env", async () => {
    const { runtime } = makeGrokRuntime();
    const pending = runtime.createGrokProfileLogin({ label: "Grok A" });
    const pty = createMockPty();
    ptySpawnMock.mockReturnValueOnce(pty);
    // Seed host leak candidates; the final login shell env must blank them.
    const priorGrokApiKey = process.env.GROK_API_KEY;
    const priorXaiApiKey = process.env.XAI_API_KEY;
    const priorClipProxy = process.env.CLIPROXY_HOME;
    const priorCodexRouter = process.env.CODEX_ROUTER_HOME;
    const priorModelCatalog = process.env.MODEL_CATALOG_PATH;
    process.env.GROK_API_KEY = "host-leak";
    process.env.XAI_API_KEY = "host-xai";
    process.env.CLIPROXY_HOME = "host-cli";
    process.env.CODEX_ROUTER_HOME = "host-router";
    process.env.MODEL_CATALOG_PATH = "host-catalog";

    const result = await runtime.startGrokProfileLogin({
      pendingRef: pending.pendingRef,
      shellId: "login:grok-a",
      projectLocation: windowsLocation,
      completionToken: "lc_grok_supervisor_test",
      windowsShellRuntime: "powershell",
    });

    expect(result.shellId).toBe("login:grok-a");
    const spawnCall = ptySpawnMock.mock.calls.at(-1);
    const spawnOptions = spawnCall?.[2] as { env?: Record<string, string> };
    const pendingHome = [...runtime.grokPendingLogins.values()][0]!.home;
    expect(spawnOptions?.env?.GROK_HOME).toBe(pendingHome);
    expect(spawnOptions?.env?.GROK_API_KEY).toBe("");
    expect(spawnOptions?.env?.XAI_API_KEY).toBe("");
    expect(spawnOptions?.env?.CLIPROXY_HOME).toBe("");
    expect(spawnOptions?.env?.CODEX_ROUTER_HOME).toBe("");
    expect(spawnOptions?.env?.MODEL_CATALOG_PATH).toBe("");
    const script = pty.write.mock.calls[0]?.[0] ?? "";
    expect(script).toContain("grok login --device-auth");

    if (priorGrokApiKey === undefined) delete process.env.GROK_API_KEY;
    else process.env.GROK_API_KEY = priorGrokApiKey;
    if (priorXaiApiKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = priorXaiApiKey;
    if (priorClipProxy === undefined) delete process.env.CLIPROXY_HOME;
    else process.env.CLIPROXY_HOME = priorClipProxy;
    if (priorCodexRouter === undefined) delete process.env.CODEX_ROUTER_HOME;
    else process.env.CODEX_ROUTER_HOME = priorCodexRouter;
    if (priorModelCatalog === undefined) delete process.env.MODEL_CATALOG_PATH;
    else process.env.MODEL_CATALOG_PATH = priorModelCatalog;
  });

  it("promotes a completed login with an official identity into an account", async () => {
    const { emitted, runtime } = makeGrokRuntime();
    const pending = runtime.createGrokProfileLogin({ label: "Grok A" });
    const pendingHome = [...runtime.grokPendingLogins.values()][0]!.home;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      `${pendingHome}\\auth.json`,
      officialAuth({ email: "person@example.com", principal_id: "principal-1" }),
      "utf8",
    );

    const account = runtime.completeGrokProfileLogin({ pendingRef: pending.pendingRef });

    expect(account.provider).toBe("grok");
    expect(account.status).toBe("available");
    expect(account.maskedIdentity).toBe("per***son@example.com");
    expect(runtime.accountStore.list("grok")).toHaveLength(1);
    expect(runtime.grokPendingLogins.size).toBe(0);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "usage-accounts",
        accounts: expect.arrayContaining([expect.objectContaining({ provider: "grok" })]),
      }),
    );
  });

  it("does not insert an account when the completed login has no identity", async () => {
    const { runtime } = makeGrokRuntime();
    const pending = runtime.createGrokProfileLogin({ label: "Grok A" });
    const pendingHome = [...runtime.grokPendingLogins.values()][0]!.home;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${pendingHome}\\auth.json`, officialAuth({}), "utf8");

    expect(() => runtime.completeGrokProfileLogin({ pendingRef: pending.pendingRef })).toThrow(
      /No official Grok identity/i,
    );
    expect(runtime.accountStore.list("grok")).toEqual([]);
    expect(runtime.grokPendingLogins.size).toBe(0);
    expect(existsSync(pendingHome)).toBe(false);
  });

  it("polls a pending login and promotes it once the official auth.json has an identity", async () => {
    const { runtime } = makeGrokRuntime();
    const pending = runtime.createGrokProfileLogin({ label: "Grok A" });
    const pendingHome = [...runtime.grokPendingLogins.values()][0]!.home;

    // No auth.json yet — not done.
    expect(runtime.pollGrokProfileLogin({ pendingRef: pending.pendingRef })).toEqual({
      done: false,
    });
    expect(runtime.accountStore.list("grok")).toEqual([]);

    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      `${pendingHome}\\auth.json`,
      officialAuth({ email: "person@example.com", user_id: "user-1" }),
      "utf8",
    );

    const result = runtime.pollGrokProfileLogin({ pendingRef: pending.pendingRef });
    expect(result.done).toBe(true);
    expect(runtime.accountStore.list("grok")).toHaveLength(1);
    expect(runtime.grokPendingLogins.size).toBe(0);
  });

  it("cancels a pending login without inserting an account", () => {
    const { runtime } = makeGrokRuntime();
    const pending = runtime.createGrokProfileLogin({ label: "Grok A" });
    const pendingHome = [...runtime.grokPendingLogins.values()][0]!.home;
    runtime.cancelGrokProfileLogin({ pendingRef: pending.pendingRef });
    expect(runtime.accountStore.list("grok")).toEqual([]);
    expect(runtime.grokPendingLogins.size).toBe(0);
    expect(existsSync(pendingHome)).toBe(false);
  });
});

describe("SupervisorRuntime craftAgent", () => {
  function craftPlan(threadId = "craft-runtime-thread") {
    const result = new Crafter().compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0], harness: "auto" } },
      { workspace: "C:\\repo", threadId },
    );
    expect(result.success).toBe(true);
    return result.craftPlan!;
  }

  function nativeCraftPlan(
    harnessKind: "grok" | "kimi" | "antigravity" | "deepseek",
    vendor: "xai" | "moonshot" | "google" | "deepseek",
    threadId = `craft-${harnessKind}`,
  ) {
    const base = craftPlan(threadId);
    return {
      ...base,
      ingredients: {
        model: { ...base.ingredients.model!, vendor, itemId: `${vendor}:model` },
        harness: {
          ...base.ingredients.harness!,
          vendor,
          itemId: `harness:${harnessKind}`,
        },
      },
      runtimeBinding: {
        ...base.runtimeBinding,
        harnessKind,
        vendor,
        modelId: `${harnessKind}-model`,
        runtimeAdapterId: `native-harness:${harnessKind}`,
      },
    };
  }

  function routedAdapter(harnessKind: string): HarnessRuntimeAdapter {
    return {
      id: `test-native:${harnessKind}`,
      harnessKind,
      supports: vi.fn<HarnessRuntimeAdapter["supports"]>(
        (plan) => plan.runtimeBinding.harnessKind === harnessKind,
      ),
      spawnEntity: vi.fn<HarnessRuntimeAdapter["spawnEntity"]>(async (plan) => ({
        id: `entity:test:${harnessKind}`,
        resultItemId: plan.resultItemId,
        craftPlan: plan,
        status: "spawned" as const,
        createdAt: new Date(0).toISOString(),
      })),
      createSession: async (entity) => ({
        id: `session:test:${harnessKind}`,
        threadId: entity.craftPlan.threadId,
        entityId: entity.id,
        status: "idle" as const,
        startTurn: async () => ({ turnId: "turn:test", status: "completed" as const, events: [] }),
        interrupt: async () => undefined,
        terminate: async () => undefined,
        getSnapshot: () => ({
          sessionId: `session:test:${harnessKind}`,
          entityId: entity.id,
          status: "idle" as const,
          events: [],
        }),
        subscribe: () => () => undefined,
        sendPrompt: async (prompt: string) => ({
          response: `${harnessKind}:${prompt}`,
          events: [],
        }),
      }),
      resumeSession: async () => {
        throw new Error("resume is not used by this route test");
      },
    };
  }

  it.each([
    ["grok", "xai"],
    ["kimi", "moonshot"],
    ["antigravity", "google"],
  ] as const)(
    "routes %s through the native adapter factory from craftAgent",
    async (harnessKind, vendor) => {
      const runtime = makeRuntime(() => undefined);
      const adapter = routedAdapter(harnessKind);
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set(harnessKind, factory);

      const result = await runtime.craftAgent({
        craftPlan: nativeCraftPlan(harnessKind, vendor),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        prompt: "native route",
      });

      expect(factory).toHaveBeenCalledWith(
        harnessKind,
        expect.objectContaining({
          projectLocation: { kind: "windows", path: "C:\\repo" },
        }),
      );
      expect(adapter.spawnEntity).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        entityId: `entity:test:${harnessKind}`,
        sessionId: `session:test:${harnessKind}`,
        response: `${harnessKind}:native route`,
      });
    },
  );

  it("routes DeepSeek through the unavailable native adapter without creating an Entity", async () => {
    const runtime = makeRuntime(() => undefined);
    const plan = nativeCraftPlan("deepseek", "deepseek");

    const rejection = runtime.craftAgent({
      craftPlan: plan,
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "must not spawn",
    });
    await expect(rejection).rejects.toThrow(/RUNTIME_UNAVAILABLE/);
    await expect(rejection).rejects.toThrow(/no synthetic Entity/);

    const diagnostics = await runtime.getNativeHarnessControlPlane({ harnessKind: "deepseek" });
    expect(diagnostics[0]).toMatchObject({
      status: "unavailable",
      descriptor: { harnessKind: "deepseek" },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "RUNTIME_UNAVAILABLE" }),
      ]),
    });
    expect(JSON.stringify(diagnostics)).not.toContain("CODEX_HOME");
  });

  it("runs spawn/create/send through Native Codex adapter and returns composition identities", async () => {
    const runtime = makeRuntime(() => undefined);
    runtime.setCustomCraftingAdapter(
      () =>
        new FakeCodexParityHarness({
          responseGenerator: () => "real native seam response",
        }),
    );

    const result = await runtime.craftAgent({
      craftPlan: craftPlan(),
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "hello from craft",
    });

    expect(result).toMatchObject({
      threadId: "craft-runtime-thread",
      sessionId: "sess:fake-codex:craft-runtime-thread",
      response: "real native seam response",
    });
    expect(result.entityId).toMatch(/^entity:fake-codex:/);
  });

  it("skips sendPrompt for an empty prompt", async () => {
    const runtime = makeRuntime(() => undefined);
    const startTurnSpy = vi.fn<(command: any) => Promise<any>>();
    runtime.setCustomCraftingAdapter(() => ({
      id: "spy-adapter",
      harnessKind: "codex",
      supports: () => true,
      spawnEntity: async (p) => ({
        id: "entity-spy",
        resultItemId: p.resultItemId,
        craftPlan: p,
        status: "spawned",
        createdAt: "",
      }),
      createSession: async (e) => ({
        id: "sess-spy",
        threadId: "craft-empty-prompt",
        entityId: e.id,
        status: "idle",
        startTurn: startTurnSpy,
        interrupt: async () => {},
        terminate: async () => {},
        getSnapshot: () => ({ sessionId: "sess-spy", entityId: e.id, status: "idle", events: [] }),
        subscribe: () => () => {},
        sendPrompt: async () => ({ response: "", events: [] }),
      }),
      resumeSession: async () => ({}) as any,
    }));

    const result = await runtime.craftAgent({
      craftPlan: craftPlan("craft-empty-prompt"),
      projectLocation: { kind: "posix", path: "/repo" },
      prompt: "",
    });

    expect(result.threadId).toBe("craft-empty-prompt");
    expect(startTurnSpy).not.toHaveBeenCalled();
  });

  it("routes the existing request-resolution IPC seam to a crafted native Session", async () => {
    const runtime = makeRuntime(() => undefined);
    const listeners = new Set<(event: RuntimeEvent) => void>();
    const respondToRequest = vi
      .fn<(requestId: string, resolution: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    runtime.setCustomCraftingAdapter(() => ({
      id: "request-adapter",
      harnessKind: "codex",
      supports: () => true,
      spawnEntity: async (plan) => ({
        id: "entity-request",
        resultItemId: plan.resultItemId,
        craftPlan: plan,
        status: "spawned",
        createdAt: "",
      }),
      createSession: async (entity) => ({
        id: "session-request",
        threadId: "craft-request-thread",
        entityId: entity.id,
        status: "idle",
        startTurn: async () => ({ turnId: "turn-request", status: "completed", events: [] }),
        respondToRequest,
        interrupt: async () => undefined,
        terminate: async () => undefined,
        getSnapshot: () => ({
          sessionId: "session-request",
          entityId: entity.id,
          status: "idle",
          events: [],
        }),
        subscribe: (listener) => {
          listeners.add((event) => listener(event, {} as never));
          return () => undefined;
        },
        sendPrompt: async () => ({ response: "", events: [] }),
      }),
      resumeSession: async () => {
        throw new Error("not used");
      },
    }));

    await runtime.craftAgent({
      craftPlan: craftPlan("craft-request-thread"),
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "",
    });
    for (const listener of listeners) {
      listener({
        type: "request.opened",
        threadId: "craft-request-thread",
        requestId: "permission_1",
        requestType: "tool_call_approval",
        payload: { summary: "Allow?", options: [{ optionId: "once", label: "Allow once" }] },
      });
    }
    await runtime.resolveThreadServerRequest({
      threadId: "craft-request-thread",
      requestId: "permission_1",
      method: "requestPermission",
      response: { optionId: "once" },
    });
    expect(respondToRequest).toHaveBeenCalledWith("permission_1", {
      kind: "permission",
      response: "once",
    });

    for (const listener of listeners) {
      listener({
        type: "request.opened",
        threadId: "craft-request-thread",
        requestId: "question_1",
        requestType: "tool_user_input",
        payload: {
          summary: "Choose",
          details: {
            userInputForm: {
              questions: [
                {
                  id: "q0",
                  question: "Choose",
                  options: [{ optionId: "q0.0", label: "TypeScript" }],
                  multiSelect: false,
                  custom: true,
                },
              ],
            },
          },
        },
      });
    }
    await runtime.resolveThreadServerRequest({
      threadId: "craft-request-thread",
      requestId: "question_1",
      method: "requestPermission",
      response: { answers: { q0: "q0.0" } },
    });
    expect(respondToRequest).toHaveBeenLastCalledWith("question_1", {
      kind: "question",
      action: "answer",
      answers: [["TypeScript"]],
    });
  });

  it("preserves the legacy ThreadSessionManager request-resolution path", async () => {
    const runtime = makeRuntime(() => undefined);
    const legacyResolve = vi
      .spyOn(runtime.threadSessionManager, "resolveThreadServerRequest")
      .mockResolvedValue(undefined);
    const payload = {
      threadId: "legacy-thread",
      requestId: "legacy-request",
      method: "requestPermission",
      response: { optionId: "allow" },
    };

    await runtime.resolveThreadServerRequest(payload);
    expect(legacyResolve).toHaveBeenCalledWith(payload);
  });

  it("maps adapter execution failure to a structured diagnostic", async () => {
    const runtime = makeRuntime(() => undefined);
    runtime.setCustomCraftingAdapter(() => ({
      id: "failing-adapter",
      harnessKind: "codex",
      supports: () => true,
      spawnEntity: async (p) => ({
        id: "entity-fail",
        resultItemId: p.resultItemId,
        craftPlan: p,
        status: "spawned",
        createdAt: "",
      }),
      createSession: async () => {
        throw CraftingError.executionFailed("AppServer connection refused: port closed");
      },
      resumeSession: async () => ({}) as any,
    }));

    await expect(
      runtime.craftAgent({
        craftPlan: craftPlan("craft-fail"),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        prompt: "hello",
      }),
    ).rejects.toThrow(/EXECUTION_FAILED/);
  });

  it("rejects a non-Codex plan before touching the adapter", async () => {
    const runtime = makeRuntime(() => undefined);

    await expect(
      runtime.craftAgent({
        craftPlan: {
          ...craftPlan("craft-unsupported"),
          runtimeBinding: {
            ...craftPlan("craft-unsupported").runtimeBinding,
            harnessKind: "unknown-harness",
          },
        },
        projectLocation: { kind: "posix", path: "/repo" },
        prompt: "hello",
      }),
    ).rejects.toThrow(/RUNTIME_UNAVAILABLE/);
  });

  describe("Grok account control plane", () => {
    beforeEach(() => {
      process.env.PORACODE_DATA_DIR = makeTempDir();
    });

    function addGrokAccount(
      runtime: SupervisorRuntime,
      label: string,
      status: "available" | "quota-exhausted" = "available",
    ) {
      const account = runtime.addAccount({
        provider: "grok",
        label,
        maskedIdentity: `${label}@example.com`,
      });
      runtime.accountStore.updateStatus(account.accountId, status);
      return account;
    }

    it("binds a new Session to the first usable Grok account and injects its managed GROK_HOME", async () => {
      const runtime = makeRuntime(() => undefined);
      const accountA = addGrokAccount(runtime, "A");
      const accountB = addGrokAccount(runtime, "B");

      const adapter = routedAdapter("grok");
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("grok", factory);

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-session-priority-a"),
        projectLocation: { kind: "windows", path: "C:\repo" },
        prompt: "bind A",
      });

      const options = factory.mock.calls[0]?.[1] as {
        accountBinding?: { accountId: string; provider: string; reason: string };
        baseSpawnEnv?: Record<string, string>;
      };
      expect(options.accountBinding?.accountId).toBe(accountA.accountId);
      expect(options.accountBinding?.provider).toBe("grok");
      expect(options.accountBinding?.reason).toBe("priority");
      expect(options.baseSpawnEnv?.GROK_HOME).toBe(
        runtime.accountStore.credentialRoot(accountA.accountId),
      );
      expect(options.baseSpawnEnv?.GROK_HOME).not.toBe(
        runtime.accountStore.credentialRoot(accountB.accountId),
      );
    });

    it("binds a new Session to an explicitly overridden Grok account", async () => {
      const runtime = makeRuntime(() => undefined);
      const accountA = addGrokAccount(runtime, "A");
      const accountB = addGrokAccount(runtime, "B");

      const adapter = routedAdapter("grok");
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("grok", factory);

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-session-explicit-b"),
        projectLocation: { kind: "windows", path: "C:\repo" },
        accountId: accountB.accountId,
        accountMode: "explicit",
        prompt: "bind B",
      });

      const options = factory.mock.calls[0]?.[1] as {
        accountBinding?: { accountId: string; reason: string };
      };
      expect(options.accountBinding?.accountId).toBe(accountB.accountId);
      expect(options.accountBinding?.reason).toBe("explicit");
      void accountA;
    });

    it("auto-picks the next Grok account in priority order when the first is exhausted", async () => {
      const runtime = makeRuntime(() => undefined);
      addGrokAccount(runtime, "A", "quota-exhausted");
      const accountB = addGrokAccount(runtime, "B");

      const adapter = routedAdapter("grok");
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("grok", factory);

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-session-auto-fallback"),
        projectLocation: { kind: "windows", path: "C:\repo" },
        prompt: "auto fallback",
      });

      const options = factory.mock.calls[0]?.[1] as { accountBinding?: { accountId: string } };
      const recordA = runtime.accountStore.getRecord(
        runtime.accountStore.list("grok")[0]!.accountId,
      );
      const listGrok = runtime.accountStore.list("grok").map((a) => [a.label, a.status]);
      expect(listGrok).toEqual([
        ["A", "quota-exhausted"],
        ["B", "available"],
      ]);
      expect(recordA?.status).toBe("quota-exhausted");
      const resolved = runtime.accountResolver.resolve({
        provider: "grok",
        mode: "auto",
      });
      expect(resolved.account.accountId).toBe(accountB.accountId);
      expect(resolved.reason).toBe("priority");
      expect(resolved.candidates).toContainEqual(
        expect.objectContaining({ accountId: accountB.accountId, eligible: true }),
      );
      expect(options.accountBinding?.accountId).toBe(accountB.accountId);
    });

    it("marks only the bound Grok account quota-exhausted from the official ACP error shape", async () => {
      const runtime = makeRuntime(() => undefined);
      const accountA = addGrokAccount(runtime, "A");
      const accountB = addGrokAccount(runtime, "B");

      const adapter = routedAdapter("grok");
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("grok", factory);

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-session-quota-error"),
        projectLocation: { kind: "windows", path: "C:\repo" },
        accountId: accountA.accountId,
        accountMode: "explicit",
        prompt: "bound A",
      });

      const options = factory.mock.calls[0]?.[1] as {
        onPromptError?: (error: unknown) => void | Promise<void>;
      };
      expect(options.onPromptError).toBeTypeOf("function");
      await options.onPromptError?.(
        new RequestError(-32603, "Internal error", {
          message: "API error (status 402 Payment Required): Grok Build usage balance exhausted",
          http_status: 402,
        }),
      );

      expect(runtime.accountStore.get(accountA.accountId)?.status).toBe("quota-exhausted");
      expect(runtime.accountStore.get(accountB.accountId)?.status).toBe("available");
    });

    it("persists quota exhaustion when the first craftAgent prompt rejects with a duck-typed error", async () => {
      const runtime = makeRuntime(() => undefined);
      const account = addGrokAccount(runtime, "A");

      const adapter = routedAdapter("grok");
      const originalCreateSession = adapter.createSession.bind(adapter);
      const quotaError = Object.assign(new Error("Internal error"), {
        code: -32603,
        data: {
          message: "API error (status 402 Payment Required): Grok Build usage balance exhausted",
          http_status: 402,
        },
      });
      adapter.createSession = async (entity) => {
        const session = await originalCreateSession(entity);
        session.sendPrompt = async () => {
          throw quotaError;
        };
        return session;
      };
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("grok", factory);

      await expect(
        runtime.craftAgent({
          craftPlan: nativeCraftPlan("grok", "xai", "grok-first-turn-quota"),
          projectLocation: { kind: "windows", path: "C:\repo" },
          accountId: account.accountId,
          accountMode: "explicit",
          prompt: "first turn",
        }),
      ).rejects.toMatchObject(quotaError);

      expect(runtime.accountStore.get(account.accountId)).toMatchObject({
        status: "quota-exhausted",
        lastError: "Grok 额度已耗尽",
        lastQuotaAt: expect.any(Number),
      });
      const metadata = JSON.parse(
        readFileSync(join(runtime.accountStore.managedRoot, "accounts.json"), "utf8"),
      ) as { accounts: Array<{ accountId: string; status: string }> };
      expect(metadata.accounts).toEqual([
        expect.objectContaining({ accountId: account.accountId, status: "quota-exhausted" }),
      ]);
    });

    it("rejects an exhausted explicit Grok account instead of silently falling back", async () => {
      const runtime = makeRuntime(() => undefined);
      const accountA = addGrokAccount(runtime, "A", "quota-exhausted");
      addGrokAccount(runtime, "B");

      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>();
      nativeHarnessFactoryOverrides.set("grok", factory);

      await expect(
        runtime.craftAgent({
          craftPlan: nativeCraftPlan("grok", "xai", "grok-session-explicit-error"),
          projectLocation: { kind: "windows", path: "C:\repo" },
          accountId: accountA.accountId,
          accountMode: "explicit",
          prompt: "must not fall back",
        }),
      ).rejects.toThrow(/explicitly requested account is unavailable/);
      expect(factory).not.toHaveBeenCalled();
    });

    it("keeps an already-started Session bound to its original account after pool changes", async () => {
      const runtime = makeRuntime(() => undefined);
      const accountA = addGrokAccount(runtime, "A");
      const accountB = addGrokAccount(runtime, "B");

      const adapterA = routedAdapter("grok");
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>();
      nativeHarnessFactoryOverrides.set("grok", factory);
      factory.mockImplementation(() => adapterA);

      const sessionA = await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-session-sticky-a"),
        projectLocation: { kind: "windows", path: "C:\repo" },
        accountId: accountA.accountId,
        accountMode: "explicit",
        prompt: "sticky A",
      });
      expect(sessionA.accountBinding?.accountId).toBe(accountA.accountId);

      // A NEW session with an explicit override binds B while session A stays A.
      const adapterB = routedAdapter("grok");
      factory.mockImplementation(() => adapterB);
      const sessionB = await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-session-sticky-b"),
        projectLocation: { kind: "windows", path: "C:\repo" },
        accountId: accountB.accountId,
        accountMode: "explicit",
        prompt: "sticky B",
      });

      expect(sessionB.accountBinding?.accountId).toBe(accountB.accountId);
      expect(sessionA.accountBinding?.accountId).toBe(accountA.accountId);
      expect(sessionA.accountBinding?.accountId).not.toBe(sessionB.accountBinding?.accountId);
    });

    it("blocks removing an account with a live craft session binding (v0.5 T09)", async () => {
      const runtime = makeRuntime(() => undefined);
      const account = addGrokAccount(runtime, "A");

      const adapter = routedAdapter("grok");
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("grok", factory);

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-lifecycle-bound"),
        projectLocation: { kind: "windows", path: "C:\repo" },
        accountId: account.accountId,
        accountMode: "explicit",
        prompt: "bind",
      });

      expect(() => runtime.removeAccount(account.accountId)).toThrow(/live Session binding/);
      expect(runtime.accountStore.get(account.accountId)).toBeDefined();
    });

    it("releases a crafted account binding when the public closeThread seam terminates it", async () => {
      const runtime = makeRuntime(() => undefined);
      const account = addGrokAccount(runtime, "A");
      const adapter = routedAdapter("grok");
      nativeHarnessFactoryOverrides.set(
        "grok",
        vi.fn(() => adapter),
      );

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-lifecycle-release"),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        accountId: account.accountId,
        accountMode: "explicit",
        prompt: "bind",
      });

      await expect(
        runtime.closeThread({ threadId: "grok-lifecycle-release" }),
      ).resolves.toBeUndefined();
      expect(() => runtime.removeAccount(account.accountId)).not.toThrow();
      expect(runtime.accountStore.get(account.accountId)).toBeUndefined();
    });

    it("allows removing an unbound account and does not touch the host profile (v0.5 T09)", () => {
      const runtime = makeRuntime(() => undefined);
      const account = runtime.addAccount({ provider: "grok", label: "A" });
      runtime.removeAccount(account.accountId);
      expect(runtime.accountStore.get(account.accountId)).toBeUndefined();
    });
  });
});

describe("SupervisorRuntime account refresh lock (v0.5 T09)", () => {
  it("coalesces concurrent per-account quota refreshes into one collector call", async () => {
    const runtime = makeRuntime(() => undefined);
    const account = runtime.addAccount({ provider: "codex", label: "A" });
    runtime.accountStore.updateStatus(account.accountId, "available");
    let calls = 0;
    runtime.codexProfileService.collectQuota = vi.fn<
      () => Promise<import("@/shared/contracts").AccountView>
    >(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return runtime.accountStore.get(account.accountId)!;
    });

    const [first, second] = await Promise.all([
      runtime.refreshAccountQuota(account.accountId),
      runtime.refreshAccountQuota(account.accountId),
    ]);
    expect(calls).toBe(1);
    expect(first.accountId).toBe(account.accountId);
    expect(second.accountId).toBe(account.accountId);
  });
});
