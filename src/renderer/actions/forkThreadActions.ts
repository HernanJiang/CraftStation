import { msg as linguiMsg } from "@lingui/core/macro";
import { toast } from "@heroui/react";
import type { PersistedRuntimeItem } from "@/shared/ipc/schemas";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import { i18n } from "@/renderer/i18n/i18n";
import { findExperimentByThreadId } from "@/renderer/state/experimentStore";
import { makeThreadTitle, useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";

/**
 * Fork a thread from one of its completed turns: the new thread carries the
 * transcript prefix up to (and including) the forked turn, plus that prefix's
 * completed-turn records, so elapsed headers and end times stay intact. It is
 * grouped with the source thread, persisted through the same snapshot seam as
 * normal hydration, and opened side-by-side — but never launched: the user
 * continues manually with a fresh provider session.
 */
export async function forkThreadFromTurn(threadId: string, itemId: string): Promise<void> {
  const store = useAppStore.getState();
  const source = store.threads.find((thread) => thread.id === threadId);
  if (!source) return;
  if (findExperimentByThreadId(threadId)) return;
  // Remote threads are owned by their host desktop; a local fork row could not
  // open or resume there, so the affordance stays hidden for them.
  if (source.remoteServerId !== undefined) return;

  const itemIds = store.runtimeItemIdsByThread[threadId] ?? [];
  const cutAt = itemIds.indexOf(itemId);
  if (cutAt < 0) return;
  const prefixIds = itemIds.slice(0, cutAt + 1);
  const byId = store.runtimeItemsByIdByThread[threadId] ?? {};
  const prefixItems: RuntimeChatItem[] = [];
  for (const id of prefixIds) {
    const item = byId[id];
    if (item) prefixItems.push(stripSessionLocalFlags(item));
  }
  if (prefixItems.length === 0) return;

  const prefixSet = new Set(prefixIds);
  const turns = (store.runtimeCompletedTurnsByThread[threadId] ?? []).filter(
    (turn) => turn.anchorItemId !== null && prefixSet.has(turn.anchorItemId),
  );

  const promptText = lastUserPromptText(prefixItems);
  const groupId = source.groupId ?? crypto.randomUUID();
  if (!source.groupId) {
    useAppStore.setState((state) => ({
      threads: state.threads.map((thread) =>
        thread.id === source.id
          ? { ...thread, groupId, groupName: source.groupName ?? source.title }
          : thread,
      ),
    }));
  }

  const baseTitle = makeThreadTitle(promptText) || source.title;
  const thread = useAppStore.getState().createThread({
    projectId: source.projectId,
    agentKind: source.agentKind,
    ...(source.agentInstanceId ? { agentInstanceId: source.agentInstanceId } : {}),
    config: { ...source.config },
    prompt: promptText,
    title: i18n._(linguiMsg`${baseTitle}（分叉）`),
    ...(source.worktreePath ? { worktreePath: source.worktreePath } : {}),
    ...(source.worktreeBranch ? { worktreeBranch: source.worktreeBranch } : {}),
    ...(source.compositionProvenance
      ? { compositionProvenance: source.compositionProvenance }
      : {}),
    ...(source.presentationMode ? { presentationMode: source.presentationMode } : {}),
    groupId,
    groupName: source.groupName ?? source.title,
    parentThreadId: source.id,
    focus: false,
  });
  // A fork never launches by itself — settle the freshly created (launching)
  // row to idle so the user simply continues typing.
  const live = useAppStore.getState();
  live.updateThreadRuntime(thread.id, {
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
  });
  live.hydrateThreadRuntimeItems(thread.id, prefixItems);
  live.hydrateThreadCompletedTurns(thread.id, turns);
  const contextUsage = live.runtimeContextByThread[threadId];
  if (contextUsage) live.hydrateThreadContextUsage(thread.id, contextUsage);

  try {
    await readBridge().dbReplaceThreadRuntimeSnapshot({
      threadId: thread.id,
      items: prefixItems.map(toPersistedRuntimeItem),
      turns: turns.map((turn) => ({
        startedAt: new Date(turn.startedAt).toISOString(),
        endedAt: new Date(turn.endedAt).toISOString(),
        anchorItemId: turn.anchorItemId,
      })),
      ...(contextUsage ? { contextUsage } : {}),
    });
  } catch (error) {
    // Memory already carries the forked transcript for this session; only the
    // reload path is degraded.
    toast.danger(friendlyError(error));
  }
  live.openThreadSideBySide(thread.id);
  toast.success(i18n._(linguiMsg`已从该轮分叉为新对话`));
}

/**
 * Drop flags that are only valid in the originating live session: a replayed
 * row must never light the working spinner, and local delegated-agent timing
 * must not leak into the fork.
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

function toPersistedRuntimeItem(item: RuntimeChatItem): PersistedRuntimeItem {
  const streams: Record<string, string> = {};
  for (const [key, value] of Object.entries(item.streams)) {
    if (typeof value === "string") streams[key] = value;
  }
  return {
    id: item.id,
    type: item.type,
    state: item.state,
    ...(item.payload !== undefined ? { payload: item.payload } : {}),
    streams,
    ...(item.parentItemId ? { parentItemId: item.parentItemId } : {}),
  };
}

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
