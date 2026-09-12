import { z } from "zod";
import { isHomeProjectId } from "@/shared/homeScope";
import {
  agentKindSchema,
  scheduleRecurrenceSchema,
  scheduleThreadTargetSchema,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskRun,
} from "@/shared/contracts";
import { normalizeScheduleThreadTarget } from "@/shared/schedules";
import type { AppControlsToolContext, ToolDomain } from "./types";

/**
 * Unified Host schedule capability. One ScheduleService backs every harness:
 * Codex / OpenCode / Gemini / Kimi / … all reach these tools through the same
 * loopback app-controls MCP ingress (see `resolveAppControlsMcpForLaunch`), so
 * there is intentionally no per-harness schedule implementation. Underscore
 * names are the stable MCP surface; `schedule.*` aliases expose the exact
 * Agent-facing contract (`schedule.create/update/delete/list/get/pause/resume/
 * run_now/list_runs`) on the same handlers and the same store.
 */

const timezoneSchema = z.string().trim().min(1).max(64).nullable().optional();
const recipeIdSchema = z.string().trim().min(1).max(160).nullable().optional();
const targetThreadIdSchema = z.string().uuid().nullable().optional();
const projectIdSchema = z.string().min(1).nullable().optional();
const harnessItemIdSchema = z.string().trim().min(1).max(160).nullable().optional();
const callingThreadUuid = (threadId: string | undefined): string | null => {
  if (!threadId) return null;
  return z.string().uuid().safeParse(threadId).success ? threadId : null;
};

const createArgsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(50_000),
  recurrence: scheduleRecurrenceSchema,
  enabled: z.boolean().optional().default(true),
  agentKind: agentKindSchema.optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  timezone: timezoneSchema,
  recipeId: recipeIdSchema,
  targetThreadId: targetThreadIdSchema,
  threadTarget: scheduleThreadTargetSchema.optional(),
  continueInCurrentThread: z.boolean().optional(),
  harnessItemId: harnessItemIdSchema,
  projectId: projectIdSchema,
});

const updateArgsSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).max(50_000).optional(),
  recurrence: scheduleRecurrenceSchema.optional(),
  enabled: z.boolean().optional(),
  agentKind: agentKindSchema.optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).nullable().optional(),
  timezone: timezoneSchema,
  recipeId: recipeIdSchema,
  targetThreadId: targetThreadIdSchema,
  threadTarget: scheduleThreadTargetSchema.optional(),
  continueInCurrentThread: z.boolean().optional(),
  harnessItemId: harnessItemIdSchema,
  projectId: projectIdSchema,
});

const idArgsSchema = z.object({ id: z.string().uuid() });
const listRunsArgsSchema = z.object({
  id: z.string().uuid(),
  limit: z.number().int().min(1).max(20).optional(),
});

function recurrenceJsonSchema(): Record<string, unknown> {
  return {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "minute"],
        properties: {
          kind: { const: "hourly" },
          minute: { type: "integer", minimum: 0, maximum: 59 },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "days", "time"],
        properties: {
          kind: { const: "weekly" },
          days: {
            type: "array",
            minItems: 1,
            items: { type: "integer", minimum: 0, maximum: 6 },
          },
          time: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "runAt"],
        properties: {
          kind: { const: "once" },
          runAt: {
            type: "string",
            format: "date-time",
            description:
              "ISO-8601 instant. Prefer UTC with Z (e.g. 2026-09-09T12:14:35.716Z); offsets like +08:00 are also accepted.",
          },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "everyMinutes"],
        properties: {
          kind: { const: "interval" },
          everyMinutes: {
            type: "integer",
            minimum: 1,
            maximum: 1440,
            description:
              "Repeat every N minutes (e.g. 10 for every-10-minutes monitoring). Prefer this over once+self-chain prompts.",
          },
        },
      },
    ],
  };
}

function scheduleExtraJsonSchema(): Record<string, unknown> {
  return {
    timezone: { type: ["string", "null"], description: "IANA time zone, e.g. Asia/Shanghai." },
    recipeId: { type: ["string", "null"], description: "Opaque recipe reference (no secrets)." },
    targetThreadId: {
      type: ["string", "null"],
      format: "uuid",
      description: "Existing thread to inherit context from; native session is always fresh.",
    },
    threadTarget: {
      description:
        'Canonical target: {kind:"new"} or {kind:"existing",threadId}. Independent of source thread provenance.',
    },
    continueInCurrentThread: {
      type: "boolean",
      description:
        "Thread binding. Defaults to true when created from a thread (future runs continue there); set false or threadTarget {kind:'new'} for a detached schedule.",
    },
    harnessItemId: {
      type: ["string", "null"],
      description: "Opaque harness Item id, e.g. harness:codex.",
    },
    projectId: {
      type: ["string", "null"],
      description: "Workspace project id; null means Home scope.",
    },
  };
}

function idJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  };
}

function createSchedule(
  args: unknown,
  ctx: AppControlsToolContext,
): ScheduledTask {
  const parsed = createArgsSchema.parse(args);
  const sourceThread = ctx.identity.threadId ? ctx.getThread(ctx.identity.threadId) : null;
  const agentKind = parsed.agentKind ?? sourceThread?.agentKind;
  const model = parsed.model ?? sourceThread?.config.model;
  if (!agentKind || !model) {
    throw new Error("agentKind and model are required when the calling thread is unavailable.");
  }
  // Default the run's project to the calling thread's project (so a schedule
  // created from inside a project runs there). Home-scope threads leave it
  // null, which the coordinator resolves to the built-in Home project.
  const projectId =
    parsed.projectId !== undefined
      ? parsed.projectId
      : sourceThread && !isHomeProjectId(sourceThread.projectId)
        ? sourceThread.projectId
        : null;
  const callingId = callingThreadUuid(ctx.identity.threadId);
  // Schedules bind to their creating thread by default: future runs inherit
  // that thread's context (same-thread follow-ups when idle, inherited text
  // otherwise). Pass continueInCurrentThread:false or an explicit
  // threadTarget:{kind:"new"} only for deliberately detached schedules.
  const wantsDetached =
    parsed.continueInCurrentThread === false || parsed.threadTarget?.kind === "new";
  const continueHere =
    callingId != null &&
    !wantsDetached &&
    (parsed.continueInCurrentThread === true ||
      (parsed.threadTarget === undefined && parsed.targetThreadId == null));
  const target = normalizeScheduleThreadTarget({
    threadTarget: continueHere
      ? { kind: "existing", threadId: callingId }
      : parsed.threadTarget,
    targetThreadId: parsed.targetThreadId,
  });
  const input: ScheduledTaskInput = {
    name: parsed.name,
    prompt: parsed.prompt,
    recurrence: parsed.recurrence,
    enabled: parsed.enabled,
    agentKind,
    ...(projectId ? { projectId } : {}),
    ...(parsed.timezone !== undefined ? { timezone: parsed.timezone } : {}),
    ...(parsed.recipeId !== undefined ? { recipeId: parsed.recipeId } : {}),
    threadTarget: target.threadTarget,
    targetThreadId: target.targetThreadId,
    sourceThreadId: callingId,
    config: {
      model,
      ...((parsed.effort ?? sourceThread?.config.effort)
        ? { effort: parsed.effort ?? sourceThread?.config.effort }
        : {}),
      ...(sourceThread?.config.fast !== undefined ? { fast: sourceThread.config.fast } : {}),
      ...(parsed.harnessItemId !== undefined ? { harnessItemId: parsed.harnessItemId } : {}),
    },
  };
  return ctx.scheduleService.create(input);
}

function updateSchedule(
  args: unknown,
  ctx: AppControlsToolContext,
): ScheduledTask {
  const parsed = updateArgsSchema.parse(args);
  const current = requireSchedule(ctx, parsed.id);
  const callingId = callingThreadUuid(ctx.identity.threadId);
  const continueHere = parsed.continueInCurrentThread === true && callingId != null;
  const target = normalizeScheduleThreadTarget({
    threadTarget: continueHere
      ? { kind: "existing", threadId: callingId }
      : parsed.threadTarget !== undefined
        ? parsed.threadTarget
        : current.threadTarget,
    targetThreadId:
      parsed.targetThreadId !== undefined ? parsed.targetThreadId : (current.targetThreadId ?? null),
  });
  return ctx.scheduleService.update(parsed.id, {
    name: parsed.name ?? current.name,
    prompt: parsed.prompt ?? current.prompt,
    recurrence: parsed.recurrence ?? current.recurrence,
    enabled: parsed.enabled ?? current.enabled,
    agentKind: parsed.agentKind ?? current.agentKind,
    projectId: parsed.projectId !== undefined ? parsed.projectId : (current.projectId ?? null),
    timezone: parsed.timezone !== undefined ? parsed.timezone : (current.timezone ?? null),
    recipeId: parsed.recipeId !== undefined ? parsed.recipeId : (current.recipeId ?? null),
    threadTarget: target.threadTarget,
    targetThreadId: target.targetThreadId,
    sourceThreadId: current.sourceThreadId ?? null,
    config: {
      model: parsed.model ?? current.config.model,
      ...(parsed.effort === null
        ? {}
        : parsed.effort !== undefined
          ? { effort: parsed.effort }
          : current.config.effort
            ? { effort: current.config.effort }
            : {}),
      ...(current.config.fast !== undefined ? { fast: current.config.fast } : {}),
      ...(parsed.harnessItemId !== undefined
        ? { harnessItemId: parsed.harnessItemId }
        : current.config.harnessItemId
          ? { harnessItemId: current.config.harnessItemId }
          : {}),
    },
  });
}

function getSchedule(args: unknown, ctx: AppControlsToolContext): ScheduledTask {
  return requireSchedule(ctx, idArgsSchema.parse(args).id);
}

function pauseSchedule(
  args: unknown,
  ctx: AppControlsToolContext,
): ScheduledTask {
  const { id } = idArgsSchema.parse(args);
  requireSchedule(ctx, id);
  return ctx.scheduleService.pause(id);
}

function resumeSchedule(
  args: unknown,
  ctx: AppControlsToolContext,
): ScheduledTask {
  const { id } = idArgsSchema.parse(args);
  requireSchedule(ctx, id);
  return ctx.scheduleService.resume(id);
}

function runSchedule(
  args: unknown,
  ctx: AppControlsToolContext,
): ScheduledTask {
  return ctx.scheduleService.runNow(idArgsSchema.parse(args).id);
}

function deleteSchedule(
  args: unknown,
  ctx: AppControlsToolContext,
): { deleted: boolean; id: string } {
  const { id } = idArgsSchema.parse(args);
  requireSchedule(ctx, id);
  ctx.scheduleService.delete(id);
  return { deleted: true, id };
}

function listScheduleRuns(args: unknown, ctx: AppControlsToolContext): ScheduledTaskRun[] {
  const parsed = listRunsArgsSchema.parse(args);
  requireSchedule(ctx, parsed.id);
  return ctx.scheduleService.listRuns(parsed.id, parsed.limit);
}

export const scheduleTools: ToolDomain = {
  specs: [
    {
      name: "list_schedules",
      description: "List the user's CraftStation schedules and their current status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "schedule.list",
      description: "Alias of list_schedules: unified Agent schedule list.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_schedule",
      description: "Get one CraftStation schedule by id.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "schedule.get",
      description: "Alias of get_schedule: unified Agent schedule get.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "create_schedule",
      description:
        "Create a device schedule. The current agent and model are used unless overridden. " +
        "The schedule binds to the creating thread by default (future runs continue there). " +
        "For sub-hourly repeats use recurrence {kind:'interval',everyMinutes:N} (e.g. every 10 minutes). " +
        "Never ask the scheduled prompt to create its own next schedule via create_schedule — that multiplies schedules and threads.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name", "prompt", "recurrence"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          prompt: { type: "string", minLength: 1, maxLength: 50000 },
          recurrence: recurrenceJsonSchema(),
          enabled: { type: "boolean" },
          agentKind: { type: "string", minLength: 1 },
          model: { type: "string", minLength: 1 },
          effort: { type: "string", minLength: 1 },
          ...scheduleExtraJsonSchema(),
        },
      },
    },
    {
      name: "schedule.create",
      description:
        "Alias of create_schedule: unified Agent schedule create. Binds to the creating thread by default; " +
        "use interval recurrence for minute-level repeats; never self-chain schedules from the prompt.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name", "prompt", "recurrence"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          prompt: { type: "string", minLength: 1, maxLength: 50000 },
          recurrence: recurrenceJsonSchema(),
          enabled: { type: "boolean" },
          agentKind: { type: "string", minLength: 1 },
          model: { type: "string", minLength: 1 },
          effort: { type: "string", minLength: 1 },
          ...scheduleExtraJsonSchema(),
        },
      },
    },
    {
      name: "update_schedule",
      description: "Update selected fields on an existing CraftStation schedule.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", minLength: 1, maxLength: 120 },
          prompt: { type: "string", minLength: 1, maxLength: 50000 },
          recurrence: recurrenceJsonSchema(),
          enabled: { type: "boolean" },
          agentKind: { type: "string", minLength: 1 },
          model: { type: "string", minLength: 1 },
          effort: { type: ["string", "null"], minLength: 1 },
          ...scheduleExtraJsonSchema(),
        },
      },
    },
    {
      name: "schedule.update",
      description: "Alias of update_schedule: unified Agent schedule update.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", minLength: 1, maxLength: 120 },
          prompt: { type: "string", minLength: 1, maxLength: 50000 },
          recurrence: recurrenceJsonSchema(),
          enabled: { type: "boolean" },
          agentKind: { type: "string", minLength: 1 },
          model: { type: "string", minLength: 1 },
          effort: { type: ["string", "null"], minLength: 1 },
          ...scheduleExtraJsonSchema(),
        },
      },
    },
    {
      name: "pause_schedule",
      description: "Pause a schedule without deleting its definition.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "schedule.pause",
      description: "Alias of pause_schedule: unified Agent schedule pause.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "resume_schedule",
      description: "Resume a paused schedule and recompute its next run.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "schedule.resume",
      description: "Alias of resume_schedule: unified Agent schedule resume.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "run_schedule",
      description: "Run an existing schedule now without changing its next scheduled run.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "schedule.run_now",
      description: "Alias of run_schedule: unified Agent schedule run-now.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "delete_schedule",
      description: "Permanently delete an existing schedule from this device.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "schedule.delete",
      description: "Alias of delete_schedule: unified Agent schedule delete.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "list_schedule_runs",
      description:
        "List recent executions of one schedule (newest first). Each row is a ScheduledTaskRun: id, scheduleId, threadId, triggeredBy (scheduled|manual), status (queued|running|succeeded|failed|interrupted — never 'never'), timestamps, summary/error, and executionSnapshot.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Schedule id from create/list/get." },
          limit: { type: "integer", minimum: 1, maximum: 20, description: "Max rows, default 20." },
        },
      },
    },
    {
      name: "schedule.list_runs",
      description: "Alias of list_schedule_runs: unified Agent schedule run history.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Schedule id from create/list/get." },
          limit: { type: "integer", minimum: 1, maximum: 20, description: "Max rows, default 20." },
        },
      },
    },
  ],
  handlers: {
    list_schedules: (_args, ctx) => ctx.scheduleService.list(),
    "schedule.list": (_args, ctx) => ctx.scheduleService.list(),
    get_schedule: getSchedule,
    "schedule.get": getSchedule,
    create_schedule: createSchedule,
    "schedule.create": createSchedule,
    update_schedule: updateSchedule,
    "schedule.update": updateSchedule,
    pause_schedule: pauseSchedule,
    "schedule.pause": pauseSchedule,
    resume_schedule: resumeSchedule,
    "schedule.resume": resumeSchedule,
    run_schedule: runSchedule,
    "schedule.run_now": runSchedule,
    delete_schedule: deleteSchedule,
    "schedule.delete": deleteSchedule,
    list_schedule_runs: listScheduleRuns,
    "schedule.list_runs": listScheduleRuns,
  },
};

function requireSchedule(ctx: AppControlsToolContext, id: string): ScheduledTask {
  const task = ctx.scheduleService.get(id);
  if (!task) throw new Error("Scheduled task not found.");
  return task;
}
