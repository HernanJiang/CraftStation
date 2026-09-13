import { z } from "zod";
import { agentKindSchema } from "./common";

const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);

export const scheduleRecurrenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hourly"),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal("weekly"),
    days: z.array(z.number().int().min(0).max(6)).min(1),
    time: localTimeSchema,
  }),
  z.object({
    kind: z.literal("once"),
    runAt: z.iso.datetime({ offset: true }),
  }),
  z.object({
    kind: z.literal("interval"),
    /**
     * Repeat every N minutes (1–1440). Covers sub-hourly monitoring such as
     * "every 10 minutes" natively so agents never need to self-chain
     * `once + create` prompts (which multiply schedules and threads).
     */
    everyMinutes: z.number().int().min(1).max(1440),
  }),
]);
export type ScheduleRecurrence = z.infer<typeof scheduleRecurrenceSchema>;

export const scheduledTaskRunStatusSchema = z.enum([
  "never",
  "running",
  "succeeded",
  "failed",
  "interrupted",
]);
export type ScheduledTaskRunStatus = z.infer<typeof scheduledTaskRunStatusSchema>;

export const scheduledTaskConfigSchema = z.object({
  model: z.string().min(1),
  effort: z.string().optional(),
  fast: z.boolean().optional(),
  /**
   * Opaque harness Item id (e.g. `harness:codex`). Resolved at run time into a
   * CraftPlan; never a process handle or native session.
   */
  harnessItemId: z.string().trim().min(1).max(160).nullable().optional(),
});
export type ScheduledTaskConfig = z.infer<typeof scheduledTaskConfigSchema>;

/**
 * Where a future run should inherit logical context from. Independent of
 * {@link ScheduledTask.sourceThreadId}, which is only provenance for the
 * thread that created the schedule.
 */
export const scheduleThreadTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({
    kind: z.literal("existing"),
    threadId: z.string().uuid(),
  }),
]);
export type ScheduleThreadTarget = z.infer<typeof scheduleThreadTargetSchema>;

/** Secret-free snapshot of how one run was resolved. Never a CraftPlan blob. */
export const scheduleExecutionSnapshotSchema = z.object({
  recipeId: z.string().nullable().optional(),
  model: z.string().min(1),
  harnessItemId: z.string().nullable().optional(),
  agentKind: z.string().min(1),
  threadTarget: scheduleThreadTargetSchema,
  sourceThreadId: z.string().uuid().nullable().optional(),
});
export type ScheduleExecutionSnapshot = z.infer<typeof scheduleExecutionSnapshotSchema>;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export const scheduleTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Invalid IANA time zone." });

export const scheduledTaskInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(50_000),
  agentKind: agentKindSchema,
  config: scheduledTaskConfigSchema,
  recurrence: scheduleRecurrenceSchema,
  enabled: z.boolean(),
  /**
   * Project the run's GUI thread is created in. `null`/omitted means the
   * built-in "Home" scope (see `HOME_PROJECT_ID`); a value must reference an
   * existing project row at run time or the run fails.
   */
  projectId: z.string().nullable().optional(),
  /**
   * IANA time zone the recurrence wall-clock is interpreted in (e.g.
   * "Asia/Shanghai"). Omitted means the device-local zone. Stored as an opaque
   * reference; resolved to real instants by `nextScheduleRunAt`.
   */
  timezone: scheduleTimeZoneSchema.nullable().optional(),
  /**
   * Opaque recipe reference the run resolves through (CraftPlan provenance).
   * The scheduler stores only the reference; resolution happens at run time.
   * Never carries credentials or process/session objects.
   */
  recipeId: z.string().trim().min(1).max(160).nullable().optional(),
  /**
   * Compatibility alias for {@link scheduleThreadTargetSchema} `existing`.
   * `null`/omitted means a fresh thread per run. Prefer `threadTarget`.
   */
  targetThreadId: z.string().uuid().nullable().optional(),
  /**
   * Canonical execution target. `{ kind: "new" }` opens a fresh thread;
   * `{ kind: "existing", threadId }` inherits that thread's persisted
   * conversation/context only. Native sessions are never reused.
   */
  threadTarget: scheduleThreadTargetSchema.optional(),
  /**
   * Host-recorded provenance: the chat thread that created this schedule.
   * For thread-bound schedules (threadTarget.kind === "existing") the host
   * sets this to the TARGET thread so run provenance and continuation stay on
   * the executor thread; the creating thread is kept only in
   * {@link createdByThreadId}. Agents must not set this; the Host overwrites it.
   */
  sourceThreadId: z.string().uuid().nullable().optional(),
  /**
   * Audit-only provenance: the thread whose MCP call created (or last
   * updated) this schedule. Never a run/delivery destination — creators watch
   * history via list/list_runs instead of receiving fired output.
   * Host-recorded; agents must not set it.
   */
  createdByThreadId: z.string().uuid().nullable().optional(),
});
export type ScheduledTaskInput = z.infer<typeof scheduledTaskInputSchema>;

export const scheduledTaskSchema = scheduledTaskInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  nextRunAt: z.iso.datetime().nullable(),
  lastRunAt: z.iso.datetime().nullable(),
  lastCompletedAt: z.iso.datetime().nullable(),
  lastStatus: scheduledTaskRunStatusSchema,
  lastResult: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;

export const updateScheduledTaskPayloadSchema = z.object({
  id: z.string().uuid(),
  task: scheduledTaskInputSchema,
});
export type UpdateScheduledTaskPayload = z.infer<typeof updateScheduledTaskPayloadSchema>;

export const scheduledTaskIdPayloadSchema = z.object({ id: z.string().uuid() });
export type ScheduledTaskIdPayload = z.infer<typeof scheduledTaskIdPayloadSchema>;

/**
 * Lifecycle of a single scheduled run, tracked per {@link scheduledTaskRunSchema}.
 * Distinct from {@link scheduledTaskRunStatusSchema} (the schedule's quick-glance
 * summary), which additionally has a "never" sentinel.
 */
export const scheduleRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "interrupted",
]);
export type ScheduleRunStatus = z.infer<typeof scheduleRunStatusSchema>;

export const scheduleRunTriggeredBySchema = z.enum(["scheduled", "manual"]);
export type ScheduleRunTriggeredBy = z.infer<typeof scheduleRunTriggeredBySchema>;

/**
 * One execution of a scheduled task, linked to the real GUI thread it created.
 * A schedule keeps a bounded history of these (newest first) alongside its
 * quick-glance `lastStatus`/`lastResult` summary. Never mixed into the
 * schedule list object.
 */
export const scheduledTaskRunSchema = z.object({
  id: z.string().uuid(),
  scheduleId: z.string().uuid(),
  threadId: z.string().uuid(),
  occurrenceAt: z.iso.datetime().nullable().optional(),
  triggeredBy: scheduleRunTriggeredBySchema.optional().default("scheduled"),
  queuedAt: z.iso.datetime().optional(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  status: scheduleRunStatusSchema,
  summary: z.string().nullable(),
  error: z.string().nullable(),
  executionSnapshot: scheduleExecutionSnapshotSchema.nullable().optional(),
});
export type ScheduledTaskRun = z.infer<typeof scheduledTaskRunSchema>;

export const getScheduleRunsPayloadSchema = z.object({ id: z.string().uuid() });
export type GetScheduleRunsPayload = z.infer<typeof getScheduleRunsPayloadSchema>;

/** Run history for one schedule, newest first (capped). */
export type GetScheduleRunsResult = ScheduledTaskRun[];
