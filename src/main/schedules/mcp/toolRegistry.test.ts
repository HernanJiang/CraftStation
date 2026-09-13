import { describe, expect, it, vi } from "vitest";
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  Thread,
} from "@/shared/contracts";
import type { ScheduleCapability } from "../ScheduleCapability";
import {
  SCHEDULE_MCP_INSTRUCTIONS,
  TOOLS,
  dispatchTool,
  type ScheduleToolContext,
} from "./toolRegistry";

const thread = {
  id: "aa11bb22-cc33-4d44-9e55-6f77aa88bb99",
  projectId: "project-1",
  agentKind: "codex",
  config: { model: "gpt-5.6", effort: "high", fast: true },
} as Thread;

function context(options: { tasks?: ScheduledTask[]; threads?: Thread[] } = {}): {
  ctx: ScheduleToolContext;
  service: ScheduleCapability;
} {
  const tasks = options.tasks ?? [];
  const threads = options.threads ?? [thread];
  const service = {
    list: vi.fn<() => ScheduledTask[]>(() => tasks),
    get: vi.fn<(id: string) => ScheduledTask | null>(
      (id) => tasks.find((task) => task.id === id) ?? null,
    ),
    create: vi.fn<(input: ScheduledTaskInput) => ScheduledTask>(
      (input) => ({ id: "created", ...input }) as ScheduledTask,
    ),
    update: vi.fn<(id: string, input: ScheduledTaskInput) => ScheduledTask>(
      (id, input) => ({ id, ...input }) as ScheduledTask,
    ),
    runNow: vi.fn<(id: string) => ScheduledTask>(
      (id) => ({ id, lastStatus: "running" }) as ScheduledTask,
    ),
    pause: vi.fn<(id: string) => ScheduledTask>(
      (id) => ({ id, enabled: false, nextRunAt: null }) as ScheduledTask,
    ),
    resume: vi.fn<(id: string) => ScheduledTask>((id) => ({ id, enabled: true }) as ScheduledTask),
    delete: vi.fn<(id: string) => void>(),
    listRuns: vi.fn<(id: string, limit?: number) => ScheduledTaskRun[]>(() => []),
  } as unknown as ScheduleCapability;
  return {
    service,
    ctx: {
      identity: { threadId: threads[0]?.id ?? thread.id, title: "Caller" },
      scheduleService: service,
      getThread: (id) => threads.find((entry) => entry.id === id) ?? null,
    },
  };
}

describe("Schedule MCP tools", () => {
  it("advertises the short catalog and wait-instead-of-poll instructions", () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      "list",
      "get",
      "create",
      "update",
      "pause",
      "resume",
      "run_now",
      "delete",
      "list_runs",
    ]);
    expect(SCHEDULE_MCP_INSTRUCTIONS).toContain("计划 / 监控 / 日常 / 定时任务");
    expect(SCHEDULE_MCP_INSTRUCTIONS).toContain("Do not poll");
    expect(SCHEDULE_MCP_INSTRUCTIONS).toContain("training job");
    expect(TOOLS.find((tool) => tool.name === "create")?.description).toContain(
      "instead of polling",
    );
  });

  it("creates a schedule with the calling thread's agent defaults", async () => {
    const { ctx, service } = context();
    await dispatchTool(
      "create",
      {
        name: "Daily brief",
        prompt: "Summarize priorities",
        recurrence: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" },
      },
      ctx,
    );

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Daily brief",
        prompt: "Summarize priorities",
        recurrence: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" },
        enabled: true,
        agentKind: "codex",
        projectId: "project-1",
        sourceThreadId: thread.id,
        threadTarget: { kind: "existing", threadId: thread.id },
        config: { model: "gpt-5.6", effort: "high", fast: true },
      }),
    );
  });

  it("updates only the requested schedule fields", async () => {
    const task = {
      id: "d2ac39e9-14ac-4776-9279-37a1e455a5db",
      name: "Old name",
      prompt: "Keep this prompt",
      agentKind: "claude:home",
      config: { model: "claude-fable-5", effort: "medium" },
      recurrence: { kind: "hourly", minute: 0 },
      enabled: true,
    } as ScheduledTask;
    const { ctx, service } = context({ tasks: [task] });

    await dispatchTool("update", { id: task.id, name: "New name", enabled: false }, ctx);

    expect(service.update).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        name: "New name",
        prompt: "Keep this prompt",
        enabled: false,
        recurrence: { kind: "hourly", minute: 0 },
      }),
    );
  });

  it("exposes list/get/create/update/pause/resume/run_now/list_runs/delete on the same service", async () => {
    const task = {
      id: "d2ac39e9-14ac-4776-9279-37a1e455a5db",
      name: "Unified",
      prompt: "Shared store",
      agentKind: "codex",
      config: { model: "gpt-5.6" },
      recurrence: { kind: "hourly", minute: 0 },
      enabled: true,
    } as ScheduledTask;
    const { ctx, service } = context({ tasks: [task] });

    await dispatchTool("list", {}, ctx);
    await dispatchTool("get", { id: task.id }, ctx);
    await dispatchTool(
      "create",
      {
        name: "Alias create",
        prompt: "via short name",
        recurrence: { kind: "hourly", minute: 15 },
        timezone: "Asia/Shanghai",
        recipeId: "recipe-daily",
        targetThreadId: null,
        continueInCurrentThread: false,
      },
      ctx,
    );
    await dispatchTool("update", { id: task.id, name: "Renamed" }, ctx);
    await dispatchTool("pause", { id: task.id }, ctx);
    await dispatchTool("resume", { id: task.id }, ctx);
    await dispatchTool("run_now", { id: task.id }, ctx);
    await dispatchTool("list_runs", { id: task.id, limit: 5 }, ctx);
    await dispatchTool("delete", { id: task.id }, ctx);

    expect(service.list).toHaveBeenCalled();
    expect(service.get).toHaveBeenCalledWith(task.id);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Alias create",
        timezone: "Asia/Shanghai",
        recipeId: "recipe-daily",
      }),
    );
    expect(service.update).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ name: "Renamed" }),
    );
    expect(service.pause).toHaveBeenCalledWith(task.id);
    expect(service.resume).toHaveBeenCalledWith(task.id);
    expect(service.runNow).toHaveBeenCalledWith(task.id);
    expect(service.listRuns).toHaveBeenCalledWith(task.id, 5);
    expect(service.delete).toHaveBeenCalledWith(task.id);
  });

  it("lists ScheduledTaskRun rows for monitoring", async () => {
    const task = {
      id: "d2ac39e9-14ac-4776-9279-37a1e455a5db",
      name: "Probe",
      prompt: "Ping",
      agentKind: "codex",
      config: { model: "gpt-5.6" },
      recurrence: { kind: "hourly", minute: 0 },
      enabled: true,
    } as ScheduledTask;
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
      executionSnapshot: {
        recipeId: null,
        model: "gpt-5.6",
        harnessItemId: null,
        agentKind: "codex",
        threadTarget: { kind: "new" as const },
        sourceThreadId: thread.id,
      },
    };
    const { ctx, service } = context({ tasks: [task] });
    service.listRuns = vi.fn().mockReturnValue([run]);

    const rows = await dispatchTool("list_runs", { id: task.id }, ctx);
    expect(service.listRuns).toHaveBeenCalledWith(task.id, undefined);
    expect(rows).toEqual([run]);
  });

  it("accepts once.runAt with a timezone offset", async () => {
    const { ctx, service } = context();
    await dispatchTool(
      "create",
      {
        name: "Offset once",
        prompt: "Ping",
        recurrence: { kind: "once", runAt: "2026-09-09T20:14:35.716+08:00" },
        timezone: "Asia/Shanghai",
        continueInCurrentThread: false,
      },
      ctx,
    );
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recurrence: { kind: "once", runAt: "2026-09-09T20:14:35.716+08:00" },
        timezone: "Asia/Shanghai",
      }),
    );
  });

  it("passes timezone/recipe/target-thread through on create", async () => {
    const { ctx, service } = context();
    await dispatchTool(
      "create",
      {
        name: "Morning summary",
        prompt: "Summarize progress",
        recurrence: { kind: "weekly", days: [1], time: "08:00" },
        timezone: "Asia/Shanghai",
        recipeId: "recipe-morning",
        targetThreadId: "aa11bb22-cc33-4d44-9e55-6f77aa88bb99",
      },
      ctx,
    );

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: "Asia/Shanghai",
        recipeId: "recipe-morning",
        targetThreadId: "aa11bb22-cc33-4d44-9e55-6f77aa88bb99",
        threadTarget: {
          kind: "existing",
          threadId: "aa11bb22-cc33-4d44-9e55-6f77aa88bb99",
        },
      }),
    );
  });

  it("continueInCurrentThread:false detaches from the calling thread", async () => {
    const { ctx, service } = context();
    await dispatchTool(
      "create",
      {
        name: "From chat",
        prompt: "Ping me",
        recurrence: { kind: "hourly", minute: 0 },
        continueInCurrentThread: false,
      },
      ctx,
    );
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceThreadId: thread.id,
        threadTarget: { kind: "new" },
        targetThreadId: null,
      }),
    );
  });
});
