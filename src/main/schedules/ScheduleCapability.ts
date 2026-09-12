import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduleRunTriggeredBy,
} from "@/shared/contracts";

/** How one firing was requested. Distinct from the schedule's lastStatus summary. */
export interface ScheduleRunInvocation {
  triggeredBy: ScheduleRunTriggeredBy;
  /** Wall-clock occurrence claimed for a scheduled tick; null for run-now. */
  occurrenceAt: string | null;
}

/**
 * Unified Host schedule capability. UI, MCP, and other hosts share one
 * implementation (`ScheduleService`) and one SQLite store.
 */
export interface ScheduleCapability {
  list(): ScheduledTask[];
  get(id: string): ScheduledTask | null;
  create(input: ScheduledTaskInput): ScheduledTask;
  update(id: string, input: ScheduledTaskInput): ScheduledTask;
  delete(id: string): void;
  pause(id: string): ScheduledTask;
  resume(id: string): ScheduledTask;
  runNow(id: string): ScheduledTask;
  /** Newest-first run history for one schedule. Empty when the store has no run table. */
  listRuns(scheduleId: string, limit?: number): ScheduledTaskRun[];
}
