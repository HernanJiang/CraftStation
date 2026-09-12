import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ToolCallPayload } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { DraftContextBar } from "./DraftContextBar";

vi.mock("./ProjectSwitchMenu", () => ({
  ProjectSwitchMenu: () => <button type="button">Project</button>,
}));
vi.mock("./CraftModeSwitch", () => ({
  CraftModeSwitch: () => <span>Craft mode</span>,
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    interruptThread: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    controlThreadGoal: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
  isQuickComposerWindow: () => false,
  isRemoteSession: () => false,
}));

const project: Project = {
  id: "project-1",
  name: "CraftStation",
  createdAt: new Date().toISOString(),
  location: { kind: "windows", path: "D:\\Work\\CraftStation" },
};

describe("DraftContextBar Git controls", () => {
  it("keeps project/runtime/craft controls but no git entry (the capsule owns git)", () => {
    const { container } = render(
      <DraftContextBar project={project} craftMode="auto" onCraftModeChange={() => undefined} />,
    );

    // No second git entrance above the composer: no branch pill, no card,
    // no portaled branch/worktree controls.
    expect(screen.queryByTestId("composer-git-entry")).toBeNull();
    expect(screen.queryByTestId("composer-git-card")).toBeNull();
    expect(container.querySelector("[data-composer-git-controls]")).toBeNull();
    expect(container.querySelector("[data-draft-worktree-row]")).toBeNull();
    // Project / runtime controls stay; the craft-mode switch is gone from the
    // chat box (mode recipes are picked from the model list instead).
    expect(screen.getByRole("button", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "CraftStation mode" })).not.toBeInTheDocument();
  });

  it("shows no git entry without a project", () => {
    render(
      <DraftContextBar
        project={{ ...project, id: "__craftstation_home__" } as Project}
        craftMode="auto"
        onCraftModeChange={() => undefined}
      />,
    );
    // Home scope renders the sr-only fallback instead of any git state.
    expect(screen.queryByTestId("composer-git-entry")).toBeNull();
  });
});

describe("DraftContextBar subagent entry", () => {
  beforeEach(() => {
    useAppStore.setState({
      runtimeItemIdsByThread: {},
      runtimeItemsByIdByThread: {},
      runtimeRequestsByThread: {},
      runtimeStructuralVersionByThread: {},
      openSubAgentByThread: {},
    });
  });

  it("never renders the agents capsule above the composer (the top-right capsule is the single entry)", () => {
    const threadId = "thread-agents";
    const running: RuntimeChatItem = {
      id: "sub-cross",
      type: "tool_call",
      state: "started",
      payload: {
        name: "分析登录问题 — Codex · GPT 5.6 Luna · Low · Fast",
        status: "running",
        isCrossagent: true,
        crossagentStatus: "running",
        progress: { stepCount: 1 },
      } satisfies ToolCallPayload,
      streams: {},
    };
    const done: RuntimeChatItem = {
      id: "sub-native",
      type: "tool_call",
      state: "completed",
      payload: {
        name: "Task",
        status: "success",
        isSubAgent: true,
        args: { description: "Review findings", subagent_type: "Explore" },
      } satisfies ToolCallPayload,
      streams: {},
    };
    useAppStore.setState({
      runtimeItemIdsByThread: { [threadId]: [running.id, done.id] },
      runtimeItemsByIdByThread: { [threadId]: { [running.id]: running, [done.id]: done } },
      runtimeStructuralVersionByThread: { [threadId]: 3 },
      openSubAgentByThread: {},
    });

    render(
      <DraftContextBar
        project={project}
        threadId={threadId}
        craftMode="auto"
        onCraftModeChange={() => undefined}
      />,
    );

    expect(screen.queryByTestId("agents-capsule")).toBeNull();
    expect(screen.queryByTestId("agents-capsule-popover")).toBeNull();
  });

  it("hosts the runtime status chip without duplicating context occupancy", () => {
    useAppStore.setState({
      threads: [
        {
          id: "thread-runtime",
          projectId: "project-1",
          agentKind: "grok",
          status: "working",
          attention: "working",
          activeTurnStartedAt: "2026-09-13T01:05:33.000Z",
        },
      ],
      runtimeContextByThread: {
        "thread-runtime": {
          usedTokens: 218_000,
          maxTokens: 262_000,
          breakdown: [{ id: "messages", label: "消息", tokens: 218_000 }],
        },
      },
    } as never);

    render(
      <DraftContextBar
        project={project}
        threadId="thread-runtime"
        craftMode="auto"
        onCraftModeChange={() => undefined}
      />,
    );

    const chip = screen.getByTestId("thread-runtime-status");
    expect(chip).toHaveTextContent("工作中");
    expect(chip).not.toHaveTextContent("84%");
    expect(chip).not.toHaveTextContent("消息");
  });
});

describe("DraftContextBar goal chip", () => {
  const goalPrompt = "修复所有 Provider 的认证和 Runtime 问题";
  const now = new Date().toISOString();

  function seedThreadWithGoal() {
    useAppStore.setState({
      threads: [
        {
          id: "thread-1",
          projectId: "project-1",
          agentKind: "kimi",
          goal: { prompt: goalPrompt, createdAt: now, updatedAt: now },
        },
      ],
    } as never);
  }

  function renderBar() {
    return render(
      <DraftContextBar
        project={project}
        threadId="thread-1"
        craftMode="auto"
        onCraftModeChange={() => undefined}
      />,
    );
  }

  it("hosts the full goal dock for a durable goal with edit/pause/clear", () => {
    seedThreadWithGoal();
    renderBar();
    const dock = screen.getByLabelText("Thread goal dock");
    expect(dock).toHaveAttribute("data-placement", "context-bar");
    expect(dock).toHaveTextContent(goalPrompt);
    expect(screen.getByRole("button", { name: "Edit goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear goal" })).toBeInTheDocument();
  });

  it("renders no chip or placeholder without a goal", () => {
    useAppStore.setState({ threads: [{ id: "thread-1", projectId: "project-1" }] } as never);
    renderBar();
    expect(screen.queryByTestId("goal-chip")).toBeNull();
    expect(screen.queryByLabelText("Thread goal dock")).toBeNull();
  });

  it("clearing the durable goal removes the dock", async () => {
    seedThreadWithGoal();
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Clear goal" }));
    await waitFor(() =>
      expect(
        useAppStore.getState().threads.find((thread) => thread.id === "thread-1")?.goal,
      ).toBeUndefined(),
    );
  });
});

describe("DraftContextBar composer plan chip", () => {
  beforeEach(() => {
    useAppStore.setState({
      threads: [{ id: "thread-1", projectId: "project-1", agentKind: "grok" }],
      runtimeItemIdsByThread: {},
      runtimeItemsByIdByThread: {},
    } as never);
  });

  it("adds a plan chip next to Local without removing the top-right capsule contract", () => {
    useAppStore.setState({
      threads: [{ id: "thread-1", projectId: "project-1", agentKind: "grok" }],
      runtimeItemIdsByThread: { "thread-1": ["plan-1"] },
      runtimeItemsByIdByThread: {
        "thread-1": {
          "plan-1": {
            id: "plan-1",
            type: "plan",
            state: "updated",
            payload: {
              steps: [
                { step: "Trace CrossAgents", status: "completed" },
                { step: "Fix runtime switch", status: "in_progress" },
                { step: "Add tests", status: "pending" },
              ],
            },
            streams: {},
          },
        },
      },
    } as never);

    render(
      <DraftContextBar
        project={project}
        threadId="thread-1"
        craftMode="auto"
        onCraftModeChange={() => undefined}
      />,
    );

    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.getByTestId("composer-plan-chip")).toHaveTextContent("1/3 Fix runtime switch");
    fireEvent.mouseEnter(screen.getByTestId("composer-plan-chip"));
    expect(screen.getByTestId("composer-plan-card")).toBeInTheDocument();
    expect(screen.getByText("计划进度")).toBeInTheDocument();
    expect(screen.getByText("Trace CrossAgents")).toBeInTheDocument();
    expect(screen.getByText("Add tests")).toBeInTheDocument();
  });

  it("shows a runtime /goal even when the durable thread.goal field is empty", () => {
    useAppStore.setState({
      threads: [{ id: "thread-1", projectId: "project-1", agentKind: "grok" }],
      runtimeItemIdsByThread: { "thread-1": ["goal-1"] },
      runtimeItemsByIdByThread: {
        "thread-1": {
          "goal-1": {
            id: "goal-1",
            type: "goal",
            state: "updated",
            payload: {
              action: "set",
              status: "active",
              objective: "Keep the original runtime on failed switch",
            },
            streams: {},
          },
        },
      },
    } as never);

    render(
      <DraftContextBar
        project={project}
        threadId="thread-1"
        craftMode="auto"
        onCraftModeChange={() => undefined}
      />,
    );

    expect(screen.getByTestId("goal-chip")).toHaveTextContent(
      "Keep the original runtime on failed switch",
    );
  });

  it("hosts the full goal dock to the right of Local with edit/pause/clear", () => {
    useAppStore.setState({
      threads: [{ id: "thread-1", projectId: "project-1", agentKind: "grok" }],
      runtimeItemIdsByThread: { "thread-1": ["goal-1"] },
      runtimeItemsByIdByThread: {
        "thread-1": {
          "goal-1": {
            id: "goal-1",
            type: "goal",
            state: "updated",
            payload: {
              action: "set",
              status: "active",
              objective: "每十分钟检查一次 持续监控",
              availableActions: ["edit", "pause", "clear"],
            },
            streams: {},
          },
        },
      },
    } as never);

    render(
      <DraftContextBar
        project={project}
        threadId="thread-1"
        craftMode="auto"
        onCraftModeChange={() => undefined}
      />,
    );

    expect(screen.getByText("Local")).toBeInTheDocument();
    const dock = screen.getByLabelText("Thread goal dock");
    expect(dock).toHaveAttribute("data-placement", "context-bar");
    expect(dock).toHaveTextContent("每十分钟检查一次 持续监控");
    expect(screen.getByRole("button", { name: "Edit goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear goal" })).toBeInTheDocument();
  });
});

