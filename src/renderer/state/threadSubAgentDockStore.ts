import { create } from "zustand";

interface ThreadSubAgentDockStore {
  dismissedByThread: Record<string, Record<string, true>>;
  dismiss: (threadId: string, itemId: string) => void;
  dismissMany: (threadId: string, itemIds: readonly string[]) => void;
  reset: (threadId: string) => void;
}

export const useThreadSubAgentDockStore = create<ThreadSubAgentDockStore>((set) => ({
  dismissedByThread: {},
  dismiss: (threadId, itemId) =>
    set((state) => {
      const current = state.dismissedByThread[threadId];
      if (current?.[itemId]) return state;
      return {
        dismissedByThread: {
          ...state.dismissedByThread,
          [threadId]: { ...(current ?? {}), [itemId]: true },
        },
      };
    }),
  dismissMany: (threadId, itemIds) =>
    set((state) => {
      if (itemIds.length === 0) return state;
      const current = state.dismissedByThread[threadId] ?? {};
      let changed = false;
      const next: Record<string, true> = { ...current };
      for (const id of itemIds) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }
      if (!changed) return state;
      return {
        dismissedByThread: {
          ...state.dismissedByThread,
          [threadId]: next,
        },
      };
    }),
  reset: (threadId) =>
    set((state) => {
      if (!state.dismissedByThread[threadId]) return state;
      const next = { ...state.dismissedByThread };
      delete next[threadId];
      return { dismissedByThread: next };
    }),
}));
