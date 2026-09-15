import { describe, expect, it } from "vitest";
import { scheduledTaskInputSchema } from "./contracts/schedule";
import {
  nextScheduleRunAt,
  normalizeScheduleThreadTarget,
  scheduleContinuesThread,
  scheduleRelatesToThread,
  scheduleThreadTarget,
} from "./schedules";

describe("nextScheduleRunAt", () => {
  it("finds the next hourly boundary at the selected minute", () => {
    const now = new Date(2026, 6, 10, 8, 15, 0, 0);
    expect(nextScheduleRunAt({ kind: "hourly", minute: 15 }, now.getTime())).toBe(
      new Date(2026, 6, 10, 9, 15, 0, 0).toISOString(),
    );
    expect(nextScheduleRunAt({ kind: "hourly", minute: 30 }, now.getTime())).toBe(
      new Date(2026, 6, 10, 8, 30, 0, 0).toISOString(),
    );
  });

  it("finds the next selected local weekday and skips the current instant", () => {
    const monday = new Date(2026, 6, 6, 8, 0, 0, 0);
    const next = nextScheduleRunAt(
      { kind: "weekly", days: [1, 3], time: "08:00" },
      monday.getTime(),
    );
    expect(next).toBe(new Date(2026, 6, 8, 8, 0, 0, 0).toISOString());
  });

  it("finds the next interval tick aligned to minute boundaries", () => {
    const now = Date.parse("2026-07-10T12:03:20.000Z");
    expect(nextScheduleRunAt({ kind: "interval", everyMinutes: 10 }, now)).toBe(
      "2026-07-10T12:13:00.000Z",
    );
    const onTick = Date.parse("2026-07-10T12:10:00.000Z");
    expect(nextScheduleRunAt({ kind: "interval", everyMinutes: 10 }, onTick)).toBe(
      "2026-07-10T12:20:00.000Z",
    );
    expect(nextScheduleRunAt({ kind: "interval", everyMinutes: 1 }, onTick)).toBe(
      "2026-07-10T12:11:00.000Z",
    );
  });

  it("returns a future one-time run and drops a missed one", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    expect(nextScheduleRunAt({ kind: "once", runAt: "2026-07-10T13:00:00.000Z" }, now)).toBe(
      "2026-07-10T13:00:00.000Z",
    );
    expect(nextScheduleRunAt({ kind: "once", runAt: "2026-07-10T11:00:00.000Z" }, now)).toBeNull();
  });

  it("accepts once.runAt with an explicit timezone offset", () => {
    const parsed = scheduledTaskInputSchema.parse({
      name: "Offset once",
      prompt: "Ping",
      agentKind: "grok",
      config: { model: "grok-4.6" },
      recurrence: { kind: "once", runAt: "2026-09-09T20:14:35.716+08:00" },
      enabled: true,
      timezone: "Asia/Shanghai",
    });
    expect(parsed.recurrence).toEqual({
      kind: "once",
      runAt: "2026-09-09T20:14:35.716+08:00",
    });
    const now = Date.parse("2026-09-09T11:00:00.000Z");
    expect(nextScheduleRunAt(parsed.recurrence, now)).toBe("2026-09-09T12:14:35.716Z");
  });

  it("computes weekly runs in the schedule time zone", () => {
    // Monday 2026-07-06 07:00 UTC = 15:00 Shanghai. Next weekday 08:00 Shanghai
    // is Tuesday 00:00 UTC.
    const now = Date.parse("2026-07-06T07:00:00.000Z");
    const next = nextScheduleRunAt(
      { kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" },
      now,
      "Asia/Shanghai",
    );
    expect(next).toBe("2026-07-07T00:00:00.000Z");
  });

  it("rejects an invalid time zone", () => {
    const now = Date.parse("2026-07-06T07:00:00.000Z");
    expect(
      nextScheduleRunAt({ kind: "weekly", days: [1], time: "08:00" }, now, "Not/AZone"),
    ).toBeNull();
  });

  it("walks America/Los_Angeles weekly times across the spring DST gap", () => {
    // 2026-03-08 02:00–02:59 local is skipped. A 02:30 weekly time must still
    // resolve to a real instant, not a nonexistent wall clock.
    const next = nextScheduleRunAt(
      { kind: "weekly", days: [0], time: "02:30" },
      Date.parse("2026-03-08T09:00:00.000Z"),
      "America/Los_Angeles",
    );
    expect(next).not.toBeNull();
    const wall = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(next!));
    expect(wall.replace(/^24:/, "00:")).not.toBe("02:30");
  });

  it("keeps sourceThreadId independent from threadTarget", () => {
    const created = {
      sourceThreadId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      targetThreadId: null,
      threadTarget: { kind: "new" as const },
    };
    const continues = {
      sourceThreadId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      targetThreadId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      threadTarget: {
        kind: "existing" as const,
        threadId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      },
    };
    expect(scheduleRelatesToThread(created, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(true);
    expect(scheduleRelatesToThread(created, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff")).toBe(false);
    expect(scheduleRelatesToThread(continues, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff")).toBe(true);
    expect(scheduleContinuesThread(created, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(false);
    expect(scheduleContinuesThread(continues, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff")).toBe(true);
    expect(scheduleContinuesThread(continues, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(false);
    expect(scheduleThreadTarget(created)).toEqual({ kind: "new" });
    expect(normalizeScheduleThreadTarget({ targetThreadId: continues.targetThreadId })).toEqual({
      threadTarget: continues.threadTarget,
      targetThreadId: continues.targetThreadId,
    });
  });
});
