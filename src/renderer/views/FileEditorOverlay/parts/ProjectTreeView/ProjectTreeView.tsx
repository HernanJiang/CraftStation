import { useEffect, useRef } from "react";
import { Tooltip, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ChevronsDownUp,
  CircleAlert,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ProjectTreeEntry } from "@/shared/contracts";
import { ContextMenu, PixelLoader } from "@/renderer/components/common";
import { useScrollFade } from "@/renderer/hooks/useScrollFade";
import { useAppStore } from "@/renderer/state/appStore";
import { useFindFocusStore } from "@/renderer/state/findFocusStore";
import type { FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import {
  useIsDropTarget,
  useIsPathLoading,
  useProjectTreeStore,
} from "@/renderer/state/projectTreeStore";
import { InlineDraftRow } from "./parts/InlineDraftRow";
import { TreeEntryRow } from "./parts/TreeEntryRow";
import { useProjectTree } from "./parts/useProjectTree";
import type { TreeDraftState } from "./parts/useProjectTree";

type ProjectTreeRow =
  | { kind: "entry"; entry: ProjectTreeEntry; depth: number }
  | { kind: "draft"; parentPath: string; draft: TreeDraftState; depth: number }
  | { kind: "loading"; parentPath: string; depth: number };

export function ProjectTreeView(props: {
  rootContext: FileEditorRootContext;
  onSelectFile: (path: string) => void;
  onPinFile?: (path: string) => void;
}) {
  const { t } = useLingui();
  const tree = useProjectTree(props);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const treeFocusToken = useFindFocusStore((state) => state.treeFocusToken);
  const lastTreeFocusToken = useRef(treeFocusToken);
  useEffect(() => {
    if (treeFocusToken === lastTreeFocusToken.current) return;
    lastTreeFocusToken.current = treeFocusToken;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [treeFocusToken]);
  const rootIsDropTarget = useIsDropTarget("");
  const rootLoading = useIsPathLoading("");
  const { setScrollContainer, scrollRef, scrollFadeStyle } = useScrollFade<HTMLDivElement>({
    maxFadePx: 10,
  });
  const directoryEntries = useProjectTreeStore((s) => s.directoryEntries);
  const expandedPaths = useProjectTreeStore((s) => s.expandedPaths);
  const loadingPaths = useProjectTreeStore((s) => s.loadingPaths);
  const isAnyDirectoryLoaded = useProjectTreeStore(
    (s) => Object.keys(s.directoryEntries).length > 0,
  );
  const rows = flattenProjectTreeRows({
    directoryEntries,
    expandedPaths,
    loadingPaths,
    draft: tree.draft,
  });
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24,
    overscan: 16,
  });

  const project = useAppStore((s) => s.projects.find((p) => p.id === props.rootContext.projectId));
  const projectName = project?.name ?? props.rootContext.projectId;

  return (
    <ContextMenu
      items={[
        ...(props.rootContext.remoteServerId
          ? []
          : [
              {
                id: "reveal-root",
                label: t`Reveal in File Explorer`,
                icon: <FolderOpen className="size-3.5" />,
              },
            ]),
        { id: "new-file", label: t`New File`, icon: <FilePlus className="size-3.5" /> },
        { id: "new-folder", label: t`New Folder`, icon: <FolderPlus className="size-3.5" /> },
        {
          id: "collapse-all",
          label: t`Collapse All`,
          icon: <ChevronsDownUp className="size-3.5" />,
        },
        { id: "refresh", label: t`Refresh`, icon: <RefreshCw className="size-3.5" /> },
      ]}
      onAction={(action) => {
        void tree.handleRootAction(action);
      }}
    >
      <div
        className="flex h-full min-h-0 flex-col bg-inherit"
        onDragOver={(event) => {
          event.preventDefault();
          useProjectTreeStore.getState().setDropTargetPath("");
        }}
        onDragLeave={() => {
          if (useProjectTreeStore.getState().dropTargetPath === "") {
            useProjectTreeStore.getState().setDropTargetPath(null);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          useProjectTreeStore.getState().setDropTargetPath(null);
          const payload = event.dataTransfer.getData("application/craftstation-project-tree");
          if (!payload) return;
          try {
            const { path } = JSON.parse(payload) as { path: string };
            void tree
              .handleMovePath(path, "")
              .catch((error) =>
                toast.danger(error instanceof Error ? error.message : String(error)),
              );
          } catch {
            // ignore malformed drops
          }
        }}
      >
        {/* Workspace Project Header */}
        <div className="flex items-center justify-between border-b border-[color:var(--border)] px-2.5 py-1.5 text-xs">
          <div className="flex min-w-0 items-center gap-1.5 truncate font-medium text-foreground">
            <Folder className="size-3.5 shrink-0 text-muted" />
            <span className="truncate">{projectName}</span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 text-muted">
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  onClick={() => void tree.handleRootAction("new-file")}
                  className="flex size-5 items-center justify-center rounded text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
                  aria-label={t`New File`}
                >
                  <FilePlus className="size-3.5" />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom">
                <Trans>New File</Trans>
              </Tooltip.Content>
            </Tooltip>
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  onClick={() => void tree.handleRootAction("new-folder")}
                  className="flex size-5 items-center justify-center rounded text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
                  aria-label={t`New Folder`}
                >
                  <FolderPlus className="size-3.5" />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom">
                <Trans>New Folder</Trans>
              </Tooltip.Content>
            </Tooltip>
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  onClick={() => void tree.handleRootAction("collapse-all")}
                  className="flex size-5 items-center justify-center rounded text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
                  aria-label={t`Collapse all folders`}
                >
                  <ChevronsDownUp className="size-3.5" />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom">
                <Trans>Collapse all folders</Trans>
              </Tooltip.Content>
            </Tooltip>
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  onClick={() => void tree.handleRootAction("refresh")}
                  className="flex size-5 items-center justify-center rounded text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
                  aria-label={t`Refresh`}
                >
                  <RefreshCw className="size-3.5" />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom">
                <Trans>Refresh</Trans>
              </Tooltip.Content>
            </Tooltip>
          </div>
        </div>

        {/* Filter Input */}
        <div className="flex items-center gap-1.5 px-2 py-2">
          <div
            data-craftstation-find-scope="tree"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-white/[0.03] px-2 py-1 text-xs text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground focus-within:border-accent/40 focus-within:bg-[var(--row-active)] focus-within:text-foreground"
          >
            <Search className="size-3.5 shrink-0 text-muted" />
            <input
              ref={searchInputRef}
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted"
              placeholder={t`Filter files…`}
              value={tree.searchQuery}
              onChange={(event) => tree.setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && tree.searchQuery) {
                  event.preventDefault();
                  tree.setSearchQuery("");
                }
              }}
            />
            {tree.searchQuery && (
              <button
                type="button"
                aria-label={t`Clear search`}
                onClick={() => tree.setSearchQuery("")}
                className="flex size-4 shrink-0 items-center justify-center rounded text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>

        {rootIsDropTarget && (
          <div className="mx-2 mb-1 rounded border border-dashed border-accent/60 bg-accent/10 px-2 py-1 text-center text-xs text-accent">
            <Trans>Drop to move to project root</Trans>
          </div>
        )}

        {tree.draft?.mode === "create" && tree.draft.parentPath === "" ? (
          <div className="px-2 pb-1">
            <InlineDraftRow
              depth={0}
              type={tree.draft.type}
              value={tree.draft.value}
              onChange={(value) => tree.setDraft((state) => (state ? { ...state, value } : state))}
              onCancel={() => tree.setDraft(null)}
              onCommit={(value) => {
                void tree
                  .handleCreateEntry("", tree.draft!.type, value)
                  .catch((error) =>
                    toast.danger(error instanceof Error ? error.message : String(error)),
                  );
              }}
            />
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1 overflow-hidden" style={scrollFadeStyle}>
          {tree.searchQuery ? (
            <div className="h-full overflow-y-auto overflow-x-hidden px-1">
              {tree.searchLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted">
                  <PixelLoader size="xs" />
                  <Trans>Searching…</Trans>
                </div>
              ) : tree.searchResults.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted">
                  <Trans>No files found.</Trans>
                </div>
              ) : (
                tree.searchResults.map((entry) => (
                  <TreeEntryRow
                    key={entry.path}
                    entry={entry}
                    rootContext={props.rootContext}
                    canReveal={!props.rootContext.remoteServerId}
                    depth={0}
                    draft={tree.draft}
                    setDraft={tree.setDraft}
                    onSelectFile={() => tree.openSearchResult(entry)}
                    {...(props.onPinFile ? { onPinFile: props.onPinFile } : {})}
                    onToggleDirectory={() => tree.openSearchResult(entry)}
                    onEntryAction={(e, action) => void tree.handleEntryAction(e, action)}
                    onMovePath={tree.handleMovePath}
                    onHandleRename={tree.handleRenameEntry}
                    onHandleCreate={tree.handleCreateEntry}
                    renderChildren={false}
                  />
                ))
              )}
            </div>
          ) : (
            <div ref={setScrollContainer} className="h-full overflow-y-auto overflow-x-hidden px-1">
              {rootLoading && !isAnyDirectoryLoaded ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted">
                  <PixelLoader size="xs" />
                  <Trans>Loading workspace…</Trans>
                </div>
              ) : tree.rootLoadError ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <CircleAlert className="size-4 text-amber-400" />
                  <div className="text-xs font-medium text-foreground">
                    <Trans>Unable to read workspace</Trans>
                  </div>
                  <p className="max-w-full break-words text-[11px] leading-4 text-muted">
                    {tree.rootLoadError}
                  </p>
                  <button
                    type="button"
                    onClick={() => void tree.retryRoot()}
                    className="rounded-md border border-[color:var(--border)] px-2 py-1 text-xs text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
                  >
                    <Trans>Retry</Trans>
                  </button>
                </div>
              ) : rows.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted">
                  <Trans>Empty workspace</Trans>
                </div>
              ) : (
                <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    if (!row) return null;
                    const rowKey =
                      row.kind === "entry" ? row.entry.path : `${row.kind}:${row.parentPath}`;
                    return (
                      <div
                        key={rowKey}
                        className="absolute left-0 top-0 w-full"
                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                      >
                        <ProjectTreeVirtualRow
                          row={row}
                          rootContext={props.rootContext}
                          canReveal={!props.rootContext.remoteServerId}
                          draft={tree.draft}
                          setDraft={tree.setDraft}
                          onSelectFile={(path) => void tree.handleSelectFile(path)}
                          {...(props.onPinFile ? { onPinFile: props.onPinFile } : {})}
                          onToggleDirectory={(path) => void tree.toggleDirectory(path)}
                          onEntryAction={(entry, action) =>
                            void tree.handleEntryAction(entry, action)
                          }
                          onMovePath={tree.handleMovePath}
                          onHandleRename={tree.handleRenameEntry}
                          onHandleCreate={tree.handleCreateEntry}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ContextMenu>
  );
}

function flattenProjectTreeRows(input: {
  directoryEntries: Record<string, ProjectTreeEntry[]>;
  expandedPaths: Record<string, boolean>;
  loadingPaths: Record<string, boolean>;
  draft: TreeDraftState | null;
}): ProjectTreeRow[] {
  const rows: ProjectTreeRow[] = [];

  const visit = (parentPath: string, depth: number) => {
    const draft = input.draft;
    if (draft?.mode === "create" && draft.parentPath === parentPath) {
      rows.push({ kind: "draft", parentPath, draft, depth });
    }
    const entries = input.directoryEntries[parentPath] ?? [];
    if (input.loadingPaths[parentPath] && entries.length === 0) {
      rows.push({ kind: "loading", parentPath, depth });
      return;
    }
    for (const entry of entries) {
      rows.push({ kind: "entry", entry, depth });
      if (entry.type === "directory" && input.expandedPaths[entry.path]) {
        visit(entry.path, depth + 1);
      }
    }
  };

  visit("", 0);
  return rows;
}

function ProjectTreeVirtualRow(props: {
  row: ProjectTreeRow;
  rootContext?: FileEditorRootContext | undefined;
  canReveal: boolean;
  draft: TreeDraftState | null;
  setDraft: React.Dispatch<React.SetStateAction<TreeDraftState | null>>;
  onSelectFile: (path: string) => void;
  onPinFile?: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onEntryAction: (entry: ProjectTreeEntry, action: string) => void;
  onMovePath: (sourcePath: string, nextParentPath: string) => Promise<void>;
  onHandleRename: (path: string, nextName: string) => Promise<void>;
  onHandleCreate: (parentPath: string, type: "file" | "directory", value: string) => Promise<void>;
}) {
  const { row, ...rowProps } = props;
  if (row.kind === "loading") {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted"
        style={{ paddingLeft: `${row.depth * 14 + 6}px` }}
      >
        <PixelLoader size="xs" />
        <Trans>Loading…</Trans>
      </div>
    );
  }
  if (row.kind === "draft") {
    return (
      <InlineDraftRow
        depth={row.depth}
        type={row.draft.type}
        value={row.draft.value}
        onChange={(value) => rowProps.setDraft((state) => (state ? { ...state, value } : state))}
        onCancel={() => rowProps.setDraft(null)}
        onCommit={(value) => {
          void rowProps
            .onHandleCreate(row.parentPath, row.draft.type, value)
            .catch((error) => toast.danger(error instanceof Error ? error.message : String(error)));
        }}
      />
    );
  }
  return (
    <TreeEntryRow
      entry={row.entry}
      rootContext={rowProps.rootContext}
      canReveal={rowProps.canReveal}
      depth={row.depth}
      draft={rowProps.draft}
      setDraft={rowProps.setDraft}
      onSelectFile={rowProps.onSelectFile}
      {...(rowProps.onPinFile ? { onPinFile: rowProps.onPinFile } : {})}
      onToggleDirectory={rowProps.onToggleDirectory}
      onEntryAction={rowProps.onEntryAction}
      onMovePath={rowProps.onMovePath}
      onHandleRename={rowProps.onHandleRename}
      onHandleCreate={rowProps.onHandleCreate}
      renderChildren={false}
    />
  );
}
