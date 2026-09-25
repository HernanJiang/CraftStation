import { useEffect, useRef, useState } from "react";
import { toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FileWarning, FolderOpen } from "lucide-react";
import { MarkdownPreview } from "../MarkdownPreview";
import { Editor, type BeforeMount, type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { macosTrafficLightPadClass } from "@/renderer/components/layout/sidebarChrome";
import {
  useActiveBufferContent,
  useActiveBufferStatus,
  useIsActiveBufferDirty,
  useTabPaths,
} from "@/renderer/state/fileEditorSelectors";
import type { ProjectLocation } from "@/shared/contracts";
import { createLspFileUri } from "@/shared/lsp";
import { getBasename } from "@/shared/pathUtils";
import { getLanguageFromPath, isMarkdownFile } from "./parts/langMap";
import { defineAppThemes, useResolvedTheme } from "./parts/monacoThemes";
import { SortableTab } from "./parts/SortableTab";
import { EditorToolbar } from "./parts/EditorToolbar";
import { useLspSync } from "./parts/useLspSync";
import { useMergeConflictContribution } from "./parts/mergeConflict/useMergeConflictContribution";
import { useGitDiffContribution } from "./parts/gitDiff/useGitDiffContribution";
import { setActiveFindEditor } from "@/renderer/components/find/editorFindBridge";
import { openPdfPreview } from "@/renderer/components/pdf";
import {
  isAudioPath,
  isCsvPath,
  isImagePath,
  isNotebookPath,
  isOfficePath,
  isPdfPath,
  isVideoPath,
  toFileUrl,
  toLocalFileUrl,
} from "@/shared/promptContent";
import { resolveLocalImageDisplayUrl } from "@/shared/localImageDisplay";
import { resolveAbsolutePath } from "@/renderer/utils/resolveAbsolutePath";
import { isRemoteSession, readBridge } from "@/renderer/bridge";
import { CsvPreview } from "./parts/CsvPreview";
import { NotebookPreview } from "./parts/NotebookPreview";
import { OfficePreview } from "./parts/OfficePreview";

export { getLanguageFromPath } from "./parts/langMap";

const EDITOR_OPTIONS: MonacoEditor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  lineHeight: 20,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: "on",
  automaticLayout: true,
  padding: { top: 4, bottom: 4 },
  renderLineHighlightOnlyWhenFocus: true,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    verticalSliderSize: 8,
    horizontalSliderSize: 8,
  },
  contextmenu: true,
  tabSize: 2,
};

export function FileEditorPane(props: {
  showTabs: boolean;
  headerNeedsTrafficLightPad?: boolean;
  onOpenFullscreen?: () => void;
  onClose?: () => void;
}) {
  const { t } = useLingui();
  const activePath = useFileEditorStore((state) => state.activePath);
  const rootProjectLocation = useFileEditorStore(
    (state) => state.rootContext?.projectLocation ?? null,
  );
  const isDirty = useIsActiveBufferDirty();
  const bufferStatus = useActiveBufferStatus();
  const markdownPreviewPath = useFileEditorStore((state) => state.markdownPreviewPath);
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const theme = useResolvedTheme();

  const [showPreview, setShowPreview] = useState(false);

  const isMarkdown = activePath ? isMarkdownFile(activePath) : false;

  const { notifyDidSave } = useLspSync({ monaco: monacoInstance, activePath, bufferStatus });

  useEffect(() => {
    setShowPreview(!!activePath && isMarkdown && markdownPreviewPath === activePath);
  }, [activePath, isMarkdown, markdownPreviewPath]);

  async function handleSave(path: string) {
    try {
      await useFileEditorStore.getState().saveFile(path);
      notifyDidSave(path);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : String(error));
    }
  }

  function handleCloseTab(path: string) {
    const store = useFileEditorStore.getState();
    const tabBuffer = store.buffers[path];
    if (tabBuffer?.status === "ready" && tabBuffer.isDirty) {
      if (!window.confirm(t`Discard unsaved changes in ${path}?`)) {
        return;
      }
      store.discardFileChanges(path);
    }
    store.closeTab(path);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        const path = useFileEditorStore.getState().activePath;
        if (path) {
          e.preventDefault();
          handleCloseTab(path);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && showPreview) {
        const path = useFileEditorStore.getState().activePath;
        if (path) {
          e.preventDefault();
          void handleSave(path);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const monacoTheme = theme === "dark" ? "craftstation-dark" : "craftstation-light";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--content-background)]">
      {props.showTabs ? (
        <TabStripHeader
          isDirty={isDirty}
          isMarkdown={isMarkdown}
          showPreview={showPreview}
          setShowPreview={setShowPreview}
          activePath={activePath}
          headerNeedsTrafficLightPad={props.headerNeedsTrafficLightPad ?? false}
          onSave={(path) => void handleSave(path)}
          handleCloseTab={handleCloseTab}
          {...(props.onOpenFullscreen ? { onOpenFullscreen: props.onOpenFullscreen } : {})}
          {...(props.onClose ? { onClose: props.onClose } : {})}
        />
      ) : null}

      {activePath && bufferStatus ? (
        <>
          {!props.showTabs ? (
            <div
              className={`flex shrink-0 items-center gap-1.5 border-b border-[color:var(--border)] px-3 ${
                props.headerNeedsTrafficLightPad ? macosTrafficLightPadClass : ""
              }`}
              style={{ height: "env(titlebar-area-height, 32px)" }}
            >
              <span className="min-w-0 truncate text-xs font-medium text-foreground">
                {getBasename(activePath)}
                {isDirty ? " *" : ""}
              </span>
              <div className="flex-1" />
              <EditorToolbar
                isMarkdown={isMarkdown}
                showPreview={showPreview}
                setShowPreview={setShowPreview}
                isDirty={isDirty}
                activePath={activePath}
                onSave={() => void handleSave(activePath)}
                {...(props.onOpenFullscreen ? { onOpenFullscreen: props.onOpenFullscreen } : {})}
                {...(props.onClose ? { onClose: props.onClose } : {})}
              />
            </div>
          ) : null}

          <EditorBody
            activePath={activePath}
            projectLocation={rootProjectLocation}
            bufferStatus={bufferStatus}
            monacoTheme={monacoTheme}
            onMonacoReady={setMonacoInstance}
            showPreview={showPreview}
            isMarkdown={isMarkdown}
            onSave={(path) => void handleSave(path)}
          />
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl bg-white/[0.04] text-muted">
            <FolderOpen className="size-5" />
          </div>
          <div className="text-sm font-medium text-foreground">
            <Trans>Open a file</Trans>
          </div>
          <div className="text-xs text-muted">
            <Trans>Select a file from the workspace tree to preview</Trans>
          </div>
        </div>
      )}
    </div>
  );
}

function TabStripHeader(props: {
  isDirty: boolean;
  isMarkdown: boolean;
  showPreview: boolean;
  setShowPreview: React.Dispatch<React.SetStateAction<boolean>>;
  activePath: string | null;
  headerNeedsTrafficLightPad: boolean;
  onSave: (path: string) => void;
  handleCloseTab: (path: string) => void;
  onOpenFullscreen?: () => void;
  onClose?: () => void;
}) {
  const { t } = useLingui();
  const paths = useTabPaths();
  if (paths.length === 0) return null;

  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 border-b border-[color:var(--border)] pl-1 pr-3 ${
        props.headerNeedsTrafficLightPad ? macosTrafficLightPadClass : ""
      }`}
      style={{ height: "env(titlebar-area-height, 32px)" }}
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        role="tablist"
        aria-label={t`Editor tabs`}
        onWheel={(event) => {
          if (event.deltaY !== 0) event.currentTarget.scrollLeft += event.deltaY;
        }}
      >
        {paths.map((path, index) => (
          <SortableTab
            key={path}
            path={path}
            index={index}
            onSelect={() => useFileEditorStore.getState().setActivePath(path)}
            onClose={() => props.handleCloseTab(path)}
            onDoubleClick={() => useFileEditorStore.getState().pinTab(path)}
          />
        ))}
      </div>

      <div className="craftstation-content-over-drag-region flex items-center gap-1.5">
        <EditorToolbar
          isMarkdown={props.isMarkdown}
          showPreview={props.showPreview}
          setShowPreview={props.setShowPreview}
          isDirty={props.isDirty}
          activePath={props.activePath}
          onSave={() => props.activePath && props.onSave(props.activePath)}
          {...(props.onOpenFullscreen ? { onOpenFullscreen: props.onOpenFullscreen } : {})}
          {...(props.onClose ? { onClose: props.onClose } : {})}
        />
      </div>
    </div>
  );
}

function EditorBody(props: {
  activePath: string;
  projectLocation: ProjectLocation | null;
  bufferStatus: NonNullable<ReturnType<typeof useActiveBufferStatus>>;
  monacoTheme: string;
  onMonacoReady: (monaco: Monaco) => void;
  showPreview: boolean;
  isMarkdown: boolean;
  onSave: (path: string) => void;
}) {
  const { activePath, projectLocation, bufferStatus, monacoTheme, showPreview, isMarkdown } = props;
  const content = useActiveBufferContent();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const [editorState, setEditorState] = useState<{
    path: string;
    editor: MonacoEditor.IStandaloneCodeEditor;
    monaco: Monaco;
  } | null>(null);
  const editorInstance = editorState?.path === activePath ? editorState.editor : null;
  const monacoInstance = editorState?.path === activePath ? editorState.monaco : null;
  const pendingReveal = useFileEditorStore((state) => state.pendingReveal);
  const gitDiff = useFileEditorStore((state) => {
    const path = state.activePath;
    if (!path) return null;
    const buffer = state.buffers[path];
    return buffer?.status === "ready" ? (buffer.gitDiff ?? null) : null;
  });
  const isPdf = isPdfPath(activePath);
  const isImage = isImagePath(activePath);
  const isVideo = isVideoPath(activePath);
  const isAudio = isAudioPath(activePath);
  const isCsv = isCsvPath(activePath);
  const isNotebook = isNotebookPath(activePath);
  const isOffice = isOfficePath(activePath);
  // Bumped by refreshOpenBuffers when the file's mtime changes on disk; keys
  // and cache-busted URLs below remount previews instead of showing stale
  // bytes (the watcher only rebuilds non-dirty buffers).
  const previewVersion = useFileEditorStore(
    (state) => state.buffers[activePath]?.modifiedAtMs ?? 0,
  );

  useMergeConflictContribution({ editor: editorInstance, monaco: monacoInstance });
  useGitDiffContribution({ editor: editorInstance, gitDiff, bufferStatus });

  useEffect(() => {
    if (!editorInstance) return;
    setActiveFindEditor(editorInstance);
    const focusSub = editorInstance.onDidFocusEditorText(() => setActiveFindEditor(editorInstance));
    return () => {
      focusSub.dispose();
      setActiveFindEditor(null);
    };
  }, [editorInstance]);

  useEffect(() => {
    if (!pendingReveal || !editorInstance) return;
    if (pendingReveal.path !== activePath) return;
    if (bufferStatus !== "ready") return;
    const { lineNumber, token } = pendingReveal;
    editorInstance.revealLineInCenter(lineNumber);
    editorInstance.setPosition({ lineNumber, column: 1 });
    editorInstance.focus();
    useFileEditorStore.getState().consumeReveal(token);
  }, [pendingReveal, editorInstance, activePath, bufferStatus]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    defineAppThemes(monaco);
  };

  function registerSaveCommand(editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) {
    // eslint-disable-next-line no-bitwise -- Monaco uses bitmask key combos
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = useFileEditorStore.getState().activePath;
      if (path) props.onSave(path);
    });
  }

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    props.onMonacoReady(monaco);
    setEditorState({ path: activePath, editor, monaco });
    registerSaveCommand(editor, monaco);
  };

  const modelPath = projectLocation ? createLspFileUri(projectLocation, activePath) : activePath;

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {isPdf ? (
        <PdfBrowserPlaceholder
          path={activePath}
          projectLocation={projectLocation}
          version={previewVersion}
        />
      ) : isImage && projectLocation ? (
        <ImagePreviewPlaceholder
          path={activePath}
          projectLocation={projectLocation}
          version={previewVersion}
        />
      ) : isVideo ? (
        <VideoPreview
          path={activePath}
          projectLocation={projectLocation}
          version={previewVersion}
        />
      ) : isAudio ? (
        <AudioPreview
          path={activePath}
          projectLocation={projectLocation}
          version={previewVersion}
        />
      ) : isCsv && bufferStatus === "ready" ? (
        <CsvPreview content={content ?? ""} />
      ) : isNotebook && bufferStatus === "ready" ? (
        <NotebookPreview content={content ?? ""} />
      ) : isOffice && projectLocation ? (
        <OfficePreview key={previewVersion} path={activePath} projectLocation={projectLocation} />
      ) : bufferStatus === "ready" && showPreview && isMarkdown ? (
        <MarkdownPreview content={content ?? ""} />
      ) : bufferStatus === "ready" ? (
        <Editor
          path={modelPath}
          language={getLanguageFromPath(activePath)}
          theme={monacoTheme}
          value={content ?? ""}
          onChange={(value) => {
            if (value !== undefined) useFileEditorStore.getState().updateBuffer(activePath, value);
          }}
          beforeMount={handleBeforeMount}
          onMount={handleEditorMount}
          options={EDITOR_OPTIONS}
          loading={
            <div className="flex h-full items-center justify-center text-sm text-muted">
              <Trans>Loading editor…</Trans>
            </div>
          }
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-sm text-muted">
          <FileWarning className="size-8 text-muted/60" />
          <div className="font-medium text-foreground">
            {bufferStatus === "binary" ? (
              <Trans>Binary file cannot be previewed directly.</Trans>
            ) : bufferStatus === "too_large" ? (
              <Trans>This file is too large for the built-in editor.</Trans>
            ) : (
              <Trans>This file uses an unsupported encoding.</Trans>
            )}
          </div>
          <div className="text-xs text-muted">{getBasename(activePath)}</div>
          {projectLocation ? (
            <button
              type="button"
              className="mt-2 rounded-md border border-[color:var(--border)] bg-white/[0.04] px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-[var(--row-hover)]"
              onClick={() => {
                void readBridge()
                  .revealProjectEntry({ projectLocation, path: activePath })
                  .catch(() => {});
              }}
            >
              <Trans>Reveal in File Explorer</Trans>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Same-path media URLs stay byte-identical across writes, so the browser cache
 * would keep serving the previous version. The buffer mtime rides along as a
 * cache-busting query — the protocol handlers resolve only the pathname.
 */
function withCacheBust(url: string, version: number): string {
  return `${url}${url.includes("?") ? "&" : "?"}v=${version}`;
}

function ImagePreviewPlaceholder(props: {
  path: string;
  projectLocation: ProjectLocation | null;
  version: number;
}) {
  const location = props.projectLocation;
  if (!location) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted">
        <Trans>No project location available to load image.</Trans>
      </div>
    );
  }
  const absPath = resolveAbsolutePath(location, props.path);
  const imageUrl = withCacheBust(
    resolveLocalImageDisplayUrl(toLocalFileUrl(absPath)),
    props.version,
  );

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-4 bg-black/20">
      <img
        src={imageUrl}
        alt={getBasename(props.path)}
        className="max-h-full max-w-full rounded-md object-contain shadow-md"
      />
    </div>
  );
}

function mediaSourceUrl(
  path: string,
  projectLocation: ProjectLocation | null,
  version: number,
): string | null {
  if (!projectLocation) return null;
  return withCacheBust(
    resolveLocalImageDisplayUrl(toLocalFileUrl(resolveAbsolutePath(projectLocation, path))),
    version,
  );
}

function VideoPreview(props: {
  path: string;
  projectLocation: ProjectLocation | null;
  version: number;
}) {
  const mediaUrl = mediaSourceUrl(props.path, props.projectLocation, props.version);
  if (!mediaUrl) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted">
        <Trans>No project location available to load video.</Trans>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-black p-4">
      {/* Range seeking on the local-file protocol is best-effort; progressive playback works. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-provided local media ships no caption track */}
      <video
        key={mediaUrl}
        src={mediaUrl}
        title={getBasename(props.path)}
        controls
        preload="metadata"
        className="max-h-full max-w-full"
      />
    </div>
  );
}

function AudioPreview(props: {
  path: string;
  projectLocation: ProjectLocation | null;
  version: number;
}) {
  const mediaUrl = mediaSourceUrl(props.path, props.projectLocation, props.version);
  if (!mediaUrl) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted">
        <Trans>No project location available to load audio.</Trans>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8">
      <p className="max-w-full truncate text-sm text-foreground">{getBasename(props.path)}</p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-provided local media ships no caption track */}
      <audio
        key={mediaUrl}
        src={mediaUrl}
        title={getBasename(props.path)}
        controls
        preload="metadata"
        className="w-full max-w-md"
      />
    </div>
  );
}

function PdfBrowserPlaceholder(props: {
  path: string;
  projectLocation: ProjectLocation | null;
  version: number;
}) {
  const { t } = useLingui();
  const location = props.projectLocation;
  if (!location) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted">
        <Trans>No project location available to load PDF.</Trans>
      </div>
    );
  }
  if (isRemoteSession()) {
    // file:// URLs resolve on the viewer's machine, so a remote session
    // cannot preview inline — the desktop opens it in a browser tab instead.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-muted">
        <p>
          <Trans>PDF preview opens in the browser.</Trans>
        </p>
        <button
          type="button"
          className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-foreground transition-colors hover:bg-[var(--row-hover)]"
          onClick={() => openPdfPreview(props.path, location)}
        >
          {t`Open in browser`}
        </button>
      </div>
    );
  }
  // Inline preview in a <webview> guest over a file:// URL: the exact
  // rendering path the in-app browser tabs use for PDFs (verified working).
  // An <iframe> cannot be used here — the PDF viewer refuses to load inside
  // a sandboxed frame (opaque origin), which painted the blank page. A
  // <webview> paints over normal DOM, so the fallback action lives in the
  // header row above it instead of overlaying it.
  // The `?v=` cache buster keys the guest's cached document on the file's
  // mtime — Chromium resolves only the pathname for file:// URLs, so the
  // query is inert for loading but forces a fresh fetch after each write.
  const fileUrl = withCacheBust(
    toFileUrl(resolveAbsolutePath(location, props.path)),
    props.version,
  );

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--border)] bg-[var(--content-background)] px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {getBasename(props.path)}
        </span>
        <button
          type="button"
          aria-label={t`Open in browser`}
          title={t`Open in browser`}
          className="shrink-0 rounded-md border border-[color:var(--border)] px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-[var(--row-hover)]"
          onClick={() => openPdfPreview(props.path, location)}
        >
          {t`Open in browser`}
        </button>
      </div>
      <webview
        key={fileUrl}
        src={fileUrl}
        title={getBasename(props.path)}
        className="min-h-0 w-full flex-1"
      />
    </div>
  );
}
