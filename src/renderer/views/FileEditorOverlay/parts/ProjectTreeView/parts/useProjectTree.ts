import { useEffect, useRef, useState } from "react";
import { toast } from "@heroui/react";
import type { ProjectTreeEntry } from "@/shared/contracts";
import { getBasename } from "@/shared/pathUtils";
import { resolveSearchConfig } from "@/shared/searchExclude";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useFileEditorStore, type FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { useProjectTreeStore } from "@/renderer/state/projectTreeStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { resolveAbsolutePath } from "@/renderer/utils/resolveAbsolutePath";

export interface TreeDraftState {
  mode: "create" | "rename";
  type: "file" | "directory";
  parentPath: string;
  path?: string;
  value: string;
}

export function useProjectTree(props: {
  rootContext: FileEditorRootContext;
  onSelectFile: (path: string) => void;
  onPinFile?: (path: string) => void;
}) {
  const remoteServerId = props.rootContext.remoteServerId;
  const refreshToken = useFileEditorStore((state) => state.refreshToken);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProjectTreeEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [draft, setDraft] = useState<TreeDraftState | null>(null);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const rootLoadQueuedFor = useRef<string | null>(null);

  const globalUseIgnoreFiles = useSharedSettings((s) => s.searchUseIgnoreFiles);
  const globalExclude = useSharedSettings((s) => s.searchExclude);
  const projectSearchSettings = useAppStore(
    (s) => s.projects.find((p) => p.id === props.rootContext.projectId)?.searchSettings,
  );

  // A project can be relocated without changing its id or worktree path. Include
  // the resolved filesystem location so the tree never reuses another root's
  // cached rows after the active project scope changes.
  const rootKey = getRootContextKey(props.rootContext);

  async function reloadPaths(paths: string[]) {
    const uniquePaths = [...new Set(paths.flatMap((path) => [getParentPath(path), path]))];
    const treeStore = useProjectTreeStore.getState();
    const generation = treeStore.generation;
    for (const path of uniquePaths) treeStore.setLoading(path, true);

    const results = await Promise.allSettled(
      uniquePaths.map(async (path) => {
        try {
          return {
            path,
            result: await readBridge().listProjectTree({
              projectLocation: props.rootContext.projectLocation,
              directoryPath: path,
            }),
          };
        } catch (error) {
          if (path && isMissingPathError(error)) {
            return { path, result: { directoryPath: path, entries: [] } };
          }
          throw error;
        }
      }),
    );

    if (useProjectTreeStore.getState().generation !== generation) return;
    const resolved = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failures = results.flatMap((result, index) => {
      if (result.status === "fulfilled") return [];
      return [{ path: uniquePaths[index]!, message: formatTreeLoadError(result.reason) }];
    });

    setLoadErrors((previous) => {
      const next = { ...previous };
      for (const path of uniquePaths) delete next[path];
      for (const failure of failures) next[failure.path] = failure.message;
      return next;
    });

    if (resolved.length > 0) {
      useProjectTreeStore
        .getState()
        .setDirectoryEntries(
          Object.fromEntries(resolved.map((item) => [item.path, item.result.entries])),
        );
    }
    useProjectTreeStore.getState().clearLoadingFor(uniquePaths);

    // A failure used to be converted into an empty result, which made a missing
    // or inaccessible project look exactly like an empty workspace. Keep the
    // toast for immediate feedback, but preserve the error in the tree so the
    // user has a visible retry path.
    if (failures.length > 0) {
      toast.danger(failures[0]!.message);
    }
  }

  useEffect(() => {
    useProjectTreeStore.getState().resetForRoot(rootKey);
    setDraft(null);
    setSearchQuery("");
    setSearchResults([]);
    setLoadErrors({});
    rootLoadQueuedFor.current = rootKey;
    void reloadPaths([""]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- root changes must reset and load exactly once; reloadPaths reads the matching render's root context.
  }, [rootKey]);

  useEffect(() => {
    // The root-context effect above already loads the root on mount/scope
    // changes. Without this guard React queues the same request a second time
    // via refreshToken, producing duplicate IPC calls and duplicate errors.
    if (rootLoadQueuedFor.current === rootKey) {
      rootLoadQueuedFor.current = null;
      return;
    }
    const paths = Object.keys(useProjectTreeStore.getState().directoryEntries);
    void reloadPaths(paths.length > 0 ? paths : [""]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, rootKey]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      useProjectTreeStore.getState().setCommittedSearchQuery("");
      return;
    }

    setSearchLoading(true);
    const handle = setTimeout(() => {
      useProjectTreeStore.getState().setCommittedSearchQuery(trimmed);
      const searchConfig = resolveSearchConfig({
        globalUseIgnoreFiles,
        globalExclude,
        projectUseIgnoreFiles: projectSearchSettings?.useIgnoreFiles,
        projectExclude: projectSearchSettings?.exclude,
      });
      void readBridge()
        .searchProjectTree({
          projectLocation: props.rootContext.projectLocation,
          query: searchQuery,
          limit: 50,
          searchConfig,
        })
        .then((result) => setSearchResults(result.entries))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 120);

    return () => clearTimeout(handle);
  }, [
    props.rootContext.projectLocation,
    searchQuery,
    globalUseIgnoreFiles,
    globalExclude,
    projectSearchSettings,
  ]);

  async function toggleDirectory(path: string) {
    const treeStore = useProjectTreeStore.getState();
    const isExpanded = treeStore.expandedPaths[path] ?? false;
    if (!isExpanded && !(path in treeStore.directoryEntries)) {
      await reloadPaths([path]);
    }
    treeStore.toggleExpanded(path);
  }

  function ensureActiveBufferCanChange(nextPath: string): boolean {
    const store = useFileEditorStore.getState();
    const activePath = store.activePath;
    const activeBuffer = activePath ? store.buffers[activePath] : undefined;
    if (
      !activePath ||
      activePath === nextPath ||
      !activeBuffer ||
      activeBuffer.status !== "ready" ||
      !activeBuffer.isDirty
    ) {
      return true;
    }
    if (!window.confirm(`Discard unsaved changes in ${activePath}?`)) {
      return false;
    }
    store.discardFileChanges(activePath);
    return true;
  }

  async function handleSelectFile(path: string) {
    if (!ensureActiveBufferCanChange(path)) return;
    props.onSelectFile(path);
  }

  async function handleCopyAbsolutePath(path: string) {
    await navigator.clipboard.writeText(
      resolveAbsolutePath(props.rootContext.projectLocation, path),
    );
  }

  async function handleCreateEntry(parentPath: string, type: "file" | "directory", name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    await readBridge().createProjectEntry({
      projectLocation: props.rootContext.projectLocation,
      path: nextPath,
      type,
    });
    useFileEditorStore.getState().bumpRefreshToken();
    setDraft(null);
    if (type === "file") {
      await handleSelectFile(nextPath);
      props.onPinFile?.(nextPath);
    }
  }

  async function handleRenameEntry(path: string, nextName: string) {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const nextPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    await readBridge().renameProjectEntry({
      projectLocation: props.rootContext.projectLocation,
      path,
      nextName: trimmed,
    });
    useFileEditorStore.getState().renamePath(path, nextPath);
    setDraft(null);
  }

  async function handleDeleteEntry(entry: ProjectTreeEntry) {
    if (!window.confirm(`Delete ${entry.path}?`)) return;
    await readBridge()
      .deleteProjectEntry({
        projectLocation: props.rootContext.projectLocation,
        path: entry.path,
      })
      .catch((error: unknown) => {
        if (!isMissingPathError(error)) throw error;
      });
    useFileEditorStore.getState().removePath(entry.path);
    if (entry.type === "directory") {
      useProjectTreeStore.getState().setDirectoryEntries({ [entry.path]: [] });
    }
    await reloadPaths([getParentPath(entry.path)]);
  }

  async function handleMovePath(sourcePath: string, nextParentPath: string) {
    await readBridge().moveProjectEntry({
      projectLocation: props.rootContext.projectLocation,
      path: sourcePath,
      nextParentPath,
    });
    const currentName = getBasename(sourcePath);
    if (!currentName) return;
    const nextPath = nextParentPath ? `${nextParentPath}/${currentName}` : currentName;
    useFileEditorStore.getState().renamePath(sourcePath, nextPath);
  }

  function expandAncestors(path: string) {
    const parts = path.split("/");
    let cursor = "";
    const pathsToExpand = [""];
    const pathsToLoad = [""];
    for (let index = 0; index < parts.length - 1; index += 1) {
      cursor = cursor ? `${cursor}/${parts[index]}` : parts[index]!;
      pathsToExpand.push(cursor);
      pathsToLoad.push(cursor);
    }
    useProjectTreeStore.getState().expandMany(pathsToExpand);
    void reloadPaths(pathsToLoad);
  }

  function openSearchResult(entry: ProjectTreeEntry) {
    expandAncestors(entry.path);
    setSearchQuery("");
    setSearchResults([]);
    if (entry.type === "directory") {
      useProjectTreeStore.getState().setExpanded(entry.path, true);
      void reloadPaths([entry.path]);
      return;
    }
    void handleSelectFile(entry.path);
  }

  async function handleEntryAction(entry: ProjectTreeEntry, action: string) {
    try {
      if (action === "reveal") {
        if (remoteServerId) return;
        await readBridge().revealProjectEntry({
          projectLocation: props.rootContext.projectLocation,
          path: entry.path,
        });
        return;
      }
      if (action === "copy-path") {
        await handleCopyAbsolutePath(entry.path);
        return;
      }
      if (action === "copy-relative-path") {
        await navigator.clipboard.writeText(entry.path);
        return;
      }
      if (action === "rename") {
        setDraft({
          mode: "rename",
          type: entry.type,
          parentPath: entry.path.includes("/")
            ? entry.path.slice(0, entry.path.lastIndexOf("/"))
            : "",
          path: entry.path,
          value: entry.name,
        });
        return;
      }
      if (action === "delete") {
        await handleDeleteEntry(entry);
        return;
      }
      if (action === "new-file") {
        useProjectTreeStore.getState().setExpanded(entry.path, true);
        await reloadPaths([entry.path]);
        setDraft({
          mode: "create",
          type: "file",
          parentPath: entry.path,
          value: "",
        });
        return;
      }
      if (action === "new-folder") {
        useProjectTreeStore.getState().setExpanded(entry.path, true);
        await reloadPaths([entry.path]);
        setDraft({
          mode: "create",
          type: "directory",
          parentPath: entry.path,
          value: "",
        });
      }
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRootAction(action: string) {
    try {
      if (action === "reveal-root") {
        if (remoteServerId) return;
        await readBridge().revealProjectEntry({
          projectLocation: props.rootContext.projectLocation,
          path: "",
        });
        return;
      }
      if (action === "new-file") {
        setDraft({ mode: "create", type: "file", parentPath: "", value: "" });
        return;
      }
      if (action === "new-folder") {
        setDraft({ mode: "create", type: "directory", parentPath: "", value: "" });
        return;
      }
      if (action === "collapse-all") {
        const treeStore = useProjectTreeStore.getState();
        treeStore.collapseAll();
        treeStore.clearDirectoryEntries();
        await reloadPaths([""]);
        return;
      }
      if (action === "refresh") {
        const entries = useProjectTreeStore.getState().directoryEntries;
        await reloadPaths(Object.keys(entries).length > 0 ? Object.keys(entries) : [""]);
        void useFileEditorStore.getState().refreshOpenBuffers();
      }
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    searchLoading,
    draft,
    setDraft,
    toggleDirectory,
    handleSelectFile,
    handleCreateEntry,
    handleRenameEntry,
    handleMovePath,
    handleEntryAction,
    handleRootAction,
    openSearchResult,
    rootLoadError: loadErrors[""] ?? null,
    retryRoot: () => reloadPaths([""]),
  };
}

function getRootContextKey(rootContext: FileEditorRootContext): string {
  const location = rootContext.projectLocation;
  const locationKey =
    location.kind === "wsl"
      ? `${location.kind}:${location.distro}:${location.linuxPath}:${location.uncPath}`
      : `${location.kind}:${location.path}`;
  return `${rootContext.projectId}:${rootContext.worktreePath ?? ""}:${rootContext.remoteServerId ?? ""}:${locationKey}`;
}

function formatTreeLoadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getParentPath(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function isMissingPathError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT") return true;
  }
  return error instanceof Error && /\bENOENT\b/.test(error.message);
}
