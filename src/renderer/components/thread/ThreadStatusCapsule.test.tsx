import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  ThreadStatusCapsule,
  buildCapsuleLabel,
  capsuleStatusDotClass,
} from "./ThreadStatusCapsule";

vi.mock("@/renderer/state/gitRefresh", () => ({
  refreshGitProject: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

const { runGitSyncCommandMock } = vi.hoisted(() => ({
  runGitSyncCommandMock: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

const bridgeMock = vi.hoisted(() => ({
  gitSwitchBranch: vi
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ branch: "main", tracking: "origin/main", ahead: 0, behind: 0 }),
  gitInit: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  gitCommit: vi.fn<() => Promise<unknown>>().mockResolvedValue({ hash: "abc123", message: "x" }),
  listThreadExchanges: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
}));

vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  readBridge: () => bridgeMock,
}));

vi.mock("@/renderer/actions/gitCommandRunner", () => ({
  runGitSyncCommand: runGitSyncCommandMock,
  deriveSyncAction: vi.fn<() => string>().mockReturnValue("push"),
}));

const baseProps = {
  threadId: "thread-1",
  projectId: "project-1",
  projectLocation: { kind: "windows", path: "C:\\repo" } as const,
};

function setThreadGoalInStore(prompt = "修复所有 Provider 认证问题") {
  const now = new Date().toISOString();
  useAppStore.getState().setThreadGoal("thread-1", { prompt, createdAt: now, updatedAt: now });
}

function setProjectAndThread() {
  const now = new Date().toISOString();
  useAppStore.setState({
    projects: [
      {
        id: "project-1",
        name: "Repo",
        location: { kind: "windows", path: "C:\\repo" },
        createdAt: now,
      },
    ],
    threads: [
      {
        id: "thread-1",
        projectId: "project-1",
        title: "Thread one",
        agentKind: "codex",
        config: { model: "gpt-5.4" },
        status: "working",
        attention: "working",
        canResumeWithConfig: true,
        archived: false,
        done: false,
        starred: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    connectingThreadIds: {},
    runtimeItemIdsByThread: {},
    runtimeItemsByIdByThread: {},
  } as never);
}

function setGitStatusMain() {
  useGitStore.setState({
    statuses: {
      "project-1": {
        isRepo: true,
        branch: "main",
        tracking: "origin/main",
        hasRemote: true,
        remoteInfo: {
          url: "https://github.com/o/r",
          platform: "github",
          owner: "o",
          repo: "r",
        },
        ahead: 2,
        behind: 0,
        staged: [{ path: "a.ts", status: "M", staged: true, insertions: 100, deletions: 7 }],
        unstaged: [{ path: "b.ts", status: "M", staged: false, insertions: 226, deletions: 20 }],
        totalInsertions: 326,
        totalDeletions: 27,
      },
    },
    worktreeStatuses: {},
  } as never);
}

describe("buildCapsuleLabel", () => {
  it("combines changes and branch in fixed order", () => {
    expect(
      buildCapsuleLabel(
        {
          isRepo: true,
          branch: "main",
          changedFiles: 12,
          insertions: 326,
          deletions: 27,
          ahead: 2,
          behind: 0,
          hasRemote: true,
        },
        "Step 1/4",
      ),
    ).toBe("+326 -27 · main · Step 1/4");
  });

  it("shows clean/synced when there is nothing to report", () => {
    expect(
      buildCapsuleLabel(
        {
          isRepo: true,
          branch: "main",
          changedFiles: 0,
          insertions: 0,
          deletions: 0,
          ahead: 0,
          behind: 0,
          hasRemote: true,
        },
        undefined,
      ),
    ).toBe("clean · main");
  });

  it("never hardcodes branch or counts", () => {
    expect(
      buildCapsuleLabel(
        {
          isRepo: true,
          branch: "feature/x",
          changedFiles: 1,
          insertions: 5,
          deletions: 1,
          ahead: 0,
          behind: 3,
          hasRemote: true,
        },
        undefined,
      ),
    ).toBe("+5 -1 · feature/x");
  });
});

describe("capsuleStatusDotClass", () => {
  it("marks conflicts, dirty, working, and clean distinctly", () => {
    expect(
      capsuleStatusDotClass(
        {
          isRepo: true,
          branch: "main",
          changedFiles: 1,
          insertions: 1,
          deletions: 0,
          ahead: 0,
          behind: 0,
          hasRemote: true,
        },
        {},
      ),
    ).toContain("amber");
    expect(capsuleStatusDotClass(undefined, { isWorking: true })).toContain("muted");
  });
});

describe("ThreadStatusCapsule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMock.listThreadExchanges.mockResolvedValue([]);
    localStorage.clear();
    usePanelStore.setState({
      rightPanelTab: "git",
      gitReviewAsPanel: false,
      gitReviewContext: null,
      gitOverlayOpen: false,
    } as never);
    setProjectAndThread();
    setGitStatusMain();
  });

  function renderCapsule(props: Partial<typeof baseProps> = {}) {
    return render(
      <AppProvider>
        <ThreadStatusCapsule {...baseProps} {...props} />
      </AppProvider>,
    );
  }

  it("renders a compact capsule from the live git store, not hardcoded text", () => {
    renderCapsule();
    const capsule = screen.getByTestId("project-status-capsule");
    expect(capsule).toHaveTextContent("main");
    expect(capsule).toHaveTextContent("+326");
    expect(capsule).toHaveTextContent("-27");
    expect(capsule).not.toHaveTextContent("ahead");
    expect(capsule.className).not.toMatch(/max-w-/);
    expect(capsule.className).not.toMatch(/\btruncate\b/);
  });

  it("expands to a floating details panel on click and collapses on second click", () => {
    renderCapsule();
    const capsule = screen.getByTestId("project-status-capsule");
    expect(screen.queryByTestId("project-status-panel")).toBeNull();

    fireEvent.click(capsule);
    const panel = screen.getByTestId("project-status-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent("更改");
    expect(panel).toHaveTextContent("提交或推送");

    fireEvent.click(capsule);
    expect(screen.queryByTestId("project-status-panel")).toBeNull();
  });

  it("renders the collapsed capsule in Changes → Branch order with no sync word", () => {
    renderCapsule();
    const capsule = screen.getByTestId("project-status-capsule");
    const text = capsule.textContent ?? "";
    expect(text).toContain("+326");
    expect(text).toContain("main");
    expect(text).not.toContain("ahead");
    expect(text.indexOf("+326")).toBeLessThan(text.indexOf("main"));
  });

  it("shows exactly the 更改 / branch / 提交或推送 rows", () => {
    renderCapsule();
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const panel = screen.getByTestId("project-status-panel");

    expect(panel).toHaveTextContent("更改");
    expect(panel).toHaveTextContent("main");
    expect(panel).toHaveTextContent("提交或推送");
    expect(panel).toHaveTextContent("+326");
    expect(panel).toHaveTextContent("-27");
    // No detail rows and no ahead/behind in the small panel.
    expect(panel).not.toHaveTextContent("Changed files");
    expect(panel).not.toHaveTextContent("Ahead / Behind");
    expect(panel).not.toHaveTextContent("Remote");
    expect(panel).not.toHaveTextContent("Uncommitted");
  });

  it("collapses when clicking outside or pressing Escape", () => {
    render(
      <AppProvider>
        <div>
          <button type="button">outside</button>
          <ThreadStatusCapsule {...baseProps} />
        </div>
      </AppProvider>,
    );
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    expect(screen.getByTestId("project-status-panel")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText("outside"));
    expect(screen.queryByTestId("project-status-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("project-status-capsule"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("project-status-panel")).toBeNull();
  });

  it("switches immediately when the project changes", () => {
    const now = new Date().toISOString();
    useGitStore.setState({
      statuses: {
        "project-1": {
          isRepo: true,
          branch: "main",
          tracking: "origin/main",
          hasRemote: true,
          remoteInfo: null,
          ahead: 0,
          behind: 0,
          staged: [],
          unstaged: [],
          totalInsertions: 0,
          totalDeletions: 0,
        },
        "project-2": {
          isRepo: true,
          branch: "feature/other",
          tracking: "",
          hasRemote: true,
          remoteInfo: null,
          ahead: 0,
          behind: 1,
          staged: [],
          unstaged: [{ path: "x.ts", status: "M", staged: false, insertions: 3, deletions: 1 }],
          totalInsertions: 3,
          totalDeletions: 1,
        },
      },
      worktreeStatuses: {},
    } as never);
    useAppStore.setState({
      projects: [
        {
          id: "project-1",
          name: "Repo",
          location: { kind: "windows", path: "C:\\repo" },
          createdAt: now,
        },
        {
          id: "project-2",
          name: "Other",
          location: { kind: "windows", path: "C:\\other" },
          createdAt: now,
        },
      ],
    } as never);

    const { rerender } = render(
      <AppProvider>
        <ThreadStatusCapsule {...baseProps} projectId="project-1" />
      </AppProvider>,
    );
    expect(screen.getByTestId("project-status-capsule")).toHaveTextContent("main");

    rerender(
      <AppProvider>
        <ThreadStatusCapsule
          {...baseProps}
          projectId="project-2"
          projectLocation={{ kind: "windows", path: "C:\\other" }}
        />
      </AppProvider>,
    );
    const capsule = screen.getByTestId("project-status-capsule");
    expect(capsule).toHaveTextContent("feature/other");
    expect(capsule).not.toHaveTextContent("behind");
  });

  it("keeps agent plans out of the 目标 row without a /goal (Step segment stays)", () => {
    useAppStore.setState({
      runtimeItemIdsByThread: { "thread-1": ["plan-1"] },
      runtimeItemsByIdByThread: {
        "thread-1": {
          "plan-1": {
            id: "plan-1",
            type: "plan",
            state: "updated",
            payload: {
              steps: [
                { step: "First step", status: "completed" },
                { step: "Second step", status: "in_progress" },
                { step: "Third step", status: "pending" },
              ],
            },
            streams: {},
          },
        },
      },
    } as never);

    renderCapsule();
    // Step segment still reflects the plan, but no 目标 row without /goal.
    expect(screen.getByTestId("project-status-capsule")).toHaveTextContent("Step 1/3");

    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const panel = screen.getByTestId("project-status-panel");
    expect(panel).not.toHaveTextContent("目标");
  });

  function seedPlanSteps(
    steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>,
  ) {
    useAppStore.setState({
      runtimeItemIdsByThread: { "thread-1": ["plan-1"] },
      runtimeItemsByIdByThread: {
        "thread-1": {
          "plan-1": {
            id: "plan-1",
            type: "plan",
            state: "updated",
            payload: { steps },
            streams: {},
          },
        },
      },
    } as never);
  }

  it("opens the task card directly from the Step segment and toggles it closed", () => {
    seedPlanSteps([
      { step: "First step", status: "completed" },
      { step: "Second step", status: "in_progress" },
      { step: "Third step", status: "pending" },
    ]);

    renderCapsule();
    const capsule = screen.getByTestId("project-status-capsule");
    expect(capsule).toHaveTextContent("Step 1/3");
    expect(screen.queryByText("Second step")).not.toBeInTheDocument();

    fireEvent.click(within(capsule).getByRole("button", { name: "Step 1/3. Show task." }));
    // Steps render inline in the Git panel, already expanded.
    const panel = screen.getByTestId("project-status-panel");
    expect(panel).toHaveTextContent("进程");
    expect(panel).toHaveTextContent("First step");
    expect(panel).toHaveTextContent("Second step");
    expect(panel).toHaveTextContent("Third step");

    // 再次点击同一 segment 收起，不留残留面板。
    fireEvent.click(within(capsule).getByRole("button", { name: "Step 1/3. Show task." }));
    expect(screen.queryByText("Second step")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-status-panel")).not.toBeInTheDocument();
  });

  it("expands the task card from the Step segment even when the project is not a git repo", () => {
    useGitStore.setState({
      statuses: {
        "project-1": {
          isRepo: false,
          branch: "",
          tracking: "",
          hasRemote: false,
          remoteInfo: null,
          ahead: 0,
          behind: 0,
          staged: [],
          unstaged: [],
          totalInsertions: 0,
          totalDeletions: 0,
        },
      },
      worktreeStatuses: {},
    } as never);
    seedPlanSteps([{ step: "Only step", status: "in_progress" }]);

    renderCapsule();
    const capsule = screen.getByTestId("project-status-capsule");
    expect(capsule).toHaveTextContent("Step 0/1");

    fireEvent.click(within(capsule).getByRole("button", { name: "Step 0/1. Show task." }));
    expect(screen.getByTestId("project-status-panel")).toBeInTheDocument();
    expect(screen.getByText("Only step")).toBeInTheDocument();
  });

  it("drops the Step segment as soon as every step completes instead of showing a stale run", () => {
    seedPlanSteps([
      { step: "First step", status: "completed" },
      { step: "Second step", status: "completed" },
    ]);

    renderCapsule();
    expect(screen.getByTestId("project-status-capsule")).not.toHaveTextContent("Step");
  });

  it("auto-opens the task card when steps appear mid-session", () => {
    renderCapsule();
    expect(screen.queryByTestId("project-status-panel")).toBeNull();

    act(() => {
      useAppStore.setState({
        runtimeItemIdsByThread: { "thread-1": ["plan-1"] },
        runtimeItemsByIdByThread: {
          "thread-1": {
            "plan-1": {
              id: "plan-1",
              type: "plan",
              state: "updated",
              payload: { steps: [{ step: "Only step", status: "in_progress" }] },
              streams: {},
            },
          },
        },
      } as never);
    });

    // The 0 → N transition opens the Git panel with steps already expanded.
    expect(screen.getByTestId("project-status-panel")).toBeInTheDocument();
    expect(screen.getByTestId("project-status-panel")).toHaveTextContent("进程");
    expect(screen.getByText("Only step")).toBeInTheDocument();
  });

  it("opens the right sidebar changes page from the 更改 row", async () => {
    renderCapsule();
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const panel = screen.getByTestId("project-status-panel");

    fireEvent.click(within(panel).getByRole("button", { name: "Show changes in the Git panel" }));
    expect(usePanelStore.getState().gitReviewContext).toEqual({ projectId: "project-1" });
    // Navigating away closes the floating panel.
    expect(screen.queryByTestId("project-status-panel")).toBeNull();
  });

  it("expands the branch card to the left and toggles it closed", () => {
    useGitStore.setState({
      branches: {
        "project-1": { branches: [{ name: "main" }, { name: "feature/x" }] },
      },
    } as never);
    renderCapsule();
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const panel = screen.getByTestId("project-status-panel");
    const branchRow = within(panel).getByRole("button", { name: /main.*branches/ });
    expect(branchRow).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(branchRow);
    expect(branchRow).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByPlaceholderText("搜索分支")).toBeInTheDocument();
    expect(screen.getByText("feature/x")).toBeInTheDocument();

    fireEvent.click(branchRow);
    expect(branchRow).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByPlaceholderText("搜索分支")).toBeNull();
  });

  it("expands the commit card to the left from the 提交或推送 row", () => {
    renderCapsule();
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const panel = screen.getByTestId("project-status-panel");

    fireEvent.click(within(panel).getByRole("button", { name: "提交或推送" }));
    // The commit card renders beside the small panel, not inside it.
    expect(screen.getByRole("textbox", { name: "提交信息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交并推送" })).toBeInTheDocument();
  });

  it("shows the 目标 row only in /goal mode with the full prompt", () => {
    setThreadGoalInStore();
    renderCapsule();
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const panel = screen.getByTestId("project-status-panel");
    expect(panel).toHaveTextContent("目标");
    expect(panel).toHaveTextContent("修复所有 Provider 认证问题");
    // Codex threads register natively.
    expect(panel).toHaveTextContent("原生");
    expect(screen.queryByRole("button", { name: "Goal. Show task." })).toBeNull();
  });

  it("offers git init when the project is not a repo", () => {
    useGitStore.setState({
      statuses: {
        "project-1": {
          isRepo: false,
          branch: "",
          tracking: "",
          hasRemote: false,
          remoteInfo: null,
          ahead: 0,
          behind: 0,
          staged: [],
          unstaged: [],
          totalInsertions: 0,
          totalDeletions: 0,
        },
      },
      worktreeStatuses: {},
    } as never);
    renderCapsule();
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const panel = screen.getByTestId("project-status-panel");
    expect(panel).toHaveTextContent("不是 Git 仓库");

    const initButton = within(panel).getByRole("button", { name: "初始化 Git 仓库" });
    expect(initButton).toBeEnabled();
    fireEvent.click(initButton);
    expect(bridgeMock.gitInit).toHaveBeenCalledWith({
      projectLocation: { kind: "windows", path: "C:\\repo" },
    });
  });

  it("collapses the panel body from the header", () => {
    renderCapsule();
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const panel = screen.getByTestId("project-status-panel");
    expect(panel).toHaveTextContent("更改");

    fireEvent.click(within(panel).getByRole("button", { name: "收起 Git 面板" }));
    expect(screen.getByTestId("project-status-panel")).toHaveTextContent("Git 工具");
    expect(screen.queryByText("更改")).toBeNull();

    fireEvent.click(
      within(screen.getByTestId("project-status-panel")).getByRole("button", {
        name: "展开 Git 面板",
      }),
    );
    expect(screen.getByText("更改")).toBeInTheDocument();
  });

  it("reopens the full Git panel from the capsule instead of the title row", () => {
    renderCapsule();
    const capsule = screen.getByTestId("project-status-capsule");
    fireEvent.click(capsule);
    fireEvent.click(
      within(screen.getByTestId("project-status-panel")).getByRole("button", {
        name: "收起 Git 面板",
      }),
    );
    expect(screen.queryByText("更改")).toBeNull();

    fireEvent.click(capsule);
    fireEvent.click(capsule);
    expect(screen.getByTestId("project-status-panel")).toHaveTextContent("更改");
    expect(screen.getByTestId("project-status-panel")).toHaveTextContent("提交或推送");
  });

  it("hides the 目标 section when there is no plan and nothing to mark", () => {
    renderCapsule();
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    expect(screen.queryByText("目标")).toBeNull();
  });

  it("opens the panel without cards from segments; rows expand explicitly", () => {
    useGitStore.setState({
      branches: {
        "project-1": { branches: [{ name: "main" }, { name: "feature/x" }] },
      },
    } as never);
    renderCapsule();
    // Segments only open the small panel — nothing expands by itself.
    fireEvent.click(
      within(screen.getByTestId("project-status-capsule")).getByRole("button", {
        name: /main/,
      }),
    );
    expect(screen.getByTestId("project-status-panel")).toHaveTextContent("提交或推送");
    expect(screen.queryByPlaceholderText("搜索分支")).toBeNull();

    // The branch row expands the card explicitly.
    fireEvent.click(
      within(screen.getByTestId("project-status-panel")).getByRole("button", {
        name: /main.*branches/,
      }),
    );
    expect(screen.getByPlaceholderText("搜索分支")).toBeInTheDocument();
    expect(screen.getByText("feature/x")).toBeInTheDocument();
    expect(screen.getByText("Create new branch...")).toBeInTheDocument();
    expect(screen.getByText("Branch graph")).toBeInTheDocument();
  });

  it("commits from the left commit card", async () => {
    renderCapsule();
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const panel = screen.getByTestId("project-status-panel");
    fireEvent.click(within(panel).getByRole("button", { name: "提交或推送" }));
    // The commit card renders beside the small panel, not inside it.
    const messageBox = screen.getByRole("textbox", { name: "提交信息" });
    // Empty message: commit actions stay disabled instead of inventing one.
    expect(screen.getByRole("button", { name: /^提交Ctrl/ })).toBeDisabled();

    fireEvent.change(messageBox, { target: { value: "fix capsule order" } });
    fireEvent.click(screen.getByRole("button", { name: /^提交Ctrl/ }));
    expect(bridgeMock.gitCommit).toHaveBeenCalledWith({
      projectLocation: { kind: "windows", path: "C:\\repo" },
      message: "fix capsule order",
      addAll: true,
    });
    await waitFor(() => expect(messageBox).toHaveValue(""));
  });

  it("exposes open-in-git-panel and refresh through the … menu", async () => {
    const { refreshGitProject } = await import("@/renderer/state/gitRefresh");
    renderCapsule();
    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const panel = screen.getByTestId("project-status-panel");

    fireEvent.click(within(panel).getByRole("button", { name: "更多操作" }));
    fireEvent.click(within(panel).getByRole("menuitem", { name: "在 Git 面板中打开" }));
    expect(usePanelStore.getState().gitReviewContext).toEqual({ projectId: "project-1" });

    fireEvent.click(screen.getByTestId("project-status-capsule"));
    const reopened = screen.getByTestId("project-status-panel");
    fireEvent.click(within(reopened).getByRole("button", { name: "更多操作" }));
    fireEvent.click(within(reopened).getByRole("menuitem", { name: "刷新状态" }));
    expect(refreshGitProject).toHaveBeenCalled();
  });

  describe("agents segment", () => {
    function seedAgents(
      items: Array<{
        id: string;
        state: "started" | "completed";
        name: string;
        status?: string;
        subAgentStatus?: string;
      }>,
    ) {
      useAppStore.setState({
        runtimeItemIdsByThread: { "thread-1": items.map((item) => item.id) },
        runtimeItemsByIdByThread: {
          "thread-1": Object.fromEntries(
            items.map((item) => [
              item.id,
              {
                id: item.id,
                type: "tool_call",
                state: item.state,
                payload: {
                  name: item.name,
                  status: item.status ?? (item.state === "completed" ? "success" : "running"),
                  isSubAgent: true,
                  args: { description: item.name },
                  ...(item.subAgentStatus ? { subAgentStatus: item.subAgentStatus } : {}),
                },
                streams: {},
              },
            ]),
          ),
        },
        runtimeStructuralVersionByThread: { "thread-1": 1 },
      } as never);
    }

    function seedPlan() {
      useAppStore.setState({
        runtimeItemIdsByThread: {
          "thread-1": [
            ...(useAppStore.getState().runtimeItemIdsByThread["thread-1"] ?? []),
            "plan-1",
          ],
        },
        runtimeItemsByIdByThread: {
          "thread-1": {
            ...useAppStore.getState().runtimeItemsByIdByThread["thread-1"],
            "plan-1": {
              id: "plan-1",
              type: "plan",
              state: "updated",
              payload: { steps: [{ step: "Only step", status: "in_progress" }] },
              streams: {},
            },
          },
        },
      } as never);
    }

    it("hides the agents segment when the thread never spawned a subagent", () => {
      renderCapsule();
      expect(screen.getByTestId("project-status-capsule")).not.toHaveTextContent("Agents");
    });

    it("orders Agents → Step → Git and shows running agents first", () => {
      seedAgents([{ id: "sub-1", state: "started", name: "Explore login" }]);
      seedPlan();
      renderCapsule();
      const text = screen.getByTestId("project-status-capsule").textContent ?? "";
      expect(text).toContain("1 Agents working");
      expect(text.indexOf("Agents")).toBeLessThan(text.indexOf("Step 0/1"));
      expect(text.indexOf("Step 0/1")).toBeLessThan(text.indexOf("main"));
    });

    it("keeps ended agents visible instead of dropping the entry", () => {
      seedAgents([{ id: "sub-1", state: "completed", name: "Explore login" }]);
      renderCapsule();
      expect(screen.getByTestId("project-status-capsule")).toHaveTextContent("1 Agents ended");
    });

    it("surfaces failures as ended plus error count", () => {
      seedAgents([
        { id: "sub-1", state: "completed", name: "Done thing" },
        { id: "sub-2", state: "completed", name: "Broken thing", status: "error" },
      ]);
      renderCapsule();
      expect(screen.getByTestId("project-status-capsule")).toHaveTextContent(
        "1 Agents ended · 1 error",
      );
    });

    it("lists rows as 目标 → Agents → 更改 → 提交或推送 and opens an agent from its card", () => {
      seedAgents([{ id: "sub-1", state: "started", name: "Explore login" }]);
      setThreadGoalInStore();
      useAppStore.setState({
        runtimeItemIdsByThread: {
          "thread-1": [
            ...(useAppStore.getState().runtimeItemIdsByThread["thread-1"] ?? []),
            "plan-1",
          ],
        },
        runtimeItemsByIdByThread: {
          "thread-1": {
            ...useAppStore.getState().runtimeItemsByIdByThread["thread-1"],
            "plan-1": {
              id: "plan-1",
              type: "plan",
              state: "updated",
              payload: { steps: [{ step: "Only step", status: "in_progress" }] },
              streams: {},
            },
          },
        },
      } as never);
      renderCapsule();
      fireEvent.click(screen.getByTestId("project-status-capsule"));
      const panel = screen.getByTestId("project-status-panel");
      const html = panel.innerHTML;
      expect(html.indexOf("目标")).toBeLessThan(html.indexOf("Agents"));
      expect(html.indexOf("Agents")).toBeLessThan(html.indexOf("更改"));
      expect(html.indexOf("更改")).toBeLessThan(html.indexOf("提交或推送"));

      // The agent list lives in the left card; opening one closes the panel.
      fireEvent.click(within(panel).getByRole("button", { name: /Agents/ }));
      fireEvent.click(screen.getByRole("button", { name: /Explore login/ }));
      expect(useAppStore.getState().openSubAgentByThread["thread-1"]).toBe("sub-1");
      expect(screen.queryByTestId("project-status-panel")).toBeNull();
    });
  });

  it("folds cross-thread dialogue into the capsule instead of a transcript banner", async () => {
    const onOpenCollaboration = vi.fn<() => void>();
    bridgeMock.listThreadExchanges.mockResolvedValue([
      {
        id: "ex-1",
        linkId: "link-1",
        projectId: "project-1",
        sourceThreadId: "thread-1",
        targetThreadId: "assistant-1",
        sequence: 1,
        deliveryMode: "after-current-turn",
        status: "failed",
        sourceProvenance: {
          threadId: "thread-1",
          projectId: "project-1",
          title: "This thread",
          modelId: "grok-4.6",
          harnessId: "grok",
          agentMcpSupported: false,
        },
        targetProvenance: {
          threadId: "assistant-1",
          projectId: "project-1",
          title: "Assistant",
          modelId: "gemini-3.8-flash",
          harnessId: "antigravity",
          agentMcpSupported: false,
        },
        requestItemId: "req-1",
        deliveryBaselineTurnIndex: null,
        deliveryAnchorItemId: null,
        replyTurnIndex: null,
        replyAnchorItemId: null,
        replyExcerpt: null,
        causalParentExchangeId: null,
        hopDepth: 0,
        error: {
          code: "THREAD_COLLABORATION_RUNTIME_UNAVAILABLE",
          message: "unavailable",
          retryable: true,
        },
        createdAt: "2026-09-09T00:00:00.000Z",
        updatedAt: "2026-09-09T00:00:00.000Z",
        deliveredAt: null,
        repliedAt: null,
      },
    ]);
    render(
      <AppProvider>
        <ThreadStatusCapsule {...baseProps} onOpenCollaboration={onOpenCollaboration} />
      </AppProvider>,
    );
    const capsule = screen.getByTestId("project-status-capsule");
    await waitFor(() => {
      expect(capsule).toHaveTextContent("Failed");
      expect(capsule).toHaveTextContent("Assistant");
    });
    expect(screen.queryByText("View cross-thread dialogue")).toBeNull();

    fireEvent.click(
      within(capsule).getByRole("button", {
        name: "Cross-thread dialogue with Assistant. Show details.",
      }),
    );
    expect(screen.getByTestId("project-status-panel")).toHaveTextContent("Cross-thread dialogue");
    fireEvent.click(screen.getByText("View cross-thread dialogue"));
    expect(onOpenCollaboration).toHaveBeenCalledTimes(1);
  });
});
