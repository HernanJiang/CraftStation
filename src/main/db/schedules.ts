import {
  scheduledTaskConfigSchema,
  scheduledTaskSchema,
  scheduleRecurrenceSchema,
  type ScheduledTask,
} from "@/shared/contracts";
import { normalizeScheduleThreadTarget } from "@/shared/schedules";
import { getSqlite } from "./connection";

interface ScheduledTaskRow {
  id: string;
  name: string;
  prompt: string;
  agent_kind: string;
  config: string;
  recurrence: string;
  enabled: number;
  project_id: string | null;
  timezone: string | null;
  recipe_id: string | null;
  target_thread_id: string | null;
  source_thread_id: string | null;
  harness_item_id: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_completed_at: string | null;
  last_status: string;
  last_result: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: ScheduledTaskRow): ScheduledTask {
  const config = scheduledTaskConfigSchema.parse(JSON.parse(row.config));
  const target = normalizeScheduleThreadTarget({
    targetThreadId: row.target_thread_id,
  });
  return scheduledTaskSchema.parse({
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    agentKind: row.agent_kind,
    config: {
      ...config,
      ...(row.harness_item_id && !config.harnessItemId
        ? { harnessItemId: row.harness_item_id }
        : {}),
    },
    recurrence: scheduleRecurrenceSchema.parse(JSON.parse(row.recurrence)),
    enabled: row.enabled === 1,
    projectId: row.project_id,
    timezone: row.timezone,
    recipeId: row.recipe_id,
    targetThreadId: target.targetThreadId,
    threadTarget: target.threadTarget,
    sourceThreadId: row.source_thread_id,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastCompletedAt: row.last_completed_at,
    lastStatus: row.last_status,
    lastResult: row.last_result,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function dbGetSchedules(): ScheduledTask[] {
  const rows = getSqlite()
    .prepare("SELECT * FROM scheduled_tasks ORDER BY created_at ASC")
    .all() as ScheduledTaskRow[];
  return rows.map(fromRow);
}

export function dbGetSchedule(id: string): ScheduledTask | null {
  const row = getSqlite().prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id) as
    | ScheduledTaskRow
    | undefined;
  return row ? fromRow(row) : null;
}

export function dbUpsertSchedule(task: ScheduledTask): void {
  const parsed = scheduledTaskSchema.parse(task);
  const target = normalizeScheduleThreadTarget(parsed);
  getSqlite()
    .prepare(
      `INSERT INTO scheduled_tasks (
        id, name, prompt, agent_kind, config, recurrence, enabled, project_id,
        timezone, recipe_id, target_thread_id, source_thread_id, harness_item_id,
        next_run_at, last_run_at, last_completed_at, last_status,
        last_result, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        prompt = excluded.prompt,
        agent_kind = excluded.agent_kind,
        config = excluded.config,
        recurrence = excluded.recurrence,
        enabled = excluded.enabled,
        project_id = excluded.project_id,
        timezone = excluded.timezone,
        recipe_id = excluded.recipe_id,
        target_thread_id = excluded.target_thread_id,
        source_thread_id = excluded.source_thread_id,
        harness_item_id = excluded.harness_item_id,
        next_run_at = excluded.next_run_at,
        last_run_at = excluded.last_run_at,
        last_completed_at = excluded.last_completed_at,
        last_status = excluded.last_status,
        last_result = excluded.last_result,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at`,
    )
    .run(
      parsed.id,
      parsed.name,
      parsed.prompt,
      parsed.agentKind,
      JSON.stringify(parsed.config),
      JSON.stringify(parsed.recurrence),
      parsed.enabled ? 1 : 0,
      parsed.projectId ?? null,
      parsed.timezone ?? null,
      parsed.recipeId ?? null,
      target.targetThreadId,
      parsed.sourceThreadId ?? null,
      parsed.config.harnessItemId ?? null,
      parsed.nextRunAt,
      parsed.lastRunAt,
      parsed.lastCompletedAt,
      parsed.lastStatus,
      parsed.lastResult,
      parsed.lastError,
      parsed.createdAt,
      parsed.updatedAt,
    );
}

export function dbDeleteSchedule(id: string): void {
  getSqlite().prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
}

/** Atomically claim a scheduled occurrence. Returns false when already claimed. */
export function dbClaimScheduledOccurrence(
  scheduleId: string,
  occurrenceAt: string,
  claimedAt: string,
): boolean {
  const result = getSqlite()
    .prepare(
      `INSERT OR IGNORE INTO scheduled_occurrences (schedule_id, occurrence_at, claimed_at)
       VALUES (?, ?, ?)`,
    )
    .run(scheduleId, occurrenceAt, claimedAt);
  return result.changes === 1;
}
