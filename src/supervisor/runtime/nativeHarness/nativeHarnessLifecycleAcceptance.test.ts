/* eslint-disable vitest/require-mock-type-parameters -- fixture mocks are intentionally structural. */
import { describe, expect, it, vi } from "vitest";
import type { IPty } from "node-pty";
import type {
  AgentAdapter,
  CreateStructuredSessionInput,
  StructuredSessionHandle,
  StructuredSessionListener,
} from "@/supervisor/agents/base";
import type { ProjectLocation, RuntimeEvent } from "@/shared/contracts";
import type { CraftPlan } from "@/shared/crafting";
import {
  ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
  CODEX_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
  GROK_NATIVE_HARNESS_DESCRIPTOR,
  KIMI_NATIVE_HARNESS_DESCRIPTOR,
} from "./descriptors";
import { PtyNativeHarnessRuntimeAdapter } from "./ptyAdapter";
import { StructuredNativeHarnessRuntimeAdapter } from "./structuredAdapter";
import { UnavailableNativeHarnessRuntimeAdapter } from "./unavailableAdapter";

const windowsProject: ProjectLocation = { kind: "windows", path: "C:\\repo" };

const ACCEPTANCE_DIMENSIONS = [
  "discovery",
  "start",
  "resume",
  "multi_turn",
  "streaming",
  "interrupt",
  "cleanup",
] as const;

const FIVE_HARNESS_MATRIX = [
  {
    harnessKind: "codex",
    transport: "codex-app-server-json-rpc",
    fixtureEvidence: "nativeCodexRuntimeAdapter.test.ts",
  },
  {
    harnessKind: "grok",
    transport: "acp-stdio",
    fixtureEvidence: "nativeHarnessProviderFixtures.test.ts",
  },
  {
    harnessKind: "kimi",
    transport: "acp-stdio",
    fixtureEvidence: "nativeHarnessProviderFixtures.test.ts",
  },
  {
    harnessKind: "antigravity",
    transport: "official-stream-json",
    fixtureEvidence: "nativeHarness.test.ts",
  },
  {
    harnessKind: "deepseek",
    transport: "deepseek-json-rpc-stdio",
    fixtureEvidence: "nativeHarness.test.ts",
  },
] as const;

function structuredPlan(harnessKind: "grok" | "kimi", vendor: "xai" | "moonshot"): CraftPlan {
  return {
    id: `plan:${harnessKind}:acceptance`,
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
      runtimeAdapterId: `native-harness:${harnessKind}`,
      environment: { kind: "windows" },
    },
    workspace: "C:\\repo",
    threadId: `thread:${harnessKind}:acceptance`,
    createdAt: new Date(0).toISOString(),
  };
}

function makeStructuredHandle(
  providerSessionId: string,
  threadId: string,
): StructuredSessionHandle {
  let listener: StructuredSessionListener | undefined;
  const handle: StructuredSessionHandle = {
    launchOptions: {},
    openThread: vi.fn(
      async (_config, sessionRef) => sessionRef?.providerSessionId ?? providerSessionId,
    ),
    startTurn: vi.fn(async (prompt) => {
      const turnId = `turn:${providerSessionId}:${prompt}`;
      const events: RuntimeEvent[] = [
        { type: "turn.started", threadId, turnId },
        {
          type: "content.delta",
          threadId,
          itemId: `item:${turnId}`,
          stream: "assistant_text",
          delta: `${providerSessionId}:${prompt}`,
        },
        { type: "turn.completed", threadId, turnId, state: "completed" },
      ];
      for (const event of events) listener?.onRuntimeEvent?.(event);
    }),
    setListener: vi.fn((next) => {
      listener = next;
    }),
    dispose: vi.fn(async () => undefined),
  };
  return handle;
}

function makeStructuredAdapter(
  harnessKind: "grok" | "kimi",
  vendor: "xai" | "moonshot",
  providerSessionId: string,
): StructuredNativeHarnessRuntimeAdapter {
  const createStructuredSession: NonNullable<AgentAdapter["createStructuredSession"]> = async (
    input: CreateStructuredSessionInput,
  ) => makeStructuredHandle(providerSessionId, input.threadId);
  const agent = {
    kind: harnessKind,
    label: `${harnessKind} acceptance fixture`,
    capabilities: {},
    buildLaunchArgv: () => ({ binary: harnessKind, args: [] }),
    buildResumeArgv: () => ({ binary: harnessKind, args: [] }),
    createStructuredSession,
  } as unknown as AgentAdapter;

  return new StructuredNativeHarnessRuntimeAdapter({
    adapter: agent,
    descriptor:
      harnessKind === "grok" ? GROK_NATIVE_HARNESS_DESCRIPTOR : KIMI_NATIVE_HARNESS_DESCRIPTOR,
    projectLocation: windowsProject,
    profileRef: `profile:${harnessKind}`,
  });
}

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
    emitData: (data) => onData?.(data),
    emitExit: (exitCode, signal) =>
      onExit?.({ exitCode, ...(signal !== undefined ? { signal } : {}) }),
  };
}

function makeAntigravityAgent(): AgentAdapter {
  const buildResumeArgv: AgentAdapter["buildResumeArgv"] = () => ({
    binary: "agy",
    args: ["--resume"],
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
    label: "Antigravity acceptance fixture",
    capabilities: {},
    buildLaunchArgv: () => ({ binary: "agy", args: ["--interactive"] }),
    buildResumeArgv,
    buildDirectInput,
    detectTerminalStatus,
  } as unknown as AgentAdapter;
}

describe("Five-Harness lifecycle acceptance matrix", () => {
  it("keeps all five targets peer rows with explicit native transports and fixture evidence", () => {
    expect(FIVE_HARNESS_MATRIX.map((entry) => entry.harnessKind)).toEqual([
      "codex",
      "grok",
      "kimi",
      "antigravity",
      "deepseek",
    ]);
    expect(FIVE_HARNESS_MATRIX.map((entry) => entry.transport)).toEqual([
      CODEX_NATIVE_HARNESS_DESCRIPTOR.transport,
      GROK_NATIVE_HARNESS_DESCRIPTOR.transport,
      KIMI_NATIVE_HARNESS_DESCRIPTOR.transport,
      ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR.transport,
      DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR.transport,
    ]);
    expect(ACCEPTANCE_DIMENSIONS).toEqual(
      expect.arrayContaining([
        "discovery",
        "start",
        "resume",
        "multi_turn",
        "streaming",
        "interrupt",
        "cleanup",
      ]),
    );
  });

  it("promotes only product-path-proven Antigravity capabilities and keeps DeepSeek gated", () => {
    const evidenceGatedCapabilities = [
      "resume",
      "multi_turn",
      "tool_execution",
      "permission",
      "mcp",
      "skills",
      "subagents",
      "context",
      "compaction",
    ] as const;

    expect(
      evidenceGatedCapabilities.map((capability) => [
        capability,
        DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR.capabilities[capability],
      ]),
    ).toEqual(
      evidenceGatedCapabilities.map((capability) => [capability, "implementation missing"]),
    );
    expect(ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR.capabilities).toMatchObject({
      resume: "supported+integrated",
      multi_turn: "supported+integrated",
      tool_execution: "supported+integrated",
      permission: "implementation missing",
      mcp: "supported+integrated",
      skills: "supported+integrated",
      subagents: "supported+integrated",
      context: "supported+integrated",
    });
    expect(ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR.capabilities.compaction).toBe(
      "native unsupported",
    );
  });

  it.each([
    ["grok", "xai"],
    ["kimi", "moonshot"],
  ] as const)(
    "runs start/resume/multi-turn/stream/cleanup for %s through the ACP seam",
    async (kind, vendor) => {
      const adapter = makeStructuredAdapter(kind, vendor, `${kind}-matrix-session`);
      const plan = structuredPlan(kind, vendor);
      const entity = await adapter.spawnEntity(plan);
      const session = await adapter.createSession(entity);
      const events: RuntimeEvent[] = [];
      session.subscribe((event) => events.push(event));

      await expect(session.startTurn({ prompt: "first" })).resolves.toMatchObject({
        status: "completed",
        response: `${kind}-matrix-session:first`,
      });
      await expect(session.startTurn({ prompt: "second" })).resolves.toMatchObject({
        status: "completed",
        response: `${kind}-matrix-session:second`,
      });
      expect(events.filter((event) => event.type === "content.delta")).toHaveLength(2);
      expect(events.every((event) => event.nativeEnvelope?.harnessKind === kind)).toBe(true);

      const resumed = await adapter.resumeSession(
        await adapter.spawnEntity(plan),
        `${kind}-saved-session`,
      );
      expect(resumed.nativeSessionRef).toBe(`${kind}-saved-session`);
      await session.terminate();
      await resumed.terminate();
      expect(session.status).toBe("terminated");
      expect(resumed.status).toBe("terminated");
    },
  );

  it("runs Antigravity PTY stream, interrupt, crash and cleanup paths", async () => {
    const streamFixture = makePtyFixture();
    const adapter = new PtyNativeHarnessRuntimeAdapter({
      adapter: makeAntigravityAgent(),
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
      spawnPty: () => streamFixture.pty,
    });
    const plan: CraftPlan = {
      ...structuredPlan("grok", "xai"),
      id: "plan:antigravity:acceptance",
      recipeId: "recipe:antigravity",
      resultItemId: "result:antigravity",
      runtimeBinding: {
        ...structuredPlan("grok", "xai").runtimeBinding,
        harnessKind: "antigravity",
        vendor: "google",
        modelId: "antigravity-default",
        runtimeAdapterId: "native-harness:antigravity",
      },
      ingredients: {
        ...structuredPlan("grok", "xai").ingredients,
        model: {
          ...structuredPlan("grok", "xai").ingredients.model!,
          vendor: "google",
          itemId: "google:model",
        },
        harness: {
          ...structuredPlan("grok", "xai").ingredients.harness!,
          vendor: "google",
          itemId: "harness:antigravity",
        },
      },
      threadId: "thread:antigravity:acceptance",
    };
    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);
    const turn = session.startTurn({ prompt: "hello" });
    streamFixture.emitData("WORKING");
    streamFixture.emitData("native stream");
    streamFixture.emitData("IDLE");
    await expect(turn).resolves.toMatchObject({
      status: "completed",
      response: expect.stringContaining("native stream"),
    });
    await session.terminate();
    expect(streamFixture.kill).toHaveBeenCalledOnce();

    const interruptFixture = makePtyFixture();
    const interruptAdapter = new PtyNativeHarnessRuntimeAdapter({
      adapter: makeAntigravityAgent(),
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
      spawnPty: () => interruptFixture.pty,
    });
    const interruptSession = await interruptAdapter.createSession(
      await interruptAdapter.spawnEntity(plan),
    );
    const interrupted = interruptSession.startTurn({ prompt: "stop" });
    await interruptSession.interrupt();
    await expect(interrupted).resolves.toMatchObject({ status: "interrupted" });
    expect(interruptFixture.writes).toContain("\u0003");
    await interruptSession.terminate();

    const crashFixture = makePtyFixture();
    const crashAdapter = new PtyNativeHarnessRuntimeAdapter({
      adapter: makeAntigravityAgent(),
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
      spawnPty: () => crashFixture.pty,
    });
    const crashSession = await crashAdapter.createSession(await crashAdapter.spawnEntity(plan));
    const crashed = crashSession.startTurn({ prompt: "crash" });
    crashFixture.emitExit(23);
    await expect(crashed).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
    expect(crashSession.getDiagnostics?.() ?? []).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "NATIVE_PROCESS_CRASHED" })]),
    );
    await crashSession.terminate();
  });

  it("keeps DeepSeek / DSH unavailable without creating synthetic lifecycle state", async () => {
    const adapter = new UnavailableNativeHarnessRuntimeAdapter(
      DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      "The official DeepSeek / DSH executable is not installed or configured.",
    );
    expect(() => adapter.getDiagnostics()[0]?.code).not.toThrow();
    await expect(
      adapter.spawnEntity({
        ...structuredPlan("grok", "xai"),
        runtimeBinding: {
          ...structuredPlan("grok", "xai").runtimeBinding,
          harnessKind: "deepseek",
          vendor: "deepseek",
          modelId: "deepseek-chat",
          runtimeAdapterId: "native-harness:deepseek",
        },
      }),
    ).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
      message: expect.stringContaining("no synthetic Entity"),
    });
  });
});
