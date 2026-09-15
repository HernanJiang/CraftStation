import { randomUUID } from "node:crypto";
import {
  scheduledTaskInputSchema,
  type ScheduleRecurrence,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskRun,
} from "@/shared/contracts";
import {
  nextScheduleRunAt,
  normalizeScheduleThreadTarget,
  scheduleContinuesThread,
  scheduleThreadTarget,
} from "@/shared/schedules";
import type { ScheduleCapability, ScheduleRunInvocation } from "./ScheduleCapability";

export interface ScheduleStore {
  list(): ScheduledTask[];
  get(id: string): ScheduledTask | null;
  upsert(task: ScheduledTask): void;
  delete(id: string): void;
  /**
   * Atomically claim `scheduleId + occurrenceAt` for a scheduled trigger.
   * Returns false when this occurrence was already claimed (restart / tick race).
   * Optional so isolated tests that only cover CRUD keep working.
   */
  claimOccurrence?(scheduleId: string, occurrenceAt: string, claimedAt: string): boolean;
  /** Newest-first run history. Optional so CRUD-only tests keep working. */
  listRuns?(scheduleId: string, limit?: number): ScheduledTaskRun[];
}

export interface ScheduleServiceOptions {
  store: ScheduleStore;
  runTask(task: ScheduledTask, invocation: ScheduleRunInvocation): Promise<string | null>;
  /**
   * Called during post-startup normalization for each task that was left in a
   * `running` state by a previous process. Lets the run-history layer mark its
   * dangling run rows as "interrupted". Optional so existing callers/tests keep
   * working unchanged.
   */
  onStartupInterrupted?(scheduleId: string): void;
  /** Notified after any mutation so hosts can broadcast one unified change event. */
  onChanged?(): void;
  now?: () => number;
  tickIntervalMs?: number;
  /** True when the bound thread is gone or archived. Used on start to sweep leftovers. */
  threadIsUnavailable?: (threadId: string) => boolean;
}

export class ScheduleService implements ScheduleCapability {
  private readonly runningIds = new Set<string>();
  /** Fallback claim set when the store has no durable occurrence table. */
  private readonly claimedOccurrences = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(private readonly options: ScheduleServiceOptions) {}

  start(): void {
    if (this.timer || this.disposed) return;
    this.sweepUnavailableBindings();
    this.normalizeAfterStartup();
    this.timer = setInterval(() => this.tick(), this.options.tickIntervalMs ?? 15_000);
    this.timer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list(): ScheduledTask[] {
    return this.options.store.list();
  }

  get(id: string): ScheduledTask | null {
    return this.options.store.get(id);
  }

  listRuns(scheduleId: string, limit?: number): ScheduledTaskRun[] {
    this.requireTask(scheduleId);
    return this.options.store.listRuns?.(scheduleId, limit) ?? [];
  }

  create(input: ScheduledTaskInput): ScheduledTask {
    const parsed = this.normalizeInput(input);
    const now = this.now();
    const { enabled, nextRunAt } = this.resolveEnablement(
      parsed.recurrence,
      parsed.timezone ?? null,
      parsed.enabled,
      now,
    );
    const task: ScheduledTask = {
      id: randomUUID(),
      ...parsed,
      ...normalizeScheduleThreadTarget(parsed),
      enabled,
      nextRunAt,
      lastRunAt: null,
      lastCompletedAt: null,
      lastStatus: "never",
      lastResult: null,
      lastError: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    this.options.store.upsert(task);
    this.emitChanged();
    return task;
  }

  update(id: string, input: ScheduledTaskInput): ScheduledTask {
    const current = this.requireTask(id);
    const parsed = this.normalizeInput(input);
    const now = this.now();
    const { enabled, nextRunAt } = this.resolveEnablement(
      parsed.recurrence,
      parsed.timezone ?? null,
      parsed.enabled,
      now,
    );
    const task: ScheduledTask = {
      ...current,
      ...parsed,
      ...normalizeScheduleThreadTarget(parsed),
      sourceThreadId: parsed.sourceThreadId !== undefined ? parsed.sourceThreadId : current.sourceThreadId,
      enabled,
      nextRunAt,
      updatedAt: new Date(now).toISOString(),
    };
    this.options.store.upsert(task);
    this.emitChanged();
    return task;
  }

  delete(id: string): void {
    this.runningIds.delete(id);
    this.options.store.delete(id);
    this.emitChanged();
  }

  /** Drop schedules whose future runs continue this thread. Detached schedules stay. */
  deleteContinuingThread(threadId: string): string[] {
    return this.deleteMatching((task) => scheduleContinuesThread(task, threadId));
  }

  /** Explicit pause: keeps the definition, clears the next firing. */
  pause(id: string): ScheduledTask {
    const current = this.requireTask(id);
    const now = this.now();
    const task: ScheduledTask = {
      ...current,
      enabled: false,
      nextRunAt: null,
      updatedAt: new Date(now).toISOString(),
    };
    this.options.store.upsert(task);
    this.emitChanged();
    return task;
  }

  /** Explicit resume: recomputes the next firing in the schedule's time zone. */
  resume(id: string): ScheduledTask {
    const current = this.requireTask(id);
    const now = this.now();
    const { enabled, nextRunAt } = this.resolveEnablement(
      current.recurrence,
      current.timezone ?? null,
      true,
      now,
    );
    const task: ScheduledTask = {
      ...current,
      enabled,
      nextRunAt,
      updatedAt: new Date(now).toISOString(),
    };
    this.options.store.upsert(task);
    this.emitChanged();
    return task;
  }

  runNow(id: string): ScheduledTask {
    const task = this.requireTask(id);
    return this.startRun(task, false, { triggeredBy: "manual", occurrenceAt: null });
  }

  tick(): void {
    if (this.disposed) return;
    const now = this.now();
    for (const task of this.options.store.list()) {
      if (!task.enabled || !task.nextRunAt || Date.parse(task.nextRunAt) > now) continue;
      if (this.runningIds.has(task.id)) continue;
      const occurrenceAt = task.nextRunAt;
      if (!this.claimOccurrence(task.id, occurrenceAt, new Date(now).toISOString())) continue;
      this.startRun(task, true, { triggeredBy: "scheduled", occurrenceAt });
    }
  }

  private startRun(
    task: ScheduledTask,
    advanceSchedule: boolean,
    invocation: ScheduleRunInvocation,
  ): ScheduledTask {
    if (this.runningIds.has(task.id)) return this.requireTask(task.id);

    const now = this.now();
    const nextRunAt = advanceSchedule
      ? nextScheduleRunAt(task.recurrence, now, task.timezone ?? null)
      : task.nextRunAt;
    const running: ScheduledTask = {
      ...task,
      ...(advanceSchedule ? { enabled: task.enabled && nextRunAt !== null, nextRunAt } : {}),
      lastRunAt: new Date(now).toISOString(),
      lastCompletedAt: null,
      lastStatus: "running",
      lastResult: null,
      lastError: null,
      updatedAt: new Date(now).toISOString(),
    };
    this.runningIds.add(task.id);
    this.options.store.upsert(running);
    this.emitChanged();

    void this.options
      .runTask(running, invocation)
      .then((output) => this.settle(task.id, "succeeded", output, null))
      .catch((error: unknown) =>
        this.settle(
          task.id,
          "failed",
          null,
          error instanceof Error ? error.message : String(error),
        ),
      );
    return running;
  }

  private settle(
    id: string,
    status: "succeeded" | "failed",
    result: string | null,
    error: string | null,
  ): void {
    this.runningIds.delete(id);
    if (this.disposed) return;
    const current = this.options.store.get(id);
    if (!current) return;
    const now = this.now();
    this.options.store.upsert({
      ...current,
      lastCompletedAt: new Date(now).toISOString(),
      lastStatus: status,
      lastResult: result,
      lastError: error,
      updatedAt: new Date(now).toISOString(),
    });
    this.emitChanged();
  }

  private normalizeAfterStartup(): void {
    const now = this.now();
    let changed = false;
    for (const task of this.options.store.list()) {
      const { enabled, nextRunAt } = this.resolveEnablement(
        task.recurrence,
        task.timezone ?? null,
        task.enabled,
        now,
      );
      const wasRunning = task.lastStatus === "running";
      if (wasRunning) this.options.onStartupInterrupted?.(task.id);
      this.options.store.upsert({
        ...task,
        enabled,
        nextRunAt,
        ...(wasRunning
          ? {
              lastCompletedAt: new Date(now).toISOString(),
              lastStatus: "interrupted" as const,
              lastError: "Interrupted by host restart.",
            }
          : {}),
        updatedAt: new Date(now).toISOString(),
      });
      changed = true;
    }
    if (changed) this.emitChanged();
  }

  private normalizeInput(input: ScheduledTaskInput): ScheduledTaskInput {
    const parsed = scheduledTaskInputSchema.parse(input);
    const target = normalizeScheduleThreadTarget(parsed);
    const recurrence =
      parsed.recurrence.kind !== "weekly"
        ? parsed.recurrence
        : {
            ...parsed.recurrence,
            days: [...new Set(parsed.recurrence.days)].sort((left, right) => left - right),
          };
    return {
      ...parsed,
      recurrence,
      threadTarget: target.threadTarget,
      targetThreadId: target.targetThreadId,
    };
  }

  private claimOccurrence(scheduleId: string, occurrenceAt: string, claimedAt: string): boolean {
    if (this.options.store.claimOccurrence) {
      return this.options.store.claimOccurrence(scheduleId, occurrenceAt, claimedAt);
    }
    const key = `${scheduleId}:${occurrenceAt}`;
    if (this.claimedOccurrences.has(key)) return false;
    this.claimedOccurrences.add(key);
    return true;
  }

  /**
   * A schedule is only truly enabled when it also has a future run to fire, so
   * enablement and `nextRunAt` are always resolved together (a disabled task,
   * or one whose recurrence has no upcoming occurrence, settles to paused).
   * The next firing is computed in the schedule's own time zone when set.
   */
  private resolveEnablement(
    recurrence: ScheduleRecurrence,
    timezone: string | null | undefined,
    enabled: boolean,
    now: number,
  ): { enabled: boolean; nextRunAt: string | null } {
    const nextRunAt = enabled ? nextScheduleRunAt(recurrence, now, timezone ?? null) : null;
    return { enabled: enabled && nextRunAt !== null, nextRunAt };
  }

  private requireTask(id: string): ScheduledTask {
    const task = this.options.store.get(id);
    if (!task) throw new Error("Scheduled task not found.");
    return task;
  }

  private sweepUnavailableBindings(): void {
    const unavailable = this.options.threadIsUnavailable;
    if (!unavailable) return;
    this.deleteMatching((task) => {
      const target = scheduleThreadTarget(task);
      return target.kind === "existing" && unavailable(target.threadId);
    });
  }

  private deleteMatching(match: (task: ScheduledTask) => boolean): string[] {
    const ids = this.options.store.list().filter(match).map((task) => task.id);
    if (ids.length === 0) return [];
    for (const id of ids) {
      this.runningIds.delete(id);
      this.options.store.delete(id);
    }
    this.emitChanged();
    return ids;
  }

  private emitChanged(): void {
    try {
      this.options.onChanged?.();
    } catch {
      // Broadcast must never break the mutation itself.
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
