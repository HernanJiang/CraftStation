import type { PromptSegment } from "@/shared/contracts";
import type { SliceCreator } from "./shared";

/** One follow-up waiting to send after the current turn, or after the user
 * chooses Send now. Renderer-owned; not an interrupt/steer slot. */
export interface QueuedFollowUp {
  /** Stable per-item id so stacked rows can be edited/removed independently. */
  id: string;
  prompt: string;
  segments?: PromptSegment[];
  queuedAt: number;
  /** True after the user stops the in-flight turn; auto-flush is suppressed. */
  paused: boolean;
}

export interface QueuedFollowUpSlice {
  /** FIFO queue per thread — enqueue appends, flush/send consume the head. */
  queuedFollowUpByThreadId: Record<string, QueuedFollowUp[]>;
  enqueueQueuedFollowUp(threadId: string, queued: QueuedFollowUp): void;
  removeQueuedFollowUpItem(threadId: string, itemId: string): void;
  /** Wholesale replace; `null`/empty drops the thread's queue entirely. */
  setQueuedFollowUps(threadId: string, items: QueuedFollowUp[] | null): void;
  pauseQueuedFollowUp(threadId: string): void;
}

export function createInitialQueuedFollowUpState(): Pick<
  QueuedFollowUpSlice,
  "queuedFollowUpByThreadId"
> {
  return { queuedFollowUpByThreadId: {} };
}

export const createQueuedFollowUpSlice: SliceCreator<QueuedFollowUpSlice> = (set) => ({
  ...createInitialQueuedFollowUpState(),

  enqueueQueuedFollowUp: (threadId, queued) =>
    set((state) => ({
      queuedFollowUpByThreadId: {
        ...state.queuedFollowUpByThreadId,
        [threadId]: [...(state.queuedFollowUpByThreadId[threadId] ?? []), queued],
      },
    })),

  removeQueuedFollowUpItem: (threadId, itemId) =>
    set((state) => {
      const list = state.queuedFollowUpByThreadId[threadId];
      if (!list) return state;
      const nextList = list.filter((item) => item.id !== itemId);
      if (nextList.length === list.length) return state;
      const next = { ...state.queuedFollowUpByThreadId };
      if (nextList.length === 0) {
        delete next[threadId];
      } else {
        next[threadId] = nextList;
      }
      return { queuedFollowUpByThreadId: next };
    }),

  setQueuedFollowUps: (threadId, items) =>
    set((state) => {
      if (!items || items.length === 0) {
        if (!state.queuedFollowUpByThreadId[threadId]) return state;
        const next = { ...state.queuedFollowUpByThreadId };
        delete next[threadId];
        return { queuedFollowUpByThreadId: next };
      }
      return {
        queuedFollowUpByThreadId: {
          ...state.queuedFollowUpByThreadId,
          [threadId]: items,
        },
      };
    }),

  pauseQueuedFollowUp: (threadId) =>
    set((state) => {
      const current = state.queuedFollowUpByThreadId[threadId];
      if (!current || current.length === 0 || current.every((item) => item.paused)) return state;
      return {
        queuedFollowUpByThreadId: {
          ...state.queuedFollowUpByThreadId,
          [threadId]: current.map((item) => ({ ...item, paused: true })),
        },
      };
    }),
});
