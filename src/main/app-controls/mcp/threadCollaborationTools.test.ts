import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InterruptThreadPayload,
  Project,
  SendThreadInputPayload,
  StartThreadPayload,
  StartThreadResult,
  Thread,
  ThreadRuntimeSnapshot,
  ThreadStatus,
} from "@/shared/contracts";
import { closeDatabase, initDatabase } from "../../db/connection";
import { dbUpsertProject, dbUpsertThread } from "../../db/projectsThreads";
import type { PersistedCompletedTurn, PersistedRuntimeItem } from "../../db/runtimeItems";
import { ThreadCollaborationService, ThreadControlAdapter } from "../../thread-collaboration";
import { ThreadStateBroker } from "../../threads/threadStateBroker";
import { dispatchTool, type AppControlsToolContext } from "./toolRegistry";

const serverNativeBindingCandidates = [
  join(process.cwd(), "dist", "server-native", "better_sqlite3.node"),
  join(process.cwd(), "..", "..", "dist", "server-native", "better_sqlite3.node"),
];
const serverNativeBinding = serverNativeBindingCandidates.find(existsSync);
let nativeBindingEnv: string | undefined;
let sqliteAvailable = true;
try {
  new Database(":memory:").close();
} catch {
  if (serverNativeBinding) nativeBindingEnv = serverNativeBinding;
  else sqliteAvailable = false;
}

function thread(id: string, projectId = "project-1", overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId,
    title: id,
    agentKind: id === "target" ? "grok" : "codex",
    config: { model: id === "target" ? "grok-4.6" : "gpt-5.6" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

describe.skipIf(!sqliteAvailable)("thread collaboration MCP tools", () => {
  let dir: string;
  let threads: Thread[];
  let statuses: Map<string, ThreadStatus>;
  let sendThreadInput: ReturnType<typeof vi.fn<(payload: SendThreadInputPayload) => Promise<void>>>;
  let startThread: ReturnType<
    typeof vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>
  >;
  let interruptThread: ReturnType<typeof vi.fn<(payload: InterruptThreadPayload) => Promise<void>>>;
  let ctx: AppControlsToolContext;
  let identityThreadId: string;

  beforeEach(() => {
    if (nativeBindingEnv) process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
    dir = mkdtempSync(join(tmpdir(), "craftstation-thread-collab-mcp-"));
    initDatabase(join(dir, "state.sqlite"));
    const projects: Project[] = [
      {
        id: "project-1",
        name: "project-1",
        location: { kind: "posix", path: "/tmp/project-1" },
        createdAt: "2026-08-31T00:00:00.000Z",
      },
      {
        id: "project-2",
        name: "project-2",
        location: { kind: "posix", path: "/tmp/project-2" },
        createdAt: "2026-08-31T00:00:00.000Z",
      },
    ];
    threads = [
      thread("source"),
      thread("target"),
      // Same Model×Harness tuple as the source: never a dialogue target.
      thread("twin", "project-1", { config: { model: "gpt-5.6" } }),
      thread("foreign", "project-2"),
      thread("third", "project-1", { agentKind: "claude", config: { model: "claude-fable-5" } }),
    ];
    for (const entry of projects) dbUpsertProject(entry, 0);
    for (const entry of threads) dbUpsertThread(entry, 0);
    statuses = new Map(threads.map((entry) => [entry.id, entry.status]));
    const turns = new Map<string, PersistedCompletedTurn[]>();
    const items = new Map<string, PersistedRuntimeItem>();
    sendThreadInput = vi.fn<(payload: SendThreadInputPayload) => Promise<void>>(
      async () => undefined,
    );
    startThread = vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>(async () => ({
      threadId: "target",
    }));
    interruptThread = vi.fn<(payload: InterruptThreadPayload) => Promise<void>>(
      async () => undefined,
    );
    identityThreadId = "source";
    const getThreadSnapshots = async (): Promise<ThreadRuntimeSnapshot[]> =>
      threads.map((entry) => ({
        threadId: entry.id,
        status: statuses.get(entry.id) ?? entry.status,
        attention: "none" as const,
        canResumeWithConfig: entry.canResumeWithConfig,
      }));
    const control = new ThreadControlAdapter({
      getThread: (id) => threads.find((entry) => entry.id === id) ?? null,
      getThreads: () => threads,
      getProject: (id) => projects.find((entry) => entry.id === id) ?? null,
      settings: () =>
        ({
          mcpServers: [],
          disabledBuiltInMcpServers: {},
          disabledBuiltInMcpTools: {},
        }) as never,
      runtime: {
        getThreadSnapshots,
        startThread,
        sendThreadInput,
        interruptThread,
        closeThread: vi.fn<(payload: { threadId: string }) => Promise<void>>(async () => undefined),
      },
      states: {
        getLiveState: (id: string) => ({
          status: statuses.get(id) ?? "inactive",
          attention: "none",
        }),
        waitUntil: async <T>(_ids: string[], _timeoutMs: number, poll: () => T | undefined) =>
          poll(),
      } as never,
    });
    const service = new ThreadCollaborationService({
      control,
      getCompletedTurns: (id) => turns.get(id) ?? [],
      getRuntimeItem: (id, itemId) => items.get(`${id}:${itemId}`) ?? null,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });
    // The tools receive the real main-process service, not a supervisor bypass.
    ctx = {
      identity: {
        get threadId() {
          return identityThreadId;
        },
        title: "Caller",
      },
      getThread: (id: string) => threads.find((entry) => entry.id === id) ?? null,
      getThreads: () => threads,
      supervisor: {
        getThreadSnapshots,
        sendThreadInput,
        interruptThread,
        startThread,
        setPendingSteer: vi.fn<() => Promise<void>>(async () => undefined),
      },
      threadStates: new ThreadStateBroker(),
      threadControl: control,
      threadCollaboration: service,
    } as unknown as AppControlsToolContext;
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING;
  });

  async function ask(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return (await dispatchTool("ask_thread", args, ctx)) as Record<string, unknown>;
  }

  it("asks through the collaboration service and delivers to a settled target", async () => {
    const exchange = await ask({ threadId: "target", request: "What is the status?" });

    expect(exchange).toMatchObject({
      sourceThreadId: "source",
      targetThreadId: "target",
      status: "delivered",
      deliveryMode: "after-current-turn",
      contextCapsule: null,
      causalParentExchangeId: null,
      hopDepth: 0,
    });
    expect(typeof exchange.idempotencyKey).toBe("string");
    expect(String(exchange.idempotencyKey).length).toBeGreaterThan(0);
    // Delivery went through the control plane once; no raw supervisor bypass.
    expect(sendThreadInput).toHaveBeenCalledTimes(1);
    expect(sendThreadInput.mock.calls[0]![0].threadId).toBe("target");
    expect(sendThreadInput.mock.calls[0]![0].prompt).toContain("What is the status?");
    expect(sendThreadInput.mock.calls[0]![0].prompt).toContain(
      "[CraftStation cross-thread dialogue]",
    );
    expect(interruptThread).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
  });

  it("delivers an Executor handoff that the Manager can read by exchange id", async () => {
    const result = (await dispatchTool(
      "send_thread_message",
      {
        thread_id: "target",
        message: "实验完成：结果已写入临时测试记录。",
        sender_role: "my-research Executor",
        experiment_id: "integration-test",
      },
      ctx,
    )) as {
      delivered: boolean;
      message_id: string;
      target_thread_id: string;
      error?: string;
    };

    expect(result).toMatchObject({
      delivered: true,
      target_thread_id: "target",
    });
    expect(result.message_id).toMatch(/^thread-exchange-/u);
    expect(result.error).toBeUndefined();

    identityThreadId = "target";
    const exchange = await dispatchTool(
      "read_thread_exchange",
      { exchangeId: result.message_id },
      ctx,
    );
    expect(exchange).toMatchObject({
      id: result.message_id,
      sourceThreadId: "source",
      targetThreadId: "target",
      status: "delivered",
      request: expect.stringContaining("实验完成"),
    });
    expect((exchange as { request: string }).request).toContain(
      "sender_role: my-research Executor",
    );
    expect((exchange as { request: string }).request).toContain("experiment_id: integration-test");
  });

  it("reuses the same durable handoff when an Executor retries an experiment", async () => {
    const args = {
      thread_id: "target",
      message: "同一实验的收口消息。",
      sender_role: "my-research Executor",
      experiment_id: "retry-safe",
    };

    const first = (await dispatchTool("send_thread_message", args, ctx)) as {
      delivered: boolean;
      message_id: string;
    };
    const second = (await dispatchTool("send_thread_message", args, ctx)) as {
      delivered: boolean;
      message_id: string;
    };

    expect(first).toMatchObject({ delivered: true });
    expect(second).toEqual(first);
    expect(sendThreadInput).toHaveBeenCalledTimes(1);
  });

  it("keeps context empty by default and honors explicit context, idempotency key and causal parent", async () => {
    const parent = await ask({
      threadId: "target",
      request: "first question",
      idempotencyKey: "k1",
    });
    expect(parent.idempotencyKey).toBe("k1");

    // The replying thread asks a different cross-composition thread, citing
    // the exchange it received as its causal parent.
    identityThreadId = "target";
    const followUp = await ask({
      threadId: "third",
      request: "follow-up question",
      idempotencyKey: "k2",
      causalParentExchangeId: parent.id,
      hopDepth: 1,
      context: { summary: "portable summary context" },
    });
    expect(followUp).toMatchObject({
      sourceThreadId: "target",
      targetThreadId: "third",
      causalParentExchangeId: parent.id,
      hopDepth: 1,
      deliveryMode: "after-current-turn",
    });
    expect(followUp.contextCapsule).toMatchObject({
      kind: "portable-context",
      sourceKinds: ["summary"],
    });
    expect((followUp.contextCapsule as { text: string }).text).toContain(
      "portable summary context",
    );

    // Answering the causal source directly is a rejected immediate loop.
    await expect(
      ask({
        threadId: "source",
        request: "loop attempt",
        idempotencyKey: "k3",
        causalParentExchangeId: parent.id,
        hopDepth: 1,
      }),
    ).rejects.toMatchObject({ code: "THREAD_COLLABORATION_LOOP" });

    // A retry with the same caller key resolves to the same durable exchange.
    identityThreadId = "source";
    const retry = await ask({
      threadId: "target",
      request: "first question",
      idempotencyKey: "k1",
    });
    expect(retry.id).toBe(parent.id);
  });

  it("queues for a busy target without steering, interrupting or raw-sending", async () => {
    statuses.set("target", "working");
    const exchange = await ask({ threadId: "target", request: "queue me" });

    expect(exchange.status).toBe("queued");
    expect(sendThreadInput).not.toHaveBeenCalled();
    expect(interruptThread).not.toHaveBeenCalled();
  });

  it("does not claim delivery when the target needs attention before accepting the message", async () => {
    statuses.set("target", "needs_approval");
    const result = (await dispatchTool(
      "send_thread_message",
      {
        thread_id: "target",
        message: "等待目标批准后再交接。",
        sender_role: "my-research Executor",
        experiment_id: "attention-test",
      },
      ctx,
    )) as { delivered: boolean; error?: string };

    expect(result).toEqual({
      delivered: false,
      message_id: expect.stringMatching(/^thread-exchange-/u),
      target_thread_id: "target",
      error: "Message status: needs_attention",
    });
    expect(sendThreadInput).not.toHaveBeenCalled();
  });

  it("lets participants read an exchange and rejects non-participants", async () => {
    const exchange = await ask({ threadId: "target", request: "readable" });

    identityThreadId = "target";
    await expect(
      dispatchTool("read_thread_exchange", { exchangeId: exchange.id }, ctx),
    ).resolves.toMatchObject({ id: exchange.id, status: "delivered" });

    identityThreadId = "stranger";
    await expect(
      dispatchTool("read_thread_exchange", { exchangeId: exchange.id }, ctx),
    ).rejects.toMatchObject({ code: "THREAD_COLLABORATION_EXCHANGE_UNAUTHORIZED" });
  });

  it("returns immediately when the cursor is absent or already behind", async () => {
    const exchange = await ask({ threadId: "target", request: "watch me" });

    const absentCursor = (await dispatchTool(
      "wait_for_thread_reply",
      { exchangeId: exchange.id, timeoutSeconds: 0 },
      ctx,
    )) as { timedOut: boolean; exchange: { id: string; status: string } };
    expect(absentCursor.timedOut).toBe(false);
    expect(absentCursor.exchange.id).toBe(exchange.id);

    const staleCursor = (await dispatchTool(
      "wait_for_thread_reply",
      {
        exchangeId: exchange.id,
        afterUpdatedAt: "2020-01-01T00:00:00.000Z",
        timeoutSeconds: 30,
      },
      ctx,
    )) as { timedOut: boolean };
    expect(staleCursor.timedOut).toBe(false);
    expect(interruptThread).not.toHaveBeenCalled();
  });

  it("marks the exchange timed out when the cursor does not advance", async () => {
    const exchange = await ask({ threadId: "target", request: "slow reply" });

    const result = (await dispatchTool(
      "wait_for_thread_reply",
      {
        exchangeId: exchange.id,
        afterUpdatedAt: (exchange as { updatedAt: string }).updatedAt,
        timeoutSeconds: 0,
      },
      ctx,
    )) as { timedOut: boolean; exchange: { status: string } };

    expect(result.timedOut).toBe(true);
    expect(result.exchange.status).toBe("timed_out");
    expect(interruptThread).not.toHaveBeenCalled();
    expect(sendThreadInput).toHaveBeenCalledTimes(1);
  });

  it("projects policy failures with stable codes instead of reaching the supervisor", async () => {
    await expect(ask({ threadId: "source", request: "self" })).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_SELF_TARGET",
    });
    await expect(ask({ threadId: "foreign", request: "cross project" })).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_CROSS_PROJECT",
    });
    await expect(ask({ threadId: "twin", request: "same composition" })).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_SAME_COMPOSITION",
    });

    // No dialogue request ever leaked into the raw send/interrupt primitives.
    expect(sendThreadInput).not.toHaveBeenCalled();
    expect(interruptThread).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
  });
});
