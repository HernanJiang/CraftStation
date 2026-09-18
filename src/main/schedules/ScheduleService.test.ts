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

  it("deletes schedules that continue an archived thread and keeps detached ones", () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const service = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
    });
    const threadId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const continues = service.create({
      ...input,
      name: "Continues archived",
      targetThreadId: threadId,
    });
    const detached = service.create({
      ...input,
      name: "Detached",
      sourceThreadId: threadId,
      threadTarget: { kind: "new" },
    });

    expect(service.deleteContinuingThread(threadId)).toEqual([continues.id]);
    expect(store.get(continues.id)).toBeNull();
    expect(store.get(detached.id)?.id).toBe(detached.id);
  });

  it("sweeps leftover bindings for archived threads on start", () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const seed = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
    });
    const archivedId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const liveId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const leftover = seed.create({ ...input, name: "Leftover", targetThreadId: archivedId });
    const live = seed.create({ ...input, name: "Live", targetThreadId: liveId });

    const service = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
      threadIsUnavailable: (threadId) => threadId === archivedId,
    });
    service.start();

    expect(store.get(leftover.id)).toBeNull();
    expect(store.get(live.id)?.id).toBe(live.id);
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

  it("keeps schedules whose availability check throws during the startup sweep", () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const seed = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
    });
    const bound = seed.create({
      ...input,
      name: "Bound",
      targetThreadId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });

    const onDiagnostic = vi.fn();
    const service = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
      threadIsUnavailable: () => {
        throw new Error("db not ready");
      },
      onDiagnostic,
    });
    service.start();

    expect(store.get(bound.id)).not.toBeNull();
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "SWEEP_CHECK_FAILED",
        scheduleId: bound.id,
        status: "error",
      }),
    );
    service.dispose();
  });

  it("reports listable rows that by-id reads cannot see at startup", () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const seed = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
    });
    const task = seed.create(input);
    const poisoned: ScheduleStore = {
      ...store,
      get: (id) => (id === task.id ? null : store.get(id)),
    };
    const onDiagnostic = vi.fn();
    const service = new ScheduleService({
      store: poisoned,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
      onDiagnostic,
    });
    service.start();

    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "STORE_INDEX_MISSING",
        scheduleId: task.id,
        status: "error",
      }),
    );
    service.dispose();
  });

  it("emits no diagnostics for a consistent store at startup", () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const seed = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
    });
    seed.create(input);

    const onDiagnostic = vi.fn();
    const service = new ScheduleService({
      store,
      runTask: vi.fn<() => Promise<string>>(),
      now: () => now,
      onDiagnostic,
    });
    service.start();

    expect(onDiagnostic).not.toHaveBeenCalled();
    service.dispose();
  });

  it("keeps the full by-id lifecycle working across a host restart", async () => {
    const store = memoryStore();
    const now = new Date(2026, 6, 6, 7, 0).getTime();
    const runTask = vi.fn<() => Promise<string>>().mockResolvedValue("ok");
    const first = new ScheduleService({ store, runTask, now: () => now });
    const task = first.create(input);

    const restarted = new ScheduleService({ store, runTask, now: () => now });
    restarted.start();

    expect(restarted.get(task.id)?.id).toBe(task.id);
    expect(restarted.update(task.id, { ...input, name: "Renamed" }).name).toBe("Renamed");
    expect(restarted.pause(task.id).enabled).toBe(false);
    expect(restarted.resume(task.id).enabled).toBe(true);
    restarted.runNow(task.id);
    await vi.waitFor(() => expect(store.get(task.id)?.lastStatus).toBe("succeeded"));
    expect(restarted.listRuns(task.id)).toEqual([]);
    restarted.delete(task.id);
    expect(restarted.get(task.id)).toBeNull();
    restarted.dispose();
    first.dispose();
  });
});
