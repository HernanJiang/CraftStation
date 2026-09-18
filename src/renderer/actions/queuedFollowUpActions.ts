import type { PromptSegment, Thread } from "@/shared/contracts";
import { buildGoalContextText, isCodexNativeGoalAgent } from "@/shared/threadGoal";
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
  useAppStore.getState().setQueuedFollowUp(threadId, {
    prompt,
    ...(segments ? { segments } : {}),
    queuedAt: Date.now(),
    paused: false,
  });
}

export function clearQueuedFollowUp(threadId: string): void {
  useAppStore.getState().setQueuedFollowUp(threadId, null);
}

export async function sendQueuedFollowUpNow(thread: Thread): Promise<void> {
  const queued = takeQueuedFollowUp(thread.id);
  if (!queued) return;
  try {
    if (thread.status === "working") {
      await setThreadPendingSteer(thread, queued.prompt, queued.segments);
      captureThreadPromptSubmitted(thread, queued.prompt, queued.segments, "pending_steer");
      return;
    }
    await submitQueuedPrompt(thread, queued);
  } catch (error) {
    // The prompt was already taken out of the queue; put it back so a failed
    // send (e.g. a supervisor timeout) never silently drops the user's text.
    useAppStore.getState().setQueuedFollowUp(thread.id, queued);
    throw error;
  }
}

export async function flushQueuedFollowUp(threadId: string): Promise<void> {
  const state = useAppStore.getState();
  const queued = state.queuedFollowUpByThreadId[threadId];
  if (!queued || queued.paused) return;
  const thread = state.threads.find((item) => item.id === threadId);
  if (!thread || thread.status === "working") return;
  takeQueuedFollowUp(threadId);
  try {
    await submitQueuedPrompt(thread, queued);
  } catch (error) {
    useAppStore.getState().setQueuedFollowUp(threadId, queued);
    throw error;
  }
}

/**
 * Auto-send a queued follow-up when a turn settles without the user hitting
 * Stop. Interrupted turns leave the queue paused (Codex-style).
 */
export function startQueuedFollowUpFlush(): () => void {
  const previousStatus = new Map<string, Thread["status"]>();
  return useAppStore.subscribe((state) => {
    for (const thread of state.threads) {
      const last = previousStatus.get(thread.id);
      previousStatus.set(thread.id, thread.status);
      if (last !== "working" || thread.status === "working") continue;
      const queued = state.queuedFollowUpByThreadId[thread.id];
      if (!queued || queued.paused) continue;
      void flushQueuedFollowUp(thread.id).catch((error: unknown) => {
        console.error("[thread] failed to flush queued follow-up", error);
      });
    }
  });
}

function takeQueuedFollowUp(threadId: string): QueuedFollowUp | null {
  const queued = useAppStore.getState().queuedFollowUpByThreadId[threadId];
  if (!queued) return null;
  useAppStore.getState().setQueuedFollowUp(threadId, null);
  return queued;
}

async function submitQueuedPrompt(thread: Thread, queued: QueuedFollowUp): Promise<void> {
  const live = useAppStore.getState().threads.find((item) => item.id === thread.id) ?? thread;
  const liveGoal = live.goal;
  const useNative = isCodexNativeGoalAgent(live.agentKind);
  const activeGoal = liveGoal && !liveGoal.paused ? liveGoal : undefined;
  if (activeGoal && useNative) {
    await registerNativeGoal(live.id, activeGoal.prompt);
  }
  const goalContext =
    activeGoal && !useNative ? buildGoalContextText(activeGoal.prompt) : undefined;
  await submitThreadInput(
    live.id,
    queued.prompt,
    queued.segments,
    goalContext ? { goalContext } : undefined,
  );
  captureThreadPromptSubmitted(live, queued.prompt, queued.segments, "follow_up");
}
