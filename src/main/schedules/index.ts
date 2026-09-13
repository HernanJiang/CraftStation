import {
  dbClaimScheduledOccurrence,
  dbDeleteSchedule,
  dbGetSchedule,
  dbGetSchedules,
  dbListScheduleRuns,
  dbUpsertSchedule,
} from "../db";
import type { ScheduledTask } from "@/shared/contracts";
import type { ScheduleRunInvocation } from "./ScheduleCapability";
import { ScheduleService } from "./ScheduleService";

export interface DeviceScheduleServiceOptions {
  /** Executes one due/manual run and resolves with its quick-glance summary. */
  runTask: (task: ScheduledTask, invocation: ScheduleRunInvocation) => Promise<string | null>;
  /** Marks a schedule's dangling run rows interrupted after a restart. */
  onStartupInterrupted?: (scheduleId: string) => void;
  /** Notified after any mutation so hosts can broadcast one unified change event. */
  onChanged?: () => void;
}

export function createDeviceScheduleService(
  options: DeviceScheduleServiceOptions,
): ScheduleService {
  return new ScheduleService({
    store: {
      list: dbGetSchedules,
      get: dbGetSchedule,
      upsert: dbUpsertSchedule,
      delete: dbDeleteSchedule,
      claimOccurrence: dbClaimScheduledOccurrence,
      listRuns: dbListScheduleRuns,
    },
    runTask: options.runTask,
    ...(options.onStartupInterrupted ? { onStartupInterrupted: options.onStartupInterrupted } : {}),
    ...(options.onChanged ? { onChanged: options.onChanged } : {}),
  });
}

export type { ScheduleCapability, ScheduleRunInvocation } from "./ScheduleCapability";
export { ScheduleService, type ScheduleStore } from "./ScheduleService";
export { ScheduleRunCoordinator, type ScheduleRunCoordinatorDeps } from "./ScheduleRunCoordinator";
export { buildScheduleThreadContextText, extractScheduleRunSummary } from "./threadContext";
export {
  resolveScheduleExecution,
  type ScheduleLaunchMode,
  type ThreadContextSnapshot,
} from "./ScheduleExecutionResolver";
export { ensureHomeProjectRow, homeScopeLocation } from "./homeProject";
export {
  ScheduleMcpIngress,
  type ScheduleMcpIngressDeps,
  type ScheduleMcpIngressInfo,
} from "./ScheduleMcpIngress";
