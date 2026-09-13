import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InterruptThreadPayload,
  Project,
  ProjectLocation,
  SendThreadInputPayload,
  StartThreadPayload,
  StartThreadResult,
  Thread,
  ThreadStatus,
} from "@/shared/contracts";
import { closeDatabase, initDatabase } from "../db/connection";
import { dbGetThread, dbGetThreads, dbUpsertProject, dbUpsertThread } from "../db/projectsThreads";
import type { PersistedCompletedTurn, PersistedRuntimeItem } from "../db/runtimeItems";
import { ThreadCollaborationService } from "../thread-collaboration/ThreadCollaborationService";
import { ThreadControlAdapter } from "../thread-collaboration/ThreadControlAdapter";
import { InterHarnessMessageBus } from "./interHarnessMessageBus";

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

const PROJECT_LOCATION: ProjectLocation = { kind: "posix", path: "/tmp/proj" };

function project(): Project {
  return {
    id: "project-1",
    name: "project-1",
    location: PROJECT_LOCATION,
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  const kinds: Record<string, { agentKind: string; model: string; native: string }> = {
    codex: { agentKind: "codex", model: "gpt-5.6", native: "codex-C1" },
    kimi1: { agentKind: "kimi", model: "k2", native: "kimi-K1" },
    kimi2: { agentKind: "kimi", model: "k2", native: "kimi-K2" },
  };
  const preset = kinds[id] ?? { agentKind: "codex", model: "gpt-5.6", native: `codex-${id}` };
  return {
    id,
    projectId: "project-1",
    title: id,
    agentKind: preset.agentKind,
    config: { model: preset.model },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    sessionRef: { providerSessionId: preset.native, discoveredAt: "2026-08-31T12:00:00.000Z" },
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

describe.skipIf(!sqliteAvailable)("InterHarnessMessageBus native round-trips", () => {
  let dir: string;
  let threads: Thread[];
  let statuses: Map<string, ThreadStatus>;
  let turns: Map<string, PersistedCompletedTurn[]>;
  let items: Map<string, PersistedRuntimeItem>;
  let sendThreadInput: ReturnType<typeof vi.fn<(payload: SendThreadInputPayload) => Promise<void>>>;
  let startThread: ReturnType<
    typeof vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>
  >;
  let interruptThread: ReturnType<typeof vi.fn<(payload: InterruptThreadPayload) => Promise<void>>>;
  let switchThreadProvider: ReturnType<
    typeof vi.fn<
      (payload: { threadId: string; agentKind: string; config: { model: string } }) => Promise<{
        threadId: string;
        agentKind: string;
        sessionRef?: { providerSessionId: string; discoveredAt: string };
        canResumeWithConfig: boolean;
      }>
    >
  >;
  let bus: InterHarnessMessageBus;
  let service: ThreadCollaborationService;
  let mirrored: Thread[];
  let mirroredDeletions: string[];
  let sessionRefs: Map<string, string>;
  let closedIds: string[];
  let createThread: ReturnType<
    typeof vi.fn<
      (request: {
        projectId: string;
        prompt: string;
        agentKind: string;
        model: string;
        title?: string;
      }) => Promise<{ threadId: string; title: string; projectId: string }>
    >
  >;

  function turn(threadId: string, index: number, text: string): void {
    const anchor = `anchor-${threadId}-${index}`;
    const list = turns.get(threadId) ?? [];
    list.push({
      anchorItemId: anchor,
      endedAt: "2026-08-31T12:01:00.000Z",
    } as PersistedCompletedTurn);
    turns.set(threadId, list);
    items.set(`${threadId}:${anchor}`, {
      type: "assistant_message",
      state: "completed",
      streams: { assistant_text: text },
    } as unknown as PersistedRuntimeItem);
  }

  beforeEach(() => {
    if (nativeBindingEnv) process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
    dir = mkdtempSync(join(tmpdir(), "craftstation-inter-harness-"));
    initDatabase(join(dir, "state.sqlite"));
    dbUpsertProject(project(), 0);
    threads = [thread("codex"), thread("kimi1"), thread("kimi2")];
    for (const entry of threads) dbUpsertThread(entry, 0);
    statuses = new Map(threads.map((entry) => [entry.id, entry.status]));
    turns = new Map();
    items = new Map();
    mirrored = [];
    mirroredDeletions = [];
    sessionRefs = new Map(
      threads.map((entry) => [entry.id, entry.sessionRef?.providerSessionId ?? ""]),
    );
    closedIds = [];
    createThread = vi.fn<
      (request: {
        projectId: string;
        prompt: string;
        agentKind: string;
        model: string;
        title?: string;
      }) => Promise<{ threadId: string; title: string; projectId: string }>
    >(async (request) => {
      const threadId = `spawned-${request.agentKind}-1`;
      const stamp = "2026-08-31T12:00:00.000Z";
      dbUpsertThread(
        {
          id: threadId,
          projectId: request.projectId,
          title: request.title ?? threadId,
          agentKind: request.agentKind,
          config: { model: request.model },
          status: "launching",
          attention: "none",
          canResumeWithConfig: false,
          archived: false,
          done: false,
          starred: false,
          presentationMode: "gui",
          createdAt: stamp,
          updatedAt: stamp,
        },
        0,
      );
      // Simulate supervisor native-session discovery landing in the snapshot.
      sessionRefs.set(threadId, `native-${request.agentKind}-9`);
      return { threadId, title: request.title ?? threadId, projectId: request.projectId };
    });
    sendThreadInput = vi.fn<(payload: SendThreadInputPayload) => Promise<void>>(
      async () => undefined,
    );
    startThread = vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>(async () => ({
      threadId: "resumed",
    }));
    interruptThread = vi.fn<(payload: InterruptThreadPayload) => Promise<void>>(
      async () => undefined,
    );
    switchThreadProvider = vi.fn<
      (payload: { threadId: string; agentKind: string; config: { model: string } }) => Promise<{
        threadId: string;
        agentKind: string;
        sessionRef?: { providerSessionId: string; discoveredAt: string };
        canResumeWithConfig: boolean;
      }>
    >(async (payload) => {
      if (payload.agentKind === "opencode" && payload.config.model.includes("fail")) {
        throw new Error("OpencodeSdkSession is not active.");
      }
      const native =
        payload.agentKind === dbGetThread(payload.threadId)?.agentKind
          ? (sessionRefs.get(payload.threadId) ?? `${payload.agentKind}-same`)
          : `native-${payload.agentKind}-switched`;
      sessionRefs.set(payload.threadId, native);
      return {
        threadId: payload.threadId,
        agentKind: payload.agentKind,
        sessionRef: {
          providerSessionId: native,
          discoveredAt: "2026-08-31T12:00:00.000Z",
        },
        canResumeWithConfig: true,
      };
    });
    const control = new ThreadControlAdapter({
      // DB-backed row getters, mirroring the production main.ts wiring, so
      // claimed external threads are visible to the control plane.
      getThread: (id) => dbGetThread(id),
      getThreads: () => dbGetThreads(),
      getProject: (id) => (id === "project-1" ? project() : null),
      settings: () =>
        ({ mcpServers: [], disabledBuiltInMcpServers: {}, disabledBuiltInMcpTools: {} }) as never,
      runtime: {
        getThreadSnapshots: async () =>
          dbGetThreads().map((entry) => ({
            threadId: entry.id,
            status: statuses.get(entry.id) ?? entry.status,
            attention: "none" as const,
            canResumeWithConfig: entry.canResumeWithConfig,
            ...(sessionRefs.get(entry.id)
              ? {
                  sessionRef: {
                    providerSessionId: sessionRefs.get(entry.id)!,
                    discoveredAt: "2026-08-31T12:00:00.000Z",
                  },
                }
              : {}),
          })),
        startThread,
        sendThreadInput,
        interruptThread,
        closeThread: vi.fn<(payload: { threadId: string }) => Promise<void>>(async (payload) => {
          closedIds.push(payload.threadId);
        }),
        switchThreadProvider,
      },
      states: {
        getLiveState: (id: string) => ({
          status: statuses.get(id) ?? "inactive",
          attention: "none" as const,
        }),
        waitUntil: async <T>(_ids: string[], _timeoutMs: number, poll: () => T | undefined) =>
          poll(),
      } as never,
    });
    service = new ThreadCollaborationService({
      control,
      getCompletedTurns: (id) => turns.get(id) ?? [],
      getRuntimeItem: (id, itemId) => items.get(`${id}:${itemId}`) ?? null,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });
    bus = new InterHarnessMessageBus({
      collaboration: service,
      control,
      getProjectLocation: (id) => (id === "project-1" ? PROJECT_LOCATION : null),
      listProjectLocations: () => [{ projectId: "project-1", location: PROJECT_LOCATION }],
      mirrorThreadToRenderer: (entry) => {
        mirrored.push(entry);
      },
      mirrorThreadDeletion: (threadId) => {
        mirroredDeletions.push(threadId);
      },
      createThread,
    });
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING;
  });

  it("Test A/B: Codex asks Kimi, Kimi replies, Codex reads the reply", async () => {
    // listPeers sees both Kimi threads from the Codex thread's workspace scope.
    const peers = bus.listPeers("codex");
    expect(peers.map((peer) => peer.address).sort()).toEqual(["kimi:kimi-K1", "kimi:kimi-K2"]);

    const { exchange } = await bus.ask("codex", "kimi:kimi-K1", "Analyze this race condition.");
    expect(exchange.status).toBe("delivered");
    expect(sendThreadInput).toHaveBeenCalledWith(expect.objectContaining({ threadId: "kimi1" }));

    // Kimi's next completed turn auto-settles the ask to replied with an excerpt.
    turn("kimi1", 0, "The race is a missing lock around the counter.");
    service.observeSupervisorEvent({
      type: "thread-state",
      threadId: "kimi1",
      status: "idle",
      attention: "none",
      canResumeWithConfig: true,
      forceCloseActiveTurn: false,
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settled = service.readExchange("codex", exchange.id);
    expect(settled.status).toBe("replied");
    expect(settled.replyExcerpt).toContain("missing lock");

    // Reverse direction works identically.
    const back = await bus.ask("kimi1", "codex:codex-C1", "Confirm the fix approach.");
    expect(back.exchange.status).toBe("delivered");
  });

  it("Test J: two same-harness Kimi threads never cross-deliver", async () => {
    await bus.send("codex", "kimi:kimi-K2", "Only for K2.");
    expect(sendThreadInput).toHaveBeenCalledTimes(1);
    expect(sendThreadInput).toHaveBeenCalledWith(expect.objectContaining({ threadId: "kimi2" }));
    const exchanges = bus.inbox("kimi1");
    expect(exchanges).toHaveLength(0);
    expect(bus.inbox("kimi2")).toHaveLength(1);
  });

  it("listPeers excludes archived, done, and schedule firing threads", async () => {
    dbUpsertThread(thread("ghost-schedule", { scheduleOrigin: { scheduleId: "sch-1" } }), 0);
    dbUpsertThread(thread("archived-peer", { archived: true }), 0);
    dbUpsertThread(thread("done-peer", { done: true }), 0);

    const peers = bus.listPeers("codex");
    expect(peers.map((peer) => peer.address).sort()).toEqual(["kimi:kimi-K1", "kimi:kimi-K2"]);
  });

  it("Test H: a busy target is queued, never force-interrupted", async () => {
    statuses.set("kimi1", "working");
    const exchange = await bus.send("codex", "kimi:kimi-K1", "Take your time.");
    expect(exchange.status).toBe("queued");
    expect(interruptThread).not.toHaveBeenCalled();
    expect(sendThreadInput).not.toHaveBeenCalled();
  });

  it("STOP with interrupt-and-send aborts a busy Executor without deleting the peer", async () => {
    statuses.set("kimi1", "working");
    interruptThread.mockImplementation(async () => {
      statuses.set("kimi1", "idle");
    });
    const exchange = await bus.send(
      "codex",
      "kimi:kimi-K1",
      "STOP. Do not sbatch.",
      "interrupt-and-send",
    );
    expect(exchange.status).toBe("delivered");
    expect(exchange.deliveredAt).not.toBeNull();
    expect(interruptThread).toHaveBeenCalledWith({ threadId: "kimi1" });
    expect(sendThreadInput).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "kimi1",
        prompt: expect.stringContaining("STOP. Do not sbatch."),
      }),
    );
    expect(dbGetThread("kimi1")).toMatchObject({ id: "kimi1" });
    expect(bus.getPeer("codex", "kimi:kimi-K1").boundThreadId).toBe("kimi1");
  });

  it("Test C: an offline target queues and delivers on resume", async () => {
    statuses.set("kimi1", "inactive");
    sendThreadInput.mockRejectedValueOnce(
      Object.assign(new Error("unknown thread session"), { code: "THREAD_UNKNOWN_SESSION" }),
    );
    const exchange = await bus.send("codex", "kimi:kimi-K1", "When you are back.");
    // Unknown-session send falls back to resume-with-sessionRef inside deliverSettled.
    expect(exchange.status).toBe("delivered");
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: "kimi1" }));
  });

  it("ask timeout stops waiting but keeps the message durable", async () => {
    statuses.set("kimi1", "working");
    const { exchange, timedOut } = await bus.ask("codex", "kimi:kimi-K1", "Slow question.", {
      timeoutMs: 5,
    });
    // Busy target queues; the bounded wait stops with timedOut=true while the
    // message itself stays queued (a timeout never deletes anything).
    expect(exchange.status).toBe("queued");
    expect(timedOut).toBe(true);
    expect(service.readExchange("codex", exchange.id).status).toBe("queued");
    // A late reply is still captured and readable afterwards.
    statuses.set("kimi1", "idle");
    await service.recover();
    turn("kimi1", 0, "Late answer.");
    service.observeSupervisorEvent({
      type: "thread-state",
      threadId: "kimi1",
      status: "idle",
      attention: "none",
      canResumeWithConfig: true,
      forceCloseActiveTurn: false,
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.readExchange("codex", exchange.id).status).toBe("replied");
  });

  it("Test I: restart recovery re-drives queued exchanges from the same DB", async () => {
    statuses.set("kimi1", "working");
    const queued = await bus.send("codex", "kimi:kimi-K1", "Survive restart.");
    expect(queued.status).toBe("queued");
    // New bus + service instances over the SAME database recover the queue.
    statuses.set("kimi1", "idle");
    await service.recover();
    expect(service.readExchange("codex", queued.id).status).toBe("delivered");
  });

  it("Test D/E: an external native thread is discovered, claimed once, and messaged without duplication", async () => {
    // External codex thread C123 exists only as a native session (no row).
    const claimed = bus.claimPeer("codex:C123", "project-1");
    expect(claimed.created).toBe(true);
    expect(claimed.address).toBe("codex:C123");
    // Claiming binds the REAL native session: row carries its sessionRef and
    // no message history is copied or fabricated.
    const row = dbGetThread(claimed.threadId);
    expect(row?.sessionRef?.providerSessionId).toBe("C123");
    expect(row?.status).toBe("inactive");
    expect(mirrored.map((entry) => entry.id)).toContain(claimed.threadId);

    // Claiming again returns the same row (idempotent, no duplicate thread).
    const again = bus.claimPeer("codex:C123", "project-1");
    expect(again).toEqual({ threadId: claimed.threadId, address: "codex:C123", created: false });

    // Messaging the address resolves to the SAME row and delivers through the
    // native resume path (sessionRef present), never creating K457-style dupes.
    statuses.set(claimed.threadId, "inactive");
    const exchange = await bus.send("codex", "codex:C123", "Hello from C1.");
    expect(exchange.targetThreadId).toBe(claimed.threadId);
    expect(["delivered", "queued"]).toContain(exchange.status);
    expect(
      dbGetThreads().filter((entry) => entry.sessionRef?.providerSessionId === "C123"),
    ).toHaveLength(1);
  });

  it("spawn_peer creates a real thread row and binds the discovered native session", async () => {
    const spawned = await bus.spawnPeer("codex", {
      harness: "grok",
      model: "grok-4.6",
      title: "Grok 4.6+测试",
      message: "准备测试",
    });

    expect(spawned.address).toBe("grok:native-grok-9");
    expect(spawned.nativeSessionId).toBe("native-grok-9");
    // Real first-class row (sidebar-visible title), launched through the
    // native create path — not a fabricated session id.
    const row = dbGetThread(spawned.threadId);
    expect(row?.title).toBe("Grok 4.6+测试");
    expect(row?.agentKind).toBe("grok");
    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", agentKind: "grok", model: "grok-4.6" }),
    );
  });

  it("switch_peer_model updates only the row config, keeping the native session", async () => {
    const switched = await bus.switchPeerModel("codex", "kimi:kimi-K1", "k3");
    expect(switched).toMatchObject({
      threadId: "kimi1",
      address: "kimi:kimi-K1",
      previousModel: "k2",
      previousHarness: "kimi",
      model: "k3",
      harness: "kimi",
      nativeSessionId: "kimi-K1",
      switched: true,
    });
    // Same native session targeted on the next send — no new session involved.
    expect(dbGetThread("kimi1")?.config.model).toBe("k3");
    expect(dbGetThread("kimi1")?.agentKind).toBe("kimi");
    expect(dbGetThread("kimi1")?.sessionRef?.providerSessionId).toBe("kimi-K1");
  });

  it("cross-harness switch_peer_model creates a new runtime instead of relabeling", async () => {
    const switched = await bus.switchPeerModel("codex", "kimi:kimi-K1", "gemini-3.8-flash");
    expect(switched).toMatchObject({
      threadId: "kimi1",
      previousHarness: "kimi",
      harness: "antigravity",
      model: "gemini-3.8-flash",
      nativeSessionId: "native-antigravity-switched",
      switched: true,
    });
    const row = dbGetThread("kimi1");
    expect(row?.agentKind).toBe("antigravity");
    expect(row?.config.model).toBe("gemini-3.8-flash");
    expect(row?.sessionRef?.providerSessionId).toBe("native-antigravity-switched");
    expect(row?.sessionRef?.providerSessionId).not.toBe("kimi-K1");
    expect(switchThreadProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "kimi1",
        agentKind: "antigravity",
        config: expect.objectContaining({ model: "gemini-3.8-flash" }),
      }),
    );
  });

  it("failed cross-harness switch_peer_model leaves the original runtime in place", async () => {
    await expect(
      bus.switchPeerModel("codex", "kimi:kimi-K1", "opencode-go/muse-spark-fail"),
    ).rejects.toThrow("OpencodeSdkSession is not active.");
    const row = dbGetThread("kimi1");
    expect(row?.agentKind).toBe("kimi");
    expect(row?.config.model).toBe("k2");
    expect(row?.sessionRef?.providerSessionId).toBe("kimi-K1");
  });

  it("spawn_peer infers antigravity from a Gemini model instead of the caller harness", async () => {
    const spawned = await bus.spawnPeer("codex", {
      model: "gemini-3.8-flash",
      title: "Gemini peer",
      message: "hello",
    });
    expect(spawned.address).toBe("antigravity:native-antigravity-9");
    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        agentKind: "antigravity",
        model: "gemini-3.8-flash",
      }),
    );
  });

  it("stop_peer closes the session and fully removes the peer", async () => {
    const claimed = bus.claimPeer("codex:C123", "project-1");
    const stopped = await bus.stopPeer("codex", "codex:C123");
    expect(stopped).toMatchObject({
      address: "codex:C123",
      threadId: claimed.threadId,
      closed: true,
      deleted: true,
    });
    expect(closedIds).toContain(claimed.threadId);
    expect(dbGetThread(claimed.threadId)).toBeNull();
    expect(mirroredDeletions).toContain(claimed.threadId);
    await expect(bus.stopPeer("codex", "codex:C123")).rejects.toThrow(/Unknown peer/);
  });

  it("stop_peer refuses to delete the calling thread itself", async () => {
    await expect(bus.stopPeer("codex", "codex:codex-C1")).rejects.toThrow(/itself/);
  });
});
