// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTask } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useScheduleStore } from "@/renderer/state/scheduleStore";
import { ThreadScheduleIndicator } from "./ThreadScheduleIndicator";

const threadId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function task(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Daily brief",
    prompt: "x",
    agentKind: "codex",
    config: { model: "gpt-5.6" },
    recurrence: { kind: "hourly", minute: 0 },
    enabled: true,
    sourceThreadId: threadId,
    threadTarget: { kind: "new" },
    nextRunAt: "2026-07-13T15:00:00.000Z",
    lastRunAt: null,
    lastCompletedAt: null,
    lastStatus: "never",
    lastResult: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const bridge = vi.hoisted(() => ({
  runScheduleNow: vi.fn<(input: { id: string }) => Promise<unknown>>(),
  pauseSchedule: vi.fn<(input: { id: string }) => Promise<unknown>>(),
  resumeSchedule: vi.fn<(input: { id: string }) => Promise<unknown>>(),
  deleteSchedule: vi.fn<(input: { id: string }) => Promise<void>>(),
  getSchedules: vi.fn<() => Promise<ScheduledTask[]>>(),
}));

const nav = vi.hoisted(() => ({
  openSchedules: vi.fn<() => void>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: Object.assign(
    (selector: (state: { openSchedules: () => void }) => unknown) =>
      selector({ openSchedules: nav.openSchedules }),
    { getState: () => ({ openSchedules: nav.openSchedules }) },
  ),
}));

function seedTasks(tasks: ScheduledTask[]) {
  act(() => {
    useScheduleStore.setState({ tasks });
  });
}

describe("ThreadScheduleIndicator", () => {
  beforeEach(() => {
    bridge.pauseSchedule.mockResolvedValue({});
    bridge.resumeSchedule.mockResolvedValue({});
    bridge.deleteSchedule.mockResolvedValue(undefined);
    bridge.getSchedules.mockResolvedValue([]);
  });

  afterEach(() => {
    useScheduleStore.setState({
      tasks: [],
      loading: false,
      focusedScheduleId: null,
      editingScheduleId: null,
    });
    nav.openSchedules.mockReset();
    bridge.pauseSchedule.mockReset();
    bridge.resumeSchedule.mockReset();
    bridge.deleteSchedule.mockReset();
    bridge.getSchedules.mockReset();
  });

  it("renders nothing when the thread has no related schedules", () => {
    seedTasks([task({ sourceThreadId: null })]);
    const { container } = render(<ThreadScheduleIndicator threadId={threadId} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a single schedule status and opens the popover", () => {
    seedTasks([task({})]);
    render(<ThreadScheduleIndicator threadId={threadId} />);
    fireEvent.click(screen.getByTestId("thread-schedule-indicator"));
    expect(screen.getByTestId("thread-schedule-popover")).toHaveTextContent("Daily brief");
  });

  it("shows the related schedule count when there are several", () => {
    seedTasks([
      task({}),
      task({
        id: "22222222-2222-4222-8222-222222222222",
        name: "Second",
        targetThreadId: threadId,
        threadTarget: { kind: "existing", threadId },
        sourceThreadId: null,
      }),
      task({
        id: "33333333-3333-4333-8333-333333333333",
        name: "Third",
      }),
    ]);
    render(<ThreadScheduleIndicator threadId={threadId} />);
    expect(screen.getByTestId("thread-schedule-indicator")).toHaveTextContent("3");
  });

  it("offers pause, edit and delete actions — no ambiguous duplicate play button", () => {
    seedTasks([task({})]);
    render(<ThreadScheduleIndicator threadId={threadId} />);
    fireEvent.click(screen.getByTestId("thread-schedule-indicator"));

    const popover = screen.getByTestId("thread-schedule-popover");
    expect(within(popover).getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(within(popover).getByRole("button", { name: "Edit schedule" })).toBeInTheDocument();
    expect(within(popover).getByRole("button", { name: "Delete schedule" })).toBeInTheDocument();
    expect(within(popover).queryByRole("button", { name: "Run now" })).not.toBeInTheDocument();
  });

  it("pauses a schedule from the popover", async () => {
    seedTasks([task({})]);
    render(<ThreadScheduleIndicator threadId={threadId} />);
    fireEvent.click(screen.getByTestId("thread-schedule-indicator"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });
    expect(bridge.pauseSchedule).toHaveBeenCalledWith({
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("resumes a paused schedule from the popover", async () => {
    seedTasks([task({ enabled: false, nextRunAt: null })]);
    render(<ThreadScheduleIndicator threadId={threadId} />);
    fireEvent.click(screen.getByTestId("thread-schedule-indicator"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    });
    expect(bridge.resumeSchedule).toHaveBeenCalledWith({
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("routes Edit to the schedules page with the editor requested", () => {
    seedTasks([task({})]);
    render(<ThreadScheduleIndicator threadId={threadId} />);
    fireEvent.click(screen.getByTestId("thread-schedule-indicator"));

    fireEvent.click(screen.getByRole("button", { name: "Edit schedule" }));

    const store = useScheduleStore.getState();
    expect(store.editingScheduleId).toBe("11111111-1111-4111-8111-111111111111");
    expect(store.focusedScheduleId).toBe("11111111-1111-4111-8111-111111111111");
    expect(nav.openSchedules).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("thread-schedule-popover")).not.toBeInTheDocument();
  });

  it("deletes a schedule only after confirmation", async () => {
    seedTasks([task({})]);
    render(<ThreadScheduleIndicator threadId={threadId} />);
    fireEvent.click(screen.getByTestId("thread-schedule-indicator"));

    fireEvent.click(screen.getByRole("button", { name: "Delete schedule" }));
    expect(await screen.findByText("Delete schedule?")).toBeInTheDocument();
    expect(bridge.deleteSchedule).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    expect(bridge.deleteSchedule).toHaveBeenCalledWith({
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("dismisses the delete confirmation without deleting", async () => {
    seedTasks([task({})]);
    render(<ThreadScheduleIndicator threadId={threadId} />);
    fireEvent.click(screen.getByTestId("thread-schedule-indicator"));

    fireEvent.click(screen.getByRole("button", { name: "Delete schedule" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    });

    await waitFor(() => expect(screen.queryByText("Delete schedule?")).not.toBeInTheDocument());
    expect(bridge.deleteSchedule).not.toHaveBeenCalled();
  });

  it("disappears after the last related schedule is removed", () => {
    seedTasks([task({})]);
    const { rerender } = render(<ThreadScheduleIndicator threadId={threadId} />);
    expect(screen.getByTestId("thread-schedule-indicator")).toBeInTheDocument();
    seedTasks([]);
    rerender(<ThreadScheduleIndicator threadId={threadId} />);
    expect(screen.queryByTestId("thread-schedule-indicator")).not.toBeInTheDocument();
  });
});
