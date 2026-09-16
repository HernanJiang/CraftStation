import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectAnyObstructingOverlayOpen, usePanelStore } from "./panelStore";
import { useFileEditorStore } from "./fileEditorStore";

const initialPanelState = usePanelStore.getState();
const initialFileEditorState = useFileEditorStore.getState();

function resetPanelStore() {
  usePanelStore.setState({
    ...initialPanelState,
    gitReviewContext: null,
    gitReviewAsPanel: false,
    gitOverlayOpen: false,
    prReviewContext: null,
    githubActionsContext: null,
    filesPanelContext: null,
    subAgentPanelContext: null,
    subAgentPanelOpen: false,
    browserPanelOpen: false,
    browserOverlayOpen: false,
    settingsOpen: false,
    projectSettingsId: null,
    threadSearchOpen: false,
  });
}

function resetFileEditorStore() {
  useFileEditorStore.setState({
    ...initialFileEditorState,
    overlayMode: null,
  });
}

it("defaults the thread list to the flat layout", () => {
  expect(initialPanelState.threadListLayout).toBe("grouped");
});

describe("selectAnyObstructingOverlayOpen", () => {
  beforeEach(() => {
    resetPanelStore();
    resetFileEditorStore();
  });
  afterEach(() => {
    resetPanelStore();
    resetFileEditorStore();
  });

  it("returns false when no overlays are open", () => {
    expect(selectAnyObstructingOverlayOpen()).toBe(false);
  });

  it("returns true when the settings overlay is open", () => {
    usePanelStore.setState({ settingsOpen: true });
    expect(selectAnyObstructingOverlayOpen()).toBe(true);
  });

  it("returns true when a project settings overlay is open", () => {
    usePanelStore.setState({ projectSettingsId: "proj-1" });
    expect(selectAnyObstructingOverlayOpen()).toBe(true);
  });

  it("returns true when the git review overlay is open", () => {
    usePanelStore.setState({ gitOverlayOpen: true });
    expect(selectAnyObstructingOverlayOpen()).toBe(true);
  });

  it("returns true when a PR review context is set", () => {
    usePanelStore.setState({
      prReviewContext: { projectId: "p", prNumber: 1 },
    });
    expect(selectAnyObstructingOverlayOpen()).toBe(true);
  });

  it("returns true when GitHub Actions is open", () => {
    usePanelStore.setState({ githubActionsContext: { projectId: "p" } });
    expect(selectAnyObstructingOverlayOpen()).toBe(true);
  });

  it("returns true when the thread search overlay is open", () => {
    usePanelStore.setState({ threadSearchOpen: true });
    expect(selectAnyObstructingOverlayOpen()).toBe(true);
  });

  it("returns true when the file editor overlay is fullscreen", () => {
    useFileEditorStore.setState({ overlayMode: "fullscreen" });
    expect(selectAnyObstructingOverlayOpen()).toBe(true);
  });

  it("returns true when the file editor overlay is modal", () => {
    useFileEditorStore.setState({ overlayMode: "modal" });
    expect(selectAnyObstructingOverlayOpen()).toBe(true);
  });

  it("does not treat gitReviewAsPanel as obstructing on its own", () => {
    usePanelStore.setState({ gitReviewAsPanel: true });
    expect(selectAnyObstructingOverlayOpen()).toBe(false);
  });

  it("does not treat the browser overlay itself as obstructing", () => {
    usePanelStore.setState({ browserOverlayOpen: true, browserPanelOpen: true });
    expect(selectAnyObstructingOverlayOpen()).toBe(false);
  });
});

describe("setPrReviewContext", () => {
  beforeEach(() => {
    resetPanelStore();
  });

  afterEach(() => {
    resetPanelStore();
  });

  it("updates local sync safety when reopening the same pull request", () => {
    const context = { projectId: "p", prNumber: 42, prKey: "p:42" };
    usePanelStore.getState().setPrReviewContext({ ...context, skipLocalSync: true });
    usePanelStore.getState().setPrReviewContext(context);

    expect(usePanelStore.getState().prReviewContext).toEqual(context);
  });
});

describe("subagent panel lifecycle", () => {
  beforeEach(() => {
    resetPanelStore();
  });

  afterEach(() => {
    resetPanelStore();
  });

  it("closeAllPanels drops the subagent context so a dead page never resurrects", () => {
    const panel = usePanelStore.getState();
    panel.setSubAgentPanelContext({
      threadId: "thread-1",
      parentItemId: "parent-1",
      projectLocation: { kind: "posix", path: "/repo" },
    });
    panel.setRightPanelTab("subagent");

    expect(usePanelStore.getState()).toMatchObject({
      rightPanelTab: "subagent",
      subAgentPanelContext: {
        threadId: "thread-1",
        parentItemId: "parent-1",
      },
      subAgentPanelOpen: true,
    });

    usePanelStore.getState().closeAllPanels();
    expect(usePanelStore.getState()).toMatchObject({
      subAgentPanelOpen: false,
      subAgentPanelContext: null,
    });
  });

  it("closing the subagent tab explicitly still clears it", () => {
    usePanelStore.getState().setSubAgentPanelContext({
      threadId: "thread-1",
      parentItemId: "parent-1",
      projectLocation: { kind: "posix", path: "/repo" },
    });
    expect(usePanelStore.getState().subAgentPanelOpen).toBe(true);

    usePanelStore.getState().setSubAgentPanelContext(null);
    expect(usePanelStore.getState()).toMatchObject({
      subAgentPanelOpen: false,
      subAgentPanelContext: null,
    });
  });
});

describe("panel dock state", () => {
  beforeEach(() => {
    resetPanelStore();
    usePanelStore.setState({
      rightPanelSplit: null,
      bottomPanelDocks: { left: null, right: null },
    });
  });
  afterEach(() => {
    resetPanelStore();
    usePanelStore.setState({
      rightPanelSplit: null,
      bottomPanelDocks: { left: null, right: null },
    });
  });

  it("stores and clears the right-panel split", () => {
    usePanelStore.getState().setRightPanelSplit({ tab: "usage", placement: "bottom" });
    expect(usePanelStore.getState().rightPanelSplit).toEqual({
      tab: "usage",
      placement: "bottom",
    });

    usePanelStore.getState().setRightPanelSplit(null);
    expect(usePanelStore.getState().rightPanelSplit).toBeNull();
  });

  it("bails out when setting an identical split", () => {
    usePanelStore.getState().setRightPanelSplit({ tab: "usage", placement: "top" });
    const before = usePanelStore.getState().rightPanelSplit;
    usePanelStore.getState().setRightPanelSplit({ tab: "usage", placement: "top" });
    expect(usePanelStore.getState().rightPanelSplit).toBe(before);
  });

  it("fills and clears the two bottom slots independently", () => {
    usePanelStore.getState().setBottomPanelDock("left", "usage");
    usePanelStore.getState().setBottomPanelDock("right", "git");
    expect(usePanelStore.getState().bottomPanelDocks).toEqual({ left: "usage", right: "git" });

    usePanelStore.getState().setBottomPanelDock("left", null);
    expect(usePanelStore.getState().bottomPanelDocks).toEqual({ left: null, right: "git" });
  });

  it("moves a tab rather than rendering it in both slots", () => {
    usePanelStore.getState().setBottomPanelDock("left", "usage");
    usePanelStore.getState().setBottomPanelDock("right", "usage");

    expect(usePanelStore.getState().bottomPanelDocks).toEqual({ left: null, right: "usage" });
  });

  it("clears a docked tab from whichever slot holds it", () => {
    usePanelStore.getState().setBottomPanelDock("right", "notes");
    usePanelStore.getState().clearBottomPanelDockTab("notes");

    expect(usePanelStore.getState().bottomPanelDocks).toEqual({ left: null, right: null });
  });

  it("releases a dock slot when the docked panel closes its own content", () => {
    usePanelStore.getState().setUsagePanelOpen(true);
    usePanelStore.getState().setBottomPanelDock("right", "usage");

    usePanelStore.getState().setUsagePanelOpen(false);

    // Otherwise an empty "Usage" section keeps the bottom row on screen.
    expect(usePanelStore.getState().bottomPanelDocks).toEqual({ left: null, right: null });
  });

  it("releases the right-panel split when its content closes", () => {
    usePanelStore.getState().setGitReviewContext({ projectId: "p1" });
    usePanelStore.getState().setRightPanelSplit({ tab: "git", placement: "bottom" });

    usePanelStore.getState().setGitReviewContext(null);

    expect(usePanelStore.getState().rightPanelSplit).toBeNull();
  });

  it("keeps a docked tab's content open when the right panel is hidden", () => {
    usePanelStore.getState().setUsagePanelOpen(true);
    usePanelStore.getState().setNotesPanelOpen(true);
    usePanelStore.getState().setBottomPanelDock("right", "usage");
    usePanelStore.getState().setRightPanelSplit({ tab: "notes", placement: "bottom" });

    usePanelStore.getState().closeAllPanels();

    // The bottom row is a separate surface, so its panel stays alive; the
    // right panel's own split does not.
    expect(usePanelStore.getState().usagePanelOpen).toBe(true);
    expect(usePanelStore.getState().notesPanelOpen).toBe(false);
    expect(usePanelStore.getState().rightPanelSplit).toBeNull();
  });
});

describe("auxiliary panel visibility", () => {
  beforeEach(() => {
    resetPanelStore();
    usePanelStore.setState({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "files",
      auxiliaryPanelTabs: ["git", "files"],
      rightPanelTab: "files",
      auxiliaryPanelMaximized: true,
    });
  });

  afterEach(() => {
    resetPanelStore();
  });

  it("hides the rail without forgetting the selected tool tabs", () => {
    usePanelStore.getState().hideAuxiliaryPanel();

    expect(usePanelStore.getState()).toMatchObject({
      auxiliaryPanelPlacement: "hidden",
      auxiliaryPanelTab: "files",
      auxiliaryPanelTabs: ["git", "files"],
      rightPanelTab: "files",
      auxiliaryPanelMaximized: false,
    });
  });

  it("reopens the rail on the tool that was active before collapsing", () => {
    usePanelStore.getState().hideAuxiliaryPanel();
    usePanelStore.getState().toggleAuxiliaryPanel("right");

    expect(usePanelStore.getState()).toMatchObject({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "files",
      rightPanelTab: "files",
    });
  });
});

describe("model usage workspace tabs", () => {
  beforeEach(() => {
    resetPanelStore();
    usePanelStore.setState({ modelUsageWorkspaceTab: "usage" });
  });

  afterEach(() => {
    resetPanelStore();
    usePanelStore.setState({ modelUsageWorkspaceTab: "usage" });
  });

  it("keeps the last-visited tab on a plain sidebar open", () => {
    usePanelStore.getState().openModelUsageWorkspace({ tab: "models" });
    usePanelStore.getState().openModelUsageDialog();
    expect(usePanelStore.getState().modelUsageWorkspaceTab).toBe("models");
  });

  it("still jumps to an explicitly requested tab", () => {
    usePanelStore.getState().openModelUsageWorkspace({ tab: "models" });
    usePanelStore.getState().openModelUsageWorkspace({ tab: "crafting" });
    expect(usePanelStore.getState().modelUsageWorkspaceTab).toBe("crafting");
  });

  it("persists the last-visited tab for the next launch", () => {
    usePanelStore.getState().openModelUsageWorkspace({ tab: "stats" });
    const stored = JSON.parse(localStorage.getItem("craftstation-panel") ?? "{}") as {
      modelUsageWorkspaceTab?: unknown;
    };
    expect(stored.modelUsageWorkspaceTab).toBe("stats");
  });
});

describe("create project modal", () => {
  beforeEach(() => {
    resetPanelStore();
  });
  afterEach(() => {
    resetPanelStore();
  });

  it("is closed by default", () => {
    expect(usePanelStore.getState().createProjectModalOpen).toBe(false);
  });

  it("opens and closes the scratch modal", () => {
    usePanelStore.getState().openCreateProjectModal();
    expect(usePanelStore.getState().createProjectModalOpen).toBe(true);

    usePanelStore.getState().closeCreateProjectModal();
    expect(usePanelStore.getState().createProjectModalOpen).toBe(false);
  });
});

describe("browserOverlayMaximized lifecycle", () => {
  beforeEach(() => {
    resetPanelStore();
  });
  afterEach(() => {
    resetPanelStore();
  });

  it("defaults to false so the overlay opens in drawer mode", () => {
    expect(usePanelStore.getState().browserOverlayMaximized).toBe(false);
  });

  it("is reset to false when the overlay is closed", () => {
    const { setBrowserOverlayOpen, setBrowserOverlayMaximized } = usePanelStore.getState();
    setBrowserOverlayOpen(true);
    setBrowserOverlayMaximized(true);
    expect(usePanelStore.getState().browserOverlayMaximized).toBe(true);

    setBrowserOverlayOpen(false);
    expect(usePanelStore.getState().browserOverlayMaximized).toBe(false);
  });

  it("survives hiding the right-panel browser (overlay is independent)", () => {
    const { setBrowserOverlayOpen, setBrowserOverlayMaximized, setBrowserPanelOpen } =
      usePanelStore.getState();
    setBrowserPanelOpen(true);
    setBrowserOverlayOpen(true);
    setBrowserOverlayMaximized(true);

    // Hiding the docked panel must not tear down a maximized overlay, otherwise
    // the fullscreen page would vanish when the right panel is hidden.
    setBrowserPanelOpen(false);
    expect(usePanelStore.getState().browserPanelOpen).toBe(false);
    expect(usePanelStore.getState().browserOverlayMaximized).toBe(true);
    expect(usePanelStore.getState().browserOverlayOpen).toBe(true);
  });

  it("survives closeAllPanels (e.g. the narrow-viewport right-panel auto-hide)", () => {
    const {
      setBrowserPanelOpen,
      setBrowserOverlayOpen,
      setBrowserOverlayMaximized,
      closeAllPanels,
    } = usePanelStore.getState();
    setBrowserPanelOpen(true);
    setBrowserOverlayOpen(true);
    setBrowserOverlayMaximized(true);

    // closeAllPanels backs the right-panel auto-hide on resize; it must close
    // the docked panel but leave the standalone browser overlay intact.
    closeAllPanels();
    expect(usePanelStore.getState().browserPanelOpen).toBe(false);
    expect(usePanelStore.getState().browserOverlayOpen).toBe(true);
    expect(usePanelStore.getState().browserOverlayMaximized).toBe(true);
  });
});

describe("per-thread auxiliary panels", () => {
  beforeEach(() => {
    resetPanelStore();
    usePanelStore.setState({ threadAuxiliaryPanels: {} });
  });

  it("captures and restores each thread's own right sidebar", () => {
    const store = () => usePanelStore.getState();
    // Thread A opens the browser on the right.
    store().setAuxiliaryPanelPlacement("right");
    store().setAuxiliaryPanelTab("browser");
    store().setBrowserPanelOpen(true);
    store().captureThreadAuxiliaryPanel("thread-a");

    // Thread B has never opened anything: defaults (hidden/closed).
    store().restoreThreadAuxiliaryPanel("thread-b");
    expect(store().auxiliaryPanelPlacement).toBe("hidden");
    expect(store().auxiliaryPanelTab).toBeNull();
    expect(store().browserPanelOpen).toBe(false);

    // Thread B opens usage instead; switching back restores A's browser.
    store().setUsagePanelOpen(true);
    store().captureThreadAuxiliaryPanel("thread-b");
    store().restoreThreadAuxiliaryPanel("thread-a");
    expect(store().auxiliaryPanelPlacement).toBe("right");
    expect(store().auxiliaryPanelTab).toBe("browser");
    expect(store().browserPanelOpen).toBe(true);
    expect(store().usagePanelOpen).toBe(false);

    // And back to B: usage, no browser.
    store().restoreThreadAuxiliaryPanel("thread-b");
    expect(store().usagePanelOpen).toBe(true);
    expect(store().browserPanelOpen).toBe(false);
  });

  it("recapturing overwrites the previous snapshot", () => {
    const store = () => usePanelStore.getState();
    store().setAuxiliaryPanelPlacement("right");
    store().captureThreadAuxiliaryPanel("thread-a");
    store().setAuxiliaryPanelPlacement("hidden");
    store().captureThreadAuxiliaryPanel("thread-a");
    store().setAuxiliaryPanelPlacement("right");
    store().restoreThreadAuxiliaryPanel("thread-a");
    expect(store().auxiliaryPanelPlacement).toBe("hidden");
  });

  it("restores each thread's open subagent as a peer right-panel tab", () => {
    const store = () => usePanelStore.getState();
    const contextA = { threadId: "thread-a", parentItemId: "agent-a" };
    store().setAuxiliaryPanelPlacement("right");
    store().setSubAgentPanelContext(contextA);
    store().setAuxiliaryPanelTab("subagent");
    store().captureThreadAuxiliaryPanel("thread-a");

    store().restoreThreadAuxiliaryPanel("thread-b");
    expect(store()).toMatchObject({
      auxiliaryPanelPlacement: "hidden",
      auxiliaryPanelTab: null,
      subAgentPanelContext: null,
      subAgentPanelOpen: false,
    });

    store().restoreThreadAuxiliaryPanel("thread-a");
    expect(store()).toMatchObject({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "subagent",
      auxiliaryPanelTabs: ["subagent"],
      subAgentPanelContext: contextA,
      subAgentPanelOpen: true,
    });
  });
});
