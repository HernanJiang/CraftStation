import { create } from "zustand";
import type {
  ProjectFileReadStatus,
  ProjectLocation,
  ReadExternalFileResult,
  ReadProjectFileResult,
} from "@/shared/contracts";
import { readBridge } from "../bridge";
import { captureProductEvent } from "../analytics/productAnalytics";
import { captureRendererException } from "../diagnostics/sentry";
import { hasUnresolvedConflicts } from "@/renderer/utils/mergeConflicts";
import { useGitStore } from "./gitStore";
import { resolveAbsolutePath } from "@/renderer/utils/resolveAbsolutePath";

/**
 * Paths in the file editor are either project-relative (e.g. `src/foo.ts`)
 * or absolute (including paths resolved from worktree-relative ".." traversals)
 * when the user opens a file outside the active root from chat or commands.
 * Absolute paths skip the project-relative IPC and route through the
 * external-file IPC instead (which has no containment restriction).
 */
function isExternalPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function containsPathTraversal(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return /(^|\/)\.\.($|\/)/.test(normalized);
}

/**
 * For user-initiated file opens, turn a relative path containing ".." traversal
 * into an absolute path resolved against the active worktree (or project) root.
 * This lets users open sibling directories or files outside the worktree
 * (e.g. from agent chat output) without weakening the strict
 * normalizeRelativePath guard used by the project tree browser and search.
 */
export function resolvePathForFileOpen(
  rootContext: FileEditorRootContext | null,
  rawPath: string,
): string {
  if (!rootContext) return rawPath;
  if (isExternalPath(rawPath)) return rawPath;
  if (!containsPathTraversal(rawPath)) return rawPath;
  return resolveAbsolutePath(rootContext.projectLocation, rawPath);
}

function externalReadAsProjectResult(result: ReadExternalFileResult): ReadProjectFileResult {
  if (result.status === "missing") {
    throw new Error(`File not found: ${result.path}`);
  }
  const base = {
    path: result.path,
    modifiedAtMs: result.modifiedAtMs,
  } as const;
  if (result.status === "ready") {
    return {
      ...base,
      status: "ready",
      ...(result.content !== undefined ? { content: result.content } : {}),
      ...(result.lineEnding !== undefined ? { lineEnding: result.lineEnding } : {}),
      ...(result.hasBom !== undefined ? { hasBom: result.hasBom } : {}),
    };
  }
  return {
    ...base,
    status: result.status,
    ...(result.contentBase64 !== undefined ? { contentBase64: result.contentBase64 } : {}),
  };
}

export type FileEditorOverlayMode = "modal" | "fullscreen";

export interface FileEditorRootContext {
  projectId: string;
  projectName: string;
  projectLocation: ProjectLocation;
  rootLabel: string;
  worktreePath?: string;
  remoteServerId?: string;
}

export interface FileEditorBuffer {
  path: string;
  status: ProjectFileReadStatus;
  modifiedAtMs: number;
  content: string;
  binaryContentBase64?: string;
  savedContent: string;
  lineEnding: "lf" | "crlf";
  hasBom: boolean;
  isDirty: boolean;
  isLoading: boolean;
  gitDiff?: FileEditorGitDiffContext;
}

export interface FileEditorGitDiffContext {
  diff: string;
}

export interface FileEditorPendingReveal {
  path: string;
  lineNumber: number;
  /** Monotonic token so re-opening the same path at the same line re-triggers the reveal. */
  token: number;
}

/** Open files for one thread. Session-only; not persisted. */
export interface FileEditorThreadSession {
  rootContext: FileEditorRootContext | null;
  overlayMode: FileEditorOverlayMode | null;
  tabs: string[];
  activePath: string | null;
  previewTab: string | null;
  markdownPreviewPath: string | null;
  buffers: Record<string, FileEditorBuffer>;
  pendingReveal: FileEditorPendingReveal | null;
}

interface FileEditorStoreState {
  rootContext: FileEditorRootContext | null;
  overlayMode: FileEditorOverlayMode | null;
  tabs: string[];
  activePath: string | null;
  previewTab: string | null;
  markdownPreviewPath: string | null;
  buffers: Record<string, FileEditorBuffer>;
  refreshToken: number;
  pendingReveal: FileEditorPendingReveal | null;
  /** Thread that owns the live tabs. Null until the sidebar binding attaches. */
  boundThreadId: string | null;
  /**
   * Bumped by {@link FileEditorStoreState.clearSession} so a read that started
   * before a project/desktop reset cannot land in a later session.
   */
  sessionEpoch: number;
  /** Parked file workspace for threads that are not focused. */
  sessionsByThread: Record<string, FileEditorThreadSession>;
  /** Record which thread owns the live workspace without swapping it. */
  bindLiveThread: (threadId: string) => void;
  /** Snapshot the live workspace under a thread id. */
  captureThreadSession: (threadId: string) => void;
  /** Show a thread's workspace, or an empty one when it has none. */
  restoreThreadSession: (threadId: string) => void;
  setRootContext: (context: FileEditorRootContext | null) => void;
  clearSession: () => void;
  openFile: (
    path: string,
    mode?: FileEditorOverlayMode | null,
    preview?: boolean,
    options?: {
      lineNumber?: number;
      markdownPreview?: boolean;
      gitDiff?: FileEditorGitDiffContext;
    },
  ) => Promise<ReadProjectFileResult>;
  consumeReveal: (token: number) => void;
  pinTab: (path: string) => void;
  setOverlayMode: (mode: FileEditorOverlayMode | null) => void;
  setActivePath: (path: string | null) => void;
  /**
   * Switch to the adjacent open tab in `tabs` order, wrapping at the ends.
   * No-op with fewer than two tabs. Mirrors the tab strip's click-to-activate
   * ({@link setActivePath}).
   */
  cycleTab: (direction: "next" | "previous") => void;
  updateBuffer: (path: string, content: string) => void;
  discardFileChanges: (path: string) => void;
  saveFile: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  renamePath: (oldPath: string, nextPath: string) => void;
  removePath: (path: string) => void;
  bumpRefreshToken: () => void;
  refreshOpenBuffers: () => Promise<void>;
}

/**
 * Per-path timestamps of the most recent user-initiated save. When the
 * watcher fires a tree-changed event within this window we skip refreshing
 * the buffer — the filesystem change came from us, and any read round-trip
 * would just rebuild Monaco's value (dropping focus and causing a blink).
 * Module-local because this isn't state anything needs to re-render on.
 */
const recentlySavedAt = new Map<string, number>();
const SELF_SAVE_SUPPRESS_MS = 1500;

function isRecentlySavedBySelf(path: string): boolean {
  const at = recentlySavedAt.get(path);
  if (at === undefined) return false;
  if (Date.now() - at > SELF_SAVE_SUPPRESS_MS) {
    recentlySavedAt.delete(path);
    return false;
  }
  return true;
}

async function maybeStageResolvedConflict(
  rootContext: FileEditorRootContext,
  path: string,
  savedContent: string,
): Promise<void> {
  if (hasUnresolvedConflicts(savedContent)) return;

  const gitState = useGitStore.getState();
  const isWorktree = Boolean(rootContext.worktreePath);
  const storeKey = rootContext.worktreePath ?? rootContext.projectId;
  const status = isWorktree
    ? gitState.worktreeStatuses[rootContext.worktreePath as string]
    : gitState.statuses[rootContext.projectId];
  const wasConflicted = status?.conflictFiles?.some((file) => file.path === path) ?? false;
  if (!wasConflicted) return;

  gitState.optimisticStageFile(storeKey, path, isWorktree);
  try {
    await readBridge().gitStage({
      projectLocation: rootContext.projectLocation,
      filePath: path,
    });
  } catch (error) {
    captureRendererException(error, { featureArea: "git" });
    // Best-effort: a status refresh elsewhere will reconcile.
  }
}

function buildBuffer(result: ReadProjectFileResult): FileEditorBuffer {
  if (result.status !== "ready") {
    return {
      path: result.path,
      status: result.status,
      modifiedAtMs: result.modifiedAtMs,
      content: "",
      ...(result.contentBase64 !== undefined ? { binaryContentBase64: result.contentBase64 } : {}),
      savedContent: "",
      lineEnding: "lf",
      hasBom: false,
      isDirty: false,
      isLoading: false,
    };
  }

  return {
    path: result.path,
    status: "ready",
    modifiedAtMs: result.modifiedAtMs,
    content: result.content ?? "",
    savedContent: result.content ?? "",
    lineEnding: result.lineEnding ?? "lf",
    hasBom: result.hasBom ?? false,
    isDirty: false,
    isLoading: false,
  };
}

function withGitDiff(
  buffer: FileEditorBuffer,
  gitDiff: FileEditorGitDiffContext | undefined,
): FileEditorBuffer {
  const { gitDiff: _gitDiff, ...rest } = buffer;
  return gitDiff ? { ...rest, gitDiff } : rest;
}

function isRemoteFileEditorContext(
  rootContext: FileEditorRootContext,
): rootContext is FileEditorRootContext & { remoteServerId: string } {
  return typeof rootContext.remoteServerId === "string" && rootContext.remoteServerId.length > 0;
}

function normalizeRootContext(rootContext: FileEditorRootContext): FileEditorRootContext {
  if (!rootContext.remoteServerId) return rootContext;
  return {
    ...rootContext,
    projectLocation: {
      ...rootContext.projectLocation,
      remoteServerId: rootContext.remoteServerId,
    },
  };
}

const EMPTY_FILE_EDITOR_SESSION: FileEditorThreadSession = {
  rootContext: null,
  overlayMode: null,
  tabs: [],
  activePath: null,
  previewTab: null,
  markdownPreviewPath: null,
  buffers: {},
  pendingReveal: null,
};

interface FileOpenOwner {
  threadId: string | null;
  epoch: number;
  rootContext: FileEditorRootContext;
}

function sessionFromLive(state: {
  rootContext: FileEditorRootContext | null;
  overlayMode: FileEditorOverlayMode | null;
  tabs: string[];
  activePath: string | null;
  previewTab: string | null;
  markdownPreviewPath: string | null;
  buffers: Record<string, FileEditorBuffer>;
  pendingReveal: FileEditorPendingReveal | null;
}): FileEditorThreadSession {
  return {
    rootContext: state.rootContext,
    overlayMode: state.overlayMode,
    tabs: state.tabs,
    activePath: state.activePath,
    previewTab: state.previewTab,
    markdownPreviewPath: state.markdownPreviewPath,
    buffers: state.buffers,
    pendingReveal: state.pendingReveal,
  };
}

function sessionMatchesLive(
  state: FileEditorThreadSession & { boundThreadId: string | null },
  session: FileEditorThreadSession,
  threadId: string,
): boolean {
  return (
    state.boundThreadId === threadId &&
    state.rootContext === session.rootContext &&
    state.overlayMode === session.overlayMode &&
    state.tabs === session.tabs &&
    state.activePath === session.activePath &&
    state.previewTab === session.previewTab &&
    state.markdownPreviewPath === session.markdownPreviewPath &&
    state.buffers === session.buffers &&
    state.pendingReveal === session.pendingReveal
  );
}

/** A finished read belongs to the thread that started it, even if focus moved. */
function writeBufferToOwner(
  state: FileEditorStoreState,
  owner: FileOpenOwner,
  openPath: string,
  buffer: FileEditorBuffer,
): Partial<FileEditorStoreState> {
  if (state.sessionEpoch !== owner.epoch) return {};
  const liveOwnsIt =
    state.boundThreadId === owner.threadId &&
    rootContextsEqual(state.rootContext, owner.rootContext);
  if (liveOwnsIt) {
    if (!state.tabs.includes(openPath) && !state.buffers[openPath]) return {};
    return { buffers: { ...state.buffers, [openPath]: buffer } };
  }
  if (!owner.threadId) return {};
  const parked = state.sessionsByThread[owner.threadId];
  if (!parked || !rootContextsEqual(parked.rootContext, owner.rootContext)) return {};
  if (!parked.tabs.includes(openPath) && !parked.buffers[openPath]) return {};
  return {
    sessionsByThread: {
      ...state.sessionsByThread,
      [owner.threadId]: {
        ...parked,
        buffers: { ...parked.buffers, [openPath]: buffer },
      },
    },
  };
}

function dropOpenTabFromOwner(
  state: FileEditorStoreState,
  owner: FileOpenOwner,
  openPath: string,
): Partial<FileEditorStoreState> {
  if (state.sessionEpoch !== owner.epoch) return {};
  const liveOwnsIt =
    state.boundThreadId === owner.threadId &&
    rootContextsEqual(state.rootContext, owner.rootContext);
  if (liveOwnsIt) {
    if (!state.tabs.includes(openPath) && !state.buffers[openPath]) return {};
    const { [openPath]: _dropped, ...buffers } = state.buffers;
    const tabs = state.tabs.filter((tabPath) => tabPath !== openPath);
    return {
      buffers,
      tabs,
      activePath:
        state.activePath === openPath ? (tabs[tabs.length - 1] ?? null) : state.activePath,
      previewTab: state.previewTab === openPath ? null : state.previewTab,
      markdownPreviewPath:
        state.markdownPreviewPath === openPath ? null : state.markdownPreviewPath,
    };
  }
  if (!owner.threadId) return {};
  const parked = state.sessionsByThread[owner.threadId];
  if (!parked || !rootContextsEqual(parked.rootContext, owner.rootContext)) return {};
  if (!parked.tabs.includes(openPath) && !parked.buffers[openPath]) return {};
  const { [openPath]: _dropped, ...buffers } = parked.buffers;
  const tabs = parked.tabs.filter((tabPath) => tabPath !== openPath);
  return {
    sessionsByThread: {
      ...state.sessionsByThread,
      [owner.threadId]: {
        ...parked,
        buffers,
        tabs,
        activePath:
          parked.activePath === openPath ? (tabs[tabs.length - 1] ?? null) : parked.activePath,
        previewTab: parked.previewTab === openPath ? null : parked.previewTab,
        markdownPreviewPath:
          parked.markdownPreviewPath === openPath ? null : parked.markdownPreviewPath,
      },
    },
  };
}

/**
 * File buffers are relative to a filesystem root, not merely a project id.
 * Comparing the location prevents a relocated project (or changed worktree
 * backing location) from retaining stale tree/editor state.
 */
function rootContextsEqual(
  current: FileEditorRootContext | null,
  next: FileEditorRootContext | null,
): boolean {
  if (current === next) return true;
  if (!current || !next) return false;
  return (
    current.projectId === next.projectId &&
    current.worktreePath === next.worktreePath &&
    current.remoteServerId === next.remoteServerId &&
    JSON.stringify(current.projectLocation) === JSON.stringify(next.projectLocation)
  );
}

async function readFileForContext(
  rootContext: FileEditorRootContext,
  path: string,
): Promise<ReadProjectFileResult> {
  return isExternalPath(path)
    ? externalReadAsProjectResult(
        await readBridge().readExternalFile({
          projectLocation: rootContext.projectLocation,
          absolutePath: path,
        }),
      )
    : await readBridge().readProjectFile({
        projectLocation: rootContext.projectLocation,
        path,
      });
}

async function writeFileForContext(
  rootContext: FileEditorRootContext,
  path: string,
  content: string,
  baseModifiedAtMs: number,
): Promise<{ modifiedAtMs: number }> {
  return isExternalPath(path)
    ? await readBridge().writeExternalFile({
        projectLocation: rootContext.projectLocation,
        absolutePath: path,
        content,
        baseModifiedAtMs,
      })
    : await readBridge().writeProjectFile({
        projectLocation: rootContext.projectLocation,
        path,
        content,
        baseModifiedAtMs,
      });
}

/**
 * Compute the next tabs/buffers/previewTab state when opening a file.
 * Handles replacing the existing preview tab at the same position.
 */
function computeTabOpen(
  state: {
    tabs: string[];
    previewTab: string | null;
    buffers: Record<string, FileEditorBuffer>;
    overlayMode: FileEditorOverlayMode | null;
  },
  path: string,
  mode: FileEditorOverlayMode | null | undefined,
  preview: boolean,
) {
  const isAlreadyOpen = state.tabs.includes(path);
  const isCurrentPreview = state.previewTab === path;

  if (preview) {
    // If already open as a permanent tab, just activate — don't demote it
    if (isAlreadyOpen && !isCurrentPreview) {
      return {
        tabs: state.tabs,
        buffers: state.buffers,
        previewTab: state.previewTab,
        overlayMode: mode ?? state.overlayMode,
      };
    }

    const oldPreview = state.previewTab;
    let tabs = state.tabs;
    let buffers = state.buffers;

    if (oldPreview && oldPreview !== path) {
      // Replace old preview at the same position
      const idx = tabs.indexOf(oldPreview);
      tabs = tabs.filter((t) => t !== oldPreview);
      if (!tabs.includes(path)) {
        tabs = [...tabs.slice(0, idx), path, ...tabs.slice(idx)];
      }
      const { [oldPreview]: _, ...rest } = buffers;
      buffers = rest;
    } else if (!isAlreadyOpen) {
      tabs = [...tabs, path];
    }

    return {
      tabs,
      buffers,
      previewTab: path as string | null,
      overlayMode: mode ?? state.overlayMode,
    };
  }

  // Permanent open
  return {
    tabs: isAlreadyOpen ? state.tabs : [...state.tabs, path],
    buffers: state.buffers,
    previewTab: isCurrentPreview ? null : state.previewTab,
    overlayMode: mode ?? state.overlayMode,
  };
}

let revealTokenCounter = 0;

export const useFileEditorStore = create<FileEditorStoreState>((set, get) => ({
  rootContext: null,
  overlayMode: null,
  tabs: [],
  activePath: null,
  previewTab: null,
  markdownPreviewPath: null,
  buffers: {},
  refreshToken: 0,
  pendingReveal: null,
  boundThreadId: null,
  sessionEpoch: 0,
  sessionsByThread: {},
  bindLiveThread: (threadId) =>
    set((state) => (state.boundThreadId === threadId ? {} : { boundThreadId: threadId })),
  captureThreadSession: (threadId) =>
    set((state) => ({
      sessionsByThread: {
        ...state.sessionsByThread,
        [threadId]: sessionFromLive(state),
      },
    })),
  restoreThreadSession: (threadId) =>
    set((state) => {
      const session = state.sessionsByThread[threadId] ?? EMPTY_FILE_EDITOR_SESSION;
      if (sessionMatchesLive(state, session, threadId)) return {};
      return {
        boundThreadId: threadId,
        rootContext: session.rootContext,
        overlayMode: session.overlayMode,
        tabs: session.tabs,
        activePath: session.activePath,
        previewTab: session.previewTab,
        markdownPreviewPath: session.markdownPreviewPath,
        buffers: session.buffers,
        pendingReveal: session.pendingReveal,
      };
    }),
  setRootContext: (rootContext) => {
    const nextRootContext = rootContext ? normalizeRootContext(rootContext) : null;
    set((state) => {
      if (rootContextsEqual(state.rootContext, nextRootContext)) {
        return {};
      }

      return {
        rootContext: nextRootContext,
        overlayMode: null,
        tabs: [],
        activePath: null,
        previewTab: null,
        markdownPreviewPath: null,
        buffers: {},
        pendingReveal: null,
        refreshToken: state.refreshToken + 1,
      };
    });
  },
  clearSession: () =>
    set((state) => ({
      rootContext: null,
      overlayMode: null,
      tabs: [],
      activePath: null,
      previewTab: null,
      markdownPreviewPath: null,
      buffers: {},
      pendingReveal: null,
      refreshToken: state.refreshToken + 1,
      // Invalidate reads that started against the session we just dropped.
      sessionEpoch: state.sessionEpoch + 1,
    })),
  consumeReveal: (token) =>
    set((state) =>
      state.pendingReveal && state.pendingReveal.token === token ? { pendingReveal: null } : {},
    ),
  async openFile(path, mode = "modal", preview = false, options) {
    const rootContext = get().rootContext;
    if (!rootContext) {
      throw new Error("No file editor context is active.");
    }

    // User-initiated opens of relative paths containing ".." (e.g. "../sibling/file"
    // from a worktree) are resolved to absolute against the active worktree root
    // so they route through the unrestricted external read path. This does not
    // affect the strict project-tree browser/search which continues to use
    // normalizeRelativePath on the supervisor.
    const openPath = resolvePathForFileOpen(rootContext, path);

    const owner: FileOpenOwner = {
      threadId: get().boundThreadId,
      epoch: get().sessionEpoch,
      rootContext,
    };
    const lineNumber = options?.lineNumber;
    const markdownPreviewPath = options?.markdownPreview ? openPath : null;
    const reveal: FileEditorPendingReveal | null =
      lineNumber !== undefined && Number.isFinite(lineNumber) && lineNumber > 0
        ? { path: openPath, lineNumber, token: ++revealTokenCounter }
        : null;

    const existing = get().buffers[openPath];
    if (existing && !existing.isLoading) {
      set((state) => {
        const changes = computeTabOpen(state, openPath, mode, preview);
        return {
          ...changes,
          activePath: openPath,
          markdownPreviewPath,
          ...(reveal ? { pendingReveal: reveal } : {}),
          buffers: {
            ...changes.buffers,
            [openPath]: withGitDiff(existing, options?.gitDiff),
          },
        };
      });
      const cachedResult = {
        path: openPath,
        status: existing.status,
        modifiedAtMs: existing.modifiedAtMs,
        ...(existing.status === "ready"
          ? {
              content: existing.content,
              lineEnding: existing.lineEnding,
              hasBom: existing.hasBom,
            }
          : {}),
        ...(existing.binaryContentBase64 !== undefined
          ? { contentBase64: existing.binaryContentBase64 }
          : {}),
      };
      return cachedResult;
    }

    set((state) => {
      const changes = computeTabOpen(state, openPath, mode, preview);
      return {
        ...changes,
        activePath: openPath,
        markdownPreviewPath,
        ...(reveal ? { pendingReveal: reveal } : {}),
        buffers: {
          ...changes.buffers,
          [openPath]: withGitDiff(
            {
              path: openPath,
              status: "ready",
              modifiedAtMs: 0,
              content: "",
              savedContent: "",
              lineEnding: "lf",
              hasBom: false,
              isDirty: false,
              isLoading: true,
            },
            options?.gitDiff,
          ),
        },
      };
    });

    try {
      const result = await readFileForContext(rootContext, openPath);
      const loaded = withGitDiff(buildBuffer(result), options?.gitDiff);
      set((state) => writeBufferToOwner(state, owner, openPath, loaded));
      const applied = get();
      const appliedToLive =
        applied.sessionEpoch === owner.epoch &&
        applied.boundThreadId === owner.threadId &&
        rootContextsEqual(applied.rootContext, owner.rootContext) &&
        applied.buffers[openPath]?.isLoading === false;
      if (appliedToLive) {
        try {
          captureProductEvent("file.opened", {
            overlay_mode: mode ?? "unchanged",
            source: isExternalPath(openPath) ? "external" : "project",
          });
        } catch (error) {
          captureRendererException(error, { featureArea: "analytics" });
        }
      }
      return result;
    } catch (error) {
      set((state) => dropOpenTabFromOwner(state, owner, openPath));
      throw error;
    }
  },
  pinTab: (path) => set((state) => (state.previewTab === path ? { previewTab: null } : {})),
  setOverlayMode: (overlayMode) => set({ overlayMode }),
  setActivePath: (activePath) => set({ activePath }),
  cycleTab: (direction) =>
    set((state) => {
      if (state.tabs.length < 2) return {};
      const currentIndex = state.activePath ? state.tabs.indexOf(state.activePath) : -1;
      const delta = direction === "next" ? 1 : -1;
      // With no active tab, step from the edge so "next" lands on the first tab
      // and "previous" on the last.
      const from = currentIndex === -1 ? (direction === "next" ? -1 : 0) : currentIndex;
      const nextPath = state.tabs[(from + delta + state.tabs.length) % state.tabs.length];
      return nextPath && nextPath !== state.activePath ? { activePath: nextPath } : {};
    }),
  updateBuffer: (path, content) =>
    set((state) => {
      const buffer = state.buffers[path];
      if (!buffer || buffer.status !== "ready") return {};
      return {
        // Editing a preview tab promotes it to permanent
        previewTab: state.previewTab === path ? null : state.previewTab,
        buffers: {
          ...state.buffers,
          [path]: {
            ...buffer,
            content,
            isDirty: content !== buffer.savedContent,
          },
        },
      };
    }),
  discardFileChanges: (path) =>
    set((state) => {
      const buffer = state.buffers[path];
      if (!buffer || buffer.status !== "ready" || !buffer.isDirty) return {};
      return {
        buffers: {
          ...state.buffers,
          [path]: {
            ...buffer,
            content: buffer.savedContent,
            isDirty: false,
          },
        },
      };
    }),
  async saveFile(path) {
    const rootContext = get().rootContext;
    const buffer = get().buffers[path];
    if (!rootContext || !buffer || buffer.status !== "ready" || !buffer.isDirty) {
      return;
    }

    const savedContent = buffer.content;
    const isRemoteContext = isRemoteFileEditorContext(rootContext);
    const result = await writeFileForContext(rootContext, path, savedContent, buffer.modifiedAtMs);
    if (get().rootContext !== rootContext) return;

    if (!isRemoteContext) {
      recentlySavedAt.set(path, Date.now());
    }

    set((state) => {
      const current = state.buffers[path];
      if (!current || current.status !== "ready") return {};
      return {
        buffers: {
          ...state.buffers,
          [path]: {
            ...current,
            modifiedAtMs: result.modifiedAtMs,
            savedContent: current.content,
            isDirty: false,
          },
        },
      };
    });

    if (!isRemoteContext) {
      void maybeStageResolvedConflict(rootContext, path, savedContent);
    }
  },
  closeTab: (path) =>
    set((state) => {
      if (!state.tabs.includes(path)) return {};

      const tabs = state.tabs.filter((tabPath) => tabPath !== path);
      const { [path]: _, ...buffers } = state.buffers;
      const nextActivePath =
        state.activePath === path ? (tabs[tabs.length - 1] ?? null) : state.activePath;

      return {
        tabs,
        buffers,
        activePath: nextActivePath,
        previewTab: state.previewTab === path ? null : state.previewTab,
        markdownPreviewPath: state.markdownPreviewPath === path ? null : state.markdownPreviewPath,
        overlayMode:
          tabs.length === 0 && state.overlayMode !== "fullscreen" ? null : state.overlayMode,
      };
    }),
  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.tabs.length ||
        toIndex >= state.tabs.length
      )
        return {};
      const tabs = [...state.tabs];
      const moved = tabs.splice(fromIndex, 1)[0];
      if (!moved) return {};
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    }),
  renamePath: (oldPath, nextPath) =>
    set((state) => {
      const nextBuffers = { ...state.buffers };

      for (const [bufferPath, buffer] of Object.entries(state.buffers)) {
        if (bufferPath !== oldPath && !bufferPath.startsWith(`${oldPath}/`)) {
          continue;
        }
        delete nextBuffers[bufferPath];
        const remappedPath =
          bufferPath === oldPath ? nextPath : `${nextPath}/${bufferPath.slice(oldPath.length + 1)}`;
        nextBuffers[remappedPath] = { ...buffer, path: remappedPath };
      }

      const remapPath = (p: string | null): string | null => {
        if (!p) return p;
        if (p === oldPath) return nextPath;
        if (p.startsWith(`${oldPath}/`)) return `${nextPath}/${p.slice(oldPath.length + 1)}`;
        return p;
      };

      return {
        buffers: nextBuffers,
        tabs: state.tabs.map((tabPath) => remapPath(tabPath)!),
        activePath: remapPath(state.activePath),
        previewTab: remapPath(state.previewTab),
        markdownPreviewPath: remapPath(state.markdownPreviewPath),
        refreshToken: state.refreshToken + 1,
      };
    }),
  removePath: (path) =>
    set((state) => {
      const tabs = state.tabs.filter(
        (tabPath) => tabPath !== path && !tabPath.startsWith(`${path}/`),
      );
      const buffers = Object.fromEntries(
        Object.entries(state.buffers).filter(
          ([bufferPath]) => bufferPath !== path && !bufferPath.startsWith(`${path}/`),
        ),
      );
      const previewRemoved = state.previewTab === path || state.previewTab?.startsWith(`${path}/`);
      const markdownPreviewRemoved =
        state.markdownPreviewPath === path || state.markdownPreviewPath?.startsWith(`${path}/`);
      return {
        tabs,
        buffers,
        activePath:
          state.activePath === path || state.activePath?.startsWith(`${path}/`)
            ? (tabs[tabs.length - 1] ?? null)
            : state.activePath,
        previewTab: previewRemoved ? null : state.previewTab,
        markdownPreviewPath: markdownPreviewRemoved ? null : state.markdownPreviewPath,
        overlayMode:
          tabs.length === 0 && state.overlayMode !== "fullscreen" ? null : state.overlayMode,
        refreshToken: state.refreshToken + 1,
      };
    }),
  bumpRefreshToken: () => set((state) => ({ refreshToken: state.refreshToken + 1 })),
  async refreshOpenBuffers() {
    const { rootContext, buffers } = get();
    if (!rootContext) return;

    const paths = Object.entries(buffers)
      .filter(([path, buf]) => {
        if (buf.isDirty || buf.isLoading) return false;
        // Previewable binaries (PDF/image/media/office) carry no text content,
        // but they still need mtime re-checks so mounted previews reload when
        // the file changes on disk.
        if (buf.status !== "ready" && buf.status !== "binary") return false;
        // Filesystem events triggered by our own save round-trip don't need
        // to rebuild the buffer — suppress for a short window so Monaco
        // doesn't lose focus / blink on Ctrl+S.
        if (isRecentlySavedBySelf(path)) return false;
        return true;
      })
      .map(([p]) => p);

    if (paths.length === 0) return;

    const results = await Promise.allSettled(
      paths.map((path) =>
        readFileForContext(rootContext, path).then((result) => ({ path, result })),
      ),
    );
    if (get().rootContext !== rootContext) return;

    set((state) => {
      let changed = false;
      const nextBuffers = { ...state.buffers };

      for (const entry of results) {
        if (entry.status !== "fulfilled") continue;
        const { path, result } = entry.value;
        const current = nextBuffers[path];
        // Skip if the buffer was modified by the user while we were reading
        if (!current || current.isDirty) continue;

        // Binary buffers have no text to diff — on-disk identity is path +
        // mtime. Rebuild on change so mounted previews remount instead of
        // showing stale bytes.
        if (current.status !== "ready") {
          if (result.status !== current.status || result.modifiedAtMs !== current.modifiedAtMs) {
            nextBuffers[path] = withGitDiff(buildBuffer(result), current.gitDiff);
            changed = true;
          }
          continue;
        }

        // Fast path: on-disk content matches what the editor shows. Refresh
        // mtime/savedContent in-place so the next compare short-circuits,
        // but don't swap the buffer object out from under Monaco — a prop
        // change there drops focus and causes a visible blink.
        if (result.status === "ready" && result.content === current.content) {
          if (
            result.modifiedAtMs !== current.modifiedAtMs ||
            result.content !== current.savedContent
          ) {
            nextBuffers[path] = {
              ...current,
              modifiedAtMs: result.modifiedAtMs,
              savedContent: result.content,
            };
            changed = true;
          }
          continue;
        }

        nextBuffers[path] = withGitDiff(buildBuffer(result), current.gitDiff);
        changed = true;
      }

      return changed ? { buffers: nextBuffers } : {};
    });
  },
}));
