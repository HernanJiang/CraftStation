import { z } from "zod";
import { getDefaultRegistry } from "@/shared/crafting";
import { isHomeProjectId } from "@/shared/homeScope";
import { parseThreadUuidReference } from "@/shared/nativeThreads";
import {
  agentKindSchema,
  scheduleRecurrenceSchema,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskRun,
  type ScheduleThreadTarget,
} from "@/shared/contracts";
import { normalizeScheduleThreadTarget, scheduleThreadTarget } from "@/shared/schedules";
import type { ScheduleToolContext, ScheduleToolDomain } from "./types";

/**
 * Unified Host schedule capability. One ScheduleService backs every harness:
 * Codex / OpenCode / Gemini / Kimi / … all reach these tools through the
 * standalone Schedule MCP ingress (see `resolveScheduleMcpForLaunch`). Short
 * names are the only MCP surface — hosts that namespace tools expose them as
 * `Schedule.create`, `Schedule.list_runs`, and so on.
 */

/**
 * Some agent bridges stringify null/undefined before sending (observed with
 * OpenCode threads passing timezone:"null", which then crashed IANA timezone
 * validation even though a real null is legal — and persisted recipeId:"null"
 * into the store). Normalize those sentinels back to null on nullable fields.
 */
const nullishArg = <S extends z.ZodTypeAny>(schema: S) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const lowered = value.trim().toLowerCase();
    return lowered === "null" || lowered === "undefined" || lowered === "" ? null : value;
  }, schema);

const timezoneSchema = nullishArg(z.string().trim().min(1).max(64).nullable().optional());
const recipeIdSchema = nullishArg(z.string().trim().min(1).max(160).nullable().optional());
/**
 * Thread references accepted at the MCP boundary: a sidebar UUID,
 * `thread:<uuid>`, or a Crossagents `harness:nativeId` address. Canonicalized
 * to the thread UUID by {@link resolveExistingThreadRef} before persistence —
 * the stored schedule always carries the UUID.
 */
const targetThreadIdSchema = nullishArg(z.string().trim().min(1).max(240).nullable().optional());
const projectIdSchema = nullishArg(z.string().min(1).nullable().optional());
const harnessItemIdSchema = nullishArg(z.string().trim().min(1).max(160).nullable().optional());
const callingThreadUuid = (threadId: string | undefined): string | null => {
  if (!threadId) return null;
  return z.string().uuid().safeParse(threadId).success ? threadId : null;
};

/**
 * Some agent bridges serialize nested object params into JSON strings before
 * sending them over MCP (observed with OpenCode threads passing
 * `threadTarget`). Accept both shapes; a string that is not a JSON object
 * still fails validation with a clear error instead of a cryptic type error.
 * The `existing` threadId is intentionally NOT uuid-only here: it may also be
 * `thread:<uuid>` or a Crossagents `harness:nativeId` address, canonicalized
 * by {@link resolveExistingThreadRef} after parsing.
 */
const scheduleThreadTargetInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({ kind: z.literal("existing"), threadId: z.string().trim().min(1).max(240) }),
]);

const threadTargetArgSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, scheduleThreadTargetInputSchema);

/**
 * Canonicalize an MCP thread reference to the sidebar thread UUID. Bare and
 * `thread:`-prefixed UUIDs pass through (existence is enforced at fire time,
 * matching legacy targetThreadId behavior); a `harness:nativeId` address goes
 * through the SAME Crossagents resolver — no UUID-only copy — so both servers
 * always name one conversation.
 */
function resolveExistingThreadRef(
  raw: string,
  ctx: ScheduleToolContext,
  callingThreadId: string | null,
): string {
  const uuidRef = parseThreadUuidReference(raw);
  if (uuidRef) return uuidRef;
  if (!ctx.resolvePeerTarget) {
    throw new Error(
      `Cannot bind the schedule to "${raw}": this host has no Crossagents address resolver wired. Use the target thread's sidebar UUID instead.`,
    );
  }
  return ctx.resolvePeerTarget(raw, callingThreadId).threadId;
}

/**
 * An explicitly requested agentKind must map to a registered harness item —
 * otherwise the run would fail at fire time, or worse, drift onto the calling
 * thread's harness. Fail at create/update time with a clear message instead.
 * Inherited (omitted) agentKinds keep legacy behavior.
 */
function assertExplicitHarnessRegistered(
  agentKind: string | undefined,
  harnessItemId: string | null | undefined,
): void {
  const registry = getDefaultRegistry();
  if (harnessItemId != null) {
    if (!registry.getItem(harnessItemId)) {
      throw new Error(
        `Unknown harnessItemId "${harnessItemId}": no such harness item is registered. The schedule would fail at fire time; pass a registered harness item (e.g. harness:devin).`,
      );
    }
    return;
  }
  if (agentKind === undefined) return;
  const itemId = `harness:${agentKind.split(":")[0]}`;
  if (!registry.getItem(itemId)) {
    throw new Error(
      `Cannot schedule agentKind "${agentKind}": harness item "${itemId}" is not registered, so the run could never fire as ${agentKind}. Pick a detected harness (codex, kimi, opencode, grok, antigravity, devin, …) or pass an explicit harnessItemId — the calling thread's harness is never substituted silently.`,
    );
  }
}

/** Task JSON enriched with Crossagents identity when the host wires the bus. */
function serializeTask(task: ScheduledTask, ctx: ScheduleToolContext): unknown {
  if (!ctx.peerAddressOfThread) return task;
  const target = scheduleThreadTarget(task);
  const boundThreadId = target.kind === "existing" ? target.threadId : null;
  return {
    ...task,
    boundThreadId,
    peerAddress: boundThreadId ? (ctx.peerAddressOfThread(boundThreadId) ?? null) : null,
  };
}

/** Run JSON enriched with the fired thread's Crossagents peer address. */
function serializeRun(run: ScheduledTaskRun, ctx: ScheduleToolContext): unknown {
  if (!ctx.peerAddressOfThread) return run;
  return {
    ...run,
    boundThreadId: run.threadId,
    peerAddress: ctx.peerAddressOfThread(run.threadId) ?? null,
  };
}

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
  threadTarget: threadTargetArgSchema.optional(),
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
  threadTarget: threadTargetArgSchema.optional(),
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
      description:
        "String alternative for threadTarget {kind:'existing',threadId}: bind future runs to this existing thread (same-thread follow-up; native session is always fresh). Accepts the sidebar thread UUID, thread:<uuid>, or a Crossagents harness:nativeId address (e.g. kimi:session_…, devin:…) — all resolve to the same thread.",
    },
    threadTarget: {
      description:
        'Canonical target as an OBJECT (never a string): {kind:"new"} opens a fresh thread per run; ' +
        '{kind:"existing",threadId:"<uuid>"} runs inside that thread (same-thread follow-up). ' +
        "The existing threadId may be a sidebar UUID, thread:<uuid>, or a Crossagents harness:nativeId address; all forms resolve to the same thread via the shared Crossagents resolver. " +
        "Independent of source thread provenance. A JSON-stringified object is also accepted.",
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: { kind: { const: "new" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "threadId"],
          properties: {
            kind: { const: "existing" },
            threadId: {
              type: "string",
              minLength: 1,
              description:
                "Sidebar thread UUID, thread:<uuid>, or a Crossagents harness:nativeId address (e.g. kimi:session_…, devin:…).",
            },
          },
        },
      ],
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

function createSchedule(args: unknown, ctx: ScheduleToolContext): unknown {
  const parsed = createArgsSchema.parse(args);
  assertExplicitHarnessRegistered(parsed.agentKind, parsed.harnessItemId ?? undefined);
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
  // Crossagents parity: threadTarget/targetThreadId accept a sidebar UUID,
  // thread:<uuid>, or a harness:nativeId address — all canonicalized to the
  // target thread's UUID through the shared resolver before persistence.
  const explicitTarget: ScheduleThreadTarget | undefined =
    parsed.threadTarget === undefined
      ? undefined
      : parsed.threadTarget.kind === "new"
        ? { kind: "new" }
        : {
            kind: "existing",
            threadId: resolveExistingThreadRef(parsed.threadTarget.threadId, ctx, callingId),
          };
  const explicitTargetThreadId =
    parsed.targetThreadId != null
      ? resolveExistingThreadRef(parsed.targetThreadId, ctx, callingId)
      : parsed.targetThreadId;
  const target = normalizeScheduleThreadTarget({
    threadTarget: continueHere ? { kind: "existing", threadId: callingId } : explicitTarget,
    targetThreadId: explicitTargetThreadId,
  });
  // Thread-bound schedules (threadTarget existing, incl. the default
  // continue-here binding) record source == target so run provenance, the
  // sidebar schedule indicator, and any continuation stay on the TARGET
  // thread — never on the creating thread. The creator is kept only in the
  // audit field `createdByThreadId`; it is never a delivery destination.
  const boundThreadId =
    target.threadTarget.kind === "existing" ? target.threadTarget.threadId : null;
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
    sourceThreadId: boundThreadId ?? callingId,
    createdByThreadId: callingId,
    config: {
      model,
      ...((parsed.effort ?? sourceThread?.config.effort)
        ? { effort: parsed.effort ?? sourceThread?.config.effort }
        : {}),
      ...(sourceThread?.config.fast !== undefined ? { fast: sourceThread.config.fast } : {}),
      ...(parsed.harnessItemId !== undefined ? { harnessItemId: parsed.harnessItemId } : {}),
    },
  };
  return serializeTask(ctx.scheduleService.create(input), ctx);
}

function updateSchedule(args: unknown, ctx: ScheduleToolContext): unknown {
  const parsed = updateArgsSchema.parse(args);
  assertExplicitHarnessRegistered(parsed.agentKind, parsed.harnessItemId ?? undefined);
  const current = requireSchedule(ctx, parsed.id);
  const callingId = callingThreadUuid(ctx.identity.threadId);
  const continueHere = parsed.continueInCurrentThread === true && callingId != null;
  // Same Crossagents-parity canonicalization as create(): UUID, thread:<uuid>,
  // and harness:nativeId targets all land on the target thread's UUID.
  const parsedTarget: ScheduleThreadTarget | undefined =
    parsed.threadTarget === undefined
      ? undefined
      : parsed.threadTarget.kind === "new"
        ? { kind: "new" }
        : {
            kind: "existing",
            threadId: resolveExistingThreadRef(parsed.threadTarget.threadId, ctx, callingId),
          };
  const parsedTargetThreadId =
    parsed.targetThreadId != null
      ? resolveExistingThreadRef(parsed.targetThreadId, ctx, callingId)
      : parsed.targetThreadId;
  const target = normalizeScheduleThreadTarget({
    threadTarget: continueHere
      ? { kind: "existing", threadId: callingId }
      : parsedTarget !== undefined
        ? parsedTarget
        : current.threadTarget,
    targetThreadId:
      parsed.targetThreadId !== undefined ? parsedTargetThreadId : (current.targetThreadId ?? null),
  });
  return serializeTask(
    ctx.scheduleService.update(parsed.id, {
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
      createdByThreadId: current.createdByThreadId ?? callingId,
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
    }),
    ctx,
  );
}

function getSchedule(args: unknown, ctx: ScheduleToolContext): unknown {
  return serializeTask(requireSchedule(ctx, idArgsSchema.parse(args).id), ctx);
}

function pauseSchedule(args: unknown, ctx: ScheduleToolContext): unknown {
  const { id } = idArgsSchema.parse(args);
  requireSchedule(ctx, id);
  return serializeTask(ctx.scheduleService.pause(id), ctx);
}

function resumeSchedule(args: unknown, ctx: ScheduleToolContext): unknown {
  const { id } = idArgsSchema.parse(args);
  requireSchedule(ctx, id);
  return serializeTask(ctx.scheduleService.resume(id), ctx);
}

function runSchedule(args: unknown, ctx: ScheduleToolContext): unknown {
  return serializeTask(ctx.scheduleService.runNow(idArgsSchema.parse(args).id), ctx);
}

function deleteSchedule(args: unknown, ctx: ScheduleToolContext): { deleted: boolean; id: string } {
  const { id } = idArgsSchema.parse(args);
  requireSchedule(ctx, id);
  ctx.scheduleService.delete(id);
  return { deleted: true, id };
}

function listScheduleRuns(args: unknown, ctx: ScheduleToolContext): unknown {
  const parsed = listRunsArgsSchema.parse(args);
  requireSchedule(ctx, parsed.id);
  return ctx.scheduleService.listRuns(parsed.id, parsed.limit).map((run) => serializeRun(run, ctx));
}

export const scheduleTools: ScheduleToolDomain = {
  specs: [
    {
      name: "list",
      description: "List the user's CraftStation schedules and their current status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get",
      description: "Get one CraftStation schedule by id.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "create",
      description:
        "Create a plan / monitor / daily routine / timed task (计划 / 监控 / 日常 / 定时任务). " +
        "Use this instead of polling, sleeping, or keeping a turn open while waiting " +
        "(training jobs, CI, later reminders, recurring checks). The current agent and model " +
        "are used unless overridden — to fire runs as Devin, pass agentKind:'devin', " +
        "model:'swe-2-max', effort:'max' (an explicit agentKind whose harness item is not " +
        "registered fails at create time; it never falls back to the calling thread's harness). " +
        "The schedule binds to the calling thread by default " +
        "(future runs continue there); pass threadTarget {kind:'existing',threadId} (or the " +
        "top-level targetThreadId string) to bind another existing thread, or " +
        "{kind:'new'} / continueInCurrentThread:false for a detached schedule. The target " +
        "threadId accepts the sidebar UUID, thread:<uuid>, or a Crossagents harness:nativeId " +
        "address (e.g. kimi:session_…, devin:…) — every form resolves to the SAME thread. " +
        "The returned " +
        "task always carries sourceThreadId and targetThreadId — verify they match the " +
        "intended thread. For sub-hourly repeats use recurrence " +
        "{kind:'interval',everyMinutes:N} (e.g. every 10 minutes). Never ask the scheduled " +
        "prompt to create its own next schedule via create — that multiplies schedules and threads.",
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
      name: "update",
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
      name: "pause",
      description: "Pause a schedule without deleting its definition.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "resume",
      description: "Resume a paused schedule and recompute its next run.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "run_now",
      description: "Run an existing schedule now without changing its next scheduled run.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "delete",
      description: "Permanently delete an existing schedule from this device.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "list_runs",
      description:
        "List recent executions of one schedule (newest first). Each row is a ScheduledTaskRun: id, scheduleId, threadId, triggeredBy (scheduled|manual), status (queued|running|succeeded|failed|interrupted — never 'never'), timestamps, summary/error, and executionSnapshot. Use this to monitor firings instead of polling the original task.",
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
    list: (_args, ctx) => ctx.scheduleService.list().map((task) => serializeTask(task, ctx)),
    get: getSchedule,
    create: createSchedule,
    update: updateSchedule,
    pause: pauseSchedule,
    resume: resumeSchedule,
    run_now: runSchedule,
    delete: deleteSchedule,
    list_runs: listScheduleRuns,
  },
};

function requireSchedule(ctx: ScheduleToolContext, id: string): ScheduledTask {
  const task = ctx.scheduleService.get(id);
  if (task) return task;
  // A row that list() can see but get() cannot read means the store views
  // diverged (observed after a host restart). Say so explicitly instead of a
  // plain NOT_FOUND so callers do not mistake it for a deleted schedule.
  let listedButUnreadable = false;
  try {
    listedButUnreadable = ctx.scheduleService.list().some((entry) => entry.id === id);
  } catch {
    // If even list fails, fall through to the plain not-found error.
  }
  if (listedButUnreadable) {
    throw new Error(
      `Scheduled task ${id} is visible in list but unreadable by id (store index missing). Restart the CraftStation host and retry; the schedule itself was not deleted.`,
    );
  }
  throw new Error(`Scheduled task not found: ${id}.`);
}
