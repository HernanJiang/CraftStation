import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_MODEL_ITEMS,
  Crafter,
  type CraftSession,
  type HarnessRuntimeAdapter,
  type StartTurnCommand,
  type TurnResult,
} from "@/shared/crafting";
import type { ResolvedMcpServer, RuntimeEvent } from "@/shared/contracts";
import { SupervisorRuntime } from "./supervisorRuntime";
import { explainNativeNetworkError } from "./agents/nativeNetworkError";

const overrides = vi.hoisted(() => new Map<string, HarnessRuntimeAdapter>());
const injectedMcp = vi.hoisted(() => new Map<string, readonly ResolvedMcpServer[]>());
vi.mock("./runtime/nativeHarness", async (importActual) => {
  const actual = await importActual<typeof import("./runtime/nativeHarness")>();
  return {
    ...actual,
    createNativeHarnessRuntimeAdapter: (
      kind: string,
      options: Parameters<typeof actual.createNativeHarnessRuntimeAdapter>[1],
    ) => {
      injectedMcp.set(kind, options.mcpServers ?? []);
      return overrides.get(kind) ?? actual.createNativeHarnessRuntimeAdapter(kind, options);
    },
  };
});
let directory: string;
let runtime: SupervisorRuntime;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "craft-goal-runtime-"));
  vi.stubEnv("CRAFTSTATION_BASE_DIR", directory);
  vi.stubEnv("CRAFTSTATION_DATA_DIR", directory);
  writeFileSync(
    join(directory, "settings.json"),
    JSON.stringify({ turnRetryMaxAttempts: 2, turnRetryIntervalSeconds: 1 }),
  );
  runtime = new SupervisorRuntime(() => {});
  vi.spyOn(runtime.skillsService, "prepareForLaunch").mockResolvedValue(undefined);
  vi.spyOn(runtime.skillsService, "scan").mockResolvedValue({
    skills: [],
    effectiveSkillIds: [],
    invocation: "slash",
    issues: [],
    canLinkToGlobal: true,
  });
});
afterEach(async () => {
  await runtime.disposeAsync();
  vi.unstubAllEnvs();
  overrides.clear();
  injectedMcp.clear();
  rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const compiled = new Crafter().compile(
    { slots: { model: BUILTIN_MODEL_ITEMS[0], harness: "auto" } },
    { workspace: directory, threadId: "goal-thread" },
  ).craftPlan!;
  const plan = {
    ...compiled,
    ingredients: {
      model: { ...compiled.ingredients.model!, vendor: "xai", itemId: "xai:model" },
      harness: { ...compiled.ingredients.harness!, vendor: "xai", itemId: "harness:grok" },
    },
    runtimeBinding: {
      ...compiled.runtimeBinding,
      harnessKind: "grok",
      vendor: "xai",
      modelId: "grok-4.6",
      runtimeAdapterId: "native-harness:grok",
    },
    overrides: { reasoningEffort: "high" as const },
  };
  const commands: StartTurnCommand[] = [];
  const listeners = new Set<(event: RuntimeEvent) => void>();
  let status: CraftSession["status"] = "idle";
  let behavior: (command: StartTurnCommand) => Promise<void> = async () => {};
  const emit = (event: RuntimeEvent) => {
    for (const listener of listeners) listener(event);
  };
  const session: CraftSession = {
    id: "goal-session",
    entityId: "goal-entity",
    get status() {
      return status;
    },
    nativeSessionRef: "goal-native",
    startTurn: async (command): Promise<TurnResult> => {
      commands.push(command);
      const turnId = `turn-${commands.length}`;
      status = "busy";
      emit({ type: "turn.started", threadId: "goal-thread", turnId });
      try {
        await behavior(command);
      } catch (error) {
        status = "idle";
        emit({ type: "turn.completed", threadId: "goal-thread", turnId, state: "failed" });
        throw error;
      }
      status = "idle";
      emit({ type: "turn.completed", threadId: "goal-thread", turnId, state: "completed" });
      return { turnId, status: "completed", events: [] };
    },
    sendPrompt: async (prompt) => {
      const result = await session.startTurn({ prompt });
      return { response: result.response ?? "", events: [...result.events] };
    },
    interrupt: async () => {},
    terminate: async () => {},
    subscribe: (listener) => {
      const wrapped = (event: RuntimeEvent) => listener(event, session.getSnapshot());
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    getSnapshot: () => ({
      sessionId: "goal-session",
      entityId: "goal-entity",
      status: session.status,
      events: [],
    }),
  };
  overrides.set("grok", {
    id: "fixture-grok",
    harnessKind: "grok",
    supports: () => true,
    spawnEntity: async () => ({
      id: "goal-entity",
      resultItemId: plan.resultItemId,
      craftPlan: plan,
      status: "spawned",
      createdAt: new Date().toISOString(),
    }),
    createSession: async () => session,
    resumeSession: async () => session,
  });
  const launch = () =>
    runtime.craftAgent({
      craftPlan: plan,
      projectLocation: { kind: "windows", path: directory },
      prompt: "",
    });
  return {
    plan,
    commands,
    launch,
    behave: (next: typeof behavior) => {
      behavior = next;
    },
  };
}

describe("Supervisor Craft-Harness goal integration", () => {
  it("preserves a failed startup goal without scheduling an authentication retry", async () => {
    await runtime.controlThreadGoal({
      threadId: "goal-thread",
      action: "edit",
      objective: "startup",
    });
    vi.spyOn(runtime.threadSessionManager, "startThread").mockRejectedValue(
      new Error("Authentication required"),
    );
    await expect(
      runtime.startThread({
        threadId: "goal-thread",
        agentKind: "kimi",
        config: { model: "kimi" },
        prompt: "startup",
        projectLocation: { kind: "windows", path: directory },
        initialSize: { cols: 80, rows: 24 },
      }),
    ).rejects.toThrow("Authentication required");
    const goals = JSON.parse(readFileSync(join(directory, "goals.json"), "utf8"));
    expect(goals[0]).toMatchObject({ objective: "startup", status: "blocked" });
    await expect(
      runtime.controlThreadGoal({ threadId: "goal-thread", action: "resume" }),
    ).resolves.toEqual({ requiresLaunch: true });
  });
  it("keeps a restored goal active while the renderer rebuilds a missing session", async () => {
    const f = fixture();
    await runtime.controlThreadGoal({
      threadId: "goal-thread",
      action: "edit",
      objective: "survive restart",
    });
    await expect(
      runtime.sendThreadInput({
        threadId: "goal-thread",
        prompt: "continue",
        config: { model: "grok-4.6" },
      }),
    ).rejects.toThrow("Unknown thread session");
    await f.launch();
    await vi.waitFor(() => expect(f.commands).toHaveLength(1));
    expect(f.commands[0]?.inlineInstructions).toContain("survive restart");
  });
  it("injects real goal tools and dispatches an idle goal using the selected model and effort", async () => {
    const f = fixture();
    await f.launch();
    await runtime.controlThreadGoal({
      threadId: "goal-thread",
      action: "edit",
      objective: "verify the fixture",
    });
    await vi.waitFor(() => expect(f.commands).toHaveLength(1));
    expect(injectedMcp.get("grok")?.some((server) => server.id === "craft-goal")).toBe(true);
    expect(
      injectedMcp.get("grok")?.find((server) => server.id === "craft-goal")?.transport.type,
    ).toBe("stdio");
    expect(f.commands[0]?.inlineInstructions).toContain("verify the fixture");
    expect(f.commands[0]?.overrides).toMatchObject({ model: "grok-4.6", reasoningEffort: "high" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(f.commands).toHaveLength(1);
  });
  it("retries a projected compaction failure through the real Supervisor seam", async () => {
    const f = fixture();
    await f.launch();
    f.behave(async () => {
      if (f.commands.length === 1)
        throw new Error(
          explainNativeNetworkError(
            "Error running remote compact task: Connection failed: error sending request",
            "Codex",
          )!,
        );
    });
    await runtime.sendThreadInput({
      threadId: "goal-thread",
      prompt: "continue task",
      config: { model: "grok-4.6", effort: "high" },
    });
    expect(f.commands).toHaveLength(2);
    expect(f.commands[1]?.inlineInstructions).toContain("Craft-Harness auto-retry");
  });
});
