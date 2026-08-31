import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useSessionHandoffStore } from "@/renderer/state/sessionHandoffStore";
import type { ProjectLocation, Thread, ThreadConfig } from "@/shared/contracts";
import {
  Crafter,
  getDefaultRegistry,
  provenanceStateKey,
  type CompositionProvenance,
  type CraftPlan,
} from "@/shared/crafting";
import type { SessionSwitchMode, SessionSwitchState } from "@/shared/sessionHandoff";
import { getProjectPosixPath } from "@/shared/wsl";

const TARGET_ITEMS: Readonly<
  Record<string, { harnessItemId: string; modelItemId: (model: string) => string }>
> = {
  codex: { harnessItemId: "harness:codex", modelItemId: (model) => `openai:${model}` },
  grok: { harnessItemId: "harness:grok", modelItemId: (model) => `xai:${model}` },
  kimi: { harnessItemId: "harness:kimi", modelItemId: (model) => `moonshot:${model}` },
  antigravity: {
    harnessItemId: "harness:antigravity",
    modelItemId: (model) => `google:${model}`,
  },
};

export interface HandoffTargetCompilation {
  available: boolean;
  craftPlan?: CraftPlan;
  provenance?: CompositionProvenance;
  reason?: string;
}

function prefixedModelId(prefixer: (model: string) => string, model: string): string {
  return model.includes(":") ? model : prefixer(model);
}

function portableReasoningEffort(
  effort: string | undefined,
): "low" | "medium" | "high" | undefined {
  return effort === "low" || effort === "medium" || effort === "high" ? effort : undefined;
}

export function compileHandoffTarget(input: {
  thread: Thread;
  projectLocation: ProjectLocation;
  targetAgentKind: string;
  targetConfig: ThreadConfig;
}): HandoffTargetCompilation {
  if (input.thread.remoteServerId) {
    return { available: false, reason: "Remote conversations do not support in-place handoff." };
  }
  if (input.thread.presentationMode !== "gui" || !input.thread.compositionProvenance) {
    return {
      available: false,
      reason: "Only local GUI conversations created from a CraftPlan can switch in place.",
    };
  }
  const target = TARGET_ITEMS[input.targetAgentKind];
  if (!target) {
    return { available: false, reason: "This target has no verified native handoff recipe." };
  }
  const registry = getDefaultRegistry();
  const modelItemId = prefixedModelId(target.modelItemId, input.targetConfig.model);
  const modelItem = registry.getItem(modelItemId);
  const harnessItem = registry.getItem(target.harnessItemId);
  if (!modelItem || !harnessItem) {
    return {
      available: false,
      reason: `The selected native combination is not registered (${modelItemId}, ${target.harnessItemId}).`,
    };
  }
  const result = new Crafter(registry).compile(
    { slots: { model: modelItem, harness: harnessItem } },
    {
      threadId: input.thread.id,
      workspace: input.thread.worktreePath ?? getProjectPosixPath(input.projectLocation),
      overrides: {
        model: input.targetConfig.model,
        ...(portableReasoningEffort(input.targetConfig.effort)
          ? { reasoningEffort: portableReasoningEffort(input.targetConfig.effort) }
          : {}),
      },
    },
  );
  if (!result.success || !result.craftPlan || !result.resultItem?.provenance) {
    return {
      available: false,
      reason: result.errors?.[0]?.message ?? "The selected native combination did not compile.",
    };
  }
  return {
    available: true,
    craftPlan: result.craftPlan,
    provenance: result.resultItem.provenance,
  };
}

/**
 * Project a completed Supervisor-owned handoff back into the durable Thread
 * row. This keeps the user-visible Thread identity stable while updating only
 * its current native binding/provenance for restart recovery.
 */
export async function applySessionHandoffState(state: SessionSwitchState): Promise<void> {
  useSessionHandoffStore.getState().setState(state.threadId, state);
  if (
    state.phase !== "active" ||
    !state.activeSegment ||
    !state.targetCraftPlan ||
    !state.targetProvenance
  ) {
    return;
  }
  const current = useAppStore.getState().threads.find((thread) => thread.id === state.threadId);
  if (!current) return;
  const {
    sessionRef: _previousSessionRef,
    accountBinding: _previousBinding,
    ...stableThread
  } = current;
  const nativeSessionRef = state.activeSegment.nativeSessionRef;
  const reasoningEffort = state.targetCraftPlan.overrides?.reasoningEffort;
  const updatedThread: Thread = {
    ...stableThread,
    agentKind: state.activeSegment.runtimeBinding.harnessKind,
    config: {
      model: state.activeSegment.runtimeBinding.modelId,
      ...(reasoningEffort ? { effort: reasoningEffort } : {}),
    },
    compositionProvenance: state.targetProvenance,
    canResumeWithConfig: Boolean(nativeSessionRef),
    ...(nativeSessionRef
      ? {
          sessionRef: {
            providerSessionId: nativeSessionRef,
            discoveredAt: state.activeSegment.activatedAt ?? state.updatedAt,
          },
        }
      : {}),
    ...(state.activeAccountBinding ? { accountBinding: state.activeAccountBinding } : {}),
    updatedAt: state.updatedAt,
  };
  useAppStore.setState((currentState) => ({
    threads: currentState.threads.map((thread) =>
      thread.id === state.threadId ? updatedThread : thread,
    ),
  }));
  const bridge = readBridge();
  try {
    await Promise.all([
      bridge.dbUpsertThread(updatedThread),
      bridge.dbSetState(provenanceStateKey(state.threadId), JSON.stringify(state.targetProvenance)),
    ]);
  } catch (error) {
    console.warn(
      `[session-handoff] Failed to persist active binding for thread ${state.threadId}:`,
      error,
    );
  }
}

export async function requestSessionHandoff(input: {
  thread: Thread;
  projectLocation: ProjectLocation;
  targetAgentKind: string;
  targetConfig: ThreadConfig;
  mode: SessionSwitchMode;
  prompt: string;
}): Promise<SessionSwitchState> {
  const compiled = compileHandoffTarget(input);
  if (!compiled.available || !compiled.craftPlan || !compiled.provenance) {
    throw new Error(compiled.reason ?? "HANDOFF_TARGET_UNAVAILABLE");
  }
  const result = await readBridge().requestSessionSwitch({
    threadId: input.thread.id,
    projectLocation: input.projectLocation,
    targetCraftPlan: compiled.craftPlan,
    targetProvenance: compiled.provenance,
    mode: input.mode,
    prompt: input.prompt,
  });
  await applySessionHandoffState(result.state);
  return result.state;
}

export async function readSessionHandoffState(
  threadId: string,
): Promise<SessionSwitchState | null> {
  const state = await readBridge().readSessionSwitchState({ threadId });
  if (state) await applySessionHandoffState(state);
  else useSessionHandoffStore.getState().clearState(threadId);
  return state;
}

export async function cancelSessionHandoff(threadId: string, requestId: string): Promise<void> {
  await readBridge().cancelSessionSwitch({ threadId, requestId });
}
