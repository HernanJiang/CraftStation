import { useLayoutEffect } from "react";
import { toast } from "@heroui/react";
import { useFileEditorStore, type FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { FileEditorPane } from "@/renderer/views/FileEditorOverlay/parts/FileEditorPane/FileEditorPane";
import { ProjectTreeView } from "@/renderer/views/FileEditorOverlay/parts/ProjectTreeView/ProjectTreeView";

/**
 * The docked Files tool is a single project-aware workspace: the preview and
 * tree deliberately share the same file-editor root context. Keeping both
 * surfaces here (rather than mounting an editor over the chat area) makes it
 * move, resize, collapse, and maximize with the right tools panel.
 */
export function ProjectFilesPanel(props: { rootContext: FileEditorRootContext }) {
  const setRootContext = useFileEditorStore((state) => state.setRootContext);
  const pinTab = useFileEditorStore((state) => state.pinTab);

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

  return (
    <div className="flex h-full min-h-0 min-w-0 bg-[var(--content-background)]">
      <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <FileEditorPane showTabs={false} />
      </section>
      <aside className="flex min-h-0 w-[clamp(220px,35%,320px)] shrink-0 flex-col border-l border-[color:var(--border)] bg-[var(--content-background)]">
        <ProjectTreeView
          rootContext={props.rootContext}
          onSelectFile={handleSelectFile}
          onPinFile={pinTab}
        />
      </aside>
    </div>
  );
}
