import { useLayoutEffect, useState } from "react";
import { toast } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Folder, PanelLeftOpen } from "lucide-react";
import { useFileEditorStore, type FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { FileEditorPane } from "@/renderer/views/FileEditorOverlay/parts/FileEditorPane/FileEditorPane";
import { ProjectTreeView } from "@/renderer/views/FileEditorOverlay/parts/ProjectTreeView/ProjectTreeView";

const TREE_WIDTH_STORAGE_KEY = "craftstation.projectFiles.treeWidthPx";
const TREE_WIDTH_DEFAULT_PX = 280;
const TREE_WIDTH_MIN_PX = 200;
const TREE_WIDTH_MAX_PX = 560;
const TREE_RESIZE_STEP_PX = 24;

function clampTreeWidth(width: number): number {
  if (!Number.isFinite(width)) return TREE_WIDTH_DEFAULT_PX;
  return Math.min(TREE_WIDTH_MAX_PX, Math.max(TREE_WIDTH_MIN_PX, Math.round(width)));
}

function readStoredTreeWidth(): number {
  try {
    const raw = window.localStorage.getItem(TREE_WIDTH_STORAGE_KEY);
    if (raw == null) return TREE_WIDTH_DEFAULT_PX;
    return clampTreeWidth(Number(raw));
  } catch {
    return TREE_WIDTH_DEFAULT_PX;
  }
}

/**
 * The docked Files tool is a single project-aware workspace: the preview and
 * tree deliberately share the same file-editor root context. Keeping both
 * surfaces here (rather than mounting an editor over the chat area) makes it
 * move, resize, collapse, and maximize with the right tools panel.
 */
export function ProjectFilesPanel(props: { rootContext: FileEditorRootContext }) {
  const { t } = useLingui();
  const setRootContext = useFileEditorStore((state) => state.setRootContext);
  const pinTab = useFileEditorStore((state) => state.pinTab);
  const [treeWidth, setTreeWidth] = useState(readStoredTreeWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);

  // Layout effects run before paint, so a project switch cannot show the
  // previous project's preview in the new project's file workspace for a frame.
  useLayoutEffect(() => {
    setRootContext(props.rootContext);
  }, [props.rootContext, setRootContext]);

  function handleSelectFile(path: string) {
    void useFileEditorStore
      .getState()
      // Do not open the legacy central overlay from a docked workspace. The
      // preview is the left half of this very panel.
      .openFile(path, null, true)
      .catch((error) => toast.danger(error instanceof Error ? error.message : String(error)));
  }

  function handleTreeResizeStart(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = treeWidth;
    // Latest rendered width; persisted on release so a coalesced final
    // mousemove cannot leave storage behind the visible size.
    let latest = startWidth;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";
    setIsResizing(true);
    const onMove = (e: MouseEvent) => {
      // Handle sits on the LEFT edge of a panel anchored to the RIGHT side;
      // dragging left (negative delta) grows the panel.
      latest = clampTreeWidth(startWidth + (startX - e.clientX));
      setTreeWidth(latest);
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setIsResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      persistTreeWidth(latest);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Keyboard equivalent of dragging: the handle sits on the tree's left
  // edge, so ArrowLeft (drag left) grows the tree and ArrowRight shrinks it.
  function handleTreeResizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      persistTreeWidth(treeWidth + TREE_RESIZE_STEP_PX);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      persistTreeWidth(treeWidth - TREE_RESIZE_STEP_PX);
    }
  }

  function persistTreeWidth(next: number) {
    const clamped = clampTreeWidth(next);
    setTreeWidth(clamped);
    try {
      window.localStorage.setItem(TREE_WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // Private-mode storage failures must not break the resize itself.
    }
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 bg-[var(--content-background)]">
      <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <FileEditorPane showTabs />
      </section>
      {treeCollapsed ? (
        <button
          type="button"
          onClick={() => setTreeCollapsed(false)}
          aria-label={t`Show directory`}
          className="absolute top-1 right-2 z-30 flex h-6 items-center gap-1 rounded-md border border-[color:var(--border)] bg-[var(--content-background)] px-2 text-xs text-foreground shadow-md"
        >
          <Folder className="size-3.5 text-muted" />
          <span>{t`Show directory`}</span>
          <PanelLeftOpen className="size-3.5 text-muted" />
        </button>
      ) : (
        <aside
          className="relative flex min-h-0 shrink-0 flex-col border-l border-[color:var(--border)] bg-[var(--content-background)]"
          style={{ width: treeWidth }}
        >
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={t`Resize file list`}
            className="absolute top-0 bottom-0 left-0 z-10 w-1.5 cursor-ew-resize transition-colors hover:bg-foreground/15"
            onMouseDown={handleTreeResizeStart}
            onKeyDown={handleTreeResizeKeyDown}
          />
          <ProjectTreeView
            rootContext={props.rootContext}
            onSelectFile={handleSelectFile}
            onPinFile={pinTab}
            onCollapseTree={() => setTreeCollapsed(true)}
          />
        </aside>
      )}
      {isResizing ? (
        <div className="fixed inset-0 z-[100]" style={{ cursor: "ew-resize" }} aria-hidden />
      ) : null}
    </div>
  );
}
