import { create } from "zustand";
import type { ProjectLocation } from "@/shared/contracts";
import { persistStoreSlice, readPersistedSlice } from "@/renderer/utils/persistStoreSlice";
import type {
  ThreadListLayout,
  ThreadSortMode,
} from "@/renderer/views/MainView/parts/Sidebar/parts/sortMode";
import { useFileEditorStore } from "./fileEditorStore";

export interface GitReviewContext {
  projectId: string;
  worktreePath?: string;
  originComposerId?: string;
}

export interface PrReviewContext {
  projectId: string;
  worktreePath?: string;
  prNumber: number;
  /** Skip pulling locally for PR contexts that are not tied to a verified local checkout. */
  skipLocalSync?: boolean;
  /**
   * Explicit prData key override for selectors (title/url/checks). Set when
   * opening a PR for a branch that has no worktree, so the overlay reads the
   * branch-keyed prefetch entry instead of the main-branch key. Defaults to
   * `resolvePrKey(projectId, worktreePath)` when omitted.
   */
  prKey?: string;
}

export interface GitHubActionsContext {
  projectId?: string;
  runId?: number;
}

export interface FilesPanelContext {
  projectId: string;
  projectName: string;
  worktreePath?: string;
  rootLabel: string;
}

export interface SubAgentPanelContext {
  threadId: string;
  parentItemId: string;
  projectLocation?: ProjectLocation;
}

/**
 * Valid right-panel tool tabs. The old "harness" Crafting Table tab was
 * removed in v1.0.0 — the Crafting Table is now the "合成台" first-level tab
 * of the model-usage workspace (openModelUsageWorkspace({ tab: "crafting" })).
 */
export type RightPanelTab =
  | "git"
  | "files"
  | "terminal"
  | "browser"
  | "usage"
  | "notes"
  | "ports"
  | "plan"
  | "subagent"
  | "side-chat";

/** Tabs that can be dragged into a dock zone. Thread-transient tabs (plan, subagent) and ports stay fixed. */
export const DOCKABLE_PANEL_TABS: ReadonlySet<RightPanelTab> = new Set([
  "git",
  "files",
  "terminal",
  "browser",
  "usage",
  "notes",
]);

/** A second panel section stacked above or below the active right-panel tab. */
export interface RightPanelSplit {
  tab: RightPanelTab;
  /** Which half of the right panel the split tab occupies. */
  placement: "top" | "bottom";
  height?: number;
}

export type BottomDockPlacement = "left" | "right";

/**
 * Panels docked in the bottom row, one per side. The terminal (when open) sits
 * between them, so the row reads `left | terminal | right`; with the terminal
 * closed the docks own the row on their own.
 */
export interface BottomPanelDocks {
  left: RightPanelTab | null;
  right: RightPanelTab | null;
}

export const EMPTY_BOTTOM_PANEL_DOCKS: BottomPanelDocks = { left: null, right: null };

export type PanelDockZone = "right-panel" | "bottom-panel";

/** Explicit Codex-style auxiliary workspace placement. Hidden is the startup default. */
export type AuxiliaryPanelPlacement = "hidden" | "right" | "bottom";

/** Resolved drop location for a dragged panel-tab icon. */
export type PanelDockTarget =
  | { zone: "right-panel"; placement: "top" | "bottom" }
  | { zone: "bottom-panel"; placement: BottomDockPlacement };

/** Per-thread right-sidebar snapshot (see threadAuxiliaryPanels). */
export interface ThreadAuxiliaryPanelSnapshot {
  placement: AuxiliaryPanelPlacement;
  tab: RightPanelTab | null;
  tabs: RightPanelTab[];
  browserOpen: boolean;
  usageOpen: boolean;
  notesOpen: boolean;
}

export const EMPTY_THREAD_AUXILIARY_PANEL: ThreadAuxiliaryPanelSnapshot = {
  placement: "hidden",
  tab: null,
  tabs: [],
  browserOpen: false,
  usageOpen: false,
  notesOpen: false,
};

interface PanelState {
  auxiliaryPanelPlacement: AuxiliaryPanelPlacement;
  /** No default tool: opening the dock first shows the Codex-style tool chooser. */
  auxiliaryPanelTab: RightPanelTab | null;
  /** Expand the auxiliary workspace to fill the whole content frame. */
  auxiliaryPanelMaximized: boolean;
  /** Session-scoped multi-tab set for the Codex-style auxiliary workspace. */
  auxiliaryPanelTabs: RightPanelTab[];
  /**
   * Per-thread right-sidebar snapshots. Each thread owns its auxiliary shell
   * (placement/tab/tabs) plus the simple open flags; switching threads
   * captures the previous thread's state and restores the target's (or
   * defaults when the thread has none). Payload contexts (git review, files,
   * subagent, PR) and layout chrome (maximized, splits, docks) stay global
   * on purpose — they reference specific repos/sessions, not the thread.
   * Session-only: never persisted (persistStoreSlice allowlist below).
   */
  threadAuxiliaryPanels: Record<string, ThreadAuxiliaryPanelSnapshot>;
  gitReviewContext: GitReviewContext | null;
  gitReviewAsPanel: boolean;
  gitOverlayOpen: boolean;
  prReviewContext: PrReviewContext | null;
  githubActionsContext: GitHubActionsContext | null;
  filesPanelContext: FilesPanelContext | null;
  subAgentPanelContext: SubAgentPanelContext | null;
  subAgentPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  /**
   * Session-scoped like `rightPanelTab`: a second tab rendered stacked with the
   * active one in the right panel, or null when the panel is unsplit.
   */
  rightPanelSplit: RightPanelSplit | null;
  /** Panels rendered in the bottom row. Only meaningful with terminalPosition "bottom". */
  bottomPanelDocks: BottomPanelDocks;
  /**
   * When true, the open right-panel tools re-scope to whichever thread is
   * focused instead of staying on the project/worktree they were opened from.
   * Persisted — single-thread users leave it on permanently.
   */
  rightPanelFollowsThread: boolean;
  /** Vertical offset (px from the pane's top) of the per-thread tool rail. */
  threadToolRailOffset: number;
  browserPanelOpen: boolean;
  usagePanelOpen: boolean;
  notesPanelOpen: boolean;
  browserOverlayOpen: boolean;
  browserOverlayMaximized: boolean;
  browserOverlayDrawerWidth: number;
  /** Global Codex-style provider account and quota dialog. */
  modelUsageDialogOpen: boolean;
  /** Primary workspace tab shown when the model-usage workspace is open. */
  modelUsageWorkspaceTab: ModelUsageWorkspaceTab;
  /** Workbench mode to enter when the crafting tab is opened (null = restore last). */
  modelUsageEntryMode: "efficient" | "creative" | null;
  settingsOpen: boolean;
  /** When the overlay is opened deep-linked to a section (e.g. "usage"); else null. */
  settingsSection: string | null;
  projectSettingsId: string | null;
  threadSortMode: ThreadSortMode;
  threadListLayout: ThreadListLayout;
  threadSearchOpen: boolean;
  /** Whether the "Start from scratch" create-project modal is open. */
  createProjectModalOpen: boolean;
  /** Whether the "Clone a repository" modal is open. */
  cloneProjectModalOpen: boolean;
  /** Whether the select-project modal for new chat is open. */
  selectProjectModalOpen: boolean;
  setGitReviewContext: (ctx: GitReviewContext | null) => void;
  setThreadSortMode: (mode: ThreadSortMode) => void;
  setThreadListLayout: (layout: ThreadListLayout) => void;
  setGitReviewAsPanel: (v: boolean) => void;
  setGitOverlayOpen: (v: boolean) => void;
  setPrReviewContext: (ctx: PrReviewContext | null) => void;
  setGitHubActionsContext: (ctx: GitHubActionsContext | null) => void;
  setFilesPanelContext: (ctx: FilesPanelContext | null) => void;
  setSubAgentPanelContext: (ctx: SubAgentPanelContext | null) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setAuxiliaryPanelPlacement: (placement: AuxiliaryPanelPlacement) => void;
  setAuxiliaryPanelTab: (tab: RightPanelTab | null) => void;
  /** Snapshot the current right-sidebar shell under a thread id. */
  captureThreadAuxiliaryPanel: (threadId: string) => void;
  /** Restore a thread's right-sidebar shell (defaults when it has none). */
  restoreThreadAuxiliaryPanel: (threadId: string) => void;
  closeAuxiliaryPanelTab: (tab: RightPanelTab) => void;
  toggleAuxiliaryPanel: (placement: Exclude<AuxiliaryPanelPlacement, "hidden">) => void;
  /** Hide the auxiliary panel while preserving its active tab and open tabs. */
  hideAuxiliaryPanel: () => void;
  toggleAuxiliaryPanelMaximized: () => void;
  setRightPanelSplit: (split: RightPanelSplit | null) => void;
  /** Put a tab in one bottom slot (or clear it); a tab never occupies two slots. */
  setBottomPanelDock: (placement: BottomDockPlacement, tab: RightPanelTab | null) => void;
  /** Remove a tab from whichever bottom slot holds it. */
  clearBottomPanelDockTab: (tab: RightPanelTab) => void;
  clearBottomPanelDocks: () => void;
  toggleRightPanelFollowsThread: () => void;
  setThreadToolRailOffset: (offset: number) => void;
  setBrowserPanelOpen: (v: boolean) => void;
  setUsagePanelOpen: (v: boolean) => void;
  openUsagePanel: () => void;
  setNotesPanelOpen: (v: boolean) => void;
  openNotesPanel: () => void;
  setBrowserOverlayOpen: (v: boolean) => void;
  setBrowserOverlayMaximized: (v: boolean) => void;
  setBrowserOverlayDrawerWidth: (v: number) => void;
  openBrowserPanel: () => void;
  openModelUsageDialog: () => void;
  closeModelUsageDialog: () => void;
  /**
   * Open the model-usage workspace at a specific primary tab, optionally
   * entering the crafting workbench in a chosen mode (null = restore last
   * Workbench mode). Kept as a single action so every chat/panel entry point
   * drives the same state instead of mutating local tab state separately.
   */
  openModelUsageWorkspace: (input: {
    tab: ModelUsageWorkspaceTab;
    entryMode?: "efficient" | "creative";
  }) => void;
  openSettings: () => void;
  openSettingsSection: (section: string) => void;
  clearSettingsSection: () => void;
  closeSettings: () => void;
  openProjectSettings: (projectId: string) => void;
  closeProjectSettings: () => void;
  openThreadSearch: () => void;
  closeThreadSearch: () => void;
  openCreateProjectModal: () => void;
  closeCreateProjectModal: () => void;
  openCloneProjectModal: () => void;
  closeCloneProjectModal: () => void;
  openSelectProjectModal: () => void;
  closeSelectProjectModal: () => void;
  closeAllPanels: () => void;
}

/**
 * Legacy hand-rolled storage keys, read once as the initial seed so existing
 * installs keep their state; the slice under PERSIST_KEY takes over on the first
 * write and wins on every launch where it exists.
 */
const PERSIST_KEY = "craftstation-panel";
const DEFAULT_DRAWER_WIDTH = 640;
const MIN_DRAWER_WIDTH = 420;
const MAX_DRAWER_WIDTH = 1400;

function projectLocationsEqual(
  a: ProjectLocation | undefined,
  b: ProjectLocation | undefined,
): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "windows") return a.path === (b as typeof a).path;
  if (a.kind === "posix") return a.path === (b as typeof a).path;
  return (
    a.distro === (b as typeof a).distro &&
    a.linuxPath === (b as typeof a).linuxPath &&
    a.uncPath === (b as typeof a).uncPath
  );
}

function clampDrawerWidth(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_DRAWER_WIDTH;
  return Math.max(MIN_DRAWER_WIDTH, Math.min(MAX_DRAWER_WIDTH, Math.round(v)));
}

const initialPersisted = readPersistedSlice<{
  gitReviewContext: GitReviewContext | null;
  browserOverlayDrawerWidth: number;
  rightPanelFollowsThread?: boolean;
  threadToolRailOffset?: number;
  threadSortMode?: ThreadSortMode;
  threadListLayout?: ThreadListLayout;
  modelUsageWorkspaceTab?: unknown;
}>(PERSIST_KEY);

function sanitizeThreadSortMode(value: unknown): ThreadSortMode {
  return value === "updated" || value === "created" || value === "manual" ? value : "updated";
}

/** First-level tabs of the model-usage workspace. */
export type ModelUsageWorkspaceTab = "usage" | "models" | "stats" | "crafting" | "recipes";

function sanitizeModelUsageWorkspaceTab(value: unknown): ModelUsageWorkspaceTab {
  return value === "usage" ||
    value === "models" ||
    value === "stats" ||
    value === "crafting" ||
    value === "recipes"
    ? value
    : "usage";
}

function sanitizeThreadListLayout(value: unknown): ThreadListLayout {
  return value === "grouped" || value === "flat" ? value : "grouped";
}

function releaseClosedTab(state: PanelState, tab: RightPanelTab): Partial<PanelState> {
  const { left, right } = state.bottomPanelDocks;
  const inDocks = left === tab || right === tab;
  const inSplit = state.rightPanelSplit?.tab === tab;
  if (!inDocks && !inSplit) return {};
  return {
    ...(inDocks
      ? {
          bottomPanelDocks: {
            left: left === tab ? null : left,
            right: right === tab ? null : right,
          },
        }
      : {}),
    ...(inSplit ? { rightPanelSplit: null } : {}),
  };
}

export const usePanelStore = create<PanelState>()((set) => ({
  auxiliaryPanelPlacement: "hidden",
  auxiliaryPanelTab: null,
  auxiliaryPanelMaximized: false,
  auxiliaryPanelTabs: [],
  threadAuxiliaryPanels: {},
  gitReviewContext: initialPersisted?.gitReviewContext ?? null,
  gitReviewAsPanel: false,
  gitOverlayOpen: false,
  prReviewContext: null,
  githubActionsContext: null,
  filesPanelContext: null,
  subAgentPanelContext: null,
  subAgentPanelOpen: false,
  rightPanelTab: "files",
  rightPanelSplit: null,
  bottomPanelDocks: EMPTY_BOTTOM_PANEL_DOCKS,
  rightPanelFollowsThread: initialPersisted?.rightPanelFollowsThread ?? true,
  threadToolRailOffset: initialPersisted?.threadToolRailOffset ?? 0,
  browserPanelOpen: false,
  usagePanelOpen: false,
  notesPanelOpen: false,
  browserOverlayOpen: false,
  browserOverlayMaximized: false,
  browserOverlayDrawerWidth: initialPersisted?.browserOverlayDrawerWidth
    ? clampDrawerWidth(initialPersisted.browserOverlayDrawerWidth)
    : DEFAULT_DRAWER_WIDTH,
  modelUsageDialogOpen: false,
  modelUsageWorkspaceTab: sanitizeModelUsageWorkspaceTab(initialPersisted?.modelUsageWorkspaceTab),
  modelUsageEntryMode: null,
  settingsOpen: false,
  settingsSection: null,
  projectSettingsId: null,
  threadSortMode: sanitizeThreadSortMode(initialPersisted?.threadSortMode),
  threadListLayout: sanitizeThreadListLayout(initialPersisted?.threadListLayout),
  threadSearchOpen: false,
  createProjectModalOpen: false,
  cloneProjectModalOpen: false,
  selectProjectModalOpen: false,

  setGitReviewContext: (ctx) =>
    set((state) => {
      const prev = state.gitReviewContext;
      if (
        (prev === null && ctx === null) ||
        (prev !== null &&
          ctx !== null &&
          prev.projectId === ctx.projectId &&
          prev.worktreePath === ctx.worktreePath &&
          prev.originComposerId === ctx.originComposerId)
      ) {
        return {};
      }

      return {
        gitReviewContext: ctx,
        ...(ctx === null ? releaseClosedTab(state, "git") : {}),
      };
    }),

  setThreadSortMode: (threadSortMode) => {
    set({ threadSortMode });
  },

  setThreadListLayout: (threadListLayout) => {
    set({ threadListLayout });
  },

  setGitReviewAsPanel: (gitReviewAsPanel) => set({ gitReviewAsPanel }),
  setGitOverlayOpen: (gitOverlayOpen) => set({ gitOverlayOpen }),
  setPrReviewContext: (ctx) => set({ prReviewContext: ctx }),
  setGitHubActionsContext: (ctx) => set({ githubActionsContext: ctx }),
  setFilesPanelContext: (ctx) =>
    set((state) => {
      return {
        filesPanelContext: ctx,
        ...(ctx === null ? releaseClosedTab(state, "files") : {}),
      };
    }),

  setSubAgentPanelContext: (ctx) =>
    set((state) => {
      const prev = state.subAgentPanelContext;
      if (
        (prev === null && ctx === null) ||
        (prev !== null &&
          ctx !== null &&
          prev.threadId === ctx.threadId &&
          prev.parentItemId === ctx.parentItemId &&
          projectLocationsEqual(prev.projectLocation, ctx.projectLocation))
      ) {
        return {};
      }
      return { subAgentPanelContext: ctx, subAgentPanelOpen: ctx !== null };
    }),

  setRightPanelTab: (tab) =>
    set((state) => {
      if (tab === "subagent") {
        return {
          rightPanelTab: tab,
          subAgentPanelOpen: state.subAgentPanelContext !== null,
        };
      }
      const unsplit = state.rightPanelSplit?.tab === tab;
      const nextSplit = unsplit ? null : state.rightPanelSplit;
      const nextTabs = state.auxiliaryPanelTabs.includes(tab)
        ? state.auxiliaryPanelTabs
        : [...state.auxiliaryPanelTabs, tab];
      return {
        rightPanelTab: tab,
        auxiliaryPanelTab: tab,
        auxiliaryPanelTabs: nextTabs,
        rightPanelSplit: nextSplit,
      };
    }),

  setAuxiliaryPanelPlacement: (placement) =>
    set((state) =>
      state.auxiliaryPanelPlacement === placement ? {} : { auxiliaryPanelPlacement: placement },
    ),

  setAuxiliaryPanelTab: (tab) =>
    set((state) => {
      if (state.auxiliaryPanelTab === tab) return {};
      if (tab === null) {
        return { auxiliaryPanelTab: null };
      }
      const nextTabs = state.auxiliaryPanelTabs.includes(tab)
        ? state.auxiliaryPanelTabs
        : [...state.auxiliaryPanelTabs, tab];
      return {
        auxiliaryPanelTab: tab,
        rightPanelTab: tab,
        auxiliaryPanelTabs: nextTabs,
      };
    }),

  captureThreadAuxiliaryPanel: (threadId) =>
    set((state) => ({
      threadAuxiliaryPanels: {
        ...state.threadAuxiliaryPanels,
        [threadId]: {
          placement: state.auxiliaryPanelPlacement,
          tab: state.auxiliaryPanelTab,
          tabs: state.auxiliaryPanelTabs,
          browserOpen: state.browserPanelOpen,
          usageOpen: state.usagePanelOpen,
          notesOpen: state.notesPanelOpen,
        },
      },
    })),

  restoreThreadAuxiliaryPanel: (threadId) =>
    set((state) => {
      const snapshot = state.threadAuxiliaryPanels[threadId] ?? EMPTY_THREAD_AUXILIARY_PANEL;
      if (
        state.auxiliaryPanelPlacement === snapshot.placement &&
        state.auxiliaryPanelTab === snapshot.tab &&
        state.browserPanelOpen === snapshot.browserOpen &&
        state.usagePanelOpen === snapshot.usageOpen &&
        state.notesPanelOpen === snapshot.notesOpen
      ) {
        return {};
      }
      return {
        auxiliaryPanelPlacement: snapshot.placement,
        auxiliaryPanelTab: snapshot.tab,
        auxiliaryPanelTabs: snapshot.tabs,
        browserPanelOpen: snapshot.browserOpen,
        usagePanelOpen: snapshot.usageOpen,
        notesPanelOpen: snapshot.notesOpen,
      };
    }),

  closeAuxiliaryPanelTab: (tab) =>
    set((state) => {
      const nextTabs = state.auxiliaryPanelTabs.filter((t) => t !== tab);
      if (state.auxiliaryPanelTab !== tab) {
        return { auxiliaryPanelTabs: nextTabs };
      }
      const closingIndex = state.auxiliaryPanelTabs.indexOf(tab);
      const fallbackTab = nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? null;
      return {
        auxiliaryPanelTabs: nextTabs,
        auxiliaryPanelTab: fallbackTab,
        ...(fallbackTab ? { rightPanelTab: fallbackTab } : {}),
      };
    }),

  toggleAuxiliaryPanel: (placement) =>
    set((state) => {
      if (state.auxiliaryPanelPlacement === placement) {
        return {
          auxiliaryPanelPlacement: "hidden",
          auxiliaryPanelMaximized: false,
        };
      }
      return {
        auxiliaryPanelPlacement: placement,
      };
    }),

  hideAuxiliaryPanel: () =>
    set((state) =>
      state.auxiliaryPanelPlacement === "hidden" && !state.auxiliaryPanelMaximized
        ? {}
        : {
            auxiliaryPanelPlacement: "hidden",
            auxiliaryPanelMaximized: false,
          },
    ),

  toggleAuxiliaryPanelMaximized: () =>
    set((state) => ({ auxiliaryPanelMaximized: !state.auxiliaryPanelMaximized })),

  setRightPanelSplit: (split) =>
    set((state) => {
      const prev = state.rightPanelSplit;
      if (
        (prev === null && split === null) ||
        (prev !== null &&
          split !== null &&
          prev.tab === split.tab &&
          prev.placement === split.placement &&
          prev.height === split.height)
      ) {
        return {};
      }
      if (split && split.tab === state.rightPanelTab) return {};
      return { rightPanelSplit: split };
    }),

  setBottomPanelDock: (placement, tab) =>
    set((state) => {
      const { left, right } = state.bottomPanelDocks;
      const nextLeft = placement === "left" ? tab : left === tab ? null : left;
      const nextRight = placement === "right" ? tab : right === tab ? null : right;
      return { bottomPanelDocks: { left: nextLeft, right: nextRight } };
    }),

  clearBottomPanelDockTab: (tab) =>
    set((state) => {
      const { left, right } = state.bottomPanelDocks;
      if (left !== tab && right !== tab) return {};
      return {
        bottomPanelDocks: {
          left: left === tab ? null : left,
          right: right === tab ? null : right,
        },
      };
    }),

  clearBottomPanelDocks: () => set({ bottomPanelDocks: EMPTY_BOTTOM_PANEL_DOCKS }),

  toggleRightPanelFollowsThread: () =>
    set((state) => {
      const next = !state.rightPanelFollowsThread;

      return { rightPanelFollowsThread: next };
    }),

  setThreadToolRailOffset: (offset) => {
    set({ threadToolRailOffset: offset });
  },

  setBrowserPanelOpen: (browserPanelOpen) =>
    set((state) => ({
      browserPanelOpen,
      ...(!browserPanelOpen ? releaseClosedTab(state, "browser") : {}),
    })),

  setUsagePanelOpen: (usagePanelOpen) =>
    set((state) => ({
      usagePanelOpen,
      ...(!usagePanelOpen ? releaseClosedTab(state, "usage") : {}),
    })),

  openUsagePanel: () => set({ usagePanelOpen: true }),
  setNotesPanelOpen: (notesPanelOpen) =>
    set((state) => ({
      notesPanelOpen,
      ...(!notesPanelOpen ? releaseClosedTab(state, "notes") : {}),
    })),
  openNotesPanel: () => set({ notesPanelOpen: true }),

  setBrowserOverlayOpen: (browserOverlayOpen) =>
    set({
      browserOverlayOpen,
      ...(!browserOverlayOpen ? { browserOverlayMaximized: false } : {}),
    }),

  setBrowserOverlayMaximized: (browserOverlayMaximized) => set({ browserOverlayMaximized }),

  setBrowserOverlayDrawerWidth: (drawerWidth) => {
    const clamped = clampDrawerWidth(drawerWidth);

    set({ browserOverlayDrawerWidth: clamped });
  },

  openBrowserPanel: () => set({ browserPanelOpen: true }),
  openModelUsageDialog: () =>
    set(() => ({
      modelUsageDialogOpen: true,
      // A plain "open" (sidebar entry) restores the last-visited tab; only the
      // explicit openModelUsageWorkspace action targets a specific tab. First
      // run defaults to "usage" via the sanitized initial state.
      modelUsageEntryMode: null,
    })),
  closeModelUsageDialog: () => set({ modelUsageDialogOpen: false }),
  openModelUsageWorkspace: (input) =>
    set(() => ({
      modelUsageDialogOpen: true,
      modelUsageWorkspaceTab: input.tab,
      modelUsageEntryMode: input.entryMode ?? null,
    })),
  openSettings: () => set({ settingsOpen: true, settingsSection: null }),
  openSettingsSection: (section) => set({ settingsOpen: true, settingsSection: section }),
  clearSettingsSection: () => set({ settingsSection: null }),
  closeSettings: () => set({ settingsOpen: false, settingsSection: null }),
  openProjectSettings: (projectId) => set({ projectSettingsId: projectId }),
  closeProjectSettings: () => set({ projectSettingsId: null }),
  openThreadSearch: () => set({ threadSearchOpen: true }),
  closeThreadSearch: () => set({ threadSearchOpen: false }),
  openCreateProjectModal: () => set({ createProjectModalOpen: true }),
  closeCreateProjectModal: () => set({ createProjectModalOpen: false }),
  openCloneProjectModal: () => set({ cloneProjectModalOpen: true }),
  closeCloneProjectModal: () => set({ cloneProjectModalOpen: false }),
  openSelectProjectModal: () => set({ selectProjectModalOpen: true }),
  closeSelectProjectModal: () => set({ selectProjectModalOpen: false }),

  closeAllPanels: () =>
    set((state) => {
      const { left, right } = state.bottomPanelDocks;
      const isDocked = (tab: RightPanelTab) => left === tab || right === tab;
      const next = {
        auxiliaryPanelPlacement: "hidden" as const,
        auxiliaryPanelTab: null,
        auxiliaryPanelMaximized: false,
        ...(isDocked("git") ? {} : { gitReviewContext: null }),
        ...(isDocked("files") ? {} : { filesPanelContext: null }),
        ...(isDocked("browser") ? { browserPanelOpen: false } : { browserPanelOpen: false }),
        ...(isDocked("usage") ? {} : { usagePanelOpen: false }),
        ...(isDocked("notes") ? {} : { notesPanelOpen: false }),
        subAgentPanelOpen: false,
        // The subagent tab is not dockable: closing everything must drop its
        // context too, otherwise the tab fallback resurrects a dead subagent
        // page the next time the rail opens.
        subAgentPanelContext: null,
        rightPanelSplit: null,
      };
      const alreadyClosed =
        state.auxiliaryPanelPlacement === "hidden" &&
        state.auxiliaryPanelTab === null &&
        !state.auxiliaryPanelMaximized &&
        (next.gitReviewContext === undefined || state.gitReviewContext === null) &&
        (next.filesPanelContext === undefined || state.filesPanelContext === null) &&
        !state.subAgentPanelOpen &&
        state.subAgentPanelContext === null &&
        (next.browserPanelOpen === undefined || !state.browserPanelOpen) &&
        (next.usagePanelOpen === undefined || !state.usagePanelOpen) &&
        (next.notesPanelOpen === undefined || !state.notesPanelOpen) &&
        state.rightPanelSplit === null;
      return alreadyClosed ? {} : next;
    }),
}));

export function selectAnyObstructingOverlayOpen(): boolean {
  const panel = usePanelStore.getState();
  const fileEditor = useFileEditorStore.getState();
  return (
    panel.settingsOpen ||
    panel.projectSettingsId !== null ||
    panel.gitOverlayOpen ||
    panel.prReviewContext !== null ||
    panel.githubActionsContext !== null ||
    panel.threadSearchOpen ||
    panel.modelUsageDialogOpen ||
    fileEditor.overlayMode === "fullscreen" ||
    fileEditor.overlayMode === "modal"
  );
}

persistStoreSlice(usePanelStore, PERSIST_KEY, (state) => ({
  gitReviewContext: state.gitReviewContext,
  browserOverlayDrawerWidth: state.browserOverlayDrawerWidth,
  rightPanelFollowsThread: state.rightPanelFollowsThread,
  threadToolRailOffset: state.threadToolRailOffset,
  threadSortMode: state.threadSortMode,
  threadListLayout: state.threadListLayout,
  modelUsageWorkspaceTab: state.modelUsageWorkspaceTab,
}));
