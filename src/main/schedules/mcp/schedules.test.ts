import { describe, expect, it, vi } from "vitest";
import type { ScheduledTask, ScheduledTaskRun, Thread } from "@/shared/contracts";
import type { ScheduleCapability } from "../ScheduleCapability";
import { scheduleTools } from "./schedules";
import type { ScheduleToolContext } from "./types";

const thread = {
  id: "cf26d9bf-8170-430a-ac4d-018ee67a3a1d",
  projectId: "project-1",
  agentKind: "grok",
  config: { model: "grok-4.6", effort: "high" },
} as Thread;

function ctx(service: ScheduleCapability): ScheduleToolContext {
  return {
    identity: { threadId: thread.id, title: "Caller" },
    scheduleService: service,
    getThread: (id) => (id === thread.id ? thread : null),
  };
}

describe("Schedule MCP tools", () => {
  it("lists ScheduledTaskRun rows through list_runs", async () => {
    const task = { id: "d55dcce0-b7cb-4d57-9c00-e5a3d19eb150" } as ScheduledTask;
    const run = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      scheduleId: task.id,
      threadId: "64261085-f3ec-4a99-8f42-a6a73468feec",
      triggeredBy: "manual",
      startedAt: "2026-09-09T12:11:50.541Z",
      completedAt: "2026-09-09T12:11:58.242Z",
      status: "succeeded",
      summary: "SCHEDULE_SCHEMA_OK",
      error: null,
      executionSnapshot: {
        recipeId: null,
        model: "grok-4.6",
        harnessItemId: null,
        agentKind: "grok",
        threadTarget: { kind: "new" },
        sourceThreadId: thread.id,
      },
    } as ScheduledTaskRun;
    const listRuns = vi.fn<(id: string, limit?: number) => ScheduledTaskRun[]>(() => [run]);
    const service = {
      get: vi.fn<(id: string) => ScheduledTask | null>(() => task),
      listRuns,
    } as unknown as ScheduleCapability;
    const context = ctx(service);

    const rows = await scheduleTools.handlers.list_runs!({ id: task.id, limit: 5 }, context);

    expect(rows).toEqual([run]);
    expect(listRuns).toHaveBeenCalledWith(task.id, 5);
    expect(run.status).not.toBe("never");
    expect(run.triggeredBy).toBe("manual");
    expect(run.threadId).not.toBe(thread.id);
  });

  it("accepts once.runAt with +08:00 on create", async () => {
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    await scheduleTools.handlers.create!(
      {
        name: "schema-probe-once",
        prompt: "Reply with exactly: SCHEDULE_SCHEMA_OK",
        recurrence: { kind: "once", runAt: "2026-09-09T20:14:35.716+08:00" },
        timezone: "Asia/Shanghai",
        continueInCurrentThread: false,
      },
      ctx(service),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        recurrence: { kind: "once", runAt: "2026-09-09T20:14:35.716+08:00" },
        timezone: "Asia/Shanghai",
        sourceThreadId: thread.id,
        threadTarget: { kind: "new" },
      }),
    );
  });

  it("binds to the calling thread by default", async () => {
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    await scheduleTools.handlers.create!(
      {
        name: "Wait for training",
        prompt: "Check the training job and summarize.",
        recurrence: { kind: "interval", everyMinutes: 10 },
      },
      ctx(service),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceThreadId: thread.id,
        threadTarget: { kind: "existing", threadId: thread.id },
        targetThreadId: thread.id,
      }),
    );
  });
});
