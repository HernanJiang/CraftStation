import { describe, expect, it, vi } from "vitest";
import type { ScheduledTask, ScheduledTaskInput } from "@/shared/contracts";
import { ScheduleService, type ScheduleStore } from "./ScheduleService";

function memoryStore(): ScheduleStore {
  const tasks = new Map<string, ScheduledTask>();
  return {
    list: () => [...tasks.values()],
    get: (id) => tasks.get(id) ?? null,
    upsert: (task) => tasks.set(task.id, task),
    delete: (id) => {
      tasks.delete(id);
    },
  };
}

const input: ScheduledTaskInput = {
  name: "Daily brief",
  prompt: "Summarize today's priorities.",
  agentKind: "claude:home",
  config: { model: "claude-fable-5", effort: "high" },
  recurrence: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" },
  enabled: true,
};

describe("ScheduleService", () => {
  it("creates device schedules with a future next run and no project fields", () => {
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const service = new ScheduleService({
      store: memoryStore(),
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
    });
    const task = service.create(input);

    expect(task.nextRunAt).toBe(new Date(2026, 6, 6, 8, 0).toISOString());
    expect(task).not.toHaveProperty("projectId");
    expect(task.lastStatus).toBe("never");
  });

  it("lists run history from the store after requiring the schedule", () => {
    const store = memoryStore();
    const service = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => new Date(2026, 6, 6, 7, 0).getTime(),
    });
    const task = service.create(input);
    const run = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      scheduleId: task.id,
      threadId: "ffffffff-0000-4111-8222-333333333333",
      triggeredBy: "manual" as const,
      startedAt: "2026-09-09T12:11:50.541Z",
      completedAt: "2026-09-09T12:11:58.242Z",
      status: "succeeded" as const,
      summary: "SCHEDULE_SCHEMA_OK",
      error: null,
    };
    store.listRuns = () => [run];
    expect(service.listRuns(task.id)).toEqual([run]);
    expect(() => service.listRuns("00000000-0000-4000-8000-000000000000")).toThrow(/not found/i);
  });

  it("coalesces overlapping due runs and advances to the next occurrence", async () => {
    const store = memoryStore();
    let now = new Date(2026, 6, 6, 7, 0).getTime();
    let resolveRun!: (output: string) => void;
    const runTask = vi.fn<() => Promise<string>>(
      () => new Promise<string>((resolve) => (resolveRun = resolve)),
    );
    const service = new ScheduleService({ store, runTask, now: () => now });
    const task = service.create(input);

    now = new Date(2026, 6, 6, 8, 0).getTime();
    service.tick();
    service.tick();
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(store.get(task.id)?.lastStatus).toBe("running");
    expect(store.get(task.id)?.nextRunAt).toBe(new Date(2026, 6, 7, 8, 0).toISOString());

    now += 1_000;
    resolveRun("Done");
    await vi.waitFor(() => expect(store.get(task.id)?.lastStatus).toBe("succeeded"));
    expect(store.get(task.id)?.lastResult).toBe("Done");
  });

  it("marks dangling runs interrupted for tasks left running on startup", () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 9, 0).getTime();
    const service = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
    });
    const task = service.create(input);
    // Simulate a prior process that died mid-run.
    store.upsert({ ...service.list()[0]!, lastStatus: "running" });

    const onStartupInterrupted = vi.fn<(scheduleId: string) => void>();
    const restarted = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      onStartupInterrupted,
      now: () => now,
    });
    restarted.start();

    expect(onStartupInterrupted).toHaveBeenCalledWith(task.id);
    expect(store.get(task.id)?.lastStatus).toBe("interrupted");
    restarted.dispose();
  });

  it("does not invoke the interrupted hook for tasks that were not running", () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 9, 0).getTime();
    const seed = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
    });
    seed.create(input);

    const onStartupInterrupted = vi.fn<(scheduleId: string) => void>();
    const service = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      onStartupInterrupted,
      now: () => now,
    });
    service.start();

    expect(onStartupInterrupted).not.toHaveBeenCalled();
    service.dispose();
  });

  it("does not resurrect a task deleted while its run is in flight", async () => {
    const store = memoryStore();
    let resolveRun!: (output: string) => void;
    const service = new ScheduleService({
      store,
      runTask: () => new Promise<string>((resolve) => (resolveRun = resolve)),
      now: () => new Date(2026, 6, 6, 7, 0).getTime(),
    });
    const task = service.create(input);
    service.runNow(task.id);
    service.delete(task.id);
    resolveRun("Late result");
    await Promise.resolve();
    expect(store.get(task.id)).toBeNull();
  });

  it("pauses and resumes through one unified store", () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const service = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
    });
    const task = service.create(input);
    expect(task.enabled).toBe(true);

    const paused = service.pause(task.id);
    expect(paused.enabled).toBe(false);
    expect(paused.nextRunAt).toBeNull();

    const resumed = service.resume(task.id);
    expect(resumed.enabled).toBe(true);
    expect(resumed.nextRunAt).toBe(new Date(2026, 6, 6, 8, 0).toISOString());
  });

  it("computes the next run in the schedule time zone", () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const service = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
    });
    const task = service.create({ ...input, timezone: "Asia/Shanghai" });
    expect(task.timezone).toBe("Asia/Shanghai");
    expect(task.nextRunAt).not.toBeNull();
  });

  it("runNow does not consume the next scheduled occurrence", async () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const runTask = vi.fn<() => Promise<string>>().mockResolvedValue("ok");
    const service = new ScheduleService({ store, runTask, now: () => now });
    const task = service.create(input);
    const nextRunAt = task.nextRunAt;
    service.runNow(task.id);
    await vi.waitFor(() => expect(store.get(task.id)?.lastStatus).toBe("succeeded"));
    expect(store.get(task.id)?.nextRunAt).toBe(nextRunAt);
  });

  it("does not re-run a claimed occurrence after a process restart", () => {
    const claims = new Set<string>();
    const store = memoryStore();
    store.claimOccurrence = (scheduleId, occurrenceAt) => {
      const key = `${scheduleId}:${occurrenceAt}`;
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    };
    const runTask = vi.fn<() => Promise<string>>().mockResolvedValue("ok");
    let now = new Date(2026, 6, 6, 7, 0).getTime();
    const first = new ScheduleService({ store, runTask, now: () => now });
    const task = first.create(input);
    now = new Date(2026, 6, 6, 8, 0).getTime();
    first.tick();
    expect(runTask).toHaveBeenCalledTimes(1);

    const restarted = new ScheduleService({ store, runTask, now: () => now });
    restarted.tick();
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(store.get(task.id)?.nextRunAt).not.toBe(task.nextRunAt);
    first.dispose();
    restarted.dispose();
  });

  it("notifies listeners after every mutation", async () => {
    const store = memoryStore();
    const onChanged = vi.fn<() => void>();
    const service = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>().mockResolvedValue("ok"),
      onChanged,
      now: () => new Date(2026, 6, 6, 7, 0).getTime(),
    });
    const task = service.create(input);
    service.pause(task.id);
    service.resume(task.id);
    service.runNow(task.id);
    await vi.waitFor(() => expect(store.get(task.id)?.lastStatus).toBe("succeeded"));
    expect(onChanged.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
