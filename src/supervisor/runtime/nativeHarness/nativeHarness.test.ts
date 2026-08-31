/* eslint-disable vitest/require-mock-type-parameters -- fixture mocks are intentionally structural. */
import { vi, describe, expect, it } from "vitest";
import type { IPty } from "node-pty";
import type {
  AgentAdapter,
  StructuredSessionHandle,
  StructuredSessionListener,
} from "@/supervisor/agents/base";
import type { ProjectLocation, RuntimeEvent } from "@/shared/contracts";
import { CraftingError, type CraftPlan, type Entity } from "@/shared/crafting";
import {
  ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
  GROK_NATIVE_HARNESS_DESCRIPTOR,
} from "./descriptors";
import { PtyNativeHarnessRuntimeAdapter } from "./ptyAdapter";
import { StructuredNativeHarnessRuntimeAdapter } from "./structuredAdapter";
import { UnavailableNativeHarnessRuntimeAdapter } from "./unavailableAdapter";

const windowsProject: ProjectLocation = { kind: "windows", path: "C:\\repo" };
const windowsWorkspace = windowsProject.kind === "windows" ? windowsProject.path : "C:\\repo";

function makePlan(
  harnessKind: string,
  vendor: string,
  runtimeAdapterId = `native-harness:${harnessKind}`,
): CraftPlan {
  return {
    id: `plan:${harnessKind}`,
    recipeId: `recipe:${harnessKind}`,
    resultItemId: `result:${harnessKind}`,
    ingredients: {
      model: {
        slot: "model",
        itemId: `${vendor}:model`,
        itemVersion: "1.0.0",
        vendor,
        kind: "model",
      },
      harness: {
        slot: "harness",
        itemId: `harness:${harnessKind}`,
        itemVersion: "1.0.0",
        vendor,
        kind: "harness",
      },
    },
    runtimeBinding: {
      harnessKind,
      modelId: `${harnessKind}-model`,
      vendor,
      runtimeAdapterId,
      profileRef: "profile:test",
      environment: { kind: "windows" },
    },
    workspace: windowsWorkspace,
    threadId: `thread:${harnessKind}`,
    createdAt: new Date(0).toISOString(),
  };
}

function makeStructuredHandle(
  options: {
    sessionId?: string;
    startTurn?: StructuredSessionHandle["startTurn"];
  } = {},
): StructuredSessionHandle & {
  listener?: StructuredSessionListener;
  openThread: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  let listener: StructuredSessionListener | undefined;
  const openThread = vi.fn(async (_config, sessionRef) => {
    return sessionRef?.providerSessionId ?? options.sessionId ?? "native-session-1";
  });
  const dispose = vi.fn(async () => undefined);
  const handle: StructuredSessionHandle & {
    listener?: StructuredSessionListener;
    openThread: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  } = {
    launchOptions: {},
    activate: vi.fn(async () => undefined),
    openThread,
    startTurn:
      options.startTurn ??
      vi.fn(async () => {
        listener?.onUpdate({ status: "working", attention: "working" });
        listener?.onRuntimeEvent?.({
          type: "content.delta",
          threadId: "thread:grok",
          itemId: "item:native",
          stream: "assistant_text",
          delta: "native response",
        });
        listener?.onUpdate({ status: "idle", attention: "none" });
      }),
    interruptTurn: vi.fn(async () => undefined),
    setListener: vi.fn((next: StructuredSessionListener) => {
      listener = next;
      handle.listener = next;
    }),
    dispose,
  };
  return handle;
}

function makeStructuredAgent(handle: StructuredSessionHandle): AgentAdapter {
  return {
    kind: "grok",
    label: "Grok fixture",
    capabilities: {},
    buildLaunchArgv: () => ({ binary: "grok", args: [] }),
    buildResumeArgv: () => ({ binary: "grok", args: [] }),
    createStructuredSession: vi.fn(async () => handle),
  } as unknown as AgentAdapter;
}

describe("Native Harness runtime seam", () => {
  it("binds CraftPlan profile/environment, preserves native session identity, envelopes events, and resumes", async () => {
    const firstHandle = makeStructuredHandle({ sessionId: "grok-session-1" });
    const adapter = new StructuredNativeHarnessRuntimeAdapter({
      adapter: makeStructuredAgent(firstHandle),
      descriptor: GROK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
    });
    const plan = makePlan("grok", "xai");

    const entity = await adapter.spawnEntity(plan);
    expect(entity.status).toBe("spawned");
    expect(entity.nativeHarness).toEqual(GROK_NATIVE_HARNESS_DESCRIPTOR);
    expect(entity.metadata).toMatchObject({ profileRef: "profile:test" });

    const session = await adapter.createSession(entity);
    expect(session.nativeSessionRef).toBe("grok-session-1");
    const events: RuntimeEvent[] = [];
    session.subscribe((event) => events.push(event));

    const turn = await session.startTurn({ prompt: "hello" });
    expect(turn.status).toBe("completed");
    expect(turn.response).toBe("native response");
    expect(
      events.some((event) => event.nativeEnvelope?.providerSessionId === "grok-session-1"),
    ).toBe(true);
    expect(session.getSnapshot().nativeEvents?.[0]?.harnessKind).toBe("grok");

    const envelope = events.find((event) => event.nativeEnvelope)?.nativeEnvelope;
    expect(envelope).toMatchObject({
      harnessKind: "grok",
      source: "canonical-adapter",
      providerSessionId: "grok-session-1",
      sequence: 0,
    });

    await session.terminate();
    expect(events.at(-1)).toMatchObject({
      type: "session.exited",
      threadId: "thread:grok",
      reason: "normal",
    });
    expect(session.status).toBe("terminated");
    expect(firstHandle.dispose).toHaveBeenCalledOnce();

    const resumedHandle = makeStructuredHandle({ sessionId: "ignored-for-resume" });
    const resumedAdapter = new StructuredNativeHarnessRuntimeAdapter({
      adapter: makeStructuredAgent(resumedHandle),
      descriptor: GROK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
    });
    const resumedEntity = await resumedAdapter.spawnEntity(plan);
    const resumed = await resumedAdapter.resumeSession(resumedEntity, "grok-session-saved");

    expect(resumed.nativeSessionRef).toBe("grok-session-saved");
    expect(resumedHandle.openThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ providerSessionId: "grok-session-saved" }),
    );
  });

  it("reports structured turn failures through a stable CraftingError and failed turn event", async () => {
    const handle = makeStructuredHandle({
      startTurn: vi.fn(async () => {
        throw new Error("native protocol failed");
      }),
    });
    const adapter = new StructuredNativeHarnessRuntimeAdapter({
      adapter: makeStructuredAgent(handle),
      descriptor: GROK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
    });
    const entity = await adapter.spawnEntity(makePlan("grok", "xai"));
    const session = await adapter.createSession(entity);
    const events: RuntimeEvent[] = [];
    session.subscribe((event) => events.push(event));

    await expect(session.startTurn({ prompt: "fail" })).rejects.toMatchObject({
      code: "EXECUTION_FAILED",
    });
    expect(session.getDiagnostics?.() ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PROTOCOL_MISMATCH",
          operation: "startTurn",
        }),
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "turn.completed",
          state: "failed",
          threadId: "thread:grok",
        }),
      ]),
    );
  });

  it("forwards the native prompt error observer into the provider structured-session seam", async () => {
    const handle = makeStructuredHandle();
    const createStructuredSession = vi.fn(async () => handle);
    const agent = {
      ...makeStructuredAgent(handle),
      createStructuredSession,
    } as AgentAdapter;
    const onPromptError = vi.fn<(error: unknown) => void>();
    const adapter = new StructuredNativeHarnessRuntimeAdapter({
      adapter: agent,
      descriptor: GROK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
      onPromptError,
    });

    await adapter.createSession(await adapter.spawnEntity(makePlan("grok", "xai")));

    expect(createStructuredSession).toHaveBeenCalledWith(
      expect.objectContaining({ onPromptError }),
    );
  });

  it("keeps unavailable DSH honest and never creates an Entity", async () => {
    const adapter = new UnavailableNativeHarnessRuntimeAdapter(
      DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      "dsh was not discovered in the native runtime audit",
    );

    await expect(adapter.spawnEntity(makePlan("deepseek", "deepseek"))).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
      message: expect.stringContaining("no synthetic Entity"),
    });
    expect(adapter.getDiagnostics()).toEqual([
      expect.objectContaining({
        code: "RUNTIME_UNAVAILABLE",
        harnessKind: "deepseek",
        message: "dsh was not discovered in the native runtime audit",
      }),
    ]);
  });
});

interface PtyFixture {
  pty: IPty;
  writes: string[];
  kill: ReturnType<typeof vi.fn>;
  emitData(data: string): void;
  emitExit(exitCode: number, signal?: number): void;
}

function makePtyFixture(): PtyFixture {
  let onData: ((data: string) => void) | undefined;
  let onExit: ((event: { exitCode: number; signal?: number }) => void) | undefined;
  const writes: string[] = [];
  const kill = vi.fn();
  const pty = {
    write: vi.fn((data: string) => writes.push(data)),
    kill,
    onData: (listener: (data: string) => void) => {
      onData = listener;
      return { dispose: vi.fn() };
    },
    onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
      onExit = listener;
      return { dispose: vi.fn() };
    },
  } as unknown as IPty;
  return {
    pty,
    writes,
    kill,
    emitData(data) {
      onData?.(data);
    },
    emitExit(exitCode, signal) {
      onExit?.({ exitCode, ...(signal !== undefined ? { signal } : {}) });
    },
  };
}

function makePtyAgent(): AgentAdapter {
  const buildResumeArgv: AgentAdapter["buildResumeArgv"] = (
    _location,
    _config,
    _prompt,
    sessionRef,
  ) => ({
    binary: "agy",
    args: ["--resume", sessionRef.providerSessionId],
  });
  const buildDirectInput: NonNullable<AgentAdapter["buildDirectInput"]> = (prompt) => [
    prompt,
    "\r",
  ];
  const detectTerminalStatus: NonNullable<AgentAdapter["detectTerminalStatus"]> = (text) =>
    text === "WORKING"
      ? { status: "working", attention: "working" }
      : text === "IDLE"
        ? { status: "idle", attention: "none" }
        : null;

  return {
    kind: "antigravity",
    label: "Antigravity fixture",
    capabilities: {},
    buildLaunchArgv: () => ({ binary: "agy", args: ["--interactive"] }),
    buildResumeArgv,
    buildDirectInput,
    detectTerminalStatus,
  } as unknown as AgentAdapter;
}

describe("PTY Native Harness adapter", () => {
  it("drives the official PTY boundary and cleans up without a leaked process", async () => {
    const fixture = makePtyFixture();
    const adapter = new PtyNativeHarnessRuntimeAdapter({
      adapter: makePtyAgent(),
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
      spawnPty: vi.fn(() => fixture.pty),
    });

    const entity: Entity = await adapter.spawnEntity(makePlan("antigravity", "google"));
    const session = await adapter.createSession(entity);
    const turnPromise = session.startTurn({ prompt: "hello" });

    fixture.emitData("WORKING");
    fixture.emitData("native answer");
    fixture.emitData("IDLE");

    const turn = await turnPromise;
    expect(turn.status).toBe("completed");
    expect(turn.response).toContain("native answer");
    expect(fixture.writes).toEqual(["hello", "\r"]);
    expect(session.getSnapshot().nativeSessionRef).toBeUndefined();

    await session.terminate();
    expect(fixture.kill).toHaveBeenCalledOnce();
    expect(session.status).toBe("terminated");
  });

  it("interrupts an active PTY turn and surfaces non-zero exits as native crash diagnostics", async () => {
    const interruptFixture = makePtyFixture();
    const interruptAdapter = new PtyNativeHarnessRuntimeAdapter({
      adapter: makePtyAgent(),
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
      spawnPty: () => interruptFixture.pty,
    });
    const interruptSession = await interruptAdapter.createSession(
      await interruptAdapter.spawnEntity(makePlan("antigravity", "google")),
    );
    const interrupted = interruptSession.startTurn({ prompt: "stop me" });
    await interruptSession.interrupt();
    await expect(interrupted).resolves.toMatchObject({ status: "interrupted" });
    expect(interruptFixture.writes).toContain("\u0003");

    const crashFixture = makePtyFixture();
    const crashAdapter = new PtyNativeHarnessRuntimeAdapter({
      adapter: makePtyAgent(),
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
      spawnPty: () => crashFixture.pty,
    });
    const crashSession = await crashAdapter.createSession(
      await crashAdapter.spawnEntity(makePlan("antigravity", "google")),
    );
    const crashed = crashSession.startTurn({ prompt: "crash me" });
    crashFixture.emitExit(17);

    await expect(crashed).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
    expect(crashSession.getDiagnostics?.() ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NATIVE_PROCESS_CRASHED",
          operation: "native-process-exit",
        }),
      ]),
    );
  });
});

describe("Native Harness diagnostic contract", () => {
  it("does not confuse unavailable runtime with synthetic success", () => {
    const diagnostic = new UnavailableNativeHarnessRuntimeAdapter(
      DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      "official runtime unavailable",
    ).getDiagnostics()[0]!;
    expect(diagnostic.code).toBe("RUNTIME_UNAVAILABLE");
    expect(diagnostic.message).toContain("unavailable");
    expect(() => CraftingError.runtimeUnavailable("deepseek").toDetail()).not.toThrow();
  });
});
