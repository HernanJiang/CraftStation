import { DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR } from "./runtime/nativeHarness/descriptors";
import { NativeProcessHarnessRuntimeAdapter } from "./runtime/nativeHarness/nativeAdapter";
import { PassThrough, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IPty } from "node-pty";
import { RequestError } from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent, ThreadConfig } from "@/shared/contracts";
import {
  craftPlanSchema,
  Crafter,
  BUILTIN_MODEL_ITEMS,
  CraftingError,
  type HarnessRuntimeAdapter,
  type SessionEventListener,
} from "@/shared/crafting";
import { TranscriptBuffer } from "@/shared/transcriptBuffer";
import { resolveCraftStationPaths } from "@/shared/craftstationPaths";
import { setUsageSecret } from "@/shared/usageSecretStore";
import type { SessionRuntime } from "./runtime/sessionTypes";
import { NativeCodexRuntimeAdapter } from "./runtime/nativeCodex";
import { isolateRuntimeMcpEnvironment } from "./runtime/testSupport/runtimeEnvironment";

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
const craftstationDataDirBeforeTests = process.env.CRAFTSTATION_DATA_DIR;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "craftstation-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function makeRuntime(emit: ConstructorParameters<typeof SupervisorRuntime>[0]): SupervisorRuntime {
  const runtime = new SupervisorRuntime(emit);
  // Runtime 编排夹具不应读取或投影宿主真实 Skills；技能专用用例会覆盖这些 spy。
  vi.spyOn(runtime.skillsService, "prepareForLaunch").mockResolvedValue(undefined);
  vi.spyOn(runtime.skillsService, "scan").mockResolvedValue({
    skills: [],
    effectiveSkillIds: [],
    invocation: "slash",
    issues: [],
    canLinkToGlobal: true,
  });
  runtimesToDispose.push(runtime);
  return runtime;
}

beforeEach(() => {
  isolateRuntimeMcpEnvironment();
  const baseDir = makeTempDir();
  vi.stubEnv("CRAFTSTATION_DATA_DIR", baseDir);
  writeFileSync(
    join(baseDir, "settings.json"),
    JSON.stringify({ locale: "en", customGlobalPrompt: "" }),
  );
});

afterEach(async () => {
  // Dispose any runtimes the test created so their owned services (LSP
  // manager, project watcher, session manager, hook coordinator) stop
  // scheduling async work. Without this, lingering operations can log to
  // console after the test file completes — vitest's worker IPC then
  // rejects the queued `onUserConsoleLog` forward as it tears down,
  // surfacing as an unhandled rejection that fails the CI run.
  await Promise.allSettled(runtimesToDispose.splice(0).map((runtime) => runtime.disposeAsync()));
  vi.unstubAllEnvs();
  // Restoring an env var to `undefined` coerces it to the literal string
  // "undefined" (Node stringifies anything assigned to `process.env.X`).
  // That bug used to cause the supervisor to resolve its baseDir as the
  // string "undefined" and create `./undefined/settings.json` in cwd on
  // the next `SupervisorRuntime` construction. Use `delete` when the
  // original value was absent; assign otherwise.
  if (craftstationDataDirBeforeTests === undefined) {
    delete process.env.CRAFTSTATION_DATA_DIR;
  } else {
    process.env.CRAFTSTATION_DATA_DIR = craftstationDataDirBeforeTests;
  }
  taskkillSpawnSyncMock.mockReset();
  taskkillSpawnSyncMock.mockReturnValue({ error: undefined, status: 0 });
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
    // The catch chain runs pool failover and Craft-Harness retry checks before
    // failing the session — each decision is async, so wait for the event
    // rather than a fixed number of microtask ticks.
    await vi.waitFor(() => {
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
    process.env.CRAFTSTATION_DATA_DIR = tempDir;
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
        workingSilenceTimeoutMs: 2000,
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

  it("keeps an adapter working when no silence watchdog is declared", async () => {
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
    ).handlePtyData(session, "Long-running provider task without a status marker");

    await vi.advanceTimersByTimeAsync(20_000);

    expect(session.status).toBe("working");
    expect(
      emitted.filter((event) => event.type === "thread-state" && event.status === "idle"),
    ).toHaveLength(0);
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
      env: { CRAFTSTATION_HOOK_URL: "http://127.0.0.1:43123/v1/agent-event" },
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
      env: { CRAFTSTATION_HOOK_URL: "http://127.0.0.1:43123/v1/agent-event" },
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
      process.env.CRAFTSTATION_DATA_DIR = tempDir;
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
    expect(script).toContain("craftstation-login-complete=lc_supervisor_test");
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
    expect(script).toContain("craftstation-login-complete=lc_supervisor_test");
    expect(script).not.toContain(managedHome);
  });

  it("rejects WSL projection instead of passing a Windows managed home into another host", async () => {
    await withPlatform("win32", async () => {
      const tempDir = makeTempDir();
      process.env.CRAFTSTATION_DATA_DIR = tempDir;
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
      process.env.CRAFTSTATION_DATA_DIR = tempDir;
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
    process.env.CRAFTSTATION_DATA_DIR = tempDir;
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
    writeFileSync(
      `${pendingHome}\\auth.json`,
      officialAuth({ email: "person@example.com", principal_id: "principal-1" }),
      "utf8",
    );

    const account = runtime.completeGrokProfileLogin({ pendingRef: pending.pendingRef });

    expect(account.provider).toBe("grok");
    expect(account.status).toBe("available");
    // 邮箱全称 contract: the Grok row keeps the unmasked email.
    expect(account.maskedIdentity).toBe("person@example.com");
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
  function craftedLifecycleCounts(runtime: SupervisorRuntime) {
    const lifecycle = runtime as unknown as {
      craftedSessionsByThread: Map<string, unknown>;
      craftedSessionBindings: Map<string, unknown>;
      craftedSessionUnsubscribers: Map<string, unknown>;
      nativeHarnessSessions: Map<string, unknown>;
    };
    return {
      craftedSessions: lifecycle.craftedSessionsByThread.size,
      craftedBindings: lifecycle.craftedSessionBindings.size,
      craftedUnsubscribers: lifecycle.craftedSessionUnsubscribers.size,
      nativeHarnessSessions: lifecycle.nativeHarnessSessions.size,
    };
  }

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
        modelId: harnessKind === "deepseek" ? "deepseek-v4-flash" : `${harnessKind}-model`,
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

  it("publishes crafted lifecycle state and native identity without waiting for reply text", async () => {
    process.env.CRAFTSTATION_DATA_DIR = makeTempDir();
    const updates: Record<string, unknown>[] = [];
    const runtime = makeRuntime((event) => {
      if (event.type === "thread-state") updates.push(event);
    });
    const adapter = routedAdapter("grok");
    const create = adapter.createSession;
    let listener: SessionEventListener | undefined;
    adapter.createSession = async (entity) => {
      const session = await create(entity);
      return {
        ...session,
        nativeSessionRef: "native-state-ref",
        subscribe: (next) => {
          listener = next;
          return () => {};
        },
      };
    };
    nativeHarnessFactoryOverrides.set("grok", () => adapter);
    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("grok", "xai", "state-thread"),
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "",
    });
    const snapshot = {
      sessionId: "session:test:grok",
      entityId: "entity:test:grok",
      status: "busy" as const,
      events: [],
    };
    listener!({ type: "turn.started", threadId: "state-thread", turnId: "turn-state" }, snapshot);
    expect(updates.at(-1)).toMatchObject({
      status: "working",
      sessionRef: { providerSessionId: "native-state-ref" },
    });
    listener!(
      {
        type: "request.opened",
        threadId: "state-thread",
        requestId: "r",
        requestType: "tool_user_input",
        payload: { summary: "choose", details: {} },
      },
      snapshot,
    );
    expect(updates.at(-1)).toMatchObject({ status: "needs_reply" });
    listener!(
      { type: "request.resolved", threadId: "state-thread", requestId: "r", outcome: "answered" },
      snapshot,
    );
    listener!(
      {
        type: "turn.completed",
        threadId: "state-thread",
        turnId: "turn-state",
        state: "completed",
      },
      snapshot,
    );
    expect(updates.at(-1)).toMatchObject({ status: "idle" });
  });

  it.each([
    ["grok", "xai"],
    ["kimi", "moonshot"],
    ["antigravity", "google"],
  ] as const)(
    "routes %s through the native adapter factory from craftAgent",
    async (harnessKind, vendor) => {
      // Isolate from the real user account store: pool membership and native
      // identity checks must not depend on machine-local credentials.
      process.env.CRAFTSTATION_DATA_DIR = makeTempDir();
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

  it("resolves only the CraftPlan-selected MCP server before constructing a native adapter", async () => {
    const runtime = makeRuntime(() => undefined);
    const adapter = routedAdapter("grok");
    const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
    nativeHarnessFactoryOverrides.set("grok", factory);
    const selectedServer = {
      id: "craft-probe",
      name: "craft-probe",
      description: "selected",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "stdio" as const, command: "node", args: ["probe.mjs"], env: {} },
    };
    const unselectedServer = {
      ...selectedServer,
      id: "not-selected",
      name: "not-selected",
    };
    const basePlan = nativeCraftPlan("grok", "xai", "craft-grok-mcp");

    await runtime.craftAgent({
      craftPlan: {
        ...basePlan,
        overrides: { ...basePlan.overrides, mcpServerIds: [selectedServer.id] },
      },
      projectLocation: { kind: "windows", path: "C:\\repo" },
      mcpServers: [selectedServer, unselectedServer],
      prompt: "native MCP route",
    });

    expect(factory).toHaveBeenCalledWith(
      "grok",
      expect.objectContaining({
        mcpServers: [
          {
            id: selectedServer.id,
            name: selectedServer.name,
            timeoutMs: selectedServer.timeoutMs,
            transport: selectedServer.transport,
          },
        ],
      }),
    );
  });

  it("injects all enabled and compatible MCP servers in Auto mode when no explicit ids are given", async () => {
    const runtime = makeRuntime(() => undefined);
    const adapter = routedAdapter("grok");
    const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
    nativeHarnessFactoryOverrides.set("grok", factory);

    const s1 = {
      id: "server-one",
      name: "server_one",
      description: "s1",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "stdio" as const, command: "node", args: ["s1.mjs"], env: {} },
    };
    const s2 = {
      id: "server-two",
      name: "server_two",
      description: "s2",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "stdio" as const, command: "node", args: ["s2.mjs"], env: {} },
    };
    const sDisabled = {
      id: "server-disabled",
      name: "server_disabled",
      description: "sDisabled",
      enabled: false,
      timeoutMs: 30_000,
      transport: { type: "stdio" as const, command: "node", args: ["sd.mjs"], env: {} },
    };
    const basePlan = nativeCraftPlan("grok", "xai", "craft-grok-auto-mcp");

    await runtime.craftAgent({
      craftPlan: {
        ...basePlan,
        overrides: { ...basePlan.overrides, capabilityMode: "auto" },
      },
      projectLocation: { kind: "windows", path: "C:\repo" },
      mcpServers: [s1, s2, sDisabled],
      prompt: "native Auto MCP route",
    });

    expect(factory).toHaveBeenCalledWith(
      "grok",
      expect.objectContaining({
        mcpServers: [
          expect.objectContaining({ id: "server-one" }),
          expect.objectContaining({ id: "server-two" }),
        ],
      }),
    );
  });

  it("injects all enabled MCP servers in Efficient mode (default-inject policy)", async () => {
    const runtime = makeRuntime(() => undefined);
    const adapter = routedAdapter("grok");
    const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
    nativeHarnessFactoryOverrides.set("grok", factory);

    const sBrowser = {
      id: "browser",
      name: "browser",
      description: "browser",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "stdio" as const, command: "node", args: ["browser.mjs"], env: {} },
    };
    const sOther = {
      id: "other-mcp",
      name: "other_mcp",
      description: "other",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "stdio" as const, command: "node", args: ["other.mjs"], env: {} },
    };
    const basePlan = nativeCraftPlan("grok", "xai", "craft-grok-efficient-mcp");

    await runtime.craftAgent({
      craftPlan: {
        ...basePlan,
        overrides: { ...basePlan.overrides, capabilityMode: "efficient" },
      },
      projectLocation: { kind: "windows", path: "C:\repo" },
      mcpServers: [sBrowser, sOther],
      prompt: "native Efficient MCP route",
    });

    // Default-inject policy: enabled means injected, regardless of harness.
    expect(factory).toHaveBeenCalledWith(
      "grok",
      expect.objectContaining({
        // Efficient mode may also include supervisor-owned built-ins such as
        // app-controls; assert the user-configured servers without freezing
        // the complete provider projection.
        mcpServers: expect.arrayContaining([
          expect.objectContaining({ id: "browser" }),
          expect.objectContaining({ id: "other-mcp" }),
        ]),
      }),
    );
  });

  it("rejects a missing or disabled CraftPlan MCP id before constructing an Entity", async () => {
    const runtime = makeRuntime(() => undefined);
    const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>();
    nativeHarnessFactoryOverrides.set("grok", factory);
    const basePlan = nativeCraftPlan("grok", "xai", "craft-grok-mcp-missing");

    const rejection = runtime.craftAgent({
      craftPlan: {
        ...basePlan,
        overrides: { ...basePlan.overrides, mcpServerIds: ["disabled-probe"] },
      },
      projectLocation: { kind: "windows", path: "C:\\repo" },
      mcpServers: [
        {
          id: "disabled-probe",
          name: "disabled-probe",
          description: "disabled",
          enabled: false,
          timeoutMs: 30_000,
          transport: { type: "stdio", command: "node", args: ["probe.mjs"], env: {} },
        },
      ],
      prompt: "must not spawn",
    });

    await expect(rejection).rejects.toThrow(/RUNTIME_UNAVAILABLE/);
    await expect(rejection).rejects.toThrow(/disabled-probe/);
    expect(factory).not.toHaveBeenCalled();
    expect(craftedLifecycleCounts(runtime)).toEqual({
      craftedSessions: 0,
      craftedBindings: 0,
      craftedUnsubscribers: 0,
      nativeHarnessSessions: 0,
    });
  });

  it("resolves a CraftPlan-selected skill through SkillsService before constructing the adapter", async () => {
    const runtime = makeRuntime(() => undefined);
    const adapter = routedAdapter("grok");
    const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
    nativeHarnessFactoryOverrides.set("grok", factory);
    const skillFilePath = "C:\\repo\\.agents\\skills\\agentic-probe\\SKILL.md";
    vi.spyOn(runtime.skillsService, "prepareForLaunch").mockResolvedValue(undefined);
    vi.spyOn(runtime.skillsService, "scan").mockResolvedValue({
      skills: [
        {
          id: "agents:project:agentic-probe",
          name: "agentic-probe",
          description: "Probe skill",
          folderName: "agentic-probe",
          absolutePath: "C:\\repo\\.agents\\skills\\agentic-probe",
          skillFilePath,
          rootPath: "C:\\repo\\.agents\\skills",
          providerId: "agents",
          providerLabel: "Shared agent skills",
          scope: "project",
          scopeLabel: "Project",
          origin: "external",
          enabled: true,
          mutable: false,
          valid: true,
          linked: false,
        },
      ],
      effectiveSkillIds: ["agents:project:agentic-probe"],
      invocation: "slash",
      issues: [],
      canLinkToGlobal: true,
    });
    vi.spyOn(runtime.skillsService, "filterPluginSkillSegments").mockImplementation(
      async (segments) => [...segments],
    );
    vi.spyOn(runtime.skillsService, "buildTurnSkillInjection").mockResolvedValue(
      "INLINE_SKILL_INSTRUCTIONS",
    );
    const basePlan = nativeCraftPlan("grok", "xai", "craft-grok-skill");

    await runtime.craftAgent({
      craftPlan: {
        ...basePlan,
        overrides: { ...basePlan.overrides, skills: ["agents:project:agentic-probe"] },
      },
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "native skill route",
    });

    expect(runtime.skillsService.prepareForLaunch).toHaveBeenCalledWith(
      { kind: "windows", path: "C:\\repo" },
      "grok",
    );
    expect(factory).toHaveBeenCalledWith(
      "grok",
      expect.objectContaining({
        skillSegments: [
          expect.objectContaining({
            kind: "skill",
            name: "agentic-probe",
            path: skillFilePath,
            invocation: "/agentic-probe",
          }),
        ],
        inlineSkillInstructions: "INLINE_SKILL_INSTRUCTIONS",
      }),
    );
  });

  it("keeps the $ prefix on dollar-invocation skill segments", async () => {
    const runtime = makeRuntime(() => undefined);
    const adapter = routedAdapter("grok");
    const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
    nativeHarnessFactoryOverrides.set("grok", factory);
    const skillFilePath = "C:\\repo\\.agents\\skills\\agentic-probe\\SKILL.md";
    vi.spyOn(runtime.skillsService, "prepareForLaunch").mockResolvedValue(undefined);
    vi.spyOn(runtime.skillsService, "scan").mockResolvedValue({
      skills: [
        {
          id: "agents:project:agentic-probe",
          name: "agentic-probe",
          description: "Probe skill",
          folderName: "agentic-probe",
          absolutePath: "C:\\repo\\.agents\\skills\\agentic-probe",
          skillFilePath,
          rootPath: "C:\\repo\\.agents\\skills",
          providerId: "agents",
          providerLabel: "Shared agent skills",
          scope: "project",
          scopeLabel: "Project",
          origin: "external",
          enabled: true,
          mutable: false,
          valid: true,
          linked: false,
        },
      ],
      effectiveSkillIds: ["agents:project:agentic-probe"],
      invocation: "dollar",
      issues: [],
      canLinkToGlobal: true,
    });
    vi.spyOn(runtime.skillsService, "filterPluginSkillSegments").mockImplementation(
      async (segments) => [...segments],
    );
    vi.spyOn(runtime.skillsService, "buildTurnSkillInjection").mockResolvedValue(
      "INLINE_SKILL_INSTRUCTIONS",
    );
    const basePlan = nativeCraftPlan("grok", "xai", "craft-grok-dollar-skill");

    await runtime.craftAgent({
      craftPlan: {
        ...basePlan,
        overrides: { ...basePlan.overrides, skills: ["agents:project:agentic-probe"] },
      },
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "dollar skill route",
    });

    expect(factory).toHaveBeenCalledWith(
      "grok",
      expect.objectContaining({
        skillSegments: [
          expect.objectContaining({
            kind: "skill",
            name: "agentic-probe",
            path: skillFilePath,
            invocation: "$agentic-probe",
          }),
        ],
      }),
    );
  });

  it("rejects an unavailable CraftPlan skill before constructing an Entity", async () => {
    const runtime = makeRuntime(() => undefined);
    const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>();
    nativeHarnessFactoryOverrides.set("grok", factory);
    vi.spyOn(runtime.skillsService, "prepareForLaunch").mockResolvedValue(undefined);
    vi.spyOn(runtime.skillsService, "scan").mockResolvedValue({
      skills: [],
      effectiveSkillIds: [],
      invocation: "slash",
      issues: [],
      canLinkToGlobal: true,
    });
    const basePlan = nativeCraftPlan("grok", "xai", "craft-grok-skill-missing");

    const rejection = runtime.craftAgent({
      craftPlan: {
        ...basePlan,
        overrides: { ...basePlan.overrides, skills: ["missing-skill"] },
      },
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "must fail closed",
    });

    await expect(rejection).rejects.toThrow(/RUNTIME_UNAVAILABLE/);
    await expect(rejection).rejects.toThrow(/missing-skill/);
    expect(factory).not.toHaveBeenCalled();
    expect(craftedLifecycleCounts(runtime)).toEqual({
      craftedSessions: 0,
      craftedBindings: 0,
      craftedUnsubscribers: 0,
      nativeHarnessSessions: 0,
    });
  });

  it("routes DeepSeek through the native adapter and rejects with RUNTIME_UNAVAILABLE without creating an Entity when unconfigured", async () => {
    const runtime = makeRuntime(() => undefined);
    const plan = nativeCraftPlan("deepseek", "deepseek");
    const previousConfig = process.env.DSH_CORDIS_CONFIG;
    delete process.env.DSH_CORDIS_CONFIG;
    try {
      const rejection = runtime.craftAgent({
        craftPlan: plan,
        projectLocation: { kind: "windows", path: "C:\\repo" },
        prompt: "must not spawn",
      });
      await expect(rejection).rejects.toThrow(/RUNTIME_UNAVAILABLE/);
      await expect(rejection).rejects.toThrow(/no synthetic Entity created/);

      const error = (await rejection.catch((err: unknown) => err)) as Error;
      const parsed = JSON.parse(error.message);
      expect(parsed.details.entityId).toBeUndefined();
      expect(parsed.details.sessionId).toBeUndefined();

      const diagnostics = await runtime.getNativeHarnessControlPlane({ harnessKind: "deepseek" });
      expect(diagnostics[0]).toMatchObject({
        status: "unavailable",
        descriptor: { harnessKind: "deepseek" },
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "RUNTIME_UNAVAILABLE" }),
        ]),
      });
      expect(JSON.stringify(diagnostics)).not.toContain("CODEX_HOME");
    } finally {
      if (previousConfig === undefined) delete process.env.DSH_CORDIS_CONFIG;
      else process.env.DSH_CORDIS_CONFIG = previousConfig;
    }
  });

  it("omits entityId and sessionId from error detail when DeepSeek process crashes during initialization", async () => {
    const runtime = makeRuntime(() => undefined);
    const plan = {
      ...nativeCraftPlan("deepseek", "deepseek"),
      runtimeBinding: {
        ...nativeCraftPlan("deepseek", "deepseek").runtimeBinding,
        options: { configPath: "C:\\repo\\cordis.yml" },
      },
    };

    const errorFixture = new EventEmitter() as EventEmitter & {
      readonly stdout: PassThrough;
      readonly stderr: PassThrough;
      killed: boolean;
      kill: ReturnType<typeof vi.fn<() => boolean>>;
    } & { stdin: Writable };
    Object.assign(errorFixture, {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      kill: vi.fn<() => boolean>(() => {
        errorFixture.killed = true;
        return true;
      }),
    });
    (errorFixture as { stdin: Writable }).stdin = new Writable({
      write: (_chunk, _encoding, callback) => {
        process.nextTick(() => {
          errorFixture.emit("exit", 1, null);
        });
        callback();
      },
    });

    nativeHarnessFactoryOverrides.set("deepseek", (_kind, options) => {
      const opt = options as any;
      return new NativeProcessHarnessRuntimeAdapter({
        descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
        projectLocation: opt.projectLocation,
        mode: "deepseek",
        runtimeCommand: "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess: () => errorFixture as never,
      });
    });

    const rejection = runtime.craftAgent({
      craftPlan: plan,
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "test crashing start",
    });
    await expect(rejection).rejects.toThrow(/RUNTIME_UNAVAILABLE/);

    const error = (await rejection.catch((err: unknown) => err)) as Error;
    const parsed = JSON.parse(error.message);
    expect(parsed.details.entityId).toBeUndefined();
    expect(parsed.details.sessionId).toBeUndefined();
  });

  it("omits entityId and sessionId from error detail when DeepSeek encounters protocol mismatch", async () => {
    const runtime = makeRuntime(() => undefined);
    const plan = {
      ...nativeCraftPlan("deepseek", "deepseek"),
      runtimeBinding: {
        ...nativeCraftPlan("deepseek", "deepseek").runtimeBinding,
        options: { configPath: "C:\\repo\\cordis.yml" },
      },
    };

    const malformedFixture = new EventEmitter() as EventEmitter & {
      readonly stdout: PassThrough;
      readonly stderr: PassThrough;
      killed: boolean;
      kill: ReturnType<typeof vi.fn<() => boolean>>;
    } & { stdin: Writable };
    Object.assign(malformedFixture, {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      kill: vi.fn<() => boolean>(() => {
        malformedFixture.killed = true;
        return true;
      }),
    });
    (malformedFixture as { stdin: Writable }).stdin = new Writable({
      write: (_chunk, _encoding, callback) => {
        malformedFixture.stdout.write("MALFORMED NON-JSON OUTPUT\n");
        process.nextTick(() => {
          malformedFixture.emit("exit", 0, null);
        });
        callback();
      },
    });

    nativeHarnessFactoryOverrides.set("deepseek", (_kind, options) => {
      const opt = options as any;
      return new NativeProcessHarnessRuntimeAdapter({
        descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
        projectLocation: opt.projectLocation,
        mode: "deepseek",
        runtimeCommand: "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess: () => malformedFixture as never,
      });
    });

    const rejection = runtime.craftAgent({
      craftPlan: plan,
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "test protocol mismatch",
    });
    await expect(rejection).rejects.toThrow(/PROTOCOL_MISMATCH/);

    const error = (await rejection.catch((err: unknown) => err)) as Error;
    const parsed = JSON.parse(error.message);
    expect(parsed.details.entityId).toBeUndefined();
    expect(parsed.details.sessionId).toBeUndefined();
  });

  it("omits entityId and sessionId from error detail and terminates process on DeepSeek long-lived non-serving timeout", async () => {
    const runtime = makeRuntime(() => undefined);
    const plan = {
      ...nativeCraftPlan("deepseek", "deepseek"),
      runtimeBinding: {
        ...nativeCraftPlan("deepseek", "deepseek").runtimeBinding,
        options: {
          configPath: "C:\\repo\\cordis.yml",
          readinessTimeoutMs: 50,
        },
      },
    };

    const longLivedFixture = new EventEmitter() as EventEmitter & {
      readonly stdout: PassThrough;
      readonly stderr: PassThrough;
      killed: boolean;
      kill: ReturnType<typeof vi.fn<() => boolean>>;
    } & { stdin: Writable };
    Object.assign(longLivedFixture, {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      kill: vi.fn<() => boolean>(() => {
        longLivedFixture.killed = true;
        return true;
      }),
    });
    (longLivedFixture as { stdin: Writable }).stdin = new Writable({
      write: (_chunk, _encoding, callback) => {
        // Keep alive indefinitely without replying to initialize
        callback();
      },
    });

    let adapter: NativeProcessHarnessRuntimeAdapter | undefined;
    nativeHarnessFactoryOverrides.set("deepseek", (_kind, options) => {
      const opt = options as any;
      adapter = new NativeProcessHarnessRuntimeAdapter({
        descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
        projectLocation: opt.projectLocation,
        mode: "deepseek",
        runtimeCommand: "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess: () => longLivedFixture as never,
      });
      return adapter;
    });

    const rejection = runtime.craftAgent({
      craftPlan: plan,
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "test timeout",
    });
    await expect(rejection).rejects.toThrow(/timed out/i);

    const error = (await rejection.catch((err: unknown) => err)) as Error;
    const parsed = JSON.parse(error.message);
    expect(parsed.details.entityId).toBeUndefined();
    expect(parsed.details.sessionId).toBeUndefined();
    expect(longLivedFixture.killed).toBe(true);
    expect(adapter?.getLifecycleSnapshot()).toEqual({
      activeSessions: 0,
      activeTransports: 0,
      runningProcesses: 0,
      pendingRequests: 0,
    });
    expect(craftedLifecycleCounts(runtime)).toEqual({
      craftedSessions: 0,
      craftedBindings: 0,
      craftedUnsubscribers: 0,
      nativeHarnessSessions: 0,
    });
  });

  it("keeps resumeCraftAgent identities provisional and clears lifecycle state on readiness timeout", async () => {
    const runtime = makeRuntime(() => undefined);
    const plan = {
      ...nativeCraftPlan("deepseek", "deepseek", "craft-deepseek-resume-timeout"),
      runtimeBinding: {
        ...nativeCraftPlan("deepseek", "deepseek").runtimeBinding,
        options: {
          configPath: "C:\\repo\\cordis.yml",
          readinessTimeoutMs: 30,
        },
      },
    };
    const fixture = new EventEmitter() as EventEmitter & {
      readonly stdout: PassThrough;
      readonly stderr: PassThrough;
      killed: boolean;
      kill: ReturnType<typeof vi.fn<() => boolean>>;
    } & { stdin: Writable };
    Object.assign(fixture, {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      kill: vi.fn<() => boolean>(() => {
        fixture.killed = true;
        return true;
      }),
    });
    (fixture as { stdin: Writable }).stdin = new Writable({
      write: (_chunk, _encoding, callback) => callback(),
    });
    let adapter: NativeProcessHarnessRuntimeAdapter | undefined;
    nativeHarnessFactoryOverrides.set("deepseek", (_kind, options) => {
      const opt = options as any;
      adapter = new NativeProcessHarnessRuntimeAdapter({
        descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
        projectLocation: opt.projectLocation,
        mode: "deepseek",
        runtimeCommand: "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess: () => fixture as never,
      });
      return adapter;
    });

    const rejection = runtime.resumeCraftAgent({
      craftPlan: plan,
      projectLocation: { kind: "windows", path: "C:\\repo" },
      sessionRef: "official-session-ref",
      prompt: "resume only after readiness",
    });
    await expect(rejection).rejects.toThrow(/timed out/i);

    const error = (await rejection.catch((err: unknown) => err)) as Error;
    const parsed = JSON.parse(error.message);
    expect(parsed.details.entityId).toBeUndefined();
    expect(parsed.details.sessionId).toBeUndefined();
    expect(fixture.killed).toBe(true);
    expect(adapter?.getLifecycleSnapshot()).toEqual({
      activeSessions: 0,
      activeTransports: 0,
      runningProcesses: 0,
      pendingRequests: 0,
    });
    expect(craftedLifecycleCounts(runtime)).toEqual({
      craftedSessions: 0,
      craftedBindings: 0,
      craftedUnsubscribers: 0,
      nativeHarnessSessions: 0,
    });
  });

  it("forwards one session.exited event and clears every cache when a ready native carrier exits", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime((event) =>
      emitted.push(event as unknown as Record<string, unknown>),
    );
    const plan = {
      ...nativeCraftPlan("deepseek", "deepseek", "craft-deepseek-process-exit"),
      runtimeBinding: {
        ...nativeCraftPlan("deepseek", "deepseek").runtimeBinding,
        options: { configPath: "C:\\repo\\cordis.yml" },
      },
    };
    const fixture = new EventEmitter() as EventEmitter & {
      readonly stdout: PassThrough;
      readonly stderr: PassThrough;
      killed: boolean;
      kill: ReturnType<typeof vi.fn<() => boolean>>;
    } & { stdin: Writable };
    Object.assign(fixture, {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      kill: vi.fn<() => boolean>(() => {
        fixture.killed = true;
        return true;
      }),
    });
    let promptSentResolve: (() => void) | undefined;
    const promptSent = new Promise<void>((resolve) => {
      promptSentResolve = resolve;
    });
    (fixture as { stdin: Writable }).stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const request = JSON.parse(String(chunk)) as { id: string; method: string };
        if (request.method === "initialize") {
          fixture.stdout.write(
            JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { sessionId: "main" } }) +
              "\n",
          );
        } else if (request.method === "session/prompt") {
          promptSentResolve?.();
        }
        callback();
      },
    });
    let adapter: NativeProcessHarnessRuntimeAdapter | undefined;
    nativeHarnessFactoryOverrides.set("deepseek", (_kind, options) => {
      const opt = options as any;
      adapter = new NativeProcessHarnessRuntimeAdapter({
        descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
        projectLocation: opt.projectLocation,
        mode: "deepseek",
        runtimeCommand: "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess: () => fixture as never,
      });
      return adapter;
    });

    const crafting = runtime.craftAgent({
      craftPlan: plan,
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "carrier exits after readiness",
    });
    await promptSent;
    fixture.emit("exit", 9, null);

    await expect(crafting).rejects.toThrow(/EXECUTION_FAILED/);
    expect(
      emitted.filter(
        (record) =>
          record.type === "thread-runtime-event" &&
          (record.event as { type?: string } | undefined)?.type === "session.exited",
      ),
    ).toHaveLength(1);
    expect(adapter?.getLifecycleSnapshot()).toEqual({
      activeSessions: 0,
      activeTransports: 0,
      runningProcesses: 0,
      pendingRequests: 0,
    });
    expect(craftedLifecycleCounts(runtime)).toEqual({
      craftedSessions: 0,
      craftedBindings: 0,
      craftedUnsubscribers: 0,
      nativeHarnessSessions: 0,
    });
  });

  it("runs spawn/create/send through Native Codex adapter and returns composition identities", async () => {
    const runtime = makeRuntime(() => undefined);
    // Inline stub of the adapter seam (the shared FakeCodexParityHarness was
    // deleted: production must never import a fake runtime).
    runtime.setCustomCraftingAdapter((plan) => ({
      id: `stub-codex:${plan.runtimeBinding.harnessKind}`,
      harnessKind: plan.runtimeBinding.harnessKind,
      supports: () => true,
      spawnEntity: async (resolvedPlan) => ({
        id: `entity:stub-codex:${resolvedPlan.threadId ?? "craft-runtime-thread"}`,
        resultItemId: resolvedPlan.resultItemId,
        craftPlan: resolvedPlan,
        status: "spawned",
        createdAt: new Date(0).toISOString(),
      }),
      createSession: async (entity) => {
        const threadId = entity.craftPlan.threadId ?? "craft-runtime-thread";
        return {
          id: `sess:stub-codex:${threadId}`,
          threadId,
          entityId: entity.id,
          status: "idle" as const,
          startTurn: async () => ({
            turnId: "turn:stub",
            status: "completed" as const,
            events: [],
          }),
          interrupt: async () => undefined,
          terminate: async () => undefined,
          getSnapshot: () => ({
            sessionId: `sess:stub-codex:${threadId}`,
            threadId,
            entityId: entity.id,
            status: "idle" as const,
            events: [],
          }),
          subscribe: () => () => undefined,
          sendPrompt: async () => ({ response: "real native seam response", events: [] }),
        };
      },
      resumeSession: async () => {
        throw new Error("resume is not used by this seam test");
      },
    }));

    const result = await runtime.craftAgent({
      craftPlan: craftPlan(),
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "hello from craft",
    });

    expect(result).toMatchObject({
      threadId: "craft-runtime-thread",
      sessionId: "sess:stub-codex:craft-runtime-thread",
      response: "real native seam response",
    });
    expect(result.entityId).toMatch(/^entity:stub-codex:/);
  });

  it("keeps the CraftStation Thread identity stable when the native Session uses its own UUID", async () => {
    const runtime = makeRuntime(() => undefined);
    runtime.setCustomCraftingAdapter((plan) => ({
      id: `native-identity:${plan.runtimeBinding.harnessKind}`,
      harnessKind: plan.runtimeBinding.harnessKind,
      supports: () => true,
      spawnEntity: async (resolvedPlan) => ({
        id: `entity:${resolvedPlan.runtimeBinding.harnessKind}`,
        resultItemId: resolvedPlan.resultItemId,
        craftPlan: resolvedPlan,
        status: "spawned",
        createdAt: new Date(0).toISOString(),
      }),
      createSession: async (entity) => {
        const harnessKind = entity.craftPlan.runtimeBinding.harnessKind;
        return {
          id: `runtime-session:${harnessKind}`,
          threadId: `official-native-uuid:${harnessKind}`,
          entityId: entity.id,
          status: "idle" as const,
          startTurn: async () => ({
            turnId: `turn:${harnessKind}`,
            status: "completed" as const,
            events: [],
          }),
          interrupt: async () => undefined,
          terminate: async () => undefined,
          getSnapshot: () => ({
            sessionId: `runtime-session:${harnessKind}`,
            threadId: `official-native-uuid:${harnessKind}`,
            entityId: entity.id,
            status: "idle" as const,
            events: [],
          }),
          subscribe: () => () => undefined,
          sendPrompt: async () => ({ response: "continued", events: [] }),
        };
      },
      resumeSession: async () => {
        throw new Error("resume is not used by this identity test");
      },
    }));

    const threadId = "craft-thread:visible";
    const created = await runtime.craftAgent({
      craftPlan: craftPlan(threadId),
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "",
    });

    expect(created.threadId).toBe(threadId);
    await expect(
      runtime.requestSessionSwitch({
        threadId,
        projectLocation: { kind: "windows", path: "C:\\repo" },
        targetCraftPlan: nativeCraftPlan("grok", "xai", threadId),
        mode: "after-current-turn",
        prompt: "continue in the same conversation",
      }),
    ).resolves.toMatchObject({
      disposition: "activated",
      state: { threadId, phase: "active" },
    });
    expect(runtime.readSessionSwitchState(threadId)).toMatchObject({ threadId, phase: "active" });
  });

  it("hands the source conversation's MCP candidates and capability config to the handoff target", async () => {
    const runtime = makeRuntime(() => undefined);
    runtime.setCustomCraftingAdapter((plan) => ({
      id: `handoff-mcp:${plan.runtimeBinding.harnessKind}`,
      harnessKind: plan.runtimeBinding.harnessKind,
      supports: () => true,
      spawnEntity: async (resolvedPlan) => ({
        id: `entity:handoff-mcp:${resolvedPlan.runtimeBinding.harnessKind}`,
        resultItemId: resolvedPlan.resultItemId,
        craftPlan: resolvedPlan,
        status: "spawned" as const,
        createdAt: new Date(0).toISOString(),
      }),
      createSession: async (entity) => {
        const harnessKind = entity.craftPlan.runtimeBinding.harnessKind;
        return {
          id: `handoff-mcp-session:${harnessKind}`,
          threadId: entity.craftPlan.threadId ?? "",
          entityId: entity.id,
          status: "idle" as const,
          startTurn: async () => ({
            turnId: `turn:${harnessKind}`,
            status: "completed" as const,
            events: [],
          }),
          interrupt: async () => undefined,
          terminate: async () => undefined,
          getSnapshot: () => ({
            sessionId: `handoff-mcp-session:${harnessKind}`,
            threadId: entity.craftPlan.threadId ?? "",
            entityId: entity.id,
            status: "idle" as const,
            events: [],
          }),
          subscribe: () => () => undefined,
          sendPrompt: async () => ({ response: "continued", events: [] }),
        };
      },
      resumeSession: async () => {
        throw new Error("resume is not used by this handoff MCP test");
      },
    }));

    const threadId = "craft-thread:handoff-mcp";
    const basePlan = craftPlan(threadId);
    const sourcePlan = craftPlanSchema.parse({
      ...basePlan,
      overrides: {
        ...(basePlan.overrides ?? {}),
        capabilityMode: "creative",
        mcpServerIds: ["browser", "my-mcp"],
      },
    });
    const candidates = [
      {
        id: "browser",
        name: "Browser",
        enabled: true,
        transport: { type: "http", url: "http://127.0.0.1:1", headers: {} },
      },
      {
        id: "my-mcp",
        name: "My MCP",
        enabled: true,
        transport: { type: "stdio", command: "mcp", args: [] },
      },
    ] as never;

    await runtime.craftAgent({
      craftPlan: sourcePlan,
      projectLocation: { kind: "windows", path: "C:\\repo" },
      prompt: "",
      mcpServers: candidates,
    });

    const createSpy = vi.spyOn(
      runtime as unknown as {
        createCraftingAdapter: (...args: unknown[]) => Promise<unknown>;
      },
      "createCraftingAdapter",
    );
    await runtime.requestSessionSwitch({
      threadId,
      projectLocation: { kind: "windows", path: "C:\\repo" },
      targetCraftPlan: craftPlanSchema.parse(nativeCraftPlan("grok", "xai", threadId)),
      mode: "after-current-turn",
      prompt: "continue with MCP intact",
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const [targetPlan, , candidateArg] = createSpy.mock.calls[0] as [
      { overrides?: Record<string, unknown> },
      unknown,
      typeof candidates,
    ];
    // The source candidates ride along — without them the rebuilt session
    // launches with no user-configured MCP servers at all.
    expect(candidateArg).toEqual(candidates);
    // The source capability config (mode + explicit ids) is inherited, so the
    // target resolves capabilities under the same policy as the source.
    expect(targetPlan.overrides).toMatchObject({
      capabilityMode: "creative",
      mcpServerIds: ["browser", "my-mcp"],
    });
    createSpy.mockRestore();
  });

  it("binds an explicit OpenAI-compatible account to an isolated Native Codex host", async () => {
    const baseDir = makeTempDir();
    process.env.CRAFTSTATION_DATA_DIR = baseDir;
    const cacheDir = resolveCraftStationPaths(baseDir).cacheDir;
    const stagingBucket = "openai-compatible:pending";
    setUsageSecret(cacheDir, stagingBucket, "baseUrl", "https://relay.example.com/v1");
    setUsageSecret(cacheDir, stagingBucket, "apiKey", "sk-runtime-test");
    setUsageSecret(cacheDir, stagingBucket, "providerName", "Chiral-API");
    setUsageSecret(cacheDir, stagingBucket, "model", "gpt-5.6-sol");
    setUsageSecret(cacheDir, stagingBucket, "validatedProtocol", "responses");
    setUsageSecret(cacheDir, stagingBucket, "validatedAt", "1700000000000");

    const runtime = makeRuntime(() => undefined);
    const account = runtime.importOpenAiCompatibleProfile({});
    const created = await (
      runtime as unknown as {
        createCraftingAdapter: (
          plan: ReturnType<typeof craftPlan>,
          projectLocation: { kind: "windows"; path: string },
          candidateMcpServers: undefined,
          accountId: string,
          accountMode: "explicit",
        ) => Promise<{
          adapter: HarnessRuntimeAdapter;
          accountBinding?: { accountId: string; provider: string; reason: string };
        }>;
      }
    ).createCraftingAdapter(
      craftPlan("craft-openai-compatible"),
      { kind: "windows", path: "C:\\repo" },
      undefined,
      account.accountId,
      "explicit",
    );

    expect(created.accountBinding).toMatchObject({
      accountId: account.accountId,
      provider: "openai-compatible",
      reason: "explicit",
    });
    expect(created.adapter.id).toBe("codex-native-runtime");
    // Exercise the ownership seam instead of assuming the concrete adapter
    // escapes it. The process-host test separately verifies endpoint env/config.
    const spawn = vi
      .spyOn(NativeCodexRuntimeAdapter.prototype, "spawnEntity")
      .mockImplementation(async function (this: NativeCodexRuntimeAdapter, plan) {
        expect(Reflect.get(this, "options")).toMatchObject({
          profileMode: "endpoint",
          baseSpawnEnv: { CRAFTSTATION_OPENAI_COMPATIBLE_API_KEY: "sk-runtime-test" },
        });
        return {
          id: "endpoint-fixture",
          resultItemId: plan.resultItemId,
          craftPlan: plan,
          status: "spawned",
          createdAt: "fixture",
        };
      });
    await created.adapter.spawnEntity(craftPlan("craft-openai-compatible"));
    spawn.mockRestore();
    const codexHome = join(
      cacheDir,
      "openai-compatible-codex",
      account.accountId.replace(/[^A-Za-z0-9._-]/g, "_"),
    );
    expect(readFileSync(join(codexHome, "config.toml"), "utf8")).toContain('name = "Chiral-API"');
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
    const emitted: Array<{ type: string } & Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => emitted.push(event as { type: string }));
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
    // v0.9 F1: resolution is fenced, so bind it to the initially published
    // active execution envelope.
    const bindingState = emitted.find(
      (event) =>
        event.type === "session-switch-state" &&
        (event.state as { phase?: string }).phase === "active",
    )!;
    const bindingSegment = (
      bindingState.state as {
        activeSegment: { id: string; runtimeSessionId: string; bindingEpoch: number };
      }
    ).activeSegment;
    const execution = {
      segmentId: bindingSegment.id,
      runtimeSessionId: bindingSegment.runtimeSessionId,
      bindingEpoch: bindingSegment.bindingEpoch,
    };
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
      execution,
    });
    expect(respondToRequest).toHaveBeenCalledWith("permission_1", {
      kind: "permission",
      response: "once",
      optionId: "once",
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
      execution,
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
      process.env.CRAFTSTATION_DATA_DIR = makeTempDir();
    });

    function addGrokAccount(
      runtime: SupervisorRuntime,
      label: string,
      status: "available" | "quota-exhausted" = "available",
      withCredential = true,
    ) {
      const account = runtime.addAccount({
        provider: "grok",
        label,
        maskedIdentity: `${label}@example.com`,
      });
      if (withCredential) {
        writeFileSync(
          join(runtime.accountStore.credentialRoot(account.accountId), "auth.json"),
          JSON.stringify({
            "https://auth.x.ai::test-client": {
              key: "test-access-token",
              email: `${label}@example.com`,
            },
          }),
          "utf8",
        );
      }
      runtime.accountStore.updateStatus(account.accountId, status);
      return account;
    }

    it("ignores metadata-only managed Grok accounts and preserves the official host login path", async () => {
      const runtime = makeRuntime(() => undefined);
      addGrokAccount(runtime, "stale", "available", false);
      const adapter = routedAdapter("grok");
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("grok", factory);

      const result = await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-host-login-fallback"),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        prompt: "use official host login",
      });

      const options = factory.mock.calls[0]?.[1] as {
        accountBinding?: unknown;
        baseSpawnEnv?: Record<string, string>;
      };
      expect(result.accountBinding).toBeUndefined();
      expect(options.accountBinding).toBeUndefined();
      expect(options.baseSpawnEnv?.GROK_HOME).toBeUndefined();
    });

    it("rejects an explicit metadata-only Grok account without falling back to host login", async () => {
      const runtime = makeRuntime(() => undefined);
      const stale = addGrokAccount(runtime, "stale", "available", false);
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>();
      nativeHarnessFactoryOverrides.set("grok", factory);

      await expect(
        runtime.craftAgent({
          craftPlan: nativeCraftPlan("grok", "xai", "grok-explicit-missing-credential"),
          projectLocation: { kind: "windows", path: "C:\\repo" },
          accountId: stale.accountId,
          accountMode: "explicit",
          prompt: "must fail closed",
        }),
      ).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
      expect(factory).not.toHaveBeenCalled();
    });

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
        // The single-row pool is exhausted after the tried row dies, so the
        // turn surfaces the projected banner (legacy-lane parity) caused by
        // the original provider rejection — never the raw "Internal error".
      ).rejects.toMatchObject({ message: "Grok 额度已耗尽", cause: quotaError });

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

    it("routes interruptThread to the crafted session and releases registration on session exit", async () => {
      const emitted: Array<{ threadId: string; event: unknown }> = [];
      const runtime = makeRuntime((event) => {
        if (event.type === "thread-runtime-event") {
          emitted.push({ threadId: event.threadId, event: event.event });
        }
      });
      const adapter = routedAdapter("grok");
      const session = await adapter.createSession({
        id: "entity:grok:test",
        resultItemId: "result:grok",
        craftPlan: nativeCraftPlan("grok", "xai", "grok-interrupt-thread"),
        status: "spawned",
        createdAt: new Date().toISOString(),
      });
      let sessionListener: ((event: unknown) => void) | undefined;
      session.subscribe = vi.fn<(listener: (event: unknown) => void) => () => void>(
        (listener: (event: unknown) => void) => {
          sessionListener = listener;
          return () => undefined;
        },
      );
      session.interrupt = vi.fn<() => Promise<void>>().mockImplementation(async () => {
        sessionListener?.({
          type: "turn.completed",
          threadId: "grok-interrupt-thread",
          turnId: "turn-1",
          state: "interrupted",
        });
        sessionListener?.({
          type: "session.exited",
          threadId: "grok-interrupt-thread",
          reason: "interrupted",
        });
      });
      adapter.createSession = vi
        .fn<(entity: unknown) => Promise<typeof session>>()
        .mockResolvedValue(session);
      nativeHarnessFactoryOverrides.set(
        "grok",
        vi.fn(() => adapter),
      );

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-interrupt-thread"),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        prompt: "bind",
      });
      const activeSegment = runtime.readSessionSwitchState("grok-interrupt-thread")
        ?.activeSegment as { id: string; runtimeSessionId: string; bindingEpoch: number };
      const execution = {
        segmentId: activeSegment.id,
        runtimeSessionId: activeSegment.runtimeSessionId,
        bindingEpoch: activeSegment.bindingEpoch,
      };

      await expect(
        runtime.interruptThread({ threadId: "grok-interrupt-thread", execution }),
      ).resolves.toBeUndefined();
      expect(session.interrupt).toHaveBeenCalledTimes(1);

      // F44: Verify runtime events forwarding
      expect(emitted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            threadId: "grok-interrupt-thread",
            event: expect.objectContaining({ type: "turn.completed", state: "interrupted" }),
          }),
          expect.objectContaining({
            threadId: "grok-interrupt-thread",
            event: expect.objectContaining({ type: "session.exited", reason: "interrupted" }),
          }),
        ]),
      );

      // F44: Verify auto-release of craftedSessionsByThread when session.exited occurs
      session.interrupt = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      // Next interruptThread will no longer route to craftedSession (falls back to threadSessionManager)
      await expect(
        runtime.interruptThread({ threadId: "grok-interrupt-thread" }),
      ).resolves.toBeUndefined();
      expect(session.interrupt).not.toHaveBeenCalled();
    });

    it("force-closes an unacknowledged crafted turn via the interrupt watchdog", async () => {
      vi.useFakeTimers();
      try {
        const emitted: Array<{ threadId: string; event: unknown }> = [];
        const runtime = makeRuntime((event) => {
          if (event.type === "thread-runtime-event") {
            emitted.push({ threadId: event.threadId, event: event.event });
          }
        });
        const adapter = routedAdapter("grok");
        const session = await adapter.createSession({
          id: "entity:grok:watchdog",
          resultItemId: "result:grok",
          craftPlan: nativeCraftPlan("grok", "xai", "grok-watchdog-thread"),
          status: "spawned",
          createdAt: new Date().toISOString(),
        });
        let sessionListener: ((event: unknown) => void) | undefined;
        session.subscribe = vi.fn<(listener: (event: unknown) => void) => () => void>(
          (listener) => {
            sessionListener = listener;
            return () => undefined;
          },
        );
        session.getSnapshot = vi.fn<typeof session.getSnapshot>(() => ({
          sessionId: session.id,
          entityId: "entity:grok:watchdog",
          threadId: "grok-watchdog-thread",
          status: "busy",
          activeTurnId: "turn-wedged",
          activeTurnStatus: "running",
          events: [],
        }));
        // The native runtime ignores the interrupt entirely: no turn.completed.
        session.interrupt = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        vi.spyOn(session, "terminate");
        adapter.createSession = vi.fn<typeof adapter.createSession>(async () => session);
        nativeHarnessFactoryOverrides.set(
          "grok",
          vi.fn(() => adapter),
        );
        // The runtime never subscribes an ack: the local listener exists only to
        // mirror the real adapter shape.
        void sessionListener;

        await runtime.craftAgent({
          craftPlan: nativeCraftPlan("grok", "xai", "grok-watchdog-thread"),
          projectLocation: { kind: "windows", path: "C:\\repo" },
          prompt: "bind",
        });

        // No execution envelope: Stop must still work instead of failing closed.
        await expect(
          runtime.interruptThread({ threadId: "grok-watchdog-thread" }),
        ).resolves.toBeUndefined();
        expect(session.interrupt).toHaveBeenCalledTimes(1);

        // The runtime never acknowledged; before the deadline nothing is force-closed.
        expect(emitted.some((e) => (e.event as { type: string }).type === "turn.completed")).toBe(
          false,
        );

        vi.advanceTimersByTime(3_100);
        expect(session.terminate).toHaveBeenCalledOnce();
        expect(emitted).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              threadId: "grok-watchdog-thread",
              event: expect.objectContaining({
                type: "turn.completed",
                turnId: "turn-wedged",
                state: "interrupted",
              }),
            }),
          ]),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("disarms the crafted interrupt watchdog when the runtime acknowledges the stop", async () => {
      vi.useFakeTimers();
      try {
        const emitted: Array<{ threadId: string; event: unknown }> = [];
        const runtime = makeRuntime((event) => {
          if (event.type === "thread-runtime-event") {
            emitted.push({ threadId: event.threadId, event: event.event });
          }
        });
        const adapter = routedAdapter("grok");
        const session = await adapter.createSession({
          id: "entity:grok:ack",
          resultItemId: "result:grok",
          craftPlan: nativeCraftPlan("grok", "xai", "grok-ack-thread"),
          status: "spawned",
          createdAt: new Date().toISOString(),
        });
        let sessionListener: ((event: unknown) => void) | undefined;
        session.subscribe = vi.fn<(listener: (event: unknown) => void) => () => void>(
          (listener) => {
            sessionListener = listener;
            return () => undefined;
          },
        );
        session.getSnapshot = vi.fn<typeof session.getSnapshot>(() => ({
          sessionId: session.id,
          entityId: "entity:grok:ack",
          threadId: "grok-ack-thread",
          status: "busy",
          activeTurnId: "turn-ack",
          activeTurnStatus: "running",
          events: [],
        }));
        session.interrupt = vi.fn<() => Promise<void>>().mockImplementation(async () => {
          sessionListener?.({
            type: "turn.completed",
            threadId: "grok-ack-thread",
            turnId: "turn-ack",
            state: "interrupted",
          });
        });
        adapter.createSession = vi.fn<typeof adapter.createSession>(async () => session);
        nativeHarnessFactoryOverrides.set(
          "grok",
          vi.fn(() => adapter),
        );

        await runtime.craftAgent({
          craftPlan: nativeCraftPlan("grok", "xai", "grok-ack-thread"),
          projectLocation: { kind: "windows", path: "C:\\repo" },
          prompt: "bind",
        });

        await runtime.interruptThread({ threadId: "grok-ack-thread" });
        const completions = emitted.filter(
          (e) => (e.event as { type: string }).type === "turn.completed",
        );
        expect(completions).toHaveLength(1);

        // After a real acknowledgement the watchdog must not double-complete.
        vi.advanceTimersByTime(3_100);
        const after = emitted.filter(
          (e) => (e.event as { type: string }).type === "turn.completed",
        );
        expect(after).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("falls back to interrupt-then-send when the crafted runtime has no steer", async () => {
      const runtime = makeRuntime(() => undefined);
      const adapter = routedAdapter("grok");
      const session = await adapter.createSession({
        id: "entity:grok:steer",
        resultItemId: "result:grok",
        craftPlan: nativeCraftPlan("grok", "xai", "grok-steer-thread"),
        status: "spawned",
        createdAt: new Date().toISOString(),
      });
      session.getSnapshot = vi.fn<typeof session.getSnapshot>(() => ({
        sessionId: session.id,
        entityId: "entity:grok:steer",
        threadId: "grok-steer-thread",
        status: "busy",
        activeTurnId: "turn-steer",
        activeTurnStatus: "running",
        events: [],
      }));
      session.interrupt = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      vi.spyOn(session, "startTurn");
      session.sendPrompt = vi.fn<typeof session.sendPrompt>(async (prompt) => ({
        response: `grok:${prompt}`,
        events: [],
      }));
      // No `steer` on the session: the unsupported path must not throw.
      adapter.createSession = vi.fn<typeof adapter.createSession>(async () => session);
      nativeHarnessFactoryOverrides.set(
        "grok",
        vi.fn(() => adapter),
      );

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-steer-thread"),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        prompt: "bind",
      });

      await expect(
        runtime.setPendingSteer({
          threadId: "grok-steer-thread",
          prompt: "next instruction",
          config: { model: "grok-model" },
        }),
      ).resolves.toBeUndefined();
      expect(session.interrupt).toHaveBeenCalledTimes(1);
      expect(session.sendPrompt).toHaveBeenCalledWith("next instruction");
    });

    it("routes public sendThreadInput follow-ups to the same live crafted session", async () => {
      const runtime = makeRuntime(() => undefined);
      const adapter = routedAdapter("grok");
      const session = await adapter.createSession({
        id: "entity:grok:multi-turn",
        resultItemId: "result:grok",
        craftPlan: nativeCraftPlan("grok", "xai", "grok-crafted-multi-turn"),
        status: "spawned",
        createdAt: new Date().toISOString(),
      });
      vi.spyOn(session, "startTurn");
      session.sendPrompt = vi.fn<typeof session.sendPrompt>(async (prompt) => ({
        response: `grok:${prompt}`,
        events: [],
      }));
      adapter.createSession = vi.fn<typeof adapter.createSession>(async () => session);
      nativeHarnessFactoryOverrides.set(
        "grok",
        vi.fn(() => adapter),
      );

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-crafted-multi-turn"),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        prompt: "first turn",
        userMessageItemId: "optimistic-first",
      });
      expect(session.startTurn).toHaveBeenCalledWith({
        prompt: "first turn",
        userMessageItemId: "optimistic-first",
      });
      const activeSegment = runtime.readSessionSwitchState("grok-crafted-multi-turn")
        ?.activeSegment as { id: string; runtimeSessionId: string; bindingEpoch: number };
      const execution = {
        segmentId: activeSegment.id,
        runtimeSessionId: activeSegment.runtimeSessionId,
        bindingEpoch: activeSegment.bindingEpoch,
      };
      await expect(
        runtime.sendThreadInput({
          threadId: "grok-crafted-multi-turn",
          prompt: "second turn",
          userMessageItemId: "optimistic-second",
          config: { model: "grok-model" },
          execution,
        }),
      ).resolves.toBeUndefined();

      expect(session.startTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "second turn",
          userMessageItemId: "optimistic-second",
          overrides: expect.objectContaining({ model: "grok-model" }),
        }),
      );
      expect(craftedLifecycleCounts(runtime).craftedSessions).toBe(1);
      await runtime.closeThread({ threadId: "grok-crafted-multi-turn", execution });
    });

    it("keeps a live crafted Grok follow-up talking when the renderer omitted the envelope", async () => {
      const runtime = makeRuntime(() => undefined);
      const adapter = routedAdapter("grok");
      const session = await adapter.createSession({
        id: "entity:grok:dropped-envelope",
        resultItemId: "result:grok",
        craftPlan: nativeCraftPlan("grok", "xai", "grok-dropped-envelope"),
        status: "spawned",
        createdAt: new Date().toISOString(),
      });
      vi.spyOn(session, "startTurn");
      session.sendPrompt = vi.fn<typeof session.sendPrompt>(async (prompt) => ({
        response: `grok:${prompt}`,
        events: [],
      }));
      adapter.createSession = vi.fn<typeof adapter.createSession>(async () => session);
      nativeHarnessFactoryOverrides.set(
        "grok",
        vi.fn(() => adapter),
      );

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("grok", "xai", "grok-dropped-envelope"),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        prompt: "first turn",
      });
      await expect(
        runtime.sendThreadInput({
          threadId: "grok-dropped-envelope",
          prompt: "都跑完了吗",
          config: { model: "grok-model" },
        }),
      ).resolves.toBeUndefined();
      expect(session.startTurn).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "都跑完了吗" }),
      );
    });

    it("releases a crafted account binding when the public closeThread seam terminates it", async () => {
      const emitted: Array<{ type: string } & Record<string, unknown>> = [];
      const runtime = makeRuntime((event) => emitted.push(event as { type: string }));
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

      // v0.9 F1: closeThread on a crafted thread requires the active execution
      // envelope published when the crafted session started.
      const bindingState = emitted.find(
        (event) =>
          event.type === "session-switch-state" &&
          (event.state as { phase?: string }).phase === "active",
      )!;
      const bindingSegment = (
        bindingState.state as {
          activeSegment: { id: string; runtimeSessionId: string; bindingEpoch: number };
        }
      ).activeSegment;
      await expect(
        runtime.closeThread({
          threadId: "grok-lifecycle-release",
          execution: {
            segmentId: bindingSegment.id,
            runtimeSessionId: bindingSegment.runtimeSessionId,
            bindingEpoch: bindingSegment.bindingEpoch,
          },
        }),
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

    it("removes an already-gone account idempotently instead of Unknown account", () => {
      const emitted: unknown[] = [];
      const runtime = makeRuntime((event) => {
        emitted.push(event);
      });
      const account = runtime.addAccount({ provider: "antigravity", label: "Ghost" });
      runtime.removeAccount(account.accountId);
      // Second delete (stale UI row, scrubbed/deduped row, double-click) must
      // succeed so the ghost row disappears instead of erroring.
      expect(() => runtime.removeAccount(account.accountId)).not.toThrow();
      expect(() =>
        runtime.removeAccount("antigravity:00000000-0000-0000-0000-000000000000"),
      ).not.toThrow();
      expect(
        emitted.some(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            (event as { type?: unknown }).type === "usage-accounts",
        ),
      ).toBe(true);
    });
  });

  describe("Antigravity account control plane", () => {
    beforeEach(() => {
      process.env.CRAFTSTATION_DATA_DIR = makeTempDir();
    });

    async function addAntigravityAccount(
      runtime: SupervisorRuntime,
      label: string,
      status: "available" | "quota-exhausted" = "available",
      withCredential = true,
    ) {
      const account = runtime.addAccount({
        provider: "antigravity",
        label,
        maskedIdentity: `${label}@example.com`,
      });
      if (withCredential) {
        const cacheDir = resolveCraftStationPaths(process.env.CRAFTSTATION_DATA_DIR!).cacheDir;
        const { providerCredentialBucket } = await import("./runtime/credentialVault");
        setUsageSecret(
          cacheDir,
          providerCredentialBucket("antigravity", account.accountId),
          "refreshToken",
          `refresh-secret-${label}`,
        );
      }
      runtime.accountStore.updateStatus(account.accountId, status);
      return account;
    }

    /** Stub B-mode host-follow (never touch the real OS store in tests). */
    function stubHostFollow(runtime: SupervisorRuntime) {
      return vi
        .spyOn(runtime.antigravityProfileService, "ensureHostFollowsAccount")
        .mockResolvedValue({ applied: false, accountId: "antigravity:stub" });
    }

    it("binds a new Session to the first usable Antigravity account and follows it on the host", async () => {
      const runtime = makeRuntime(() => undefined);
      const accountA = await addAntigravityAccount(runtime, "A");
      await addAntigravityAccount(runtime, "B");
      const ensureHost = stubHostFollow(runtime);

      const adapter = routedAdapter("antigravity");
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("antigravity", factory);

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("antigravity", "google", "ag-session-priority-a"),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        prompt: "bind A",
      });

      const options = factory.mock.calls[0]?.[1] as {
        accountBinding?: { accountId: string; provider: string; reason: string };
        baseSpawnEnv?: Record<string, string>;
      };
      expect(options.accountBinding?.accountId).toBe(accountA.accountId);
      expect(options.accountBinding?.provider).toBe("antigravity");
      expect(options.accountBinding?.reason).toBe("priority");
      // B-mode: host follows the bound row; the spawn itself stays ambient.
      expect(ensureHost).toHaveBeenCalledWith(accountA.accountId);
      expect(options.baseSpawnEnv?.AGY_ADC_AUTH).toBeUndefined();
      expect(options.baseSpawnEnv?.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    });

    it("binds a new Session to an explicitly overridden Antigravity account", async () => {
      const runtime = makeRuntime(() => undefined);
      await addAntigravityAccount(runtime, "A");
      const accountB = await addAntigravityAccount(runtime, "B");
      const ensureHost = stubHostFollow(runtime);

      const adapter = routedAdapter("antigravity");
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("antigravity", factory);

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("antigravity", "google", "ag-session-explicit-b"),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        accountId: accountB.accountId,
        accountMode: "explicit",
        prompt: "bind B",
      });

      const options = factory.mock.calls[0]?.[1] as {
        accountBinding?: { accountId: string; reason: string };
        baseSpawnEnv?: Record<string, string>;
      };
      expect(options.accountBinding?.accountId).toBe(accountB.accountId);
      expect(options.accountBinding?.reason).toBe("explicit");
      // B-mode: explicit choice is applied to the host; the spawn stays ambient.
      expect(ensureHost).toHaveBeenCalledWith(accountB.accountId);
      expect(options.baseSpawnEnv?.AGY_ADC_AUTH).toBeUndefined();
      expect(options.baseSpawnEnv?.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    });

    it("auto-picks the next Antigravity account in priority order when the first is exhausted", async () => {
      const runtime = makeRuntime(() => undefined);
      await addAntigravityAccount(runtime, "A", "quota-exhausted");
      const accountB = await addAntigravityAccount(runtime, "B");
      stubHostFollow(runtime);

      const adapter = routedAdapter("antigravity");
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("antigravity", factory);

      await runtime.craftAgent({
        craftPlan: nativeCraftPlan("antigravity", "google", "ag-session-auto-fallback"),
        projectLocation: { kind: "windows", path: "C:\\repo" },
        prompt: "auto fallback",
      });

      const options = factory.mock.calls[0]?.[1] as { accountBinding?: { accountId: string } };
      expect(options.accountBinding?.accountId).toBe(accountB.accountId);
      const resolved = runtime.accountResolver.resolve({
        provider: "antigravity",
        mode: "auto",
      });
      expect(resolved.account.accountId).toBe(accountB.accountId);
      expect(resolved.reason).toBe("priority");
    });

    it("marks the bound Antigravity account quota-exhausted when the first turn fails with a quota error", async () => {
      const runtime = makeRuntime(() => undefined);
      const account = await addAntigravityAccount(runtime, "A");
      stubHostFollow(runtime);

      const adapter = routedAdapter("antigravity");
      const originalCreateSession = adapter.createSession.bind(adapter);
      const quotaError = new Error("RESOURCE_EXHAUSTED (code 429): Individual quota reached");
      adapter.createSession = async (entity) => {
        const session = await originalCreateSession(entity);
        session.sendPrompt = async () => {
          throw quotaError;
        };
        return session;
      };
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("antigravity", factory);

      await expect(
        runtime.craftAgent({
          craftPlan: nativeCraftPlan("antigravity", "google", "ag-first-turn-quota"),
          projectLocation: { kind: "windows", path: "C:\\repo" },
          accountId: account.accountId,
          accountMode: "explicit",
          prompt: "first turn",
        }),
      ).rejects.toThrow(/Individual quota reached/);

      expect(runtime.accountStore.get(account.accountId)).toMatchObject({
        status: "quota-exhausted",
        lastQuotaAt: expect.any(Number),
      });
      // The next auto session must rotate away from the exhausted row.
      const accountB = await addAntigravityAccount(runtime, "B");
      void accountB;
      const resolved = runtime.accountResolver.resolve({
        provider: "antigravity",
        mode: "auto",
      });
      expect(resolved.account.maskedIdentity).toBe("B@example.com");
    });

    it("kicks host-login rotation after a bound Antigravity failure is recorded", async () => {
      const runtime = makeRuntime(() => undefined);
      const account = await addAntigravityAccount(runtime, "A");
      stubHostFollow(runtime);
      const rotate = vi.spyOn(runtime.antigravityProfileService, "rotateHostAfterFailure");
      rotate.mockResolvedValue({ rotated: false });

      const adapter = routedAdapter("antigravity");
      const originalCreateSession = adapter.createSession.bind(adapter);
      adapter.createSession = async (entity) => {
        const session = await originalCreateSession(entity);
        session.sendPrompt = async () => {
          throw new Error("RESOURCE_EXHAUSTED (code 429): Individual quota reached");
        };
        return session;
      };
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("antigravity", factory);

      await expect(
        runtime.craftAgent({
          craftPlan: nativeCraftPlan("antigravity", "google", "ag-first-turn-rotate"),
          projectLocation: { kind: "windows", path: "C:\\repo" },
          accountId: account.accountId,
          accountMode: "explicit",
          prompt: "first turn",
        }),
      ).rejects.toThrow(/Individual quota reached/);

      // Marking is synchronous; rotation rides fire-and-forget behind it.
      expect(runtime.accountStore.get(account.accountId)?.status).toBe("quota-exhausted");
      await vi.waitFor(() => expect(rotate).toHaveBeenCalledTimes(1));
      expect(rotate.mock.calls[0]?.[0]).toBe(account.accountId);
    });

    it("marks the bound Antigravity account auth-expired when the first turn fails with an auth error", async () => {
      const runtime = makeRuntime(() => undefined);
      const account = await addAntigravityAccount(runtime, "A");
      stubHostFollow(runtime);

      const adapter = routedAdapter("antigravity");
      const originalCreateSession = adapter.createSession.bind(adapter);
      adapter.createSession = async (entity) => {
        const session = await originalCreateSession(entity);
        session.sendPrompt = async () => {
          throw new Error("You are not logged into Antigravity.");
        };
        return session;
      };
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("antigravity", factory);

      await expect(
        runtime.craftAgent({
          craftPlan: nativeCraftPlan("antigravity", "google", "ag-first-turn-auth"),
          projectLocation: { kind: "windows", path: "C:\\repo" },
          accountId: account.accountId,
          accountMode: "explicit",
          prompt: "first turn",
        }),
      ).rejects.toThrow(/not logged into/);

      expect(runtime.accountStore.get(account.accountId)?.status).toBe("auth-expired");
    });

    it("leaves Antigravity pool state untouched for non-quota failures like invalid model selection", async () => {
      const runtime = makeRuntime(() => undefined);
      const account = await addAntigravityAccount(runtime, "A");
      stubHostFollow(runtime);

      const adapter = routedAdapter("antigravity");
      const originalCreateSession = adapter.createSession.bind(adapter);
      adapter.createSession = async (entity) => {
        const session = await originalCreateSession(entity);
        session.sendPrompt = async () => {
          throw new Error(
            'invalid model selection (--model "gemini-3.6-flash-medium" --effort ""): model gemini-3.6-flash-medium is not recognized as a known model or custom model in settings',
          );
        };
        return session;
      };
      const factory = vi.fn<(..._args: unknown[]) => HarnessRuntimeAdapter>(() => adapter);
      nativeHarnessFactoryOverrides.set("antigravity", factory);

      await expect(
        runtime.craftAgent({
          craftPlan: nativeCraftPlan("antigravity", "google", "ag-first-turn-model"),
          projectLocation: { kind: "windows", path: "C:\\repo" },
          accountId: account.accountId,
          accountMode: "explicit",
          prompt: "first turn",
        }),
      ).rejects.toThrow(/invalid model selection/);

      expect(runtime.accountStore.get(account.accountId)?.status).toBe("available");
    });
  });
});

describe("SupervisorRuntime chat session pool-first authorization", () => {
  beforeEach(() => {
    process.env.CRAFTSTATION_DATA_DIR = makeTempDir();
  });

  function addPoolAccount(
    runtime: SupervisorRuntime,
    provider: "codex" | "grok" | "kimi",
    label: string,
    withCredential = true,
  ) {
    const account = runtime.addAccount({
      provider,
      label,
      maskedIdentity: `${label}@example.com`,
    });
    if (withCredential) {
      writeFileSync(
        join(runtime.accountStore.credentialRoot(account.accountId), "auth.json"),
        JSON.stringify({ testCredential: true }),
        "utf8",
      );
    }
    runtime.accountStore.updateStatus(account.accountId, "available");
    return account;
  }

  it("falls back to ambient only when the provider has no credentialed pool accounts", async () => {
    const runtime = makeRuntime(() => undefined);
    // Metadata-only row: the pool exists but holds no usable credential.
    addPoolAccount(runtime, "codex", "stale", false);
    expect(
      await (
        runtime as unknown as {
          resolveAccountSessionEnv: (input: { provider: string; threadId: string }) => unknown;
        }
      ).resolveAccountSessionEnv({ provider: "codex", threadId: "thread-1" }),
    ).toBeUndefined();
    // Providers without a chat pool seam always use their ambient login.
    expect(
      await (
        runtime as unknown as {
          resolveAccountSessionEnv: (input: { provider: string; threadId: string }) => unknown;
        }
      ).resolveAccountSessionEnv({ provider: "claude", threadId: "thread-1" }),
    ).toBeUndefined();
  });

  it("binds codex chat sessions to the pool account via CODEX_HOME", async () => {
    const runtime = makeRuntime(() => undefined);
    const account = addPoolAccount(runtime, "codex", "Pool A");
    const resolved = await (
      runtime as unknown as {
        resolveAccountSessionEnv: (input: { provider: string; threadId: string }) => Promise<
          | {
              accountId: string;
              reason: string;
              env: Record<string, string>;
            }
          | undefined
        >;
      }
    ).resolveAccountSessionEnv({ provider: "codex", threadId: "thread-2" });
    expect(resolved?.accountId).toBe(account.accountId);
    expect(resolved?.env.CODEX_HOME).toBe(runtime.accountStore.credentialRoot(account.accountId));
    expect(JSON.stringify(resolved?.env)).not.toContain("testCredential");
  });

  it("binds grok chat sessions to the pool account via a pinned GROK_HOME", async () => {
    const runtime = makeRuntime(() => undefined);
    const account = addPoolAccount(runtime, "grok", "Pool G");
    const resolved = await (
      runtime as unknown as {
        resolveAccountSessionEnv: (input: { provider: string; threadId: string }) => Promise<
          | {
              accountId: string;
              env: Record<string, string>;
            }
          | undefined
        >;
      }
    ).resolveAccountSessionEnv({ provider: "grok", threadId: "thread-3" });
    expect(resolved?.accountId).toBe(account.accountId);
    expect(resolved?.env.GROK_HOME).toBe(runtime.accountStore.credentialRoot(account.accountId));
  });

  it("throws when the pool exists but every account is unusable (no silent ambient fallback)", async () => {
    const runtime = makeRuntime(() => undefined);
    const account = addPoolAccount(runtime, "grok", "Only", true);
    runtime.accountStore.updateStatus(account.accountId, "quota-exhausted");
    await expect(
      (
        runtime as unknown as {
          resolveAccountSessionEnv: (input: { provider: string; threadId: string }) => unknown;
        }
      ).resolveAccountSessionEnv({ provider: "grok", threadId: "thread-4" }),
    ).rejects.toThrowError(/No usable grok account/);
  });

  it("skips failover-tried accounts when re-resolving the pool", async () => {
    // Same-turn failover records every account that died this turn; the
    // re-resolution inside restartThread must never land back on one of them,
    // even when its quota write-back hasn't landed yet.
    const runtime = makeRuntime(() => undefined);
    const first = addPoolAccount(runtime, "grok", "Dead");
    const second = addPoolAccount(runtime, "grok", "Next");
    const resolved = await (
      runtime as unknown as {
        resolveAccountSessionEnv: (input: {
          provider: string;
          threadId: string;
          excludedAccountIds?: readonly string[];
        }) => Promise<{ accountId: string } | undefined>;
      }
    ).resolveAccountSessionEnv({
      provider: "grok",
      threadId: "thread-5",
      excludedAccountIds: [first.accountId],
    });
    expect(resolved?.accountId).toBe(second.accountId);
  });

  it("marks only the bound Kimi account quota-exhausted on a 402 prompt error", () => {
    const runtime = makeRuntime(() => undefined);
    const accountA = addPoolAccount(runtime, "kimi", "A");
    const accountB = addPoolAccount(runtime, "kimi", "B");
    const rt = runtime as unknown as {
      handleKimiNativePromptError: (accountId: string, error: unknown) => void;
    };
    rt.handleKimiNativePromptError(accountA.accountId, {
      code: -32603,
      message: "Internal error",
      data: { http_status: 402, message: "payment required" },
    });
    expect(runtime.accountStore.get(accountA.accountId)?.status).toBe("quota-exhausted");
    expect(runtime.accountStore.get(accountB.accountId)?.status).toBe("available");
    // Rate-limiting recovers on its own: never mark.
    rt.handleKimiNativePromptError(accountB.accountId, {
      data: { http_status: 429, message: "too many requests" },
    });
    expect(runtime.accountStore.get(accountB.accountId)?.status).toBe("available");
    // Auth failures need a human re-login: never mark.
    rt.handleKimiNativePromptError(accountB.accountId, {
      data: { http_status: 401, message: "unauthorized" },
    });
    expect(runtime.accountStore.get(accountB.accountId)?.status).toBe("available");
  });

  it("marks only the bound Codex account quota-exhausted on the usage-limit shape", () => {
    const runtime = makeRuntime(() => undefined);
    const accountA = addPoolAccount(runtime, "codex", "A");
    const accountB = addPoolAccount(runtime, "codex", "B");
    const rt = runtime as unknown as {
      handleCodexNativePromptError: (accountId: string, error: unknown) => void;
    };
    rt.handleCodexNativePromptError(
      accountA.accountId,
      new Error(
        "Error running remote compact task You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits.",
      ),
    );
    expect(runtime.accountStore.get(accountA.accountId)?.status).toBe("quota-exhausted");
    expect(runtime.accountStore.get(accountB.accountId)?.status).toBe("available");
    // willRetry warnings and rate-limit nudges never mark.
    rt.handleCodexNativePromptError(
      accountB.accountId,
      new Error("Approaching rate limits, willRetry"),
    );
    expect(runtime.accountStore.get(accountB.accountId)?.status).toBe("available");
  });

  it("binds antigravity chat sessions to the followed pool row with ambient env", async () => {
    const baseDir = makeTempDir();
    process.env.CRAFTSTATION_DATA_DIR = baseDir;
    const runtime = makeRuntime(() => undefined);
    const account = runtime.addAccount({
      provider: "antigravity",
      label: "AG Pool",
      maskedIdentity: "ag-pool@example.com",
    });
    const cacheDir = resolveCraftStationPaths(baseDir).cacheDir;
    const { providerCredentialBucket } = await import("./runtime/credentialVault");
    setUsageSecret(
      cacheDir,
      providerCredentialBucket("antigravity", account.accountId),
      "refreshToken",
      "refresh-secret",
    );
    runtime.accountStore.updateStatus(account.accountId, "available");
    const ensure = vi
      .spyOn(runtime.antigravityProfileService, "ensureHostFollowsAccount")
      .mockResolvedValue({ applied: true, accountId: account.accountId });

    const resolved = await (
      runtime as unknown as {
        resolveAccountSessionEnv: (input: { provider: string; threadId: string }) => Promise<
          | {
              accountId: string;
              env: Record<string, string>;
            }
          | undefined
        >;
      }
    ).resolveAccountSessionEnv({ provider: "antigravity", threadId: "thread-ag-1" });

    // B-mode: the binding names the followed row for display/quota, but the
    // spawn env stays ambient (no ADC projection) so the host catalog applies.
    expect(ensure).toHaveBeenCalledWith(account.accountId);
    expect(resolved?.accountId).toBe(account.accountId);
    expect(resolved?.env).toEqual({});
    expect(resolved?.env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(resolved?.env.AGY_ADC_AUTH).toBeUndefined();
  });

  it("falls back to ambient when the antigravity pool holds no refresh token", async () => {
    const baseDir = makeTempDir();
    process.env.CRAFTSTATION_DATA_DIR = baseDir;
    const runtime = makeRuntime(() => undefined);
    const account = runtime.addAccount({
      provider: "antigravity",
      label: "AG Empty",
      maskedIdentity: "ag-empty@example.com",
    });
    runtime.accountStore.updateStatus(account.accountId, "available");
    // No sealed refresh token: the account is not schedulable, so the seam
    // reports "no credentialed pool" and the session uses the ambient login —
    // identical to a metadata-only codex/grok row.
    expect(
      await (
        runtime as unknown as {
          resolveAccountSessionEnv: (input: { provider: string; threadId: string }) => unknown;
        }
      ).resolveAccountSessionEnv({ provider: "antigravity", threadId: "thread-ag-2" }),
    ).toBeUndefined();
    expect(account.accountId).toBeTruthy();
  });

  describe("third-party chat launches bypass the subscription pool", () => {
    function addThirdPartyAccount(
      runtime: ReturnType<typeof makeRuntime>,
      overrides?: { model?: string; protocol?: string },
    ) {
      const account = runtime.addAccount({
        provider: "openai-compatible",
        label: "Chiral-API",
        maskedIdentity: "Chiral-API",
        providerAccountId: "Chiral-API",
      });
      const bucket = (
        runtime as unknown as {
          openAiCompatibleProfileService: { bucketFor: (id: string) => string };
        }
      ).openAiCompatibleProfileService.bucketFor(account.accountId);
      const cacheDir = resolveCraftStationPaths(process.env.CRAFTSTATION_DATA_DIR!).cacheDir;
      setUsageSecret(cacheDir, bucket, "baseUrl", "https://relay.example.com/v1");
      setUsageSecret(cacheDir, bucket, "apiKey", "sk-third-party");
      setUsageSecret(cacheDir, bucket, "model", overrides?.model ?? "gpt-5.6-sol");
      setUsageSecret(cacheDir, bucket, "validatedProtocol", overrides?.protocol ?? "responses");
      setUsageSecret(cacheDir, bucket, "validatedAt", "1700000000000");
      runtime.accountStore.updateStatus(account.accountId, "available");
      return account;
    }

    async function resolveThirdParty(
      runtime: ReturnType<typeof makeRuntime>,
      input: { provider: string; threadId: string; model?: string; thirdPartyAccountId: string },
    ) {
      return (
        runtime as unknown as {
          resolveAccountSessionEnv: (
            i: typeof input,
          ) => Promise<
            { accountId: string; reason: string; env: Record<string, string> } | undefined
          >;
        }
      ).resolveAccountSessionEnv(input);
    }

    it("projects a validated third-party model to Codex without any pool account", async () => {
      const baseDir = makeTempDir();
      process.env.CRAFTSTATION_DATA_DIR = baseDir;
      const runtime = makeRuntime(() => undefined);
      const thirdParty = addThirdPartyAccount(runtime);
      // No codex/kimi pool rows at all: legacy code would fall to ambient or
      // throw a pool error. The third-party path must succeed regardless.
      const resolved = await resolveThirdParty(runtime, {
        provider: "codex",
        threadId: "thread-tp-1",
        model: "gpt-5.6-sol",
        thirdPartyAccountId: thirdParty.accountId,
      });
      expect(resolved?.accountId).toBe(thirdParty.accountId);
      expect(resolved?.reason).toBe("third-party");
      expect(resolved?.env.CODEX_HOME).toContain("openai-compatible-codex");
      expect(resolved?.env.CRAFTSTATION_OPENAI_COMPATIBLE_API_KEY).toBe("sk-third-party");
      // The key travels only in the child-process env (projection), never on
      // disk: the generated Codex home must not contain secret material.
      expect(resolved?.env.CODEX_HOME).not.toContain("sk-third-party");
    });

    it("projects a validated GLM third-party model to OpenCode, never the Codex pool", async () => {
      const baseDir = makeTempDir();
      process.env.CRAFTSTATION_DATA_DIR = baseDir;
      const runtime = makeRuntime(() => undefined);
      const thirdParty = addThirdPartyAccount(runtime, {
        model: "glm-5.3-flash",
        protocol: "chat_completions",
      });
      const resolved = await resolveThirdParty(runtime, {
        provider: "opencode",
        threadId: "thread-tp-glm",
        model: "glm-5.3-flash",
        thirdPartyAccountId: thirdParty.accountId,
      });
      expect(resolved?.accountId).toBe(thirdParty.accountId);
      expect(resolved?.reason).toBe("third-party");
      expect(resolved?.env.OPENCODE_CONFIG_DIR).toContain("openai-compatible-opencode");
      expect(resolved?.env.CRAFTSTATION_OPENCODE_PROVIDER).toBe("craftstation");
      expect(resolved?.env.CODEX_HOME).toBeUndefined();
    });

    it("projects a validated Responses third-party model to Muse Code", async () => {
      const baseDir = makeTempDir();
      process.env.CRAFTSTATION_DATA_DIR = baseDir;
      const runtime = makeRuntime(() => undefined);
      const thirdParty = addThirdPartyAccount(runtime, { model: "muse-spark-1.3-contributor" });
      const resolved = await resolveThirdParty(runtime, {
        provider: "muse",
        threadId: "thread-tp-muse",
        model: "muse-spark-1.3-contributor",
        thirdPartyAccountId: thirdParty.accountId,
      });
      expect(resolved?.accountId).toBe(thirdParty.accountId);
      expect(resolved?.reason).toBe("third-party");
      expect(resolved?.env.META_API_KEY).toBe("sk-third-party");
      expect(resolved?.env.CRAFTSTATION_MUSE_BASE_URL).toBe("https://relay.example.com/v1");
      expect(resolved?.env.XDG_CONFIG_HOME).toContain("openai-compatible-muse");
    });

    it("never reports a pool error for third-party launches, even with an exhausted kimi pool", async () => {
      const baseDir = makeTempDir();
      process.env.CRAFTSTATION_DATA_DIR = baseDir;
      const runtime = makeRuntime(() => undefined);
      const thirdParty = addThirdPartyAccount(runtime, { model: "k3-256k" });
      // Exhausted native kimi pool: must NOT surface as "No usable kimi
      // account in the provider pool" for a third-party launch.
      const dead = addPoolAccount(runtime, "kimi", "Dead", true);
      runtime.accountStore.updateStatus(dead.accountId, "quota-exhausted");
      const resolved = await resolveThirdParty(runtime, {
        provider: "kimi",
        threadId: "thread-tp-2",
        model: "k3-256k",
        thirdPartyAccountId: thirdParty.accountId,
      });
      expect(resolved?.accountId).toBe(thirdParty.accountId);
      expect(resolved?.reason).toBe("third-party");
      expect(resolved?.accountId).not.toBe(dead.accountId);
    });

    it("fails closed on unknown or unverified third-party accounts", async () => {
      const baseDir = makeTempDir();
      process.env.CRAFTSTATION_DATA_DIR = baseDir;
      const runtime = makeRuntime(() => undefined);
      await expect(
        resolveThirdParty(runtime, {
          provider: "codex",
          threadId: "thread-tp-3",
          thirdPartyAccountId: "openai-compatible:nope",
        }),
      ).rejects.toThrowError(/不存在或已删除/);

      const unverified = runtime.addAccount({
        provider: "openai-compatible",
        label: "Unverified",
        maskedIdentity: "Unverified",
      });
      await expect(
        resolveThirdParty(runtime, {
          provider: "codex",
          threadId: "thread-tp-4",
          thirdPartyAccountId: unverified.accountId,
        }),
      ).rejects.toThrowError(/尚未通过真实兼容性验证/);
    });
  });
});

describe("SupervisorRuntime account refresh lock (v0.5 T09)", () => {
  it("coalesces concurrent per-account quota refreshes into one collector call", async () => {
    process.env.CRAFTSTATION_DATA_DIR = makeTempDir();
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

describe("SupervisorRuntime official Crafting model inventory", () => {
  it("projects only models returned by the official Codex app-server discovery seam", async () => {
    const runtime = makeRuntime(() => undefined);
    const discovery = vi.fn<
      () => Promise<
        Array<{
          id: string;
          displayName: string;
          contextWindow: number;
          supportsStreaming: boolean;
          supportsToolCalling: boolean;
        }>
      >
    >(async () => [
      {
        id: "gpt-official-live",
        displayName: "GPT Official Live",
        contextWindow: 196_000,
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ]);
    runtime.setCraftingModelDiscovery(discovery);

    await expect(
      runtime.getCraftingModelInventory({
        projectLocation: { kind: "windows", path: "C:\\repo" },
      }),
    ).resolves.toEqual({
      status: "ready",
      source: "codex-app-server-model-list",
      models: [
        {
          id: "gpt-official-live",
          displayName: "GPT Official Live",
          contextWindow: 196_000,
          supportsStreaming: true,
          supportsToolCalling: true,
        },
      ],
    });
    expect(discovery).toHaveBeenCalledWith({ kind: "windows", path: "C:\\repo" });
  });

  it.each([
    ["empty official inventory", async (): Promise<undefined> => undefined, "RUNTIME_UNAVAILABLE"],
    [
      "protocol failure",
      async (): Promise<undefined> => Promise.reject(new Error("private path")),
      "PROTOCOL_MISMATCH",
    ],
  ] as const)(
    "fails closed for %s without static OpenAI fallback",
    async (_name, discovery, code) => {
      const runtime = makeRuntime(() => undefined);
      runtime.setCraftingModelDiscovery(discovery);

      const result = await runtime.getCraftingModelInventory({
        projectLocation: { kind: "windows", path: "C:\\repo" },
      });

      expect(result).toMatchObject({
        status: "unavailable",
        source: "codex-app-server-model-list",
        models: [],
        diagnostic: { code },
      });
      expect(JSON.stringify(result)).not.toMatch(/gpt-4o|gpt-5-hybrid|gpt-5\.3-codex|o3-mini/u);
      expect(JSON.stringify(result)).not.toContain("private path");
    },
  );
});

describe("SupervisorRuntime crafted execution fencing (v0.9 F1)", () => {
  const projectLocation = { kind: "windows" as const, path: "C:\\repo" };

  function fencePlan(threadId: string) {
    const result = new Crafter().compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0], harness: "auto" } },
      { workspace: "C:\\repo", threadId },
    );
    expect(result.success).toBe(true);
    return result.craftPlan!;
  }

  interface FenceFixture {
    runtime: SupervisorRuntime;
    plan: ReturnType<typeof fencePlan>;
    /** Supervisor events (session-switch-state, thread-runtime-event, ...). */
    emitted: Array<{ type: string } & Record<string, unknown>>;
    sessionIds: string[];
    turns: Array<{ prompt: string; userMessageItemId?: string | undefined }>;
    /** Emit a canonical event from the MOST RECENTly created crafted session. */
    emitFromSession: (event: RuntimeEvent) => void;
  }

  function makeFenceRuntime(threadId: string): FenceFixture {
    const emitted: Array<{ type: string } & Record<string, unknown>> = [];
    const runtime = makeRuntime((event) => emitted.push(event as { type: string }));
    let emitFromCurrent: (event: RuntimeEvent) => void = () => undefined;
    const sessionIds: string[] = [];
    const turns: FenceFixture["turns"] = [];
    let sessionCounter = 0;
    runtime.setCustomCraftingAdapter(
      (plan): HarnessRuntimeAdapter => ({
        id: "fence-harness",
        harnessKind: plan.runtimeBinding.harnessKind,
        supports: () => true,
        spawnEntity: async (entityPlan) => ({
          id: `entity:fence:${sessionCounter + 1}`,
          resultItemId: entityPlan.resultItemId,
          craftPlan: entityPlan,
          status: "spawned",
          createdAt: new Date(0).toISOString(),
        }),
        createSession: async (entity) => {
          sessionCounter += 1;
          const sessionId = `runtime-fence:${sessionCounter}`;
          sessionIds.push(sessionId);
          const snapshot = {
            sessionId,
            threadId: entity.craftPlan.threadId,
            entityId: entity.id,
            status: "idle" as const,
            events: [],
          };
          return {
            id: sessionId,
            nativeSessionRef: `native:${sessionId}`,
            threadId: entity.craftPlan.threadId,
            entityId: entity.id,
            status: "idle" as const,
            startTurn: async (command) => {
              turns.push(command);
              return { turnId: "turn:fence", status: "completed" as const, events: [] };
            },
            interrupt: async () => undefined,
            steer: async () => undefined,
            respondToRequest: async () => undefined,
            terminate: async () => undefined,
            getSnapshot: () => snapshot,
            subscribe: (listener: SessionEventListener) => {
              emitFromCurrent = (event) => listener(event, snapshot);
              return () => undefined;
            },
            sendPrompt: async () => ({ response: "fence-ok", events: [] }),
          };
        },
        resumeSession: async () => {
          throw new Error("resume is not used by the fencing test");
        },
      }),
    );
    return {
      runtime,
      plan: fencePlan(threadId),
      emitted,
      sessionIds,
      turns,
      emitFromSession: (event) => emitFromCurrent(event),
    };
  }

  function activeBindingStates(fixture: FenceFixture) {
    return fixture.emitted
      .filter(
        (event) =>
          event.type === "session-switch-state" &&
          (event.state as { phase?: string }).phase === "active",
      )
      .map((event) => (event.state as { activeSegment: Record<string, unknown> }).activeSegment);
  }

  function envelopeFor(segment: Record<string, unknown>) {
    return {
      segmentId: segment.id as string,
      runtimeSessionId: segment.runtimeSessionId as string,
      bindingEpoch: segment.bindingEpoch as number,
    };
  }

  it("reattaches a reloaded renderer without replacing the live Session or its listeners", async () => {
    const threadId = "fence-reload";
    const f = makeFenceRuntime(threadId);
    const initial = await f.runtime.craftAgent({ craftPlan: f.plan, projectLocation, prompt: "" });
    const payload = { craftPlan: f.plan, projectLocation, sessionRef: "native:runtime-fence:1" };
    await expect(f.runtime.resumeCraftAgent(payload)).resolves.toMatchObject({
      entityId: initial.entityId,
      sessionId: initial.sessionId,
    });
    expect(f.sessionIds).toHaveLength(1);
    await f.runtime.resumeCraftAgent({
      ...payload,
      prompt: "continue",
      userMessageItemId: "resume-user",
    });
    expect(f.turns).toEqual([
      expect.objectContaining({ prompt: "continue", userMessageItemId: "resume-user" }),
    ]);
    f.emitFromSession({ type: "turn.started", threadId, turnId: "after-reload" });
    f.emitFromSession({
      type: "turn.completed",
      threadId,
      turnId: "after-reload",
      state: "completed",
    });
    expect(f.emitted.filter((event) => event.type === "thread-state").at(-1)).toMatchObject({
      status: "idle",
    });
    await expect(
      f.runtime.resumeCraftAgent({ ...payload, sessionRef: "different-native-session" }),
    ).rejects.toThrow("HANDOFF_ACTIVE_PLAN_MISMATCH");
    await expect(
      f.runtime.resumeCraftAgent({ ...payload, accountId: "different-account" }),
    ).rejects.toThrow("HANDOFF_ACTIVE_PLAN_MISMATCH");
    expect(f.sessionIds).toHaveLength(1);
  });

  it("publishes the initial active binding and fences crafted active commands", async () => {
    const threadId = "fence-thread";
    const f = makeFenceRuntime(threadId);
    await f.runtime.craftAgent({ craftPlan: f.plan, projectLocation, prompt: "" });

    // The FIRST crafted Segment publishes its binding through the existing
    // session-switch-state channel, so the renderer can fence commands.
    const segments = activeBindingStates(f);
    expect(segments).toHaveLength(1);
    expect(f.runtime.readSessionSwitchState(threadId)).toMatchObject({
      targetCraftPlan: { id: f.plan.id, recipeId: f.plan.recipeId },
    });
    const envelope = envelopeFor(segments[0]!);
    expect(envelope.runtimeSessionId).toBe("runtime-fence:1");

    const missing = { code: "HANDOFF_ACTIVE_EXECUTION_REQUIRED" };
    // Follow-up send binds to the live Segment when the renderer omitted the
    // envelope (reload / missed session-switch-state). Close still fails closed.
    await expect(
      f.runtime.sendThreadInput({ threadId, prompt: "hi", config: { model: "m" } }),
    ).resolves.toBeUndefined();
    await expect(f.runtime.closeThread({ threadId })).rejects.toMatchObject(missing);
    await expect(f.runtime.clearPendingSteer({ threadId })).rejects.toMatchObject(missing);
    await expect(
      f.runtime.resolveThreadServerRequest({
        threadId,
        requestId: "req-1",
        method: "requestPermission",
        response: { optionId: "allow" },
      }),
    ).rejects.toMatchObject(missing);
    // Stop and steer are deliberately best-effort: a dropped handoff envelope
    // must never leave the user unable to stop a wedged turn or keep talking.
    // The fence failure is logged, not thrown.
    await expect(f.runtime.interruptThread({ threadId })).resolves.toBeUndefined();
    await expect(
      f.runtime.setPendingSteer({ threadId, prompt: "s", config: { model: "m" } }),
    ).resolves.toBeUndefined();

    // The current envelope lets the same commands through.
    await f.runtime.sendThreadInput({
      threadId,
      prompt: "hi",
      config: { model: "m" },
      execution: envelope,
    });
    await f.runtime.interruptThread({ threadId, execution: envelope });
    await f.runtime.clearPendingSteer({ threadId, execution: envelope });
    await f.runtime.setPendingSteer({
      threadId,
      prompt: "s",
      config: { model: "m" },
      execution: envelope,
    });

    const stale = { code: "HANDOFF_EXECUTION_STALE" };
    await expect(
      f.runtime.sendThreadInput({
        threadId,
        prompt: "hi",
        config: { model: "m" },
        execution: { ...envelope, bindingEpoch: envelope.bindingEpoch + 1 },
      }),
    ).rejects.toMatchObject(stale);
    await expect(
      f.runtime.closeThread({ threadId, execution: { ...envelope, runtimeSessionId: "other" } }),
    ).rejects.toMatchObject(stale);
    // A stale envelope on interrupt/steer also degrades to best-effort.
    await expect(
      f.runtime.interruptThread({
        threadId,
        execution: { ...envelope, segmentId: "segment:other" },
      }),
    ).resolves.toBeUndefined();
  });

  it("never resolves a pending request whose origin execution went stale", async () => {
    const threadId = "fence-origin-thread";
    const f = makeFenceRuntime(threadId);
    await f.runtime.craftAgent({ craftPlan: f.plan, projectLocation, prompt: "" });

    f.emitFromSession({
      type: "request.opened",
      threadId,
      requestId: "req-1",
      requestType: "command_execution_approval",
      payload: { summary: "Run script.sh" },
    });

    await expect(
      f.runtime.resolveThreadServerRequest({
        threadId,
        requestId: "req-1",
        method: "requestPermission",
        response: { optionId: "allow" },
      }),
    ).rejects.toMatchObject({ code: "HANDOFF_ACTIVE_EXECUTION_REQUIRED" });

    // Rebind the SAME durable thread to a fresh native session. The Segment id
    // and epoch are reused, but the runtime session identity moved — the old
    // request's origin execution no longer matches the active binding.
    await f.runtime.craftAgent({ craftPlan: f.plan, projectLocation, prompt: "" });
    expect(f.sessionIds).toEqual(["runtime-fence:1", "runtime-fence:2"]);
    const latestEnvelope = envelopeFor(activeBindingStates(f).at(-1)!);
    expect(latestEnvelope.runtimeSessionId).toBe("runtime-fence:2");

    await expect(
      f.runtime.resolveThreadServerRequest({
        threadId,
        requestId: "req-1",
        method: "requestPermission",
        response: { optionId: "allow" },
        execution: latestEnvelope,
      }),
    ).rejects.toMatchObject({ code: "HANDOFF_EXECUTION_STALE" });

    // A request opened under the NEW binding still resolves.
    f.emitFromSession({
      type: "request.opened",
      threadId,
      requestId: "req-2",
      requestType: "command_execution_approval",
      payload: { summary: "Run again" },
    });
    await expect(
      f.runtime.resolveThreadServerRequest({
        threadId,
        requestId: "req-2",
        method: "requestPermission",
        response: { optionId: "allow" },
        execution: latestEnvelope,
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps legacy non-crafted threads on the ThreadSessionManager path", async () => {
    const runtime = makeRuntime(() => undefined);
    // No crafted session for these threads: commands must fall through to the
    // legacy manager and fail with ITS error — never a handoff fence code.
    await expect(
      runtime.sendThreadInput({ threadId: "legacy-thread", prompt: "hi", config: { model: "m" } }),
    ).rejects.toThrow(/Unknown thread session/);
    // Legacy close/interrupt tolerate unknown threads (best-effort) and never
    // demand an execution envelope.
    await expect(runtime.closeThread({ threadId: "legacy-thread" })).resolves.toBeUndefined();
    await expect(runtime.interruptThread({ threadId: "legacy-thread" })).resolves.toBeUndefined();
  });
});

describe("SupervisorRuntime compatibility bridge control", () => {
  const cliproxyEnvBefore = process.env.CLIPROXY_BINARY_PATH;

  afterEach(() => {
    if (cliproxyEnvBefore === undefined) {
      delete process.env.CLIPROXY_BINARY_PATH;
    } else {
      process.env.CLIPROXY_BINARY_PATH = cliproxyEnvBefore;
    }
  });

  it("stops an idle bridge idempotently", async () => {
    const runtime = makeRuntime(() => undefined);
    await expect(runtime.stopCompatibilityBridge()).resolves.toMatchObject({ running: false });
    expect(runtime.getCompatibilityBridgeStatus().running).toBe(false);
  });

  it("fails start with remediation when no sidecar binary exists", async () => {
    delete process.env.CLIPROXY_BINARY_PATH;
    const runtime = makeRuntime(() => undefined);
    await expect(
      runtime.startCompatibilityBridge({
        cwd: makeTempDir(),
        existsSync: () => false,
        resolveOnPath: () => undefined,
      }),
    ).rejects.toThrow(/CLIProxyAPI sidecar binary not found/);
    expect(runtime.getCompatibilityBridgeStatus().running).toBe(false);
  });

  it.runIf(
    process.platform === "win32" &&
      existsSync(join(process.cwd(), ".tools", "cpa", "cli-proxy-api.exe")),
  )("starts and stops the real bundled sidecar end to end", async () => {
    delete process.env.CLIPROXY_BINARY_PATH;
    const runtime = makeRuntime(() => undefined);
    try {
      const started = await runtime.startCompatibilityBridge();
      expect(started.running).toBe(true);
      expect(started.endpoint).toBe("http://127.0.0.1:8317");
    } finally {
      await runtime.stopCompatibilityBridge();
    }
    expect(runtime.getCompatibilityBridgeStatus().running).toBe(false);
  });
});
