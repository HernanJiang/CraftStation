import { msg as linguiMsg } from "@lingui/core/macro";
import { toast } from "@heroui/react";
import { isEphemeralSideChatThread } from "@/shared/contracts";
import { i18n } from "@/renderer/i18n/i18n";
import { usePanelStore } from "@/renderer/state/panelStore";
import { findExperimentByThreadId } from "@/renderer/state/experimentStore";
import { makeThreadTitle, useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { useSideChatStore } from "@/renderer/state/sideChatStore";
import { deleteThreadOnly, openThread } from "./threadActions";

/** Title suffix marking a memory-only Side Chat branch (stripped on save). */
export const SIDE_CHAT_BRANCH_TITLE_SUFFIX = "（临时分支）";

/**
 * Drop flags that are only valid in the originating live session: a replayed
 * row must never light the working spinner, and local delegated-agent timing
 * must not leak into the branch. (Same hygiene as `forkThreadFromTurn`'s
 * transcript copy, kept local so this commit stays self-contained.)
 */
function stripSessionLocalFlags(item: RuntimeChatItem): RuntimeChatItem {
  const {
    observedLive: _observedLive,
    startedAt: _startedAt,
    completedAt: _completedAt,
    ...rest
  } = item;
  const clean: RuntimeChatItem = {
    id: rest.id,
    type: rest.type,
    state: rest.state,
    streams: { ...rest.streams },
    ...(rest.payload !== undefined ? { payload: rest.payload } : {}),
    ...(rest.parentItemId ? { parentItemId: rest.parentItemId } : {}),
  };
  return clean;
}

/** Latest user prompt text in a transcript prefix (branch title source). */
function lastUserPromptText(prefixItems: readonly RuntimeChatItem[]): string {
  for (let index = prefixItems.length - 1; index >= 0; index -= 1) {
    const item = prefixItems[index]!;
    if (item.type !== "user_message") continue;
    const content = (item.payload as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .map((part) => {
        const typed = part as { text?: unknown } | null;
        return typeof typed?.text === "string" ? typed.text : "";
      })
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
    if (text) return text;
  }
  return "";
}

/**
 * Open the right-panel Side Chat on its chooser ("branch from current" /
 * "open existing"). Never touches threads or the main view.
 */
export function openSideChatPanel(): void {
  useSideChatStore.getState().openPanel();
}

/**
 * Drop the currently selected branch when it is still an unsaved ephemeral
 * row (switching to another branch or to an existing thread must not orphan
 * its row and runtime session in memory).
 */
function discardSelectedUnsavedBranch(): void {
  const selection = useSideChatStore.getState().selection;
  if (selection?.kind !== "branch") return;
  const thread = useAppStore
    .getState()
    .threads.find((candidate) => candidate.id === selection.threadId);
  if (thread && isEphemeralSideChatThread(thread)) {
    deleteThreadOnly(thread.id);
  }
}

/**
 * Fork the FULL transcript of a formal thread into a memory-only ephemeral
 * branch and show it in Side Chat (flow A).
 *
 * Mirrors `forkThreadFromTurn`'s transcript hygiene (session-local flags
 * stripped, idle runtime state, user continues manually with a fresh provider
 * session) but deliberately differs in three ways: it copies the whole
 * transcript (not a turn prefix), it never opens anything in the main view,
 * and it never persists — no `dbReplaceThreadRuntimeSnapshot`, and
 * `dbStorage` filters ephemeral rows out of `dbSyncAll`.
 */
export function openSideChatBranch(sourceThreadId: string): boolean {
  const store = useAppStore.getState();
  const source = store.threads.find((thread) => thread.id === sourceThreadId);
  if (!source || isEphemeralSideChatThread(source)) {
    toast.danger(i18n._(linguiMsg`当前没有可分支的正式会话。`));
    return false;
  }
  if (findExperimentByThreadId(sourceThreadId)) {
    toast.danger(i18n._(linguiMsg`实验线程不支持侧边分支。`));
    return false;
  }
  // Remote threads are owned by their host desktop; a local branch row could
  // not open or resume there, so the affordance stays hidden for them.
  if (source.remoteServerId !== undefined) {
    toast.danger(i18n._(linguiMsg`远程线程不支持侧边分支。`));
    return false;
  }

  const itemIds = store.runtimeItemIdsByThread[sourceThreadId] ?? [];
  const byId = store.runtimeItemsByIdByThread[sourceThreadId] ?? {};
  const branchItems: RuntimeChatItem[] = [];
  for (const id of itemIds) {
    const item = byId[id];
    if (item) branchItems.push(stripSessionLocalFlags(item));
  }
  if (branchItems.length === 0) {
    toast.danger(i18n._(linguiMsg`当前线程还没有可分支的上下文。`));
    return false;
  }

  discardSelectedUnsavedBranch();
  const promptText = lastUserPromptText(branchItems);
  const baseTitle = makeThreadTitle(promptText) || source.title;
  const thread = store.createThread({
    projectId: source.projectId,
    agentKind: source.agentKind,
    ...(source.agentInstanceId ? { agentInstanceId: source.agentInstanceId } : {}),
    config: { ...source.config },
    prompt: promptText,
    title: `${baseTitle}${SIDE_CHAT_BRANCH_TITLE_SUFFIX}`,
    ...(source.worktreePath ? { worktreePath: source.worktreePath } : {}),
    ...(source.worktreeBranch ? { worktreeBranch: source.worktreeBranch } : {}),
    ...(source.compositionProvenance
      ? { compositionProvenance: source.compositionProvenance }
      : {}),
    ...(source.presentationMode ? { presentationMode: source.presentationMode } : {}),
    parentThreadId: source.id,
    isEphemeral: true,
    focus: false,
  });
  // A branch never launches by itself — settle the freshly created (launching)
  // row to idle so the user simply continues typing.
  const live = useAppStore.getState();
  live.updateThreadRuntime(thread.id, {
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
  });
  live.hydrateThreadRuntimeItems(thread.id, branchItems);
  live.hydrateThreadCompletedTurns(thread.id, [
    ...(store.runtimeCompletedTurnsByThread[sourceThreadId] ?? []),
  ]);
  const contextUsage = live.runtimeContextByThread[sourceThreadId];
  if (contextUsage) live.hydrateThreadContextUsage(thread.id, contextUsage);

  useSideChatStore.getState().selectBranch(thread.id, source.id);
  toast.success(i18n._(linguiMsg`已从当前线程创建临时分支（不会出现在左侧列表）。`));
  return true;
}

/**
 * Show an existing FORMAL thread in parallel on the right (flow B). The row
 * is never copied or moved — closing Side Chat leaves it exactly as it was.
 */
export function openSideChatExisting(threadId: string): boolean {
  const thread = useAppStore.getState().threads.find((candidate) => candidate.id === threadId);
  if (!thread || isEphemeralSideChatThread(thread)) return false;
  if (findExperimentByThreadId(threadId)) {
    toast.danger(i18n._(linguiMsg`实验线程不支持在 Side Chat 中打开。`));
    return false;
  }
  // Side Chat renders the thread in place; it cannot run the remote
  // open/hydration pipeline (`openThread`), so remote rows stay out.
  if (thread.remoteServerId !== undefined) {
    toast.danger(i18n._(linguiMsg`远程线程不支持在 Side Chat 中打开。`));
    return false;
  }
  discardSelectedUnsavedBranch();
  useSideChatStore.getState().selectExisting(threadId);
  return true;
}

/**
 * Promote the current ephemeral branch to a formal thread: clear the flag
 * (it joins the left list on the next render), group it with its parent like
 * a fork, then hand it to the main view and close Side Chat.
 */
export function saveSideChatAsFormal(): boolean {
  const selection = useSideChatStore.getState().selection;
  if (!selection || selection.kind !== "branch") return false;
  const store = useAppStore.getState();
  const thread = store.threads.find((candidate) => candidate.id === selection.threadId);
  if (!thread) {
    useSideChatStore.getState().close();
    return false;
  }
  if (!isEphemeralSideChatThread(thread)) return true;

  const parent = thread.parentThreadId
    ? store.threads.find((candidate) => candidate.id === thread.parentThreadId)
    : undefined;
  const groupId = parent?.groupId ?? crypto.randomUUID();
  const groupName = parent ? (parent.groupName ?? parent.title) : thread.title;
  const title = thread.title.endsWith(SIDE_CHAT_BRANCH_TITLE_SUFFIX)
    ? thread.title.slice(0, -SIDE_CHAT_BRANCH_TITLE_SUFFIX.length).trim() || thread.title
    : thread.title;
  useAppStore.setState((state) => ({
    threads: state.threads.map((candidate) => {
      if (candidate.id === parent?.id && !parent.groupId) {
        return { ...candidate, groupId, groupName };
      }
      if (candidate.id !== thread.id) return candidate;
      const { isEphemeral: _dropped, ...rest } = candidate;
      return { ...rest, title, groupId, groupName };
    }),
  }));
  useAppStore.getState().touchThread(thread.id);
  useSideChatStore.getState().close();
  openThread(thread.id);
  toast.success(i18n._(linguiMsg`已保存为正式线程。`));
  return true;
}

/**
 * Close Side Chat. An unsaved ephemeral branch is discarded with its runtime
 * session (row removed, session closed, worktree never touched); a formal
 * thread opened on the right is left exactly as it was.
 */
export function closeSideChat(): void {
  const selection = useSideChatStore.getState().selection;
  if (selection?.kind === "branch") {
    const thread = useAppStore.getState().threads.find(
      (candidate) => candidate.id === selection.threadId,
    );
    if (thread && isEphemeralSideChatThread(thread)) {
      deleteThreadOnly(thread.id);
    }
  }
  useSideChatStore.getState().close();
  usePanelStore.getState().closeAuxiliaryPanelTab("side-chat");
}
