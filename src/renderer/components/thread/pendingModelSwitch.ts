import type { ThreadConfig, ThreadPresentationMode } from "@/shared/contracts";
import { sameComposerAccount } from "@/shared/thirdPartyRouting";

/**
 * Staged model-switch state for the composer.
 *
 * Picking a model in the selector must NOT switch immediately: the user picks,
 * optionally tweaks effort, then sends — the provider/harness switch commits
 * as part of that send. This module holds the tiny pure decision core so the
 * Section stays thin and the rules are unit-testable without rendering the
 * composer.
 */
export interface PendingModelSwitch {
  agentKind: string;
  model: string;
  presentationMode?: ThreadPresentationMode | undefined;
  accountId?: string | undefined;
  /** Permission / effort patches made against the staged target before send. */
  configPatch?: Partial<ThreadConfig> | undefined;
}

/** True when the pick differs from what's live (i.e. worth staging). */
export function shouldStageModelSwitch(
  live: { agentKind: string; model: string; accountId?: string | undefined },
  next: { agentKind: string; model: string; accountId?: string | undefined },
): boolean {
  return (
    next.agentKind !== live.agentKind ||
    next.model !== live.model ||
    !sameComposerAccount(live.accountId, next.accountId)
  );
}

/** True when the live row already matches the staged target (send directly). */
export function isPendingSwitchResolved(
  live: { agentKind: string; model: string; accountId?: string | undefined },
  pending: PendingModelSwitch,
): boolean {
  return (
    live.agentKind === pending.agentKind &&
    live.model === pending.model &&
    sameComposerAccount(live.accountId, pending.accountId)
  );
}
