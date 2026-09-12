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
import type { ThreadDialogueRequest, ThreadRuntimeProvenance } from "@/shared/threadCollaboration";
import { closeDatabase, initDatabase } from "../db/connection";
import { dbUpsertProject, dbUpsertThread } from "../db/projectsThreads";
import type { PersistedCompletedTurn, PersistedRuntimeItem } from "../db/runtimeItems";
import { ExchangeRepository } from "./ExchangeRepository";
import { ThreadCollaborationService } from "./ThreadCollaborationService";
import { ThreadControlAdapter } from "./ThreadControlAdapter";

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

function project(id = "project-1"): Project {
  return {
    id,
    name: id,
    location: { kind: "posix", path: `/tmp/${id}` },
    createdAt: "2026-08-31T00:00:00.000Z",
  };
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

function provenance(threadId: string): ThreadRuntimeProvenance {
  return {
    threadId,
    projectId: "project-1",
    title: threadId,
    modelId: "model",
    harnessId: "harness",
    agentMcpSupported: false,
  };
}

function compositionProvenance(modelId: string, harnessKind: string) {
  return {
    recipeId: "recipe-native",
    recipeVersion: "1.0.0",
    craftedAt: "2026-08-31T00:00:00.000Z",
    ingredients: {},
    runtimeBinding: {
      harnessKind,
      modelId,
      vendor: "test-vendor",
      runtimeAdapterId: `${harnessKind}-adapter`,
    },
  };
}

function repositoryInput(overrides: Partial<Parameters<ExchangeRepository["create"]>[0]> = {}) {
  return {
    projectId: "project-1",
    sourceThreadId: "source",
    targetThreadId: "target",
    deliveryMode: "after-current-turn" as const,
    request: "question",
    contextCapsule: null,
    sourceProvenance: provenance("source"),
    targetProvenance: provenance("target"),
    idempotencyKey: "key-1",
    hopDepth: 0,
    ...overrides,
  };
}

describe.skipIf(!sqliteAvailable)("ThreadCollaborationService durable dialogue", () => {
  let dir: string;
  let threads: Thread[];
  let projects: Project[];
  let statuses: Map<string, ThreadStatus>;
  let turns: Map<string, PersistedCompletedTurn[]>;
  let items: Map<string, PersistedRuntimeItem>;
  let sendThreadInput: ReturnType<typeof vi.fn<(payload: SendThreadInputPayload) => Promise<void>>>;
  let startThread: ReturnType<
    typeof vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>
  >;
  let interruptThread: ReturnType<typeof vi.fn<(payload: InterruptThreadPayload) => Promise<void>>>;
  let service: ThreadCollaborationService;

  beforeEach(() => {
    if (nativeBindingEnv) process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
    dir = mkdtempSync(join(tmpdir(), "craftstation-thread-collaboration-"));
    initDatabase(join(dir, "state.sqlite"));
    projects = [project(), project("project-2")];
    threads = [thread("source"), thread("target"), thread("other", "project-2")];
    for (const entry of projects) dbUpsertProject(entry, 0);
    for (const entry of threads) dbUpsertThread(entry, 0);
    statuses = new Map(threads.map((entry) => [entry.id, entry.status]));
    turns = new Map();
    items = new Map();
    sendThreadInput = vi.fn<(payload: SendThreadInputPayload) => Promise<void>>(
      async () => undefined,
    );
    startThread = vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>(async () => ({
      threadId: "target",
    }));
    interruptThread = vi.fn<(payload: InterruptThreadPayload) => Promise<void>>(
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
            attention: (statuses.get(entry.id) ?? entry.status) === "working" ? "working" : "none",
            canResumeWithConfig: entry.canResumeWithConfig,
          })),
        startThread,
        sendThreadInput,
        interruptThread,
        closeThread: vi.fn<(payload: { threadId: string }) => Promise<void>>(async () => undefined),
      },
      states: {
        getLiveState: (id: string) => ({
          status: statuses.get(id) ?? "inactive",
          attention: (statuses.get(id) ?? "inactive") === "working" ? "working" : "none",
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
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING;
  });

  function request(
    overrides: Partial<ThreadDialogueRequest> = {},
  ): Promise<ReturnType<typeof service.readExchange>> {
    return service.requestDialogue({
      actorThreadId: overrides.sourceThreadId ?? "source",
      request: {
        sourceThreadId: "source",
        targetThreadId: "target",
        request: "question",
        deliveryMode: "after-current-turn",
        idempotencyKey: "key-1",
        hopDepth: 0,
        ...overrides,
      },
    });
  }

  it("delivers an idle request once and reuses an identical idempotent retry", async () => {
    const first = await request();
    const second = await request();

    expect(first.status).toBe("delivered");
    expect(second.id).toBe(first.id);
    expect(sendThreadInput).toHaveBeenCalledTimes(1);
    expect(sendThreadInput).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "target", userMessageItemId: first.requestItemId }),
    );
  });

  it("rejects self-target, cross-project, unauthorized source and idempotency conflicts", async () => {
    await expect(request({ targetThreadId: "source" })).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_SELF_TARGET",
    });
    await expect(
      request({ targetThreadId: "other", idempotencyKey: "cross" }),
    ).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_CROSS_PROJECT",
    });
    await expect(
      service.requestDialogue({
        actorThreadId: "target",
        request: {
          sourceThreadId: "source",
          targetThreadId: "target",
          request: "question",
          deliveryMode: "after-current-turn",
          idempotencyKey: "unauthorized",
          hopDepth: 0,
        },
      }),
    ).rejects.toMatchObject({ code: "THREAD_COLLABORATION_SOURCE_UNAUTHORIZED" });
    await request();
    await expect(request({ request: "changed" })).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_IDEMPOTENCY_CONFLICT",
    });
  });

  it("freezes targets to cross-composition pairs: differing Model or Harness is required", async () => {
    // Same harness, different model → allowed.
    threads[1] = thread("target", "project-1", {
      agentKind: "codex",
      config: { model: "grok-4.6" },
    });
    await expect(request({ idempotencyKey: "same-harness" })).resolves.toMatchObject({
      status: "delivered",
    });

    // Same model, different harness → allowed.
    threads[1] = thread("target", "project-1", {
      agentKind: "grok",
      config: { model: "gpt-5.6" },
    });
    await expect(request({ idempotencyKey: "same-model" })).resolves.toMatchObject({
      status: "queued",
    });

    // Identical Model×Harness tuple → fail closed with a stable error.
    threads[1] = thread("target", "project-1", {
      agentKind: "codex",
      config: { model: "gpt-5.6" },
    });
    await expect(request({ idempotencyKey: "identical" })).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_SAME_COMPOSITION",
    });
    expect(sendThreadInput).toHaveBeenCalledTimes(1);
  });

  it("allows identical Model×Harness pairs when they are provably distinct native threads", async () => {
    const ref = (nativeId: string) => ({
      providerSessionId: nativeId,
      discoveredAt: "2026-08-31T12:00:00.000Z",
    });
    threads[0] = thread("source", "project-1", {
      agentKind: "codex",
      config: { model: "gpt-5.6" },
      sessionRef: ref("codex-C1"),
    });
    // Same native session on both sides → still blocked.
    threads[1] = thread("target", "project-1", {
      agentKind: "codex",
      config: { model: "gpt-5.6" },
      sessionRef: ref("codex-C1"),
    });
    await expect(request({ idempotencyKey: "same-native" })).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_SAME_COMPOSITION",
    });

    // Distinct native sessions (e.g. Kimi K1 vs Kimi K2 on one model) → allowed.
    threads[1] = thread("target", "project-1", {
      agentKind: "codex",
      config: { model: "gpt-5.6" },
      sessionRef: ref("codex-C2"),
    });
    const delivered = await request({ idempotencyKey: "distinct-native" });
    expect(delivered.status).toBe("delivered");
    expect(delivered.targetProvenance).toMatchObject({ nativeSessionId: "codex-C2" });
    expect(sendThreadInput).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "target" }),
    );
  });

  it("resolves the composition policy from runtime provenance, not raw thread strings", async () => {
    threads[0] = thread("source", "project-1", {
      compositionProvenance: compositionProvenance("gpt-5.6", "codex"),
    });
    // Raw agentKind/config.model both match the source, but the resolved
    // runtime binding differs → allowed.
    threads[1] = thread("target", "project-1", {
      agentKind: "codex",
      config: { model: "gpt-5.6" },
      compositionProvenance: compositionProvenance("claude-fable-5", "claude"),
    });
    await expect(request({ idempotencyKey: "binding-differs" })).resolves.toMatchObject({
      targetProvenance: expect.objectContaining({
        modelId: "claude-fable-5",
        harnessId: "claude",
      }),
    });

    // Raw strings differ from the source, but the resolved binding is the
    // identical tuple → rejected even though the raw strings differ.
    threads[1] = thread("target", "project-1", {
      agentKind: "grok",
      config: { model: "grok-4.6" },
      compositionProvenance: compositionProvenance("gpt-5.6", "codex"),
    });
    await expect(request({ idempotencyKey: "binding-identical" })).rejects.toMatchObject({
      code: "THREAD_COLLABORATION_SAME_COMPOSITION",
    });
  });

  it("reports sameComposition on target summaries so every transport shares the policy", () => {
    threads.push(
      thread("twin", "project-1", { agentKind: "codex", config: { model: "gpt-5.6" } }),
      thread("mixed-model", "project-1", { agentKind: "codex", config: { model: "grok-4.6" } }),
    );
    const targets = service.listTargets("source");
    expect(targets.find((target) => target.threadId === "twin")?.sameComposition).toBe(true);
    expect(targets.find((target) => target.threadId === "mixed-model")?.sameComposition).toBe(
      false,
    );
    expect(targets.find((target) => target.threadId === "target")?.sameComposition).toBe(false);
    // The source thread itself and other-project threads are never listed.
    expect(targets.some((target) => target.threadId === "source")).toBe(false);
    expect(targets.some((target) => target.threadId === "other")).toBe(false);
  });

  it("injects a prompt into a busy target immediately instead of queuing", async () => {
    statuses.set("target", "working");
    const delivered = await request();
    expect(delivered.status).toBe("delivered");
    expect(sendThreadInput).toHaveBeenCalledTimes(1);
    expect(interruptThread).not.toHaveBeenCalled();
    expect(sendThreadInput.mock.calls[0]?.[0]).toMatchObject({
      threadId: "target",
      prompt: expect.stringContaining("hello"),
    });
  });

  it("cancels a not-yet-delivered exchange without sending a follow-up", async () => {
    sendThreadInput.mockRejectedValueOnce(new Error("hold"));
    interruptThread.mockRejectedValueOnce(new Error("hold"));
    const failed = await request();
    expect(failed.status).toBe("failed");
    expect(sendThreadInput).toHaveBeenCalledTimes(1);
  });

  it("stops waiting after delivery without interrupting the target turn", async () => {
    const delivered = await request();
    expect(service.cancelExchange("source", delivered.id).status).toBe("cancelled");
    expect(interruptThread).not.toHaveBeenCalled();
  });

  it("marks a wait timeout without interrupting and still permits a later reply", async () => {
    const delivered = await request();
    const result = await service.waitForExchange("source", delivered.id, delivered.updatedAt, 0);
    expect(result.timedOut).toBe(true);
    expect(result.exchange.status).toBe("timed_out");
    expect(interruptThread).not.toHaveBeenCalled();

    turns.set("target", [
      {
        startedAt: "2026-08-31T12:00:01.000Z",
        endedAt: "2026-08-31T12:00:02.000Z",
        anchorItemId: "late-reply",
      },
    ]);
    items.set("target:late-reply", {
      id: "late-reply",
      type: "assistant_message",
      state: "completed",
      streams: { assistant_text: "late reply" },
    });
    await service.recover();
    expect(service.readExchange("source", delivered.id).status).toBe("replied");
  });

  it("injects follow-ups on one conversation link immediately", async () => {
    const first = await request();
    const second = await request({ request: "follow-up", idempotencyKey: "key-2" });
    expect(first.status).toBe("delivered");
    expect(second.status).toBe("delivered");
    expect(second.linkId).toBe(first.linkId);
    expect(second.sequence).toBe(first.sequence + 1);
    expect(sendThreadInput).toHaveBeenCalledTimes(2);
  });

  it("injects into a target that needs a reply instead of parking the request", async () => {
    statuses.set("target", "needs_reply");
    const delivered = await request();
    expect(delivered.status).toBe("delivered");
    expect(sendThreadInput).toHaveBeenCalledTimes(1);
  });

  it("fails closed when explicit interrupt is not confirmed", async () => {
    statuses.set("target", "working");
    interruptThread.mockRejectedValueOnce(new Error("interrupt transport failed"));
    const failed = await request({ deliveryMode: "interrupt-and-send" });
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("THREAD_COLLABORATION_INTERRUPT_FAILED");
    expect(sendThreadInput).not.toHaveBeenCalled();
  });

  it("interrupts a busy target then delivers interrupt-and-send as a new turn", async () => {
    statuses.set("target", "working");
    interruptThread.mockImplementation(async () => {
      statuses.set("target", "idle");
    });
    const exchange = await request({
      deliveryMode: "interrupt-and-send",
      idempotencyKey: "stop-1",
      request: "STOP. Do not submit jobs.",
    });
    expect(interruptThread).toHaveBeenCalledWith({ threadId: "target" });
    expect(exchange.status).toBe("delivered");
    expect(exchange.deliveredAt).not.toBeNull();
    expect(sendThreadInput).toHaveBeenCalledTimes(1);
    expect(sendThreadInput).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "target",
        prompt: expect.stringContaining("STOP. Do not submit jobs."),
      }),
    );
  });

  it("treats interrupt-and-send on an idle target as a no-op interrupt", async () => {
    const exchange = await request({
      deliveryMode: "interrupt-and-send",
      idempotencyKey: "idle-int",
    });
    expect(interruptThread).not.toHaveBeenCalled();
    expect(exchange.status).toBe("delivered");
    expect(exchange.deliveredAt).not.toBeNull();
  });

  it("does not queue interrupt-and-send against an error runtime", async () => {
    statuses.set("target", "error");
    const failed = await request({
      deliveryMode: "interrupt-and-send",
      idempotencyKey: "err-int",
    });
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("THREAD_COLLABORATION_RUNTIME_UNAVAILABLE");
    expect(failed.error?.retryable).toBe(true);
    expect(interruptThread).not.toHaveBeenCalled();
    expect(sendThreadInput).not.toHaveBeenCalled();
  });

  it("lets interrupt-and-send still interrupt a busy target after an immediate inject", async () => {
    statuses.set("target", "working");
    const chatter = await request({
      idempotencyKey: "chatter",
      request: "when you have a moment",
    });
    expect(chatter.status).toBe("delivered");
    interruptThread.mockImplementation(async () => {
      statuses.set("target", "idle");
    });
    const stop = await request({
      deliveryMode: "interrupt-and-send",
      idempotencyKey: "stop-jump",
      request: "STOP",
    });
    expect(stop.status).toBe("delivered");
    expect(stop.deliveredAt).not.toBeNull();
    expect(interruptThread).toHaveBeenCalledTimes(1);
  });

  it("captures only a completed assistant turn after the delivery baseline", async () => {
    turns.set("target", [
      {
        startedAt: "2026-08-31T10:00:00.000Z",
        endedAt: "2026-08-31T10:01:00.000Z",
        anchorItemId: "old-assistant",
      },
    ]);
    items.set("target:old-assistant", {
      id: "old-assistant",
      type: "assistant_message",
      state: "completed",
      streams: { assistant_text: "old reply" },
    });
    const delivered = await request();
    turns.get("target")?.push(
      {
        startedAt: "2026-08-31T12:00:01.000Z",
        endedAt: "2026-08-31T12:00:02.000Z",
        anchorItemId: "reasoning",
      },
      {
        startedAt: "2026-08-31T12:00:03.000Z",
        endedAt: "2026-08-31T12:00:04.000Z",
        anchorItemId: "assistant-streaming",
      },
      {
        startedAt: "2026-08-31T12:00:05.000Z",
        endedAt: "2026-08-31T12:00:06.000Z",
        anchorItemId: "new-assistant",
      },
    );
    items.set("target:reasoning", {
      id: "reasoning",
      type: "reasoning",
      state: "completed",
      streams: { reasoning_text: "hidden" },
    });
    items.set("target:assistant-streaming", {
      id: "assistant-streaming",
      type: "assistant_message",
      state: "started",
      streams: { assistant_text: "partial" },
    });
    items.set("target:new-assistant", {
      id: "new-assistant",
      type: "assistant_message",
      state: "completed",
      streams: { assistant_text: "new reply" },
    });

    await service.recover();
    const replied = service.readExchange("source", delivered.id);
    expect(replied.status).toBe("replied");
    expect(replied.replyAnchorItemId).toBe("new-assistant");
    expect(replied.replyExcerpt).toBe("new reply");
  });

  it("rejects an immediate causal loop", async () => {
    const parent = await request();
    await expect(
      service.requestDialogue({
        actorThreadId: "target",
        request: {
          sourceThreadId: "target",
          targetThreadId: "source",
          request: "loop",
          deliveryMode: "after-current-turn",
          idempotencyKey: "loop-key",
          causalParentExchangeId: parent.id,
          hopDepth: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "THREAD_COLLABORATION_LOOP" });
  });

  it("allows only one concurrent delivery claim", () => {
    const repository = new ExchangeRepository();
    const created = repository.create(repositoryInput()).exchange;
    repository.markQueued(created.id);
    const first = repository.claim(created.id);
    const second = repository.claim(created.id);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("fails an expired delivery claim instead of retrying an uncertain send", () => {
    let now = new Date("2026-08-31T12:00:00.000Z");
    const repository = new ExchangeRepository(
      () => now,
      () => "fixed-id",
    );
    const created = repository.create(repositoryInput({ idempotencyKey: "expired" })).exchange;
    repository.markQueued(created.id);
    expect(repository.claim(created.id, 10)).not.toBeNull();
    now = new Date("2026-08-31T12:00:00.020Z");
    const [failed] = repository.failExpiredClaims();
    expect(failed?.status).toBe("failed");
    expect(failed?.error?.code).toBe("THREAD_COLLABORATION_DELIVERY_UNCERTAIN");
  });
});
