/** Renderer state key for the temporary chat's last model. Not the main window default. */
export const TEMPORARY_CHAT_MODEL_STATE_KEY = "temporary-chat-model";

/** A hidden temporary chat keeps its CLI only this long. A visible window is in use. */
export const TEMPORARY_CHAT_IDLE_MS = 2 * 60 * 60 * 1000;

/** Drop the background CLI only when the window is hidden and still owns a thread. */
export function shouldExpireTemporaryChatWarm(state: {
  visible: boolean;
  hasThread: boolean;
}): boolean {
  return !state.visible && state.hasThread;
}

export type TemporaryChatWarmIdentity = {
  agentKind: string;
  model: string;
  accountId?: string;
  presentationMode: string;
};

/** Identity of a prepared CLI session. Effort and other turn settings are applied on send. */
export function temporaryChatWarmKey(identity: TemporaryChatWarmIdentity): string {
  return [
    identity.agentKind,
    identity.model,
    identity.accountId ?? "",
    identity.presentationMode,
  ].join("\0");
}

const UNUSABLE_WARM_STATUSES = new Set(["error", "inactive"]);

/**
 * Send into the prepared process when it already is the harness and model this
 * message wants. The draft picker may remap a vendor model onto its native CLI
 * before send; that still matches a prepare that went through the same remap.
 */
export function shouldSendIntoTemporaryChatWarm(args: {
  warm: { threadId: string; phase: "starting" | "ready" | "failed" } | null;
  threadId: string;
  threadStatus: string | undefined;
  threadAgentKind: string | undefined;
  threadModel: string | undefined;
  threadSourceProviderKind: string | undefined;
  threadPresentationMode: string | undefined;
  threadAccountId: string | undefined;
  launchAgentKind: string;
  launchModel: string;
  launchPresentationMode: string | undefined;
  launchAccountId: string | undefined;
  hasGoal: boolean;
  hasWorktree: boolean;
}): boolean {
  const { warm } = args;
  if (!warm || warm.phase !== "ready" || warm.threadId !== args.threadId) return false;
  if (args.hasGoal || args.hasWorktree) return false;
  if (!args.threadStatus || UNUSABLE_WARM_STATUSES.has(args.threadStatus)) return false;
  if (!args.threadModel || args.threadModel !== args.launchModel) return false;
  const presentation = args.launchPresentationMode ?? args.threadPresentationMode ?? "gui";
  if ((args.threadPresentationMode ?? "gui") !== presentation) return false;
  if ((args.threadAccountId ?? "") !== (args.launchAccountId ?? "")) return false;
  return (
    args.threadAgentKind === args.launchAgentKind ||
    args.threadSourceProviderKind === args.launchAgentKind
  );
}

/**
 * The prepared session can take the next message when it is the same CLI and
 * model and the launch finished. `launching` still counts: the renderer status
 * can lag the supervisor session by one event.
 */
export function shouldReuseTemporaryChatWarm(
  warm: { key: string; ready: boolean } | null,
  key: string,
  threadStatus: string | undefined,
): boolean {
  return Boolean(
    warm?.ready && warm.key === key && threadStatus && !UNUSABLE_WARM_STATUSES.has(threadStatus),
  );
}

/** Run async tasks one at a time. A rejection does not block the next task. */
export function createExclusiveQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
