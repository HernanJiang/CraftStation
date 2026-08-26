import { Suspense, type ReactNode, useEffect, useRef } from "react";
import { useDroppable } from "@dnd-kit/react";
import { getAppName } from "@/shared/appName";
import { readBridge } from "@/renderer/bridge";
import { PageLayout } from "@/renderer/components/layout/PageLayout";
import { Sidebar } from "@/renderer/views/MainView/parts/Sidebar/Sidebar";
import { AppContent } from "@/renderer/views/MainView/parts/AppContent/AppContent";
import { ConversationErrorBoundary } from "@/renderer/views/MainView/parts/AppContent/ConversationErrorBoundary";
import { MainRightPanel } from "@/renderer/views/MainView/parts/MainRightPanel";
import { MainContentHeaderControls } from "@/renderer/views/MainView/parts/MainContentHeaderControls";
import { MainTitlebar } from "@/renderer/views/MainView/parts/MainTitlebar";
import { MainGitPanel } from "@/renderer/views/MainView/parts/MainGitPanel";
import { BottomDockDropStrip } from "@/renderer/views/MainView/parts/RightPanel/parts/PanelDock/BottomDockDropStrip";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useProjectIds } from "@/renderer/state/useThread";
import { closeAllPanels, dismissRightOverlay } from "@/renderer/actions/panelActions";
import { setMainPanelDropZoneElement, useIsMainPanelDropActive } from "@/renderer/dnd";
import { DeferredFileEditorPanel } from "@/renderer/deferredFeatures";

export function MainPageLayout() {
  const channel = readBridge().channel;
  const isDev = import.meta.env.DEV;
  const auxiliaryPanelPlacement = usePanelStore((state) => state.auxiliaryPanelPlacement);
  const auxiliaryPanelOpen = auxiliaryPanelPlacement !== "hidden";
  const conversationResetKey = useAppStore((state) => {
    const view = state.view;
    if (view.kind !== "thread") return view.kind;
    return `thread:${view.panes.join("|")}`;
  });

  return (
    <PageLayout
      title={getAppName(channel, isDev)}
      globalHeader={<MainTitlebar />}
      hideSidebarHeaderTitle
      onRequestClosePanels={closeAllPanels}
      onDismissRightOverlay={dismissRightOverlay}
      contentHeaderChildren={<MainContentHeaderControls />}
      sidebar={<Sidebar />}
      content={
        <MainPanelDropZone>
          <ConversationErrorBoundary resetKey={conversationResetKey}>
            <AppContent />
          </ConversationErrorBoundary>
          <Suspense>
            <DeferredFileEditorPanel />
          </Suspense>
        </MainPanelDropZone>
      }
      rightPanel={<MainRightPanel />}
      rightPanelOpen={auxiliaryPanelOpen}
      rightPanelPlacement={auxiliaryPanelPlacement === "bottom" ? "bottom" : "right"}
      balanceRightPanelOnOpen={auxiliaryPanelPlacement === "right"}
      balanceBottomPanelOnOpen={auxiliaryPanelPlacement === "bottom"}
      {...(auxiliaryPanelOpen ? {} : { gitPanel: <MainGitPanel /> })}
    />
  );
}

function MainPanelDropZone(props: { children: ReactNode }) {
  const elementRef = useRef<HTMLDivElement>(null);
  // The dnd-kit registration keeps the source from going into "no valid
  // target" cancellation; pointer hit-testing is done by the dnd module via
  // the element registered through `setMainPanelDropZoneElement` below.
  useDroppable({
    id: "main-panel-drop-zone",
    accept: "sidebar-panel",
    data: { type: "main-panel-drop-zone" },
    element: elementRef,
  });
  const isActive = useIsMainPanelDropActive();

  useEffect(() => {
    setMainPanelDropZoneElement(elementRef.current);
    return () => setMainPanelDropZoneElement(null);
  }, []);

  return (
    <div ref={elementRef} className="relative h-full min-h-0">
      {props.children}
      <BottomDockDropStrip />
      {isActive ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 z-20 rounded border border-accent/70 bg-accent/5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
        />
      ) : null}
    </div>
  );
}

export function StalePanelCleanup() {
  const projectIds = useProjectIds();
  const fileEditorRootContext = useFileEditorStore((state) => state.rootContext);
  const clearFileEditorSession = useFileEditorStore((state) => state.clearSession);
  const gitReviewContext = usePanelStore((s) => s.gitReviewContext);
  const gitOverlayOpen = usePanelStore((s) => s.gitOverlayOpen);
  const filesPanelContext = usePanelStore((s) => s.filesPanelContext);

  useEffect(() => {
    const projectIdSet = new Set(projectIds);
    const panelStore = usePanelStore.getState();

    if (gitReviewContext && !projectIdSet.has(gitReviewContext.projectId)) {
      panelStore.setGitOverlayOpen(false);
      panelStore.setGitReviewContext(null);
    } else if (!gitReviewContext && gitOverlayOpen) {
      panelStore.setGitOverlayOpen(false);
    }

    if (filesPanelContext && !projectIdSet.has(filesPanelContext.projectId)) {
      panelStore.setFilesPanelContext(null);
    }

    if (fileEditorRootContext && !projectIdSet.has(fileEditorRootContext.projectId)) {
      clearFileEditorSession();
    }
  }, [
    clearFileEditorSession,
    fileEditorRootContext,
    filesPanelContext,
    gitOverlayOpen,
    gitReviewContext,
    projectIds,
  ]);

  return null;
}
