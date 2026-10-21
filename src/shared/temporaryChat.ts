import { projectDraftConfigSchema } from "./contracts/config";
import type { ProjectDraftConfig, ThreadPresentationMode } from "./contracts";

/** The temporary window's own last model. Main-chat requests do not write this. */
export const TEMPORARY_CHAT_MODEL_STATE_KEY = "temporary-chat-model";

export function readChatModelMemory(value: string | null):
  | {
      draftConfig: ProjectDraftConfig;
      accountId?: string;
      presentationMode?: ThreadPresentationMode;
    }
  | undefined {
  try {
    const saved = value ? JSON.parse(value) : undefined;
    const parsed = projectDraftConfigSchema.safeParse(saved?.draftConfig);
    if (!parsed.success || !parsed.data.model.trim()) return undefined;
    return {
      draftConfig: parsed.data,
      ...(typeof saved.accountId === "string" ? { accountId: saved.accountId } : {}),
      ...(saved.presentationMode === "gui" || saved.presentationMode === "terminal"
        ? { presentationMode: saved.presentationMode }
        : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Reopen the temporary chat on its own last model.
 * A main-chat request is a different composer and is ignored even when present.
 */
export function readTemporaryChatStartupMemory(
  ownMemory: string | null,
  mainChatMemory?: string | null,
): ReturnType<typeof readChatModelMemory> {
  void mainChatMemory;
  return readChatModelMemory(ownMemory);
}

/** A hidden temporary chat keeps its CLI only this long. A visible window is in use. */
export const TEMPORARY_CHAT_IDLE_MS = 2 * 60 * 60 * 1000;

/**
 * Drop the background CLI only when the window is hidden, still owns a thread,
 * and the user did not park it in the Workspace list. Parking keeps the
 * conversation until they press close.
 */
export function shouldExpireTemporaryChatWarm(state: {
  visible: boolean;
  hasThread: boolean;
  parked?: boolean;
}): boolean {
  return !state.visible && state.hasThread && state.parked !== true;
}

/** What the main window's Workspace section shows for a parked temporary chat. */
export interface TemporaryChatPresence {
  parked: boolean;
  title: string;
}

export const EMPTY_TEMPORARY_CHAT_PRESENCE: TemporaryChatPresence = {
  parked: false,
  title: "",
};

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

/**
 * Launch config for a prepare. Keeps the saved draft's permission fields when
 * the harness is unchanged, and still prepares when the picker has moved on.
 */
export function temporaryChatWarmDraft<T extends { agentKind: string; model: string }>(
  draft: T | undefined,
  selection: Pick<TemporaryChatWarmIdentity, "agentKind" | "model">,
): T | { agentKind: string; model: string } | null {
  if (!selection.model || !selection.agentKind) return null;
  if (!draft?.model || draft.agentKind !== selection.agentKind) {
    return { agentKind: selection.agentKind, model: selection.model };
  }
  if (draft.model === selection.model) return draft;
  return { ...draft, model: selection.model };
}

/**
 * The composer paints once before the saved account is restored. That partial
 * identity must not kill a prepare that already targets the same harness and model.
 */
export function shouldReplaceTemporaryChatWarm(
  current: { key: string; phase: "starting" | "ready" | "failed" } | null,
  next: TemporaryChatWarmIdentity,
): boolean {
  if (!current || current.phase === "failed") return true;
  return !temporaryChatWarmAcceptsLaunch(current.key, next);
}

/**
 * A prepare already targets this launch. The composer paints once before the
 * saved account is restored; that partial identity still matches. A real model
 * or harness change does not.
 */
export function temporaryChatWarmAcceptsLaunch(
  warmKey: string,
  launch: TemporaryChatWarmIdentity,
): boolean {
  if (warmKey === temporaryChatWarmKey(launch)) return true;
  const [agent, model, account, presentation] = warmKey.split("\0");
  return (
    agent === launch.agentKind &&
    model === launch.model &&
    (presentation || "gui") === (launch.presentationMode || "gui") &&
    (account ?? "").length > 0 &&
    !launch.accountId
  );
}

/**
 * Temporary chat keeps its own last model. The main composer ignores a bare
 * last-draft model unless the user picked it in the global model menu.
 */
export function withTemporaryChatModelMemory(
  lastDraft: { agentKind: string; model: string } | undefined,
  explicitDefaults?: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  const model = lastDraft?.model.trim();
  if (!lastDraft?.agentKind || !model) return explicitDefaults;
  return { ...(explicitDefaults ?? {}), [lastDraft.agentKind]: model };
}

/**
 * Draft written for a selection made inside the temporary chat.
 * A draft that still names the previous model is left untouched unless the
 * user changed the pick after the window had already settled.
 */
export function temporaryChatMemoryDraft(
  selection: { agentKind: string; model: string },
  draft: ProjectDraftConfig | undefined,
  force: boolean,
): ProjectDraftConfig | undefined {
  if (!selection.agentKind || !selection.model.trim()) return undefined;
  if (draft && draft.agentKind === selection.agentKind && draft.model === selection.model) {
    return draft;
  }
  if (!force) return undefined;
  return {
    ...(draft ?? { agentKind: selection.agentKind, model: selection.model }),
    agentKind: selection.agentKind,
    model: selection.model,
  };
}

/** Model id to reopen, when this draft is the temporary chat's saved choice. */
export function temporaryChatRememberedModel(
  lastDraft: { agentKind: string; model: string } | undefined,
  agentKind: string | undefined,
): string | undefined {
  const model = lastDraft?.model.trim();
  if (!agentKind || lastDraft?.agentKind !== agentKind || !model) return undefined;
  return model;
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
  /** Set when this thread was prepared for the launch the user is sending. */
  warmKey?: string;
}): boolean {
  const { warm } = args;
  if (!warm || warm.phase !== "ready" || warm.threadId !== args.threadId) return false;
  if (args.hasGoal || args.hasWorktree) return false;
  if (!args.threadStatus || UNUSABLE_WARM_STATUSES.has(args.threadStatus)) return false;
  if (
    args.warmKey &&
    temporaryChatWarmAcceptsLaunch(args.warmKey, {
      agentKind: args.launchAgentKind,
      model: args.launchModel,
      ...(args.launchAccountId ? { accountId: args.launchAccountId } : {}),
      presentationMode: args.launchPresentationMode ?? args.threadPresentationMode ?? "gui",
    })
  ) {
    // The supervisor may remap the stored model id. The prepare already
    // targeted this launch, so send into that process.
    return true;
  }
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
