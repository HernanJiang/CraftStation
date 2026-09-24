import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "./appStore";
import { useFileEditorStore } from "./fileEditorStore";
import { usePanelStore } from "./panelStore";
import { installThreadSidebarBinding } from "./threadSidebarBinding";

function focusThread(threadId: string | null) {
  if (!threadId) {
    useAppStore.setState({ view: { kind: "home" }, focusedPaneId: null });
    return;
  }
  useAppStore.setState({
    view: { kind: "thread", panes: [threadId] },
    focusedPaneId: threadId,
  });
}

describe("threadSidebarBinding", () => {
  afterEach(() => {
    focusThread(null);
    usePanelStore.setState({
      auxiliaryPanelPlacement: "hidden",
      auxiliaryPanelTab: null,
      auxiliaryPanelTabs: [],
      filesPanelContext: null,
      threadAuxiliaryPanels: {},
      browserPanelOpen: false,
      rightPanelTab: "files",
    });
    useFileEditorStore.setState({
      rootContext: null,
      overlayMode: null,
      tabs: [],
      activePath: null,
      previewTab: null,
      markdownPreviewPath: null,
      buffers: {},
      pendingReveal: null,
      boundThreadId: null,
      sessionsByThread: {},
    });
  });

  it("gives each thread its own files and sidebar", () => {
    focusThread(null);
    const unsubscribe = installThreadSidebarBinding();
    try {
      focusThread("thread-a");
      usePanelStore.getState().setAuxiliaryPanelPlacement("right");
      usePanelStore.getState().setAuxiliaryPanelTab("files");
      usePanelStore.getState().setFilesPanelContext({
        projectId: "paper",
        projectName: "Paper",
        rootLabel: "Paper",
      });
      useFileEditorStore.setState({
        tabs: ["iclr2027_conference.pdf"],
        activePath: "iclr2027_conference.pdf",
      });

      focusThread("thread-b");
      expect(usePanelStore.getState().auxiliaryPanelPlacement).toBe("hidden");
      expect(usePanelStore.getState().filesPanelContext).toBeNull();
      expect(useFileEditorStore.getState().tabs).toEqual([]);

      usePanelStore.getState().setAuxiliaryPanelPlacement("right");
      usePanelStore.getState().setAuxiliaryPanelTab("browser");
      usePanelStore.getState().setBrowserPanelOpen(true);
      useFileEditorStore.setState({ tabs: ["EQ_UNIBENCH.md"], activePath: "EQ_UNIBENCH.md" });

      focusThread("thread-a");
      expect(useFileEditorStore.getState().activePath).toBe("iclr2027_conference.pdf");
      expect(useFileEditorStore.getState().tabs).toEqual(["iclr2027_conference.pdf"]);
      expect(usePanelStore.getState().auxiliaryPanelTab).toBe("files");
      expect(usePanelStore.getState().filesPanelContext?.projectId).toBe("paper");
      expect(usePanelStore.getState().browserPanelOpen).toBe(false);

      focusThread("thread-b");
      expect(useFileEditorStore.getState().tabs).toEqual(["EQ_UNIBENCH.md"]);
      expect(usePanelStore.getState().auxiliaryPanelTab).toBe("browser");
      expect(usePanelStore.getState().browserPanelOpen).toBe(true);
      expect(usePanelStore.getState().filesPanelContext).toBeNull();
    } finally {
      unsubscribe();
    }
  });
});
