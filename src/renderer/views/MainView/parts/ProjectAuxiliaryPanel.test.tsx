import { act, render, waitFor } from "@testing-library/react";
import { I18nProvider } from "@lingui/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { i18n } from "@/renderer/i18n/i18n";
import { showSubAgentPanel } from "@/renderer/actions/panelActions";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { ProjectAuxiliaryPanel } from "./ProjectAuxiliaryPanel";

vi.mock("@/renderer/analytics/useProductViewTracking", () => ({
  productSurfaceView: vi.fn<(tab: string, mode: string) => string>(() => "git"),
  useProductViewTracking: vi.fn<() => void>(),
}));

vi.mock("@/renderer/state/gitRefresh", () => ({
  prefetchVisibleGitPanelPrData: vi.fn<(projectId: string, worktreePath?: string) => Promise<void>>(
    () => Promise.resolve(),
  ),
}));

const unifiedRightPanelProps = vi.hoisted(() => ({
  current: null as {
    activeTab: string;
    launcherOpen?: boolean;
    onAddTool?: () => void;
  } | null,
}));

vi.mock("@/renderer/components/layout/UnifiedRightPanel", () => ({
  UnifiedRightPanel: (props: {
    activeTab: string;
    launcherOpen?: boolean;
    onAddTool?: () => void;
  }) => {
    unifiedRightPanelProps.current = props;
    return null;
  },
}));

function makeThread(id: string, projectId: string, worktreePath: string): Thread {
  const now = "2026-08-03T00:00:00.000Z";
  return {
    id,
    projectId,
    worktreePath,
    title: id,
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: now,
    updatedAt: now,
  };
}

const threadA = makeThread("thread-a", "project-a", "/worktree-a");
const threadB = makeThread("thread-b", "project-b", "/worktree-b");
const threadC = makeThread("thread-c", "project-c", "/worktree-c");

const projectA: Project = {
  id: "project-a",
  name: "Project A",
  location: { kind: "windows", path: "D:\\Work\\ProjectA" },
  createdAt: "2026-08-03T00:00:00.000Z",
};

function focusThread(threadId: string): void {
  useAppStore.setState({
    threads: [threadA, threadB, threadC],
    view: { kind: "thread", panes: [threadId] },
    focusedPaneId: threadId,
  });
}

describe("ProjectAuxiliaryPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    unifiedRightPanelProps.current = null;
    focusThread(threadA.id);
    useAppStore.setState({ projects: [] });
    usePanelStore.setState({
      gitReviewContext: {
        projectId: threadB.projectId,
        worktreePath: threadB.worktreePath!,
        originComposerId: threadB.id,
      },
      gitReviewAsPanel: true,
      rightPanelFollowsThread: true,
      rightPanelTab: "git",
      filesPanelContext: null,
      browserPanelOpen: false,
      usagePanelOpen: false,
      notesPanelOpen: false,
    });
  });

  it("preserves a git badge target when the locked panel opens", async () => {
    render(
      <I18nProvider i18n={i18n}>
        <ProjectAuxiliaryPanel includeTerminal visible />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(usePanelStore.getState().gitReviewContext).toEqual({
        projectId: threadB.projectId,
        worktreePath: threadB.worktreePath!,
        originComposerId: threadB.id,
      });
    });

    act(() => focusThread(threadC.id));

    await waitFor(() => {
      expect(usePanelStore.getState().gitReviewContext).toEqual({
        projectId: threadC.projectId,
        worktreePath: threadC.worktreePath!,
      });
    });
  });

  it("leaves the browser tab when the browser panel was dismissed with it selected", async () => {
    // Closing the last browser tab clears browserPanelOpen over IPC but leaves
    // rightPanelTab on "browser"; the panel must fall back to an open panel
    // instead of rendering an empty browser layer.
    usePanelStore.setState({ rightPanelTab: "browser", browserPanelOpen: false });

    render(
      <I18nProvider i18n={i18n}>
        <ProjectAuxiliaryPanel includeTerminal visible />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(unifiedRightPanelProps.current?.activeTab).toBe("git");
    });
  });

  it("keeps the browser tab active while the browser panel is open", async () => {
    usePanelStore.setState({ rightPanelTab: "browser", browserPanelOpen: true });

    render(
      <I18nProvider i18n={i18n}>
        <ProjectAuxiliaryPanel includeTerminal visible />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(unifiedRightPanelProps.current?.activeTab).toBe("browser");
    });
  });

  it("closes a stale browser overlay without replacing the active tool", async () => {
    usePanelStore.setState({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "browser",
      auxiliaryPanelTabs: ["notes", "browser"],
      rightPanelTab: "browser",
      browserPanelOpen: true,
      browserOverlayOpen: true,
      browserOverlayMaximized: true,
    });

    render(
      <I18nProvider i18n={i18n}>
        <ProjectAuxiliaryPanel includeTerminal visible />
      </I18nProvider>,
    );

    await waitFor(() => expect(unifiedRightPanelProps.current?.onAddTool).toBeTypeOf("function"));
    act(() => unifiedRightPanelProps.current?.onAddTool?.());

    expect(usePanelStore.getState()).toMatchObject({
      auxiliaryPanelTab: "browser",
      auxiliaryPanelTabs: ["notes", "browser"],
      browserOverlayOpen: false,
      browserOverlayMaximized: false,
    });
  });

  it("recovers an unavailable review selection into the launcher", async () => {
    usePanelStore.setState({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "git",
      auxiliaryPanelTabs: ["git"],
      rightPanelTab: "git",
      gitReviewContext: null,
      gitReviewAsPanel: false,
    });

    render(
      <I18nProvider i18n={i18n}>
        <ProjectAuxiliaryPanel includeTerminal visible />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(unifiedRightPanelProps.current?.launcherOpen).toBe(true);
      expect(usePanelStore.getState()).toMatchObject({
        auxiliaryPanelTab: null,
        auxiliaryPanelTabs: [],
      });
    });
  });

  it("inherits the focused conversation project when Review has no scope", async () => {
    useAppStore.setState({ projects: [projectA] });
    usePanelStore.setState({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "git",
      auxiliaryPanelTabs: ["git"],
      rightPanelTab: "git",
      gitReviewContext: null,
      gitReviewAsPanel: false,
    });

    render(
      <I18nProvider i18n={i18n}>
        <ProjectAuxiliaryPanel includeTerminal visible />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(unifiedRightPanelProps.current?.launcherOpen).toBe(false);
      expect(usePanelStore.getState()).toMatchObject({
        gitReviewContext: {
          projectId: threadA.projectId,
          worktreePath: threadA.worktreePath,
        },
        gitReviewAsPanel: true,
      });
    });
  });

  it("inherits the focused conversation worktree when Files has no scope", async () => {
    useAppStore.setState({ projects: [projectA] });
    usePanelStore.setState({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "files",
      auxiliaryPanelTabs: ["files"],
      rightPanelTab: "files",
      filesPanelContext: null,
    });

    render(
      <I18nProvider i18n={i18n}>
        <ProjectAuxiliaryPanel includeTerminal visible />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(unifiedRightPanelProps.current?.launcherOpen).toBe(false);
      expect(usePanelStore.getState().filesPanelContext).toMatchObject({
        projectId: threadA.projectId,
        worktreePath: threadA.worktreePath,
      });
    });
  });

  it("shows the subagent detail instead of the launcher when opened from the status capsule", async () => {
    const subAgentItem: RuntimeChatItem = {
      id: "sub-1",
      type: "tool_call",
      state: "completed",
      streams: {},
    };
    useAppStore.setState({
      runtimeItemIdsByThread: { [threadA.id]: [subAgentItem.id] },
      runtimeItemsByIdByThread: { [threadA.id]: { [subAgentItem.id]: subAgentItem } },
    });
    // The top-right capsule funnels through the same action as the in-chat
    // rows: the detail must land on the auxiliary tab, not under the launcher.
    showSubAgentPanel(threadA.id, subAgentItem.id);

    render(
      <I18nProvider i18n={i18n}>
        <ProjectAuxiliaryPanel includeTerminal visible />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(unifiedRightPanelProps.current?.activeTab).toBe("subagent");
      expect(unifiedRightPanelProps.current?.launcherOpen).toBe(false);
    });
  });
});
