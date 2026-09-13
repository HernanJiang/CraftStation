import type { PromptSegment } from "@/shared/contracts";
import type { SliceCreator } from "./shared";

/** One follow-up waiting to send after the current turn, or after the user
 * chooses Send now. Renderer-owned; not an interrupt/steer slot. */
export interface QueuedFollowUp {
  prompt: string;
  segments?: PromptSegment[];
  queuedAt: number;
  /** True after the user stops the in-flight turn; auto-flush is suppressed. */
  paused: boolean;
}

export interface QueuedFollowUpSlice {
  queuedFollowUpByThreadId: Record<string, QueuedFollowUp>;
  setQueuedFollowUp(threadId: string, queued: QueuedFollowUp | null): void;
  pauseQueuedFollowUp(threadId: string): void;
  updateQueuedFollowUpPrompt(threadId: string, prompt: string): void;
}

export function createInitialQueuedFollowUpState(): Pick<
  QueuedFollowUpSlice,
  "queuedFollowUpByThreadId"
> {
  return { queuedFollowUpByThreadId: {} };
}

export const createQueuedFollowUpSlice: SliceCreator<QueuedFollowUpSlice> = (set) => ({
  ...createInitialQueuedFollowUpState(),
  setQueuedFollowUp: (threadId, queued) =>
    set((state) => {
      if (queued === null) {
        if (!state.queuedFollowUpByThreadId[threadId]) return state;
        const next = { ...state.queuedFollowUpByThreadId };
        delete next[threadId];
        return { queuedFollowUpByThreadId: next };
      }
      return {
        queuedFollowUpByThreadId: {
          ...state.queuedFollowUpByThreadId,
          [threadId]: queued,
        },
      };
    }),
  pauseQueuedFollowUp: (threadId) =>
    set((state) => {
      const current = state.queuedFollowUpByThreadId[threadId];
      if (!current || current.paused) return state;
      return {
        queuedFollowUpByThreadId: {
          ...state.queuedFollowUpByThreadId,
          [threadId]: { ...current, paused: true },
        },
      };
    }),
  updateQueuedFollowUpPrompt: (threadId, prompt) =>
    set((state) => {
      const current = state.queuedFollowUpByThreadId[threadId];
      if (!current) return state;
      const trimmed = prompt.trim();
      if (!trimmed || current.prompt === trimmed) return state;
      return {
        queuedFollowUpByThreadId: {
          ...state.queuedFollowUpByThreadId,
          [threadId]: {
            ...current,
            prompt: trimmed,
            segments: [{ kind: "text", content: trimmed }],
          },
        },
      };
    }),
});
