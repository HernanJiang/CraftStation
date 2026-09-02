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
  ThreadStatus,
} from "@/shared/contracts";
import { closeDatabase, initDatabase } from "../db/connection";
import { dbUpsertProject, dbUpsertThread } from "../db/projectsThreads";
import type { PersistedCompletedTurn, PersistedRuntimeItem } from "../db/runtimeItems";
import { ThreadCollaborationService, ThreadControlAdapter } from "../thread-collaboration";
import { RemoteHttpError } from "./auth";
import { createRemoteThreadCollaborationGateway } from "./threadCollaborationGateway";

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

describe.skipIf(!sqliteAvailable)("remote thread collaboration gateway", () => {
  let dir: string;
  let threads: Thread[];
  let statuses: Map<string, ThreadStatus>;
  let sendThreadInput: ReturnType<typeof vi.fn<(payload: SendThreadInputPayload) => Promise<void>>>;
  let gateway: ReturnType<typeof createRemoteThreadCollaborationGateway>;

  beforeEach(() => {
    if (nativeBindingEnv) process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
    dir = mkdtempSync(join(tmpdir(), "craftstation-thread-collab-gateway-"));
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
      thread("twin", "project-1", { config: { model: "gpt-5.6" } }),
      thread("foreign", "project-2"),
    ];
    for (const entry of projects) dbUpsertProject(entry, 0);
    for (const entry of threads) dbUpsertThread(entry, 0);
    statuses = new Map(threads.map((entry) => [entry.id, entry.status]));
    const turns = new Map<string, PersistedCompletedTurn[]>();
    const items = new Map<string, PersistedRuntimeItem>();
    sendThreadInput = vi.fn<(payload: SendThreadInputPayload) => Promise<void>>(
      async () => undefined,
    );
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
        getThreadSnapshots: async () =>
          threads.map((entry) => ({
            threadId: entry.id,
            status: statuses.get(entry.id) ?? entry.status,
            attention: "none",
            canResumeWithConfig: entry.canResumeWithConfig,
          })),
        startThread: vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>(
          async () => ({ threadId: "target" }),
        ),
        sendThreadInput,
        interruptThread: vi.fn<(payload: InterruptThreadPayload) => Promise<void>>(
          async () => undefined,
        ),
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
    gateway = createRemoteThreadCollaborationGateway(() => service);
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING;
  });

  function request(sourceThreadId: string, targetThreadId: string, idempotencyKey: string) {
    return gateway.request(sourceThreadId, {
      sourceThreadId,
      targetThreadId,
      request: "status check",
      deliveryMode: "after-current-turn",
      idempotencyKey,
      hopDepth: 0,
    });
  }

  it("routes list, request, read and wait through the single host service", async () => {
    const targets = gateway.listTargets("source");
    expect(targets.map((target) => target.threadId).sort()).toEqual(["target", "twin"]);

    const exchange = await request("source", "target", "gateway-1");
    expect(exchange.status).toBe("delivered");
    expect(sendThreadInput).toHaveBeenCalledTimes(1);

    const read = gateway.read("source", exchange.id);
    expect(read.id).toBe(exchange.id);

    const list = gateway.list("source", "source", 10);
    expect(list.map((entry) => entry.id)).toContain(exchange.id);

    const wait = await gateway.wait("source", exchange.id, undefined, 0);
    expect(wait.timedOut).toBe(false);
    expect(wait.exchange.id).toBe(exchange.id);

    const cancelled = gateway.cancel("source", exchange.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("summarizes exchanges onto the remote wire shape without durable internals", async () => {
    const exchange = await request("source", "target", "gateway-2");
    const summary = gateway.summarize(exchange);

    expect(summary).toMatchObject({
      id: exchange.id,
      status: "delivered",
      sourceThreadId: "source",
      targetThreadId: "target",
    });
    const serialized = JSON.stringify(summary);
    for (const internal of [
      "request",
      "contextCapsule",
      "idempotencyKey",
      "claimToken",
      "claimExpiresAt",
    ]) {
      expect(serialized).not.toContain(`"${internal}"`);
    }
    expect(summary).not.toHaveProperty("request");
    expect(summary).not.toHaveProperty("idempotencyKey");
    expect(summary).not.toHaveProperty("claimToken");
  });

  it("rejects cross-project and same-composition dialogue with stable codes", async () => {
    await expect(request("source", "foreign", "gateway-cross")).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_CROSS_PROJECT",
    });
    await expect(request("source", "twin", "gateway-same")).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_SAME_COMPOSITION",
    });
    expect(sendThreadInput).not.toHaveBeenCalled();
  });

  it("enforces participant and source-only actor policies for remote callers", async () => {
    const exchange = await request("source", "target", "gateway-actor");

    expect(() => gateway.read("bystander", exchange.id)).toThrowError(
      expect.objectContaining({ code: "THREAD_COLLABORATION_EXCHANGE_UNAUTHORIZED" }),
    );
    expect(() => gateway.list("bystander", "source", 10)).toThrowError(
      expect.objectContaining({ code: "THREAD_COLLABORATION_SOURCE_UNAUTHORIZED" }),
    );
    expect(() => gateway.cancel("target", exchange.id)).toThrowError(
      expect.objectContaining({ code: "THREAD_COLLABORATION_CANCEL_UNAUTHORIZED" }),
    );
  });

  it("reports the collaboration module as unavailable when the host has none", async () => {
    const unavailable = createRemoteThreadCollaborationGateway(() => null);
    await expect(async () => {
      await unavailable.request("source", {
        sourceThreadId: "source",
        targetThreadId: "target",
        request: "x",
        deliveryMode: "after-current-turn",
        idempotencyKey: "gateway-none",
        hopDepth: 0,
      });
    }).rejects.toMatchObject({ status: 503 });
    await expect(async () => {
      await unavailable.read("source", "missing");
    }).rejects.toBeInstanceOf(RemoteHttpError);
    expect(() => unavailable.listTargets("source")).toThrowError(RemoteHttpError);
  });
});
