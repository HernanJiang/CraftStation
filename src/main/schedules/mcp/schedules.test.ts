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

/** Context with the Crossagents bus seams wired (production parity). */
function ctxWithBus(
  service: ScheduleCapability,
  bus: {
    resolvePeerTarget?: (target: string, sourceThreadId: string | null) => { threadId: string };
    peerAddressOfThread?: (threadId: string) => string | null;
  },
): ScheduleToolContext {
  return {
    ...ctx(service),
    ...(bus.resolvePeerTarget ? { resolvePeerTarget: bus.resolvePeerTarget } : {}),
    ...(bus.peerAddressOfThread ? { peerAddressOfThread: bus.peerAddressOfThread } : {}),
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

  it("continueInCurrentThread=true binds the calling thread (P0-2 acceptance)", async () => {
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    const result = await scheduleTools.handlers.create!(
      {
        name: "Self check 30min",
        prompt: "Run the self check and report locally.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        continueInCurrentThread: true,
      },
      ctx(service),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceThreadId: thread.id,
        targetThreadId: thread.id,
        threadTarget: { kind: "existing", threadId: thread.id },
      }),
    );
    // The created task is returned with both ids so the caller can verify.
    expect(result).toEqual(
      expect.objectContaining({ sourceThreadId: thread.id, targetThreadId: thread.id }),
    );
  });

  const executorThread = {
    id: "d48b6841-b29c-476c-ab2d-85fe3145c7d8",
    projectId: "project-1",
    agentKind: "opencode",
    config: { model: "opencode-go/muse-spark-1.3-contributor" },
  } as Thread;

  it("threadTarget existing binds source and target to the target thread (P1-1)", async () => {
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    // Manager (thread.id) creating a check bound to the executor thread.
    await scheduleTools.handlers.create!(
      {
        name: "Executor self check",
        prompt: "Run the executor self check.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        threadTarget: { kind: "existing", threadId: executorThread.id },
      },
      ctx(service),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceThreadId: executorThread.id,
        targetThreadId: executorThread.id,
        threadTarget: { kind: "existing", threadId: executorThread.id },
        createdByThreadId: thread.id,
      }),
    );
  });

  it("accepts a JSON-stringified threadTarget object (OpenCode bridge, P0-1)", async () => {
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    await scheduleTools.handlers.create!(
      {
        name: "Executor self check",
        prompt: "Run the executor self check.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        threadTarget: JSON.stringify({ kind: "existing", threadId: executorThread.id }),
      },
      ctx(service),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceThreadId: executorThread.id,
        targetThreadId: executorThread.id,
        threadTarget: { kind: "existing", threadId: executorThread.id },
      }),
    );
  });

  it("threadTarget {kind:'new'} is a detached schedule bound to no thread", async () => {
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    await scheduleTools.handlers.create!(
      {
        name: "Detached sweep",
        prompt: "Sweep and log.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        threadTarget: { kind: "new" },
      },
      ctx(service),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceThreadId: thread.id,
        targetThreadId: null,
        threadTarget: { kind: "new" },
        createdByThreadId: thread.id,
      }),
    );
  });

  it("normalizes stringified null sentinels on create (OpenCode bridge)", async () => {
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    await scheduleTools.handlers.create!(
      {
        name: "Null sentinel probe",
        prompt: "Probe null sentinel normalization.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        timezone: "null",
        recipeId: "null",
        projectId: "null",
        continueInCurrentThread: false,
      },
      ctx(service),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: null, recipeId: null }),
    );
  });

  it("normalizes stringified null sentinels on update (OpenCode bridge)", async () => {
    const current = {
      id: "d55dcce0-b7cb-4d57-9c00-e5a3d19eb150",
      name: "Self check",
      prompt: "Run the self check.",
      agentKind: "opencode",
      recurrence: { kind: "interval", everyMinutes: 30 },
      enabled: true,
      timezone: "Asia/Shanghai",
      recipeId: "recipe-1",
      threadTarget: { kind: "new" },
      targetThreadId: null,
      sourceThreadId: thread.id,
      createdByThreadId: thread.id,
      config: { model: "opencode-go/muse-spark-1.3-contributor" },
    } as unknown as ScheduledTask;
    const update = vi.fn<(id: string, input: unknown) => ScheduledTask>(
      (_id, input) => ({ ...current, ...(input as object) }) as ScheduledTask,
    );
    const service = {
      get: vi.fn<(id: string) => ScheduledTask | null>(() => current),
      update,
    } as unknown as ScheduleCapability;

    await scheduleTools.handlers.update!(
      { id: current.id, timezone: "null", recipeId: "undefined" },
      ctx(service),
    );

    expect(update).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({ timezone: null, recipeId: null }),
    );
  });

  it("still accepts real null and real time zones alongside the sentinels", async () => {
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    await scheduleTools.handlers.create!(
      {
        name: "Real null probe",
        prompt: "Probe real null handling.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        timezone: null,
        recipeId: null,
        continueInCurrentThread: false,
      },
      ctx(service),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: null, recipeId: null }),
    );
    create.mockClear();
    await scheduleTools.handlers.create!(
      {
        name: "Real zone probe",
        prompt: "Probe real timezone handling.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        timezone: "Asia/Shanghai",
        continueInCurrentThread: false,
      },
      ctx(service),
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ timezone: "Asia/Shanghai" }));
  });

  it("distinguishes a listed-but-unreadable schedule from a plain not found", () => {
    const id = "d55dcce0-b7cb-4d57-9c00-e5a3d19eb150";
    const ghost = { id } as ScheduledTask;
    const diverged = {
      get: vi.fn<(id: string) => ScheduledTask | null>(() => null),
      list: vi.fn<() => ScheduledTask[]>(() => [ghost]),
    } as unknown as ScheduleCapability;
    expect(() => scheduleTools.handlers.get!({ id }, ctx(diverged))).toThrow(
      /visible in list but unreadable by id/u,
    );

    const empty = {
      get: vi.fn<(id: string) => ScheduledTask | null>(() => null),
      list: vi.fn<() => ScheduledTask[]>(() => []),
    } as unknown as ScheduleCapability;
    expect(() => scheduleTools.handlers.get!({ id }, ctx(empty))).toThrow(
      `Scheduled task not found: ${id}.`,
    );
  });

  it("resolves a harness:nativeId threadTarget to the existing thread UUID (shared Crossagents resolver)", async () => {
    const KIMI_UUID = "d48b6841-b29c-476c-ab2d-85fe3145c7d8";
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    const resolvePeerTarget = vi.fn(() => ({ threadId: KIMI_UUID }));

    await scheduleTools.handlers.create!(
      {
        name: "Kimi executor check",
        prompt: "Run the check.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        threadTarget: { kind: "existing", threadId: "kimi:session_abc123" },
      },
      ctxWithBus(service, { resolvePeerTarget }),
    );

    // The shared resolver ran once; the schedule persists the CANONICAL UUID,
    // never the raw address — and the run binds to that same conversation.
    expect(resolvePeerTarget).toHaveBeenCalledWith("kimi:session_abc123", thread.id);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTarget: { kind: "existing", threadId: KIMI_UUID },
        targetThreadId: KIMI_UUID,
        sourceThreadId: KIMI_UUID,
        createdByThreadId: thread.id,
      }),
    );
  });

  it("resolves a bare harness:nativeId targetThreadId string the same way", async () => {
    const DEVIN_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    const resolvePeerTarget = vi.fn(() => ({ threadId: DEVIN_UUID }));

    await scheduleTools.handlers.create!(
      {
        name: "Devin nightly",
        prompt: "Run the nightly self check.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        targetThreadId: "devin:acp-session-9",
      },
      ctxWithBus(service, { resolvePeerTarget }),
    );

    expect(resolvePeerTarget).toHaveBeenCalledWith("devin:acp-session-9", thread.id);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTarget: { kind: "existing", threadId: DEVIN_UUID },
        targetThreadId: DEVIN_UUID,
      }),
    );
  });

  it("accepts thread:<uuid> targets without needing the resolver", async () => {
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;
    const resolvePeerTarget = vi.fn(() => ({ threadId: "unused" }));

    await scheduleTools.handlers.create!(
      {
        name: "Prefixed target",
        prompt: "Bind to the prefixed thread.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        threadTarget: { kind: "existing", threadId: `thread:${executorThread.id}` },
      },
      ctxWithBus(service, { resolvePeerTarget }),
    );

    expect(resolvePeerTarget).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTarget: { kind: "existing", threadId: executorThread.id },
        targetThreadId: executorThread.id,
      }),
    );
  });

  it("fails closed with a clear error when a native address has no resolver wired", () => {
    const service = {
      create: vi.fn(),
    } as unknown as ScheduleCapability;
    expect(() =>
      scheduleTools.handlers.create!(
        {
          name: "No resolver",
          prompt: "Bind by address.",
          recurrence: { kind: "interval", everyMinutes: 30 },
          threadTarget: { kind: "existing", threadId: "kimi:session_abc123" },
        },
        ctx(service),
      ),
    ).toThrow(/no Crossagents address resolver/);
  });

  it("fires as Devin when agentKind=devin model=swe-2-max effort=max are explicit", async () => {
    const create = vi.fn<(input: unknown) => ScheduledTask>(
      (input) => ({ id: "created", ...(input as object) }) as ScheduledTask,
    );
    const service = { create } as unknown as ScheduleCapability;

    await scheduleTools.handlers.create!(
      {
        name: "Devin self check",
        prompt: "Run the self check and report.",
        recurrence: { kind: "interval", everyMinutes: 30 },
        agentKind: "devin",
        model: "swe-2-max",
        effort: "max",
        threadTarget: { kind: "new" },
      },
      ctx(service),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKind: "devin",
        threadTarget: { kind: "new" },
        config: expect.objectContaining({ model: "swe-2-max", effort: "max" }),
      }),
    );
  });

  it("rejects an explicit agentKind whose harness item is missing instead of drifting", () => {
    const create = vi.fn();
    const service = { create } as unknown as ScheduleCapability;
    expect(() =>
      scheduleTools.handlers.create!(
        {
          name: "Typo harness",
          prompt: "This must not silently bind the caller's harness.",
          recurrence: { kind: "interval", everyMinutes: 30 },
          agentKind: "devin-typo",
          model: "swe-2-max",
        },
        ctx(service),
      ),
    ).toThrow(/harness:devin-typo/);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an unknown explicit harnessItemId at create time", () => {
    const create = vi.fn();
    const service = { create } as unknown as ScheduleCapability;
    expect(() =>
      scheduleTools.handlers.create!(
        {
          name: "Ghost harness item",
          prompt: "No such item.",
          recurrence: { kind: "interval", everyMinutes: 30 },
          harnessItemId: "harness:no-such-harness",
        },
        ctx(service),
      ),
    ).toThrow(/harnessItemId/);
    expect(create).not.toHaveBeenCalled();
  });

  it("get exposes boundThreadId and peerAddress for a UUID-bound task", () => {
    const bound = {
      id: "d55dcce0-b7cb-4d57-9c00-e5a3d19eb150",
      name: "Bound check",
      agentKind: "devin",
      threadTarget: { kind: "existing", threadId: executorThread.id },
      targetThreadId: executorThread.id,
      sourceThreadId: executorThread.id,
      config: { model: "swe-2-max" },
    } as unknown as ScheduledTask;
    const service = {
      get: vi.fn<(id: string) => ScheduledTask | null>(() => bound),
    } as unknown as ScheduleCapability;
    const peerAddressOfThread = vi.fn((threadId: string) =>
      threadId === executorThread.id ? "devin:acp-session-9" : null,
    );

    const result = scheduleTools.handlers.get!(
      { id: bound.id },
      ctxWithBus(service, { peerAddressOfThread }),
    ) as Record<string, unknown>;

    expect(result).toMatchObject({
      id: bound.id,
      boundThreadId: executorThread.id,
      peerAddress: "devin:acp-session-9",
    });
  });

  it("list_runs rows carry boundThreadId and peerAddress of the fired thread", async () => {
    const taskRow = { id: "d55dcce0-b7cb-4d57-9c00-e5a3d19eb150" } as ScheduledTask;
    const firedThreadId = "64261085-f3ec-4a99-8f42-a6a73468feec";
    const run = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      scheduleId: taskRow.id,
      threadId: firedThreadId,
      triggeredBy: "scheduled",
      startedAt: "2026-09-19T00:00:00.000Z",
      completedAt: null,
      status: "running",
      summary: null,
      error: null,
    } as ScheduledTaskRun;
    const service = {
      get: vi.fn<(id: string) => ScheduledTask | null>(() => taskRow),
      listRuns: vi.fn<() => ScheduledTaskRun[]>(() => [run]),
    } as unknown as ScheduleCapability;
    const peerAddressOfThread = vi.fn((threadId: string) =>
      threadId === firedThreadId ? "devin:devin-session-1" : null,
    );

    const rows = (await scheduleTools.handlers.list_runs!(
      { id: taskRow.id },
      ctxWithBus(service, { peerAddressOfThread }),
    )) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: run.id,
      boundThreadId: firedThreadId,
      peerAddress: "devin:devin-session-1",
    });
  });
});
