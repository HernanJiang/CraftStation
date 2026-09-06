import { create } from "zustand";

/**
 * What the right-panel Side Chat is showing.
 *
 * - `branch`: a memory-only ephemeral fork of a formal thread (see
 *   `isEphemeralSideChatThread`). It never enters the left thread list or
 *   SQLite; closing Side Chat discards it unless the user saved it first.
 * - `existing`: a formal thread opened in parallel on the right. The row is
 *   untouched — closing Side Chat only closes the panel, never the thread.
 */
export type SideChatSelection =
  | { kind: "branch"; threadId: string; sourceThreadId: string }
  | { kind: "existing"; threadId: string };

interface SideChatState {
  /** The Side Chat surface is open (chooser or a live thread). */
  panelOpen: boolean;
  /** Null = chooser ("branch from current" / "open existing"). */
  selection: SideChatSelection | null;
  /** Open the panel on the chooser without touching any thread. */
  openPanel: () => void;
  selectBranch: (threadId: string, sourceThreadId: string) => void;
  selectExisting: (threadId: string) => void;
  close: () => void;
}

export const useSideChatStore = create<SideChatState>((set) => ({
  panelOpen: false,
  selection: null,
  openPanel: () => set({ panelOpen: true, selection: null }),
  selectBranch: (threadId, sourceThreadId) =>
    set({ panelOpen: true, selection: { kind: "branch", threadId, sourceThreadId } }),
  selectExisting: (threadId) =>
    set({ panelOpen: true, selection: { kind: "existing", threadId } }),
  close: () => set({ panelOpen: false, selection: null }),
}));

/** Thread id currently rendered in Side Chat, if any. */
export function selectSideChatThreadId(state: SideChatState): string | null {
  return state.selection?.threadId ?? null;
}
