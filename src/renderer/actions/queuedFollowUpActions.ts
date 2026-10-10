import type { PromptSegment, Thread } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { registerNativeGoal } from "@/renderer/actions/threadActions";
import { setThreadPendingSteer, submitThreadInput } from "@/renderer/actions/threadRuntimeActions";
import { captureThreadPromptSubmitted } from "@/renderer/analytics/posthog";
import { useAppStore } from "@/renderer/state/appStore";
import type { QueuedFollowUp } from "@/renderer/state/slices/queuedFollowUpSlice";

export function enqueueThreadFollowUp(
  threadId: string,
  prompt: string,
  segments: PromptSegment[] | undefined,
): void {
  useAppStore.getState().enqueueQueuedFollowUp(threadId, {
    id: crypto.randomUUID(),
    prompt,
    ...(segments ? { segments } : {}),
    queuedAt: Date.now(),
    paused: false,
  });
  setGoalInputHold(threadId, true);
}

export function clearQueuedFollowUp(threadId: string): void {
  useAppStore.getState().setQueuedFollowUps(threadId, null);
  setGoalInputHold(threadId, false);
}

export function removeQueuedFollowUpItem(threadId: string, itemId: string): void {
  useAppStore.getState().removeQueuedFollowUpItem(threadId, itemId);
  if (!useAppStore.getState().queuedFollowUpByThreadId[threadId]?.length) {
    setGoalInputHold(threadId, false);
  }
}

export async function sendQueuedFollowUpNow(thread: Thread, itemId?: string): Promise<void> {
  const queued = takeQueuedFollowUpItem(thread.id, itemId);
  if (!queued) return;
  try {
    if (thread.status === "working") {
      await setThreadPendingSteer(thread, queued.prompt, queued.segments);
      setGoalInputHold(
        thread.id,
        !!useAppStore.getState().queuedFollowUpByThreadId[thread.id]?.length,
      );
      captureThreadPromptSubmitted(thread, queued.prompt, queued.segments, "pending_steer");
      return;
    }
    await submitQueuedPrompt(thread, queued);
  } catch (error) {
    // The prompt was already taken out of the queue; put it back at the front so
    // a failed send (e.g. a supervisor timeout) never silently drops the user's
    // text or reorders the queue.
    restoreQueuedFollowUpAtFront(thread.id, queued);
    throw error;
  }
}

export async function flushQueuedFollowUp(threadId: string): Promise<void> {
  const state = useAppStore.getState();
  const queued = state.queuedFollowUpByThreadId[threadId]?.[0];
  if (!queued || queued.paused) return;
  const thread = state.threads.find((item) => item.id === threadId);
  if (!thread || thread.status === "working") return;
  useAppStore.getState().removeQueuedFollowUpItem(threadId, queued.id);
  try {
    await submitQueuedPrompt(thread, queued);
  } catch (error) {
    restoreQueuedFollowUpAtFront(threadId, queued);
    throw error;
  }
}

/**
 * Auto-send a queued follow-up when a turn settles without the user hitting
 * Stop. Interrupted turns leave the queue paused (Codex-style). Only the head
 * item flushes per settle — the turn it starts drains the next one, preserving
 * FIFO order.
 */
export function startQueuedFollowUpFlush(): () => void {
  const previousStatus = new Map<string, Thread["status"]>();
  return useAppStore.subscribe((state) => {
    for (const thread of state.threads) {
      const last = previousStatus.get(thread.id);
      previousStatus.set(thread.id, thread.status);
      if (last !== "working" || thread.status === "working") continue;
      const queued = state.queuedFollowUpByThreadId[thread.id]?.[0];
      if (!queued || queued.paused) continue;
      void flushQueuedFollowUp(thread.id).catch((error: unknown) => {
        console.error("[thread] failed to flush queued follow-up", error);
      });
    }
  });
}

function takeQueuedFollowUpItem(threadId: string, itemId?: string): QueuedFollowUp | null {
  const list = useAppStore.getState().queuedFollowUpByThreadId[threadId];
  if (!list || list.length === 0) return null;
  const target = itemId ? list.find((item) => item.id === itemId) : list[0];
  if (!target) return null;
  useAppStore.getState().removeQueuedFollowUpItem(threadId, target.id);
  return target;
}

function restoreQueuedFollowUpAtFront(threadId: string, queued: QueuedFollowUp): void {
  const current = useAppStore.getState().queuedFollowUpByThreadId[threadId] ?? [];
  useAppStore.getState().setQueuedFollowUps(threadId, [queued, ...current]);
}

async function submitQueuedPrompt(thread: Thread, queued: QueuedFollowUp): Promise<void> {
  const live = useAppStore.getState().threads.find((item) => item.id === thread.id) ?? thread;
  const liveGoal = live.goal;
  const activeGoal = liveGoal && !liveGoal.paused ? liveGoal : undefined;
  if (activeGoal) {
    await registerNativeGoal(live.id, activeGoal.prompt);
  }
  await submitThreadInput(live.id, queued.prompt, queued.segments, undefined);
  setGoalInputHold(live.id, !!useAppStore.getState().queuedFollowUpByThreadId[live.id]?.length);
  captureThreadPromptSubmitted(live, queued.prompt, queued.segments, "follow_up");
}

function setGoalInputHold(threadId: string, pending: boolean): void {
  void readBridge()
    .controlThreadGoal({ threadId, action: "hold", pending })
    .catch((error: unknown) => console.warn("[goal] pending input sync failed", error));
}
