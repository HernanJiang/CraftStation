import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { resolveThirdPartyAccountForLaunch } from "@/shared/thirdPartyRouting";
import { useSessionHandoffStore } from "@/renderer/state/sessionHandoffStore";
import { showTopStatusToast } from "@/renderer/components/ui/topStatusToast";
import {
  adaptThreadConfigForCapabilities,
  capabilitiesForPresentation,
} from "@/shared/agentSelection";
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
  opencode: {
    harnessItemId: "harness:opencode",
    modelItemId: (model) =>
      model.includes(":") || model.includes("/") ? model : `openai:${model}`,
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
  const modelItem =
    registry.getItem(modelItemId) ??
    registry.listItems("model").find((item) => {
      const prefix = modelItemId.includes(":")
        ? modelItemId.slice(0, modelItemId.indexOf(":") + 1)
        : "";
      return prefix.length > 0 && item.id.startsWith(prefix);
    });
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

/**
 * Switch the live thread to another model/provider while keeping the same
 * Thread identity. Prefers the native CraftPlan handoff when the target is a
 * verified GUI recipe; otherwise rebuilds the supervisor session on the new
 * provider against the existing conversation timeline (fresh native session
 * + transcript preface + persisted switch divider — never a store-only
 * rebind, which used to fork the renderer row from the live session).
 */
function adaptSwitchTargetConfig(input: {
  thread: Thread;
  targetAgentKind: string;
  targetConfig: ThreadConfig;
  targetPresentationMode?: Thread["presentationMode"];
}): ThreadConfig {
  const { agentStatuses, wslAgentStatuses } = useAgentStatusesStore.getState();
  const status =
    agentStatuses.find((entry) => entry.kind === input.targetAgentKind) ??
    wslAgentStatuses.find((entry) => entry.kind === input.targetAgentKind);
  if (!status) return input.targetConfig;
  const presentation = input.targetPresentationMode ?? input.thread.presentationMode ?? "gui";
  return adaptThreadConfigForCapabilities(
    input.targetConfig,
    capabilitiesForPresentation(status.capabilities, presentation),
  );
}

export async function switchLiveThreadProvider(input: {
  thread: Thread;
  projectLocation: ProjectLocation;
  targetAgentKind: string;
  targetConfig: ThreadConfig;
  targetPresentationMode?: Thread["presentationMode"];
  /** Sticky third-party account from the picker; never fall back to the native pool. */
  targetAccountId?: string;
}): Promise<void> {
  const targetConfig = adaptSwitchTargetConfig(input);
  const compiled = compileHandoffTarget({
    thread: input.thread,
    projectLocation: input.projectLocation,
    targetAgentKind: input.targetAgentKind,
    targetConfig,
  });
  if (compiled.available && compiled.craftPlan && compiled.provenance) {
    await requestSessionHandoff({
      thread: input.thread,
      projectLocation: input.projectLocation,
      targetAgentKind: input.targetAgentKind,
      targetConfig,
      mode: "after-current-turn",
      prompt: "Continue this conversation with the newly selected model. Preserve prior context.",
    });
    return;
  }

  // Third-party custom models carry their validated account binding across
  // the switch — otherwise the rebuilt session falls back to the native pool
  // with an unresolvable custom model id (e.g. a Cavoti GLM id on Codex).
  const thirdPartyAccountId = resolveThirdPartyAccountForLaunch({
    agentKind: input.targetAgentKind,
    model: targetConfig.model,
    customModels: useSharedSettings.getState().customModels ?? [],
    accounts: useUsageAccountsStore.getState().accounts ?? [],
    ...(input.targetAccountId ? { explicitAccountId: input.targetAccountId } : {}),
  });
  const result = await readBridge().switchThreadProvider({
    threadId: input.thread.id,
    agentKind: input.targetAgentKind,
    config: targetConfig,
    ...(thirdPartyAccountId ? { thirdPartyAccountId } : {}),
  });
  // A switch committed while a turn was working abandons that turn on the
  // disposed session. Mark it cancelled (same honesty rule as the stop
  // button and pending-steer displacement) instead of letting it render an
  // empty 已完成. Only on success: a failed switch rolls back and the old
  // turn, if any, keeps running.
  if (input.thread.status === "working" && input.thread.activeTurnStartedAt) {
    const startedAt = Date.parse(input.thread.activeTurnStartedAt);
    if (Number.isFinite(startedAt)) {
      useAppStore.getState().markUserCancelledTurn(input.thread.id, startedAt);
    }
  }
  // Sub-agents of the disposed session are orphaned by the switch: their
  // completion events can no longer be routed. Settle their rows now so they
  // cannot stick on working forever (cross-harness switches must not reuse
  // the old native session, so adoption is never an option).
  useAppStore.getState().reconcileStaleSubAgents(input.thread.id);
  const { sessionRef: _previous, accountBinding: _binding, ...stable } = input.thread;
  const boundAccountId = thirdPartyAccountId ?? result.poolAccountId;
  const updatedThread: Thread = {
    ...stable,
    agentKind: input.targetAgentKind,
    config: targetConfig,
    ...(input.targetPresentationMode ? { presentationMode: input.targetPresentationMode } : {}),
    ...(result.sessionRef ? { sessionRef: result.sessionRef } : {}),
    ...(boundAccountId
      ? {
          accountBinding: {
            accountId: boundAccountId,
            provider: thirdPartyAccountId ? "openai-compatible" : input.targetAgentKind,
            credentialScopeRef: `managed:${boundAccountId}`,
            reason: "explicit" as const,
            boundAt: Date.now(),
          },
        }
      : {}),
    canResumeWithConfig: result.canResumeWithConfig,
    updatedAt: new Date().toISOString(),
  };
  useAppStore.setState((current) => ({
    threads: current.threads.map((thread) =>
      thread.id === input.thread.id ? updatedThread : thread,
    ),
  }));
  await readBridge().dbUpsertThread(updatedThread);
  await readBridge().dbInsertThreadNativeSession({
    threadId: input.thread.id,
    harness: input.targetAgentKind,
    model: targetConfig.model,
    ...(result.sessionRef ? { nativeSessionId: result.sessionRef.providerSessionId } : {}),
    ...(result.poolAccountId ? { poolAccountId: result.poolAccountId } : {}),
  });
  // The supervisor already painted a persisted model_switch divider at the
  // switch point; the toast only confirms + warns about cross-model drift.
  showTopStatusToast(`已切换至 ${targetConfig.model}`, {
    description: "同一线程跨模型切换可能导致一定程度的性能下降",
  });
}
