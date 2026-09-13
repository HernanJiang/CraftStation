import { forwardRef, type ReactNode } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { Project, ScheduledTask, Thread } from "@/shared/contracts";
import { useScheduleStore } from "@/renderer/state/scheduleStore";
import { SortableThreadItem } from "./SortableThreadItem";

type MockContextMenuItem = {
  id: string;
  isDisabled?: boolean;
  disabledReason?: string;
};

const {
  sortableRefMock,
  sortableHandleRefMock,
  sortableOptionsMock,
  contextMenuItemsMock,
  getStatusToneMock,
  useThreadHasBackgroundActivityMock,
  useThreadHasDraftMock,
  toggleStarThreadMock,
  archiveThreadMock,
} = vi.hoisted(() => ({
  sortableRefMock: vi.fn<(element: HTMLElement | null) => void>(),
  sortableHandleRefMock: vi.fn<(element: HTMLElement | null) => void>(),
  sortableOptionsMock: vi.fn<(options: unknown) => void>(),
  contextMenuItemsMock: vi.fn<(items: MockContextMenuItem[]) => void>(),
  getStatusToneMock:
    vi.fn<(thread: Thread, opts?: { hasBackgroundActivity?: boolean }) => string>(),
  useThreadHasBackgroundActivityMock: vi.fn<(threadId: string) => boolean>(),
  useThreadHasDraftMock: vi.fn<(threadId: string) => boolean>(),
  toggleStarThreadMock: vi.fn<(threadId: string) => void>(),
  archiveThreadMock: vi.fn<(threadId: string) => void>(),
}));

vi.mock("@dnd-kit/react", () => ({
  useDraggable: () => undefined,
}));

vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: (options: unknown) => {
    sortableOptionsMock(options);
    return { ref: sortableRefMock, handleRef: sortableHandleRefMock };
  },
}));

vi.mock("@/renderer/dnd", () => ({
  useIsDraggingThread: () => false,
}));

vi.mock("@/renderer/components/common/ContextMenu", () => ({
  ContextMenu: (props: { children: ReactNode; items: MockContextMenuItem[] }) => {
    contextMenuItemsMock(props.items);
    return <>{props.children}</>;
  },
}));

vi.mock("@/renderer/components/common/SidebarButton", () => ({
  SidebarButton: forwardRef<HTMLDivElement, { label: ReactNode; suffix?: ReactNode }>(
    (props, ref) => (
      <div ref={ref} role="button">
        {props.label}
        {props.suffix}
      </div>
    ),
  ),
}));

vi.mock("@/renderer/components/providers/ThreadProviderIcon", () => ({
  ThreadProviderIcon: () => null,
}));

vi.mock("@/renderer/views/MainView/parts/Sidebar/parts/GitBadge", () => ({
  GitBadge: (props: { projectName: string }) => (
    <button type="button" aria-label={`Git status for ${props.projectName}`} />
  ),
}));

vi.mock("@/renderer/views/MainView/parts/Sidebar/parts/SyncBadge", () => ({
  SyncBadge: (props: { projectId: string; worktreePath?: string }) => (
    <span data-testid="sync-badge">
      {props.projectId}:{props.worktreePath ?? "project"}
    </span>
  ),
}));

vi.mock("@/renderer/components/providers/statusTone", () => ({
  getStatusTone: getStatusToneMock,
}));

vi.mock("@/renderer/hooks/uiSelectors", () => ({
  useCurrentThreadIdsCount: () => 1,
  useProjectAgentStatuses: () => [],
  useIsCurrentThread: () => false,
  useThreadHasBackgroundActivity: (threadId: string) =>
    useThreadHasBackgroundActivityMock(threadId),
  useThreadHasDraft: (threadId: string) => useThreadHasDraftMock(threadId),
  useIsProjectFilesPanelActive: () => false,
  useIsProjectGitPanelActive: () => false,
  useIsProjectTerminalActive: () => false,
  useIsProjectTerminalBusy: () => false,
  useIsProjectTerminalOpen: () => false,
  useIsWorktreeFilesPanelActive: () => false,
  useIsWorktreeGitPanelActive: () => false,
  useIsWorktreeTerminalActive: () => false,
  useIsWorktreeTerminalBusy: () => false,
  useIsWorktreeTerminalOpen: () => false,
  useRunningProjectActionIds: () => [],
}));

vi.mock("@/renderer/views/MainView/parts/Sidebar/parts/useWorktreeActions", () => ({
  useWorktreeGitItems: () => [],
}));

vi.mock("@/renderer/actions/gitActions", () => ({
  gitPull: vi.fn<() => void>(),
  gitPush: vi.fn<() => void>(),
  gitSync: vi.fn<() => void>(),
  gitPullFromSource: vi.fn<() => void>(),
  gitMergeToSource: vi.fn<() => void>(),
  gitMergeAndRemove: vi.fn<() => void>(),
}));

vi.mock("@/renderer/actions/panelActions", () => ({
  openGitReview: vi.fn<() => void>(),
}));

vi.mock("@/renderer/actions/threadActions", () => ({
  openThread: vi.fn<() => void>(),
  archiveThread: archiveThreadMock,
  requestDeleteThread: vi.fn<() => void>(),
  unloadThread: vi.fn<() => void>(),
  toggleMarkThreadDone: vi.fn<() => void>(),
  toggleStarThread: toggleStarThreadMock,
  deleteThread: vi.fn<() => void>(),
  renameThread: vi.fn<() => void>(),
  continueInProvider: vi.fn<() => void>(),
}));

vi.mock("@/renderer/actions/terminalActions", () => ({
  runProjectAction: vi.fn<() => void>(),
  openWorktreeTerminal: vi.fn<() => void>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({ openExternal: vi.fn<(url: string) => void>() }),
}));

vi.mock("@/renderer/state/gitStore", () => {
  const state = { prData: {} };
  return {
    useGitStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Thread 1",
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-03-21T10:00:00.000Z",
    ...overrides,
  };
}

function relatedSchedule(): ScheduledTask {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Check training",
    prompt: "x",
    agentKind: "codex",
    config: { model: "gpt-5.6" },
    recurrence: { kind: "interval", everyMinutes: 10 },
    enabled: true,
    sourceThreadId: "thread-1",
    threadTarget: { kind: "new" },
    nextRunAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    lastStatus: "never",
    lastResult: null,
    lastError: null,
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-03-21T10:00:00.000Z",
  };
}

const project: Project = {
  id: "project-1",
  name: "Project",
  location: { kind: "windows", path: "C:\\repo" },
  createdAt: "2026-03-21T10:00:00.000Z",
};

describe("SortableThreadItem", () => {
  beforeEach(async () => {
    const { useNotificationStore } = await import("@/renderer/state/notificationStore");
    useNotificationStore.getState().clear();
    sortableRefMock.mockClear();
    sortableHandleRefMock.mockClear();
    sortableOptionsMock.mockClear();
    contextMenuItemsMock.mockClear();
    toggleStarThreadMock.mockClear();
    archiveThreadMock.mockClear();
    getStatusToneMock.mockReset();
    getStatusToneMock.mockReturnValue("default");
    useThreadHasBackgroundActivityMock.mockReset();
    useThreadHasBackgroundActivityMock.mockReturnValue(false);
    useThreadHasDraftMock.mockReset();
    useThreadHasDraftMock.mockReturnValue(false);
    useScheduleStore.setState({ tasks: [], loading: false, focusedScheduleId: null });
  });

  it("keeps the row visually working while the thread has background activity", () => {
    const thread = makeThread();
    useThreadHasBackgroundActivityMock.mockReturnValue(true);

    render(
      <SortableThreadItem
        thread={thread}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    expect(getStatusToneMock).toHaveBeenCalledWith(thread, { hasBackgroundActivity: true });
  });

  it("keeps the thread title on a single truncated line", () => {
    const { getByText } = render(
      <SortableThreadItem
        thread={makeThread({ title: "统一 Schedule Capability 与线程 Schedule 指示器" })}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    const title = getByText("统一 Schedule Capability 与线程 Schedule 指示器");
    expect(title.className).toContain("truncate");
    expect(title.className).not.toContain("whitespace-normal");
  });

  it("shows the draft dot in the far-right suffix when the thread has an unsent draft", () => {
    useThreadHasDraftMock.mockReturnValue(true);

    const { getByLabelText } = render(
      <SortableThreadItem
        thread={makeThread()}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    const draft = getByLabelText("Has unsent draft");
    expect(draft.parentElement?.className).toContain("justify-end");
  });

  it("shows an unread notification dot on the far right of the row", async () => {
    const { useNotificationStore } = await import("@/renderer/state/notificationStore");
    useNotificationStore.getState().clear();
    useNotificationStore.getState().push({
      tone: "success",
      title: "Assistant",
      status: "Done",
      threadId: "thread-1",
    });

    const { getByTestId } = render(
      <SortableThreadItem
        thread={makeThread()}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    const dot = getByTestId("thread-unread-notification-dot");
    expect(dot.parentElement?.className).toContain("justify-end");
  });

  it("hides the draft dot when the thread has no draft", () => {
    const { queryByLabelText } = render(
      <SortableThreadItem
        thread={makeThread()}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    expect(queryByLabelText("Has unsent draft")).not.toBeInTheDocument();
  });

  it("keeps the working spinner when a related schedule is bound to a live turn", () => {
    getStatusToneMock.mockReturnValue("working");
    useScheduleStore.setState({
      tasks: [relatedSchedule()],
      loading: false,
      focusedScheduleId: null,
    });

    const { queryByTestId, getByLabelText } = render(
      <SortableThreadItem
        thread={makeThread({ status: "working" })}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    expect(getByLabelText("Working")).toBeInTheDocument();
    expect(queryByTestId("thread-schedule-clock")).not.toBeInTheDocument();
  });

  it("shows a clock on a settled thread that still has a related schedule", () => {
    getStatusToneMock.mockReturnValue("finished");
    useScheduleStore.setState({
      tasks: [relatedSchedule()],
      loading: false,
      focusedScheduleId: null,
    });

    const { getByTestId, queryByLabelText } = render(
      <SortableThreadItem
        thread={makeThread({
          status: "finished",
          lastTurnEndedAt: "2026-03-21T10:05:00.000Z",
        })}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    expect(getByTestId("thread-schedule-clock")).toBeInTheDocument();
    expect(queryByLabelText("Working")).not.toBeInTheDocument();
    expect(queryByLabelText("Completed")).not.toBeInTheDocument();
  });

  it("keeps pin, more, and direct archive as the row hover actions", () => {
    const thread = makeThread();

    render(
      <SortableThreadItem
        thread={thread}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pin Thread 1" }));
    expect(toggleStarThreadMock).toHaveBeenCalledWith(thread.id);
    expect(screen.getByRole("button", { name: "More actions for Thread 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Archive Thread 1" }));
    expect(archiveThreadMock).toHaveBeenCalledWith(thread.id);
    expect(screen.queryByRole("button", { name: "Rename Thread 1" })).not.toBeInTheDocument();
  });

  it("shows a green completion point and a working spinner without elapsed time or git chrome", () => {
    getStatusToneMock.mockReturnValueOnce("done");
    const { rerender } = render(
      <SortableThreadItem
        thread={{ ...makeThread(), done: true }}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    expect(screen.getByLabelText("Completed")).toHaveClass("bg-emerald-500", "size-1.5");
    expect(screen.queryByText(/\d+h/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("sync-badge")).not.toBeInTheDocument();

    getStatusToneMock.mockReturnValueOnce("working");
    rerender(
      <SortableThreadItem
        thread={{ ...makeThread(), status: "working" }}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );
    expect(screen.getByLabelText("Working")).toHaveClass("animate-spin");
  });

  it("registers the row element as the sortable element", () => {
    const { container } = render(
      <SortableThreadItem
        thread={makeThread()}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    const row = container.firstElementChild;

    expect(row).toBeInstanceOf(HTMLElement);
    expect(sortableRefMock).toHaveBeenCalledWith(row);
  });

  it("registers the nested sidebar row as the drag handle", () => {
    render(
      <SortableThreadItem
        thread={makeThread()}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    const handle = sortableHandleRefMock.mock.calls.at(-1)?.[0];

    expect(handle).toBeInstanceOf(HTMLDivElement);
    expect(handle).toHaveTextContent("Thread 1");
  });

  it("keeps automatic-sort rows draggable into panes while disabling sidebar reordering", () => {
    render(
      <SortableThreadItem
        thread={makeThread()}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
        sortDisabled
      />,
    );

    expect(sortableOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread",
        accept: [],
        disabled: false,
      }),
    );
  });

  it("enables unload for a loaded thread without a session ref", () => {
    render(
      <SortableThreadItem
        thread={makeThread()}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    const unloadItem = contextMenuItemsMock.mock.calls
      .at(-1)?.[0]
      .find((item) => item.id === "unload");

    expect(unloadItem).toMatchObject({ id: "unload" });
    expect(unloadItem?.isDisabled).toBe(false);
    expect(unloadItem?.disabledReason).toBeUndefined();
  });

  it("keeps unload disabled for already unloaded threads", () => {
    render(
      <SortableThreadItem
        thread={{ ...makeThread(), status: "inactive" }}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    const unloadItem = contextMenuItemsMock.mock.calls
      .at(-1)?.[0]
      .find((item) => item.id === "unload");

    expect(unloadItem).toMatchObject({
      id: "unload",
      isDisabled: true,
      disabledReason: "Thread is already unloaded.",
    });
  });

  it("keeps flat-list thread rows free of project, sync, git, files, and terminal chrome", () => {
    render(
      <SortableThreadItem
        thread={makeThread()}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="flat:__flat__"
        projectTag={<span>{project.name}</span>}
      />,
    );

    expect(screen.queryByText("Project")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sync-badge")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Git status for Project" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Files for Project" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Terminal for Project" })).not.toBeInTheDocument();
  });

  it("keeps inline rename without restoring flat-list metadata chrome", () => {
    render(
      <SortableThreadItem
        thread={makeThread()}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId="thread-1"
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="flat:__flat__"
        projectTag={<span>{project.name}</span>}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Rename thread" })).toHaveValue("Thread 1");
    expect(screen.queryByText("Project")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sync-badge")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Git status for Project" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Files for Project" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Terminal for Project" })).not.toBeInTheDocument();
  });

  it("omits project-scoped row chrome in grouped lists, where the project header carries it", () => {
    render(
      <SortableThreadItem
        thread={makeThread()}
        threadIndex={1}
        project={project}
        showWorktreeBadge={false}
        editingThreadId={null}
        setEditingThreadId={vi.fn<(id: string | null) => void>()}
        group="project-entries:project-1"
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Git status for Project" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("sync-badge")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Files for Project" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Terminal for Project" })).not.toBeInTheDocument();
  });
});
