import type { DraftContent, PendingDraftWorktreeSelection } from "./types";
import type { SliceCreator } from "./shared";

/**
 * A one-shot request to insert text into a project's draft composer. Carried
 * separately from `draftContents` because it must apply whether the composer is
 * mounting fresh OR already open — subscribing components consume it and clear
 * it. `nonce` makes repeated identical seeds distinct so the consuming effect
 * re-fires.
 */
export interface PendingComposerSeed {
  text: string;
  nonce: number;
  bindLeadingSkill?: boolean;
}

export interface DraftSlice {
  draftContents: Record<string, DraftContent>;
  /**
   * Unsent composer content for *already-launched* threads, keyed by threadId.
   * Saved when a thread's composer unmounts (switching panes/threads remounts
   * it, see ThreadPane's `key={threadId}`) and restored when it mounts again,
   * so an in-progress message survives navigating away. In-memory only — not
   * persisted across app restarts (see appStore `partialize`), matching the
   * per-project `draftContents` behavior.
   */
  threadDraftContents: Record<string, DraftContent>;
  pendingDraftWorktreeSelections: Record<string, PendingDraftWorktreeSelection>;
  pendingComposerSeeds: Record<string, PendingComposerSeed>;
  draftContentDiscardRequests: Record<string, true>;
  /**
   * One-shot "save the next unmounted draft under a different project" mapping
   * (fromProjectId → toProjectId). The composer project switch uses it so the
   * typed prompt follows the retarget instead of being dropped.
   */
  draftContentTransfers: Record<string, string>;
  saveDraftContent: (projectId: string, content: DraftContent) => void;
  clearDraftContent: (projectId: string) => void;
  discardDraftContent: (projectId: string) => void;
  consumeDraftContentDiscard: (projectId: string) => boolean;
  transferDraftContent: (fromProjectId: string, toProjectId: string) => void;
  consumeDraftContentTransfer: (fromProjectId: string) => string | undefined;
  saveThreadDraftContent: (threadId: string, content: DraftContent) => void;
  clearThreadDraftContent: (threadId: string) => void;
  setPendingDraftWorktreeSelection: (
    projectId: string,
    selection: PendingDraftWorktreeSelection,
  ) => void;
  clearPendingDraftWorktreeSelection: (projectId: string) => void;
  setComposerSeed: (projectId: string, text: string, bindLeadingSkill?: boolean) => void;
  clearComposerSeed: (projectId: string) => void;
}

export const createDraftSlice: SliceCreator<DraftSlice> = (set) => ({
  draftContents: {},
  threadDraftContents: {},
  pendingDraftWorktreeSelections: {},
  pendingComposerSeeds: {},
  draftContentDiscardRequests: {},
  draftContentTransfers: {},
  saveDraftContent: (projectId, content) =>
    set((state) => ({
      draftContents: { ...state.draftContents, [projectId]: content },
    })),
  clearDraftContent: (projectId) =>
    set((state) => {
      if (!(projectId in state.draftContents)) return {};
      const { [projectId]: _, ...rest } = state.draftContents;
      return { draftContents: rest };
    }),
  discardDraftContent: (projectId) =>
    set((state) => {
      const { [projectId]: _draft, ...draftContents } = state.draftContents;
      return {
        draftContents,
        draftContentDiscardRequests: {
          ...state.draftContentDiscardRequests,
          [projectId]: true,
        },
      };
    }),
  consumeDraftContentDiscard: (projectId) => {
    let shouldDiscard = false;
    set((state) => {
      if (!(projectId in state.draftContentDiscardRequests)) return {};
      shouldDiscard = true;
      const { [projectId]: _, ...rest } = state.draftContentDiscardRequests;
      return { draftContentDiscardRequests: rest };
    });
    return shouldDiscard;
  },
  transferDraftContent: (from, to) =>
    set((state) => {
      if (from === to) return {};
      // A draft saved earlier (composer not mounted) moves immediately; a live
      // composer's unmount cleanup follows the transfer entry below.
      const { [from]: movedDraft, ...rest } = state.draftContents;
      const draftContents = movedDraft ? { ...rest, [to]: movedDraft } : rest;
      const { [from]: _discard, ...draftContentDiscardRequests } =
        state.draftContentDiscardRequests;
      return {
        draftContents,
        draftContentDiscardRequests,
        draftContentTransfers: { ...state.draftContentTransfers, [from]: to },
      };
    }),
  consumeDraftContentTransfer: (from) => {
    let target: string | undefined;
    set((state) => {
      if (!(from in state.draftContentTransfers)) return {};
      target = state.draftContentTransfers[from];
      const { [from]: _, ...rest } = state.draftContentTransfers;
      return { draftContentTransfers: rest };
    });
    return target;
  },
  saveThreadDraftContent: (threadId, content) =>
    set((state) => ({
      threadDraftContents: { ...state.threadDraftContents, [threadId]: content },
    })),
  clearThreadDraftContent: (threadId) =>
    set((state) => {
      if (!(threadId in state.threadDraftContents)) return {};
      const { [threadId]: _, ...rest } = state.threadDraftContents;
      return { threadDraftContents: rest };
    }),
  setPendingDraftWorktreeSelection: (projectId, selection) =>
    set((state) => ({
      pendingDraftWorktreeSelections: {
        ...state.pendingDraftWorktreeSelections,
        [projectId]: selection,
      },
    })),
  clearPendingDraftWorktreeSelection: (projectId) =>
    set((state) => {
      if (!(projectId in state.pendingDraftWorktreeSelections)) return {};
      const { [projectId]: _, ...rest } = state.pendingDraftWorktreeSelections;
      return { pendingDraftWorktreeSelections: rest };
    }),
  setComposerSeed: (projectId, text, bindLeadingSkill) =>
    set((state) => {
      const trimmed = text.trim();
      if (!trimmed) return {};
      const prevNonce = state.pendingComposerSeeds[projectId]?.nonce ?? 0;
      return {
        pendingComposerSeeds: {
          ...state.pendingComposerSeeds,
          [projectId]: {
            text: trimmed,
            nonce: prevNonce + 1,
            ...(bindLeadingSkill ? { bindLeadingSkill: true } : {}),
          },
        },
      };
    }),
  clearComposerSeed: (projectId) =>
    set((state) => {
      if (!(projectId in state.pendingComposerSeeds)) return {};
      const { [projectId]: _, ...rest } = state.pendingComposerSeeds;
      return { pendingComposerSeeds: rest };
    }),
});
