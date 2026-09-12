// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("ThreadScheduleIndicator", () => {
  afterEach(() => {
    useScheduleStore.setState({ tasks: [], loading: false, focusedScheduleId: null });
    nav.openSchedules.mockReset();
  });

  it("renders nothing when the thread has no related schedules", () => {
    useScheduleStore.setState({ tasks: [task({ sourceThreadId: null })] });
    const { container } = render(<ThreadScheduleIndicator threadId={threadId} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a single schedule status and opens the popover", () => {
    useScheduleStore.setState({ tasks: [task({})] });
    render(<ThreadScheduleIndicator threadId={threadId} />);
    fireEvent.click(screen.getByTestId("thread-schedule-indicator"));
    expect(screen.getByTestId("thread-schedule-popover")).toHaveTextContent("Daily brief");
  });

  it("shows the related schedule count when there are several", () => {
    useScheduleStore.setState({
      tasks: [
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
      ],
    });
    render(<ThreadScheduleIndicator threadId={threadId} />);
    expect(screen.getByTestId("thread-schedule-indicator")).toHaveTextContent("3");
  });

  it("disappears after the last related schedule is removed", () => {
    useScheduleStore.setState({ tasks: [task({})] });
    const { rerender } = render(<ThreadScheduleIndicator threadId={threadId} />);
    expect(screen.getByTestId("thread-schedule-indicator")).toBeInTheDocument();
    useScheduleStore.setState({ tasks: [] });
    rerender(<ThreadScheduleIndicator threadId={threadId} />);
    expect(screen.queryByTestId("thread-schedule-indicator")).not.toBeInTheDocument();
  });
});
