import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { Crafter, getDefaultRegistry } from "@/shared/crafting";
import type { SessionSwitchState } from "@/shared/sessionHandoff";
import { useAppStore } from "@/renderer/state/appStore";
import { useSessionHandoffStore } from "@/renderer/state/sessionHandoffStore";
import {
  applySessionHandoffState,
  cancelSessionHandoff,
  compileHandoffTarget,
  readSessionHandoffState,
  requestSessionHandoff,
} from "./sessionHandoffActions";

const bridge = vi.hoisted(() => ({
  requestSessionSwitch: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readSessionSwitchState: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  cancelSessionSwitch: vi.fn<(...args: unknown[]) => Promise<void>>(),
  craftAgent: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  closeThread: vi.fn<(...args: unknown[]) => Promise<void>>(),
  dbUpsertThread: vi.fn<(...args: unknown[]) => Promise<void>>(),
  dbSetState: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridge }));

const projectLocation = { kind: "windows" as const, path: "D:\\repo" };

function craftedThread(): Thread {
  const registry = getDefaultRegistry();
  // Codex owns its model catalog through app-server discovery; seed the
  // official model in this handoff fixture instead of relying on the filtered
  // stale builtin catalog.
  registry.refreshCodexModels([
    { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex", contextWindow: 200_000 },
  ]);
  const result = new Crafter(registry).compile({
    slots: {
      model: registry.getItem("openai:gpt-5.3-codex")!,
      harness: registry.getItem("harness:codex")!,
    },
  });
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Handoff",
    agentKind: "codex",
    config: { model: "gpt-5.3-codex" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    compositionProvenance: result.resultItem!.provenance,
    presentationMode: "gui",
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

function switchState(overrides: Partial<SessionSwitchState> = {}): SessionSwitchState {
  return {
    requestId: "switch-1",
    threadId: "thread-1",
    mode: "after-current-turn",
    phase: "queued",
    sourceSegmentId: "segment-1",
    targetBinding: {
      harnessKind: "grok",
      modelId: "grok-4.6",
      vendor: "xai",
      runtimeAdapterId: "native-harness:grok",
    },
    requestedAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("session handoff renderer actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionHandoffStore.setState({ statesByThread: {} });
    useAppStore.setState({ threads: [] });
    bridge.dbUpsertThread.mockResolvedValue(undefined);
    bridge.dbSetState.mockResolvedValue(undefined);
  });

  it.each([
    ["grok", "grok-4.6", "recipe:xai-grok-native", "grok"],
    ["codex", "gpt-5.3-codex", "recipe:openai-codex-native", "codex"],
  ])("compiles the verified %s native target", (targetAgentKind, model, recipeId, harnessKind) => {
    const compiled = compileHandoffTarget({
      thread: craftedThread(),
      projectLocation,
      targetAgentKind,
      targetConfig: { model },
    });

    expect(compiled).toMatchObject({
      available: true,
      craftPlan: {
        recipeId,
        threadId: "thread-1",
        workspace: "D:\\repo",
        runtimeBinding: { harnessKind },
      },
    });
  });

  it("fails closed for an unregistered target without invoking runtime procedures", () => {
    const compiled = compileHandoffTarget({
      thread: craftedThread(),
      projectLocation,
      targetAgentKind: "unknown-provider",
      targetConfig: { model: "unknown-model" },
    });

    expect(compiled.available).toBe(false);
    expect(compiled.reason).toContain("no verified native handoff recipe");
    expect(bridge.requestSessionSwitch).not.toHaveBeenCalled();
  });

  it("requests a switch on the same thread and workspace without legacy close/craft calls", async () => {
    const state = switchState();
    bridge.requestSessionSwitch.mockResolvedValue({
      requestId: state.requestId,
      disposition: "queued",
      state,
    });

    await requestSessionHandoff({
      thread: craftedThread(),
      projectLocation,
      targetAgentKind: "grok",
      targetConfig: { model: "grok-4.6", effort: "xhigh" },
      mode: "after-current-turn",
      prompt: "Continue the implementation.",
    });

    expect(bridge.requestSessionSwitch).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        projectLocation,
        mode: "after-current-turn",
        prompt: "Continue the implementation.",
        targetCraftPlan: expect.objectContaining({
          threadId: "thread-1",
          workspace: "D:\\repo",
          overrides: { model: "grok-4.6" },
        }),
        targetProvenance: expect.objectContaining({
          recipeId: "recipe:xai-grok-native",
        }),
      }),
    );
    expect(bridge.craftAgent).not.toHaveBeenCalled();
    expect(bridge.closeThread).not.toHaveBeenCalled();
    expect(useSessionHandoffStore.getState().statesByThread["thread-1"]).toEqual(state);
  });

  it("hydrates and cancels a durable queued switch by request identity", async () => {
    const state = switchState();
    bridge.readSessionSwitchState.mockResolvedValue(state);
    bridge.cancelSessionSwitch.mockResolvedValue(undefined);

    await expect(readSessionHandoffState("thread-1")).resolves.toEqual(state);
    await cancelSessionHandoff("thread-1", state.requestId);

    expect(bridge.readSessionSwitchState).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(bridge.cancelSessionSwitch).toHaveBeenCalledWith({
      threadId: "thread-1",
      requestId: "switch-1",
    });
  });

  it("persists the activated Segment as the current binding of the same Thread", async () => {
    const sourceThread = craftedThread();
    useAppStore.setState({ threads: [sourceThread] });
    const compiled = compileHandoffTarget({
      thread: sourceThread,
      projectLocation,
      targetAgentKind: "grok",
      targetConfig: { model: "grok-4.6", effort: "high" },
    });
    const state = switchState({
      phase: "active",
      targetCraftPlan: compiled.craftPlan,
      targetProvenance: compiled.provenance,
      activeSegment: {
        id: "segment-2",
        threadId: sourceThread.id,
        ordinal: 1,
        bindingEpoch: 2,
        status: "active",
        craftPlanId: compiled.craftPlan!.id,
        recipeId: compiled.craftPlan!.recipeId,
        resultItemId: compiled.craftPlan!.resultItemId,
        runtimeBinding: compiled.craftPlan!.runtimeBinding,
        entityId: "entity-grok",
        runtimeSessionId: "runtime-grok",
        nativeSessionRef: "native-grok",
        predecessorSegmentId: "segment-1",
        checkpointId: "checkpoint-1",
        createdAt: "2026-08-31T00:00:01.000Z",
        activatedAt: "2026-08-31T00:00:02.000Z",
      },
    });

    await applySessionHandoffState(state);

    expect(useAppStore.getState().threads[0]).toMatchObject({
      id: sourceThread.id,
      agentKind: "grok",
      config: { model: "grok-4.6", effort: "high" },
      compositionProvenance: expect.objectContaining({
        recipeId: "recipe:xai-grok-native",
      }),
      sessionRef: {
        providerSessionId: "native-grok",
        discoveredAt: "2026-08-31T00:00:02.000Z",
      },
    });
    expect(bridge.dbUpsertThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: sourceThread.id, agentKind: "grok" }),
    );
    expect(bridge.dbSetState).toHaveBeenCalledWith(
      "craftstation:provenance:thread-1",
      expect.stringContaining("recipe:xai-grok-native"),
    );
  });
});
