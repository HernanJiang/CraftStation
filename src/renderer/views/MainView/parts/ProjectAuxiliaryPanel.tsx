import { useEffect, useRef } from "react";
import { useLingui } from "@lingui/react/macro";
import { isHomeProjectId } from "@/shared/homeScope";
import {
  productSurfaceView,
  useProductViewTracking,
} from "@/renderer/analytics/useProductViewTracking";
import { BrowserDockSlot } from "@/renderer/views/MainView/parts/RightPanel/parts/BrowserPanel/BrowserDockSlot";
import {
  extractBrowserToWindow,
  injectBrowserToMain,
} from "@/renderer/views/MainView/parts/RightPanel/parts/BrowserPanel/browserWindowActions";
import { DevTerminalPanel } from "@/renderer/views/MainView/parts/RightPanel/parts/DevTerminalPanel/DevTerminalPanel";
import { AuxiliaryPanelLauncher } from "@/renderer/views/MainView/parts/AuxiliaryPanelLauncher";
import { SideChatPanel } from "./RightPanel/parts/SideChatPanel";
import {
  UnifiedRightPanel,
  type RightPanelTab,
} from "@/renderer/components/layout/UnifiedRightPanel";
import { ProjectFilesPanel } from "@/renderer/views/FileEditorOverlay/parts/ProjectFilesPanel";
import { NotesPanel } from "@/renderer/views/MainView/parts/RightPanel/parts/NotesPanel/NotesPanel";
import { UsagePanel } from "@/renderer/views/MainView/parts/RightPanel/parts/UsagePanel/UsagePanel";
import { UsagePanelHeaderActions } from "@/renderer/views/MainView/parts/RightPanel/parts/UsagePanel/parts/UsagePanelHeaderActions";
import {
  SubAgentContent,
  SubAgentHeaderText,
} from "@/renderer/components/thread/ChatPane/parts/items/SubAgentOverlay";
import { ThreadTodoDock } from "@/renderer/components/thread/ThreadTodoDock";
import { selectThreadTodoDockState } from "@/renderer/components/thread/threadTodoState";
import { useAppStore } from "@/renderer/state/appStore";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { useFileEditorStore, type FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { usePanelStore, type GitReviewContext } from "@/renderer/state/panelStore";
import { useThreadTodoDockStore } from "@/renderer/state/threadTodoDockStore";
import { useSideChatStore } from "@/renderer/state/sideChatStore";
import { closeSideChat } from "@/renderer/actions/sideChatActions";
import { watchRemoteTerminal } from "@/renderer/state/remoteTerminalFeed";
import { prefetchVisibleGitPanelPrData } from "@/renderer/state/gitRefresh";
import {
  moveThreadTodoDock,
  showFilesPanel,
  showGitReviewPanel,
  undockPanelTab,
} from "@/renderer/actions/panelActions";
import { showTerminalPanel } from "@/renderer/actions/terminalActions";
import { getCurrentProjectId } from "@/renderer/actions/currentProject";
import { selectFocusedThreadId, useFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { syncRightPanelTabToFocusedThread } from "@/renderer/hooks/useRightPanelThreadLock";
import { formatProjectScopeLabel } from "@/renderer/utils/projectScopeLabel";
import { useBottomDockedTabs } from "@/renderer/state/panelDockSelectors";
import { GitReviewPanelContent } from "./RightPanel/parts/GitReviewPanelContent";
import { resolveFilesRootContext } from "./RightPanel/parts/resolveFilesRootContext";

interface PanelProjectScope {
  projectId: string;
  worktreePath?: string;
}

function scopeFromGitContext(context: GitReviewContext | null): PanelProjectScope | null {
  if (!context) return null;
  return {
    projectId: context.projectId,
    ...(context.worktreePath ? { worktreePath: context.worktreePath } : {}),
  };
}

function scopeFromFilesContext(context: FileEditorRootContext | null): PanelProjectScope | null {
  if (!context) return null;
  return {
    projectId: context.projectId,
    ...(context.worktreePath ? { worktreePath: context.worktreePath } : {}),
  };
}

export function ProjectAuxiliaryPanel(props: {
  includeTerminal: boolean;
  visible: boolean;
  showLauncher?: boolean;
}) {
  const { t } = useLingui();
  const projects = useAppStore((s) => s.projects);
  const gitReviewContext = usePanelStore((s) => s.gitReviewContext);
  const gitReviewAsPanel = usePanelStore((s) => s.gitReviewAsPanel);
  const filesPanelContext = usePanelStore((s) => s.filesPanelContext);
  const subAgentPanelContext = usePanelStore((s) => s.subAgentPanelContext);
  const rightPanelTab = usePanelStore((s) => s.rightPanelTab);
  const auxiliaryPanelTab = usePanelStore((s) => s.auxiliaryPanelTab);
  const auxiliaryPanelTabs = usePanelStore((s) => s.auxiliaryPanelTabs);
  const auxiliaryPanelMaximized = usePanelStore((s) => s.auxiliaryPanelMaximized);
  const rightPanelSplit = usePanelStore((s) => s.rightPanelSplit);
  const bottomDocks = useBottomDockedTabs();
  const dockedTabs = [bottomDocks.left, bottomDocks.right].filter(
    (tab): tab is RightPanelTab => tab !== null,
  );
  const isBottomDocked = (tab: RightPanelTab) => dockedTabs.includes(tab);
  const setRightPanelTab = usePanelStore((s) => s.setRightPanelTab);
  const setAuxiliaryPanelTab = usePanelStore((s) => s.setAuxiliaryPanelTab);
  const closeAuxiliaryPanelTab = usePanelStore((s) => s.closeAuxiliaryPanelTab);
  const hideAuxiliaryPanel = usePanelStore((s) => s.hideAuxiliaryPanel);
  const toggleAuxiliaryPanelMaximized = usePanelStore((s) => s.toggleAuxiliaryPanelMaximized);
  const rightPanelFollowsThread = usePanelStore((s) => s.rightPanelFollowsThread);
  const toggleRightPanelFollowsThread = usePanelStore((s) => s.toggleRightPanelFollowsThread);
  const browserPanelOpen = usePanelStore((s) => s.browserPanelOpen);
  const browserExtracted = useBrowserPanelStore((s) => s.extracted);
  const usagePanelOpen = usePanelStore((s) => s.usagePanelOpen);
  const setUsagePanelOpen = usePanelStore((s) => s.setUsagePanelOpen);
  const notesPanelOpen = usePanelStore((s) => s.notesPanelOpen);
  const setNotesPanelOpen = usePanelStore((s) => s.setNotesPanelOpen);
  // Reactive id of the project the notes panel should show — recomputed (and
  // re-rendered) as the user navigates between threads/drafts/projects.
  const currentProjectId = useAppStore(() => getCurrentProjectId());
  const setBrowserPanelOpen = usePanelStore((s) => s.setBrowserPanelOpen);
  const setBrowserOverlayOpen = usePanelStore((s) => s.setBrowserOverlayOpen);
  const setBrowserOverlayMaximized = usePanelStore((s) => s.setBrowserOverlayMaximized);
  const setGitReviewContext = usePanelStore((s) => s.setGitReviewContext);
  const setGitOverlayOpen = usePanelStore((s) => s.setGitOverlayOpen);
  const setFileEditorOverlayMode = useFileEditorStore((s) => s.setOverlayMode);
  const terminalOpen = useDevTerminalStore((s) => s.isOpen);
  const terminalProjectId = useDevTerminalStore((s) => s.activeProjectId);
  const terminalWorktreePath = useDevTerminalStore((s) => s.activeWorktreePath);
  const terminalProject = projects.find((project) => project.id === terminalProjectId);
  const currentThreadId = useFocusedThreadId();
  // Side Chat no longer requires an active main thread: the chooser can open
  // from Home (existing-thread flow) and the tab stays while a side thread —
  // ephemeral branch or parallel formal thread — is selected.
  const sideChatPanelOpen = useSideChatStore((state) => state.panelOpen);
  const todoDockPlacement = useThreadTodoDockStore((state) =>
    currentThreadId
      ? (state.byThreadId[currentThreadId]?.placement ?? state.defaultPlacement)
      : "composer",
  );
  const todoDockCollapsed = useThreadTodoDockStore((state) =>
    currentThreadId
      ? (state.byThreadId[currentThreadId]?.collapsed ?? state.defaultCollapsed)
      : false,
  );
  const retiredTodoSourceItemId = useThreadTodoDockStore((state) =>
    currentThreadId ? state.byThreadId[currentThreadId]?.retiredSourceItemId : undefined,
  );
  const todoDockState = useAppStore((state) =>
    currentThreadId && todoDockPlacement === "right"
      ? selectThreadTodoDockState(state, currentThreadId)
      : null,
  );

  const gitPanelOpen = !!gitReviewContext && gitReviewAsPanel;
  const filesPanelOpen = filesPanelContext !== null;
  const subAgentItemExists = useAppStore((state) =>
    subAgentPanelContext
      ? state.runtimeItemsByIdByThread[subAgentPanelContext.threadId]?.[
          subAgentPanelContext.parentItemId
        ] !== undefined
      : false,
  );
  const subAgentInCurrentThread =
    subAgentPanelContext !== null &&
    subAgentPanelContext.threadId === currentThreadId &&
    subAgentItemExists;
  const planInCurrentThread =
    currentThreadId !== null &&
    todoDockPlacement === "right" &&
    todoDockState !== null &&
    todoDockState.sourceItemId !== retiredTodoSourceItemId;

  const previousGitReviewContextRef = useRef<GitReviewContext | null>(null);
  const gitReviewContextChanged = previousGitReviewContextRef.current !== gitReviewContext;
  previousGitReviewContextRef.current = gitReviewContext;

  const lastGitPanelContextRef = useRef(gitReviewContext);
  if (gitReviewContext && gitReviewAsPanel) {
    lastGitPanelContextRef.current = gitReviewContext;
  }
  const gitPanelContext = gitPanelOpen ? gitReviewContext : lastGitPanelContextRef.current;

  const lastFilesPanelContextRef = useRef(filesPanelContext);
  if (filesPanelContext) {
    lastFilesPanelContextRef.current = filesPanelContext;
  }
  const rawFilesPanelContext = filesPanelOpen
    ? filesPanelContext
    : lastFilesPanelContextRef.current;
  const resolvedFilesPanelContext = resolveFilesRootContext(rawFilesPanelContext, projects);

  const requestedTab: RightPanelTab = props.includeTerminal
    ? rightPanelTab === "ports"
      ? "git"
      : rightPanelTab
    : rightPanelTab === "files" ||
        rightPanelTab === "browser" ||
        rightPanelTab === "usage" ||
        rightPanelTab === "notes" ||
        rightPanelTab === "plan" ||
        rightPanelTab === "subagent"
      ? rightPanelTab
      : "git";

  function requestedTabIsAvailable(): boolean {
    // A bottom-docked tab already renders in the bottom row.
    if (isBottomDocked(requestedTab)) return false;
    if (requestedTab === "subagent") return subAgentInCurrentThread;
    if (requestedTab === "plan") return planInCurrentThread;
    // The browser panel is dismissed out-of-band when its last tab closes (the
    // browser sync clears browserPanelOpen but leaves rightPanelTab pointing at
    // "browser"), so it must honor its open flag even when no plan is present —
    // otherwise the panel stays open on an empty browser layer.
    if (requestedTab === "browser") return browserPanelOpen;
    if (!planInCurrentThread) return true;
    if (requestedTab === "terminal") return terminalOpen;
    if (requestedTab === "files") return filesPanelOpen;
    if (requestedTab === "git") return gitPanelOpen;
    if (requestedTab === "usage") return usagePanelOpen;
    return requestedTab === "notes" && notesPanelOpen;
  }

  function fallbackActiveTab(): RightPanelTab {
    if (planInCurrentThread) return "plan";
    if (subAgentInCurrentThread) return "subagent";
    if (filesPanelOpen && !isBottomDocked("files")) return "files";
    if (gitPanelOpen && !isBottomDocked("git")) return "git";
    if (browserPanelOpen && !isBottomDocked("browser")) return "browser";
    if (usagePanelOpen && !isBottomDocked("usage")) return "usage";
    if (notesPanelOpen && !isBottomDocked("notes")) return "notes";
    if (props.includeTerminal && terminalOpen) return "terminal";
    return "git";
  }

  const activeTab = requestedTabIsAvailable() ? requestedTab : fallbackActiveTab();

  const gitTabIsOpen = auxiliaryPanelTabs.includes("git") || auxiliaryPanelTab === "git";
  const filesTabIsOpen = auxiliaryPanelTabs.includes("files") || auxiliaryPanelTab === "files";

  const launcherOpen = props.showLauncher === true || auxiliaryPanelTab === null;

  // A persisted/legacy selected tab can outlive its content context. Clear it
  // back to the launcher instead of rendering a black, content-less layer.
  useEffect(() => {
    if (!props.visible || props.showLauncher || auxiliaryPanelTab === null) return;
    const hasContent =
      (auxiliaryPanelTab === "git" && gitPanelOpen) ||
      (auxiliaryPanelTab === "files" && filesPanelOpen) ||
      (auxiliaryPanelTab === "browser" && browserPanelOpen) ||
      (auxiliaryPanelTab === "terminal" && terminalOpen) ||
      (auxiliaryPanelTab === "usage" && usagePanelOpen) ||
      (auxiliaryPanelTab === "notes" && notesPanelOpen) ||
      (auxiliaryPanelTab === "plan" && planInCurrentThread) ||
      (auxiliaryPanelTab === "subagent" && subAgentInCurrentThread) ||
      (auxiliaryPanelTab === "side-chat" && currentThreadId !== null);
    if (!hasContent) closeAuxiliaryPanelTab(auxiliaryPanelTab);
  }, [
    auxiliaryPanelTab,
    browserPanelOpen,
    currentThreadId,
    closeAuxiliaryPanelTab,
    filesPanelOpen,
    gitPanelOpen,
    notesPanelOpen,
    planInCurrentThread,
    props.showLauncher,
    props.visible,
    setAuxiliaryPanelTab,
    subAgentInCurrentThread,
    terminalOpen,
    usagePanelOpen,
  ]);

  // Review and Files are project-scoped surfaces. When an opened tab has no
  // explicit scope, bind it to the focused thread's project before painting the
  // content. This is the same Project -> Worktree -> panel chain used by the
  // sidebar actions and prevents the "need a project scope" dead end.
  useEffect(() => {
    if (!props.visible || props.showLauncher || !currentThreadId) return;
    const thread = useAppStore
      .getState()
      .threads.find((candidate) => candidate.id === currentThreadId);
    if (!thread || isHomeProjectId(thread.projectId)) return;
    const projectExists = projects.some(
      (project) =>
        !project.disabled && !isHomeProjectId(project.id) && project.id === thread.projectId,
    );
    if (!projectExists) return;
    if (activeTab === "git" && gitTabIsOpen && !gitPanelOpen) {
      showGitReviewPanel(thread.projectId, thread.worktreePath);
    } else if (activeTab === "files" && filesTabIsOpen && !filesPanelOpen) {
      showFilesPanel(thread.projectId, thread.worktreePath);
    }
  }, [
    activeTab,
    currentThreadId,
    filesPanelOpen,
    gitPanelOpen,
    projects,
    gitTabIsOpen,
    filesTabIsOpen,
    props.showLauncher,
    props.visible,
  ]);

  useEffect(() => {
    if (!props.visible) return;
    let refreshTimer: number | undefined;
    const frame = requestAnimationFrame(() => {
      // A new git context is an explicit target (for example, clicking thread
      // B's badge while thread A is focused). Let that open win; the follow
      // lock will take over again on the next thread or tab change.
      if (activeTab !== "git" || !gitReviewContextChanged) {
        syncRightPanelTabToFocusedThread(activeTab);
      }
      if (activeTab !== "git") return;

      // Let the thread and linked-panel frames paint before paying for PR I/O.
      // The prefetch itself gates on gh availability + GitHub remote, and also
      // throttles and deduplicates per project.
      refreshTimer = window.setTimeout(() => {
        const app = useAppStore.getState();
        if (selectFocusedThreadId(app) !== currentThreadId) return;
        const thread = app.threads.find((item) => item.id === currentThreadId);
        if (!thread || isHomeProjectId(thread.projectId)) return;
        void prefetchVisibleGitPanelPrData(thread.projectId, thread.worktreePath);
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [
    activeTab,
    currentThreadId,
    gitReviewContext,
    gitReviewContextChanged,
    props.visible,
    rightPanelFollowsThread,
  ]);
  useProductViewTracking(productSurfaceView(activeTab, "panel"), "panel", {
    active: props.visible,
    finishWhenInactive: true,
  });

  const gitScope = scopeFromGitContext(gitPanelContext);
  const filesScope = scopeFromFilesContext(resolvedFilesPanelContext);
  const terminalScope: PanelProjectScope | null = terminalProjectId
    ? {
        projectId: terminalProjectId,
        ...(terminalWorktreePath ? { worktreePath: terminalWorktreePath } : {}),
      }
    : null;

  function fallbackScope(): PanelProjectScope | null {
    const firstProject = projects[0];
    return firstProject ? { projectId: firstProject.id } : null;
  }

  function activeProjectScope(): PanelProjectScope | null {
    if (activeTab === "terminal") return terminalScope ?? filesScope ?? gitScope;
    if (activeTab === "files") return filesScope ?? gitScope ?? terminalScope;
    if (activeTab === "git") return gitScope ?? filesScope ?? terminalScope;
    return filesScope ?? gitScope ?? terminalScope;
  }

  function projectNameForScope(scope: PanelProjectScope | null): string | undefined {
    if (!scope) return undefined;
    return projects.find((p) => p.id === scope.projectId)?.name;
  }

  const notesProjectId = currentProjectId ?? resolveNextProjectScope()?.projectId;

  function resolveProjectName(): string | undefined {
    switch (activeTab) {
      case "browser":
        return t`Browser`;
      case "usage":
        return t`Usage`;
      case "notes":
        return notesProjectId ? projectNameForScope({ projectId: notesProjectId }) : t`Notes`;
      case "terminal": {
        const terminalProjectName = projectNameForScope(terminalScope);
        return terminalProjectName
          ? formatProjectScopeLabel(terminalProjectName, terminalWorktreePath ?? undefined)
          : undefined;
      }
      case "subagent":
      case "plan":
        return undefined;
      case "files":
        return resolvedFilesPanelContext?.rootLabel ?? projectNameForScope(activeProjectScope());
      default:
        return projectNameForScope(activeProjectScope());
    }
  }
  const projectName = resolveProjectName();
  const isHomeScope = isHomeProjectId(activeProjectScope()?.projectId);

  function resolveNextProjectScope(): PanelProjectScope | null {
    return activeProjectScope() ?? fallbackScope();
  }

  /**
   * Clicking a toolbar icon always lands the tab in this panel, so a tab that
   * currently lives in the split half or the bottom row is pulled back first —
   * otherwise the click would have no visible effect.
   */
  function pressTab(tab: RightPanelTab, open: () => void) {
    undockPanelTab(tab);
    open();
  }

  function handleOpenGit() {
    const scope = resolveNextProjectScope();
    if (!scope) return;
    showGitReviewPanel(scope.projectId, scope.worktreePath);
  }

  function handleOpenFiles() {
    const scope = resolveNextProjectScope();
    if (!scope) return;
    showFilesPanel(scope.projectId, scope.worktreePath);
  }

  function handleOpenTerminal() {
    const scope = resolveNextProjectScope();
    if (!scope) return;
    showTerminalPanel(scope.projectId, scope.worktreePath);
  }

  function handleClose() {
    // Collapsing the right rail is visibility-only. Keep the active tab and
    // its tool context so reopening the rail returns to the same workspace.
    hideAuxiliaryPanel();
  }

  function handleCloseSubAgent() {
    usePanelStore.getState().setSubAgentPanelContext(null);
    handleClose();
  }

  function handleCloseTab(tab: RightPanelTab): void {
    if (tab === "git") setGitReviewContext(null);
    if (tab === "files") usePanelStore.getState().setFilesPanelContext(null);
    if (tab === "browser") setBrowserPanelOpen(false);
    if (tab === "usage") setUsagePanelOpen(false);
    if (tab === "notes") setNotesPanelOpen(false);
    if (tab === "terminal") useDevTerminalStore.getState().closePanel();
    if (tab === "side-chat") closeSideChat();
    closeAuxiliaryPanelTab(tab);
  }

  function handleAddTool(): void {
    setBrowserOverlayMaximized(false);
    setBrowserOverlayOpen(false);
  }

  // A bottom-docked tab renders in the bottom row; keep it out of this panel so
  // singleton surfaces (the browser webview) are never mounted twice.
  const renderTerminalContent = props.includeTerminal && terminalOpen;
  const renderGitContent = gitPanelOpen && !isBottomDocked("git");
  const renderFilesContent = filesPanelOpen && !isBottomDocked("files");
  const renderBrowserContent = browserPanelOpen && !isBottomDocked("browser");
  const renderUsageContent = usagePanelOpen && !isBottomDocked("usage");
  const renderNotesContent =
    notesPanelOpen && notesProjectId !== undefined && !isBottomDocked("notes");
  const renderPlanContent = planInCurrentThread;
  const renderSubAgentContent = subAgentInCurrentThread;
  const openTabs = auxiliaryPanelTabs.filter((tab) => {
    if (tab === "git") return gitPanelOpen || gitTabIsOpen;
    if (tab === "files") return filesPanelOpen || filesTabIsOpen;
    if (tab === "browser") return browserPanelOpen || auxiliaryPanelTabs.includes("browser");
    if (tab === "terminal") return renderTerminalContent || auxiliaryPanelTabs.includes("terminal");
    if (tab === "usage") return usagePanelOpen || auxiliaryPanelTabs.includes("usage");
    if (tab === "notes") return notesPanelOpen || auxiliaryPanelTabs.includes("notes");
    if (tab === "plan") return renderPlanContent;
    if (tab === "subagent") return renderSubAgentContent;
    if (tab === "side-chat") return sideChatPanelOpen;
    return true;
  });

  return (
    <UnifiedRightPanel
      activeTab={activeTab}
      onTabChange={(tab) => {
        if (tab === "subagent" && !renderSubAgentContent) return;
        if (tab === "plan" && !renderPlanContent) return;
        pressTab(tab, () => setRightPanelTab(tab));
      }}
      {...(renderTerminalContent
        ? {
            terminalContent: (
              <DevTerminalPanel
                hideHeader
                {...(terminalProject?.remoteServerId
                  ? {
                      watchTerminal: (terminalId, listener) =>
                        watchRemoteTerminal(terminalProject.remoteServerId!, terminalId, listener),
                    }
                  : {})}
              />
            ),
          }
        : {})}
      gitContent={
        renderGitContent ? (
          <GitReviewPanelContent
            gitPanelContext={gitPanelContext}
            onClose={() => setGitReviewContext(null)}
            onExpandToOverlay={() => setGitOverlayOpen(true)}
          />
        ) : undefined
      }
      filesContent={
        renderFilesContent && resolvedFilesPanelContext ? (
          <ProjectFilesPanel rootContext={resolvedFilesPanelContext} />
        ) : undefined
      }
      browserContent={
        renderBrowserContent ? (
          <BrowserDockSlot
            extracted={browserExtracted}
            onBringBack={injectBrowserToMain}
            onFocusWindow={extractBrowserToWindow}
          />
        ) : undefined
      }
      usageContent={renderUsageContent ? <UsagePanel /> : undefined}
      notesContent={
        renderNotesContent && notesProjectId ? (
          <NotesPanel key={notesProjectId} projectId={notesProjectId} />
        ) : undefined
      }
      {...(renderPlanContent && currentThreadId && todoDockState
        ? {
            planContent: (
              <ThreadTodoDock
                collapsed={todoDockCollapsed}
                placement="right"
                state={todoDockState}
                onCollapsedChange={(collapsed) =>
                  useThreadTodoDockStore.getState().setCollapsed(currentThreadId, collapsed)
                }
                onPlacementChange={(placement) => moveThreadTodoDock(currentThreadId, placement)}
                onRetire={() =>
                  useThreadTodoDockStore
                    .getState()
                    .retire(currentThreadId, todoDockState.sourceItemId)
                }
              />
            ),
          }
        : {})}
      subagentContent={
        renderSubAgentContent ? (
          <SubAgentContent
            key={`${subAgentPanelContext.threadId}:${subAgentPanelContext.parentItemId}`}
            threadId={subAgentPanelContext.threadId}
            parentItemId={subAgentPanelContext.parentItemId}
            hideHeader
            {...(subAgentPanelContext.projectLocation
              ? { projectLocation: subAgentPanelContext.projectLocation }
              : {})}
          />
        ) : undefined
      }
      sideChatContent={<SideChatPanel />}
      usageHeaderActions={
        <UsagePanelHeaderActions dragControlClass="craftstation-overlay-header__controls" />
      }
      showTerminalTab={props.includeTerminal}
      showFilesTab={!isHomeScope}
      showGitTab={!isHomeScope}
      showNotesTab={notesProjectId !== undefined}
      showPlanTab={renderPlanContent}
      showSubagentTab={renderSubAgentContent}
      showSideChatTab={sideChatPanelOpen}
      openTabs={openTabs}
      launcherOpen={launcherOpen}
      launcherContent={<AuxiliaryPanelLauncher />}
      onAddTool={handleAddTool}
      onCloseTab={handleCloseTab}
      onToggleMaximize={toggleAuxiliaryPanelMaximized}
      isMaximized={auxiliaryPanelMaximized}
      {...(renderSubAgentContent
        ? {
            subagentModel: (
              <SubAgentHeaderText
                threadId={subAgentPanelContext.threadId}
                parentItemId={subAgentPanelContext.parentItemId}
                compact
                part="description"
              />
            ),
            subagentTitle: (
              <SubAgentHeaderText
                threadId={subAgentPanelContext.threadId}
                parentItemId={subAgentPanelContext.parentItemId}
                compact
                part="title"
              />
            ),
            onCloseSubagent: handleCloseSubAgent,
          }
        : {})}
      projectName={projectName}
      onExpandGitToOverlay={() => setGitOverlayOpen(true)}
      onExpandFilesToOverlay={() => setFileEditorOverlayMode("fullscreen")}
      onExpandBrowserToOverlay={() => {
        setBrowserOverlayMaximized(true);
        setBrowserOverlayOpen(true);
      }}
      onExtractBrowserToWindow={extractBrowserToWindow}
      onOpenGit={() => pressTab("git", handleOpenGit)}
      onOpenFiles={() => pressTab("files", handleOpenFiles)}
      {...(props.includeTerminal
        ? { onOpenTerminal: () => pressTab("terminal", handleOpenTerminal) }
        : {})}
      onOpenBrowser={() =>
        pressTab("browser", () => {
          if (browserExtracted) {
            extractBrowserToWindow();
            return;
          }
          setBrowserPanelOpen(true);
          setRightPanelTab("browser");
        })
      }
      onOpenUsage={() =>
        pressTab("usage", () => {
          setUsagePanelOpen(true);
          setRightPanelTab("usage");
        })
      }
      onOpenNotes={() =>
        pressTab("notes", () => {
          setNotesPanelOpen(true);
          setRightPanelTab("notes");
        })
      }
      followsThread={rightPanelFollowsThread}
      onToggleFollowsThread={toggleRightPanelFollowsThread}
      dockedTabs={dockedTabs}
      {...(rightPanelSplit && !isBottomDocked(rightPanelSplit.tab)
        ? {
            splitTab: rightPanelSplit.tab,
            splitPlacement: rightPanelSplit.placement,
            onCloseSplit: () => usePanelStore.getState().setRightPanelSplit(null),
          }
        : {})}
      onClose={handleClose}
    />
  );
}
