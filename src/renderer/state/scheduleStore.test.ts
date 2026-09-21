import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTask } from "@/shared/contracts";
import { selectSchedulesForThread, startScheduleSync, useScheduleStore } from "./scheduleStore";

const threadA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const threadB = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const related: ScheduledTask = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "From A",
  prompt: "x",
  agentKind: "codex",
  config: { model: "gpt-5.6" },
  recurrence: { kind: "hourly", minute: 0 },
  enabled: true,
  sourceThreadId: threadA,
  threadTarget: { kind: "new" },
  nextRunAt: null,
  lastRunAt: null,
  lastCompletedAt: null,
  lastStatus: "never",
  lastResult: null,
  lastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const continues: ScheduledTask = {
  ...related,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Continues A",
  sourceThreadId: threadB,
  targetThreadId: threadA,
  threadTarget: { kind: "existing", threadId: threadA },
};

const unrelated: ScheduledTask = {
  ...related,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Other",
  sourceThreadId: threadB,
  threadTarget: { kind: "new" },
};

const bridge = vi.hoisted(() => ({
  getSchedules: vi.fn<() => Promise<ScheduledTask[]>>(),
  onSchedulesChanged: vi.fn<(listener: () => void) => () => void>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

describe("scheduleStore", () => {
  afterEach(() => {
    useScheduleStore.setState({
      tasks: [],
      loading: false,
      focusedScheduleId: null,
      editingScheduleId: null,
    });
    bridge.getSchedules.mockReset();
    bridge.onSchedulesChanged.mockReset();
  });

  it("selects schedules by sourceThreadId or existing threadTarget", () => {
    expect(selectSchedulesForThread([related, continues, unrelated], threadA)).toEqual([
      related,
      continues,
    ]);
    expect(selectSchedulesForThread([related, continues, unrelated], threadB)).toEqual([
      continues,
      unrelated,
    ]);
  });

  it("refetches from ScheduleService on host change events", async () => {
    let listener: (() => void) | undefined;
    bridge.onSchedulesChanged.mockImplementation((cb) => {
      listener = cb;
      return () => undefined;
    });
    bridge.getSchedules.mockResolvedValueOnce([]).mockResolvedValueOnce([related]);
    const stop = startScheduleSync();
    await vi.waitFor(() => expect(bridge.getSchedules).toHaveBeenCalledTimes(1));
    listener?.();
    await vi.waitFor(() => expect(useScheduleStore.getState().tasks).toEqual([related]));
    stop();
  });
});
