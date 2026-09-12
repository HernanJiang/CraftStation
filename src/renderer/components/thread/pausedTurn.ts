import type { AppStoreState } from "@/renderer/state/slices/shared";

/** Prompt sent when the user resumes a turn that was stopped, closed, or errored. */
export const CONTINUE_INTERRUPTED_TASK_PROMPT =
  "请从刚才被打断的地方继续任务，不要从头开始。";

/**
 * True when the latest turn was interrupted (Stop / close / error) and the
 * thread is no longer running — the composer should offer Continue instead of
 * treating the work as finished.
 */
export function isThreadTaskPaused(state: AppStoreState, threadId: string): boolean {
  const thread = state.threads.find((item) => item.id === threadId);
  if (!thread) return false;
  if (
    thread.status === "working" ||
    thread.status === "launching" ||
    thread.status === "needs_approval" ||
    thread.status === "needs_reply"
  ) {
    return false;
  }
  if (thread.status === "error") return true;
  const turns = state.runtimeCompletedTurnsByThread[threadId] ?? [];
  let lastStartedAt: number | undefined;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.endedAt - turn.startedAt >= 1000) {
      lastStartedAt = turn.startedAt;
      break;
    }
  }
  if (lastStartedAt === undefined) return false;
  return (state.userCancelledTurnStartsByThread[threadId] ?? []).includes(lastStartedAt);
}

export function continueInterruptedTaskSegments(): [{ kind: "text"; content: string }] {
  return [{ kind: "text", content: CONTINUE_INTERRUPTED_TASK_PROMPT }];
}
