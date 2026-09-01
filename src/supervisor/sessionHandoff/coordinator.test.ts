import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectLocation, RuntimeEvent } from "@/shared/contracts";
import type {
  CraftPlan,
  CraftSession,
  CraftSessionStatus,
  Entity,
  PromptResult,
  SessionEventListener,
  SessionSnapshot,
  StartTurnCommand,
  TurnResult,
} from "@/shared/crafting";
import type { RuntimeSegment } from "@/shared/sessionHandoff";
import { SessionHandoffCoordinator } from "./coordinator";
import { RuntimeSegmentLedger } from "./segmentLedger";

const dirs: string[] = [];
const location: ProjectLocation = { kind: "windows", path: "C:\\repo" };

function plan(id: string, harnessKind = "codex"): CraftPlan {
  return {
    id,
    recipeId: `recipe-${id}`,
    resultItemId: `result-${id}`,
    ingredients: {},
    runtimeBinding: {
      harnessKind,
      modelId: `model-${id}`,
      vendor: `vendor-${id}`,
      runtimeAdapterId: `${harnessKind}-runtime`,
    },
    threadId: "thread-1",
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}

class TestSession implements CraftSession {
  readonly listeners = new Set<SessionEventListener>();
  status: CraftSessionStatus;
  activeTurnId: string | undefined;
  terminated = false;
  bootstrapError: Error | undefined;
  interruptConfirms = true;
  prompts: string[] = [];

  constructor(
    readonly id: string,
    readonly entityId: string,
    readonly threadId = "thread-1",
    status: CraftSessionStatus = "idle",
  ) {
    this.status = status;
    this.activeTurnId = status === "busy" ? "turn-active" : undefined;
  }

  getSnapshot(): SessionSnapshot {
    return {
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      status: this.status,
      ...(this.activeTurnId ? { activeTurnId: this.activeTurnId } : {}),
      events: [],
    };
  }

  subscribe(listener: SessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event, this.getSnapshot());
  }

  async interrupt(): Promise<void> {
    if (!this.interruptConfirms) return;
    this.status = "idle";
    this.activeTurnId = undefined;
  }

  async terminate(): Promise<void> {
    this.terminated = true;
    this.status = "terminated";
  }

  async sendPrompt(prompt: string): Promise<PromptResult> {
    this.prompts.push(prompt);
    if (this.bootstrapError) throw this.bootstrapError;
    return { response: "ok", events: [] };
  }

  async startTurn(_command: StartTurnCommand): Promise<TurnResult> {
    return { turnId: "turn-test", status: "completed", events: [] };
  }
}

interface Fixture {
  ledger: RuntimeSegmentLedger;
  coordinator: SessionHandoffCoordinator;
  source: TestSession;
  target: TestSession;
  sourcePlan: CraftPlan;
  targetPlan: CraftPlan;
  sessions: Map<string, CraftSession>;
  plans: Map<string, CraftPlan>;
  states: RuntimeSegment[];
  emittedStates: string[];
  prepareTarget: ReturnType<typeof vi.fn>;
}

function fixture(
  input: { sourceBusy?: boolean; bootstrapFails?: boolean; prepareFails?: boolean } = {},
): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "craftstation-coordinator-"));
  dirs.push(dir);
  const ledger = new RuntimeSegmentLedger(dir);
  const sourcePlan = plan("source");
  const targetPlan = plan("target", "grok");
  const source = new TestSession(
    "runtime-source",
    "entity-source",
    "thread-1",
    input.sourceBusy ? "busy" : "idle",
  );
  const target = new TestSession("runtime-target", "entity-target");
  if (input.bootstrapFails) target.bootstrapError = new Error("bootstrap rejected");
  ledger.ensureInitial({
    threadId: "thread-1",
    plan: sourcePlan,
    entityId: source.entityId,
    runtimeSessionId: source.id,
  });
  const sessions = new Map<string, CraftSession>([["thread-1", source]]);
  const plans = new Map<string, CraftPlan>([["thread-1", sourcePlan]]);
  const states: RuntimeSegment[] = [];
  const emittedStates: string[] = [];
  const prepareTarget = vi.fn<
    () => Promise<{ entity: Entity; session: TestSession; plan: CraftPlan }>
  >(async () => {
    if (input.prepareFails) throw new Error("target unavailable");
    const entity: Entity = {
      id: target.entityId,
      resultItemId: targetPlan.resultItemId,
      craftPlan: targetPlan,
      status: "running",
      createdAt: "2026-08-31T00:00:00.000Z",
    };
    return { entity, session: target, plan: targetPlan };
  });
  const coordinator = new SessionHandoffCoordinator(
    {
      ledger,
      getSession: (threadId) => sessions.get(threadId),
      getPlan: (threadId) => plans.get(threadId),
      getPendingRequestCount: () => 0,
      prepareTarget,
      activateTarget: (threadId, prepared, segment) => {
        sessions.set(threadId, prepared.session);
        plans.set(threadId, prepared.plan);
        states.push(segment);
      },
      restoreSource: (threadId, sourcePlanToRestore, sourceSession, segment) => {
        sessions.set(threadId, sourceSession);
        plans.set(threadId, sourcePlanToRestore);
        states.push(segment);
      },
      commitTarget: () => undefined,
      emitState: (state) => emittedStates.push(state.phase),
    },
    { abortConfirmTimeoutMs: 20, boundaryPollIntervalMs: 1 },
  );
  return {
    ledger,
    coordinator,
    source,
    target,
    sourcePlan,
    targetPlan,
    sessions,
    plans,
    states,
    emittedStates,
    prepareTarget,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SessionHandoffCoordinator", () => {
  it("activates a ready target in the same Thread and fences stale source commands/events", async () => {
    const f = fixture();
    const result = await f.coordinator.requestSwitch({
      threadId: "thread-1",
      projectLocation: location,
      targetCraftPlan: f.targetPlan,
      mode: "after-current-turn",
      prompt: "continue",
    });

    expect(result.disposition).toBe("activated");
    expect(f.sessions.get("thread-1")).toBe(f.target);
    expect(f.target.prompts[0]).toContain("this is not a native session resume");
    expect(f.source.terminated).toBe(true);
    expect(f.ledger.list("thread-1")).toEqual([
      expect.objectContaining({ status: "inactive", bindingEpoch: 1 }),
      expect.objectContaining({ status: "active", bindingEpoch: 2 }),
    ]);
    expect(() =>
      f.coordinator.assertActiveExecution("thread-1", {
        segmentId: "segment:thread-1:1",
        runtimeSessionId: "runtime-source",
        bindingEpoch: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "HANDOFF_EXECUTION_STALE" }));
    expect(
      f.coordinator.acceptsEvent("thread-1", {
        type: "warning",
        threadId: "thread-1",
        message: "late source warning",
        execution: {
          segmentId: "segment:thread-1:1",
          runtimeSessionId: "runtime-source",
          bindingEpoch: 1,
        },
      }),
    ).toBe(false);
    f.ledger.close();
  });

  it("fails closed when a crafted active command omits its execution envelope", () => {
    const f = fixture();
    expect(() => f.coordinator.assertActiveExecution("thread-1", undefined)).toThrowError(
      expect.objectContaining({ code: "HANDOFF_ACTIVE_EXECUTION_REQUIRED" }),
    );
    expect(() => f.coordinator.assertActiveExecution("thread-1", {} as never)).toThrowError(
      expect.objectContaining({ code: "HANDOFF_ACTIVE_EXECUTION_REQUIRED" }),
    );

    // The current binding still passes the fence untouched.
    const active = f.ledger.active("thread-1")!;
    expect(
      f.coordinator.assertActiveExecution("thread-1", {
        segmentId: active.id,
        runtimeSessionId: active.runtimeSessionId!,
        bindingEpoch: active.bindingEpoch,
      }),
    ).toEqual(active);
    f.ledger.close();
  });

  it("rejects each drifted envelope dimension as a stale execution", () => {
    const f = fixture();
    const active = f.ledger.active("thread-1")!;
    const current = {
      segmentId: active.id,
      runtimeSessionId: active.runtimeSessionId!,
      bindingEpoch: active.bindingEpoch,
    };
    for (const drifted of [
      { ...current, segmentId: "segment:thread-1:9" },
      { ...current, runtimeSessionId: "runtime-other" },
      { ...current, bindingEpoch: current.bindingEpoch + 1 },
    ]) {
      expect(() => f.coordinator.assertActiveExecution("thread-1", drifted)).toThrowError(
        expect.objectContaining({ code: "HANDOFF_EXECUTION_STALE" }),
      );
    }
    f.ledger.close();
  });

  it("keeps the source active when target preparation fails", async () => {
    const f = fixture({ prepareFails: true });
    const result = await f.coordinator.requestSwitch({
      threadId: "thread-1",
      projectLocation: location,
      targetCraftPlan: f.targetPlan,
      mode: "after-current-turn",
      prompt: "continue",
    });

    expect(result.disposition).toBe("rolled_back");
    expect(f.ledger.active("thread-1")?.runtimeSessionId).toBe(f.source.id);
    expect(f.source.terminated).toBe(false);
    f.ledger.close();
  });

  it("reverses the active CAS and restores the source when target bootstrap fails", async () => {
    const f = fixture({ bootstrapFails: true });
    const result = await f.coordinator.requestSwitch({
      threadId: "thread-1",
      projectLocation: location,
      targetCraftPlan: f.targetPlan,
      mode: "after-current-turn",
      prompt: "continue",
    });

    expect(result.disposition).toBe("rolled_back");
    expect(f.sessions.get("thread-1")).toBe(f.source);
    expect(f.ledger.active("thread-1")?.runtimeSessionId).toBe(f.source.id);
    expect(f.target.terminated).toBe(true);
    expect(f.source.terminated).toBe(false);
    f.ledger.close();
  });

  it("queues a busy after-turn request, replaces/cancels it, and starts only at a safe boundary", async () => {
    const f = fixture({ sourceBusy: true });
    const first = await f.coordinator.requestSwitch({
      threadId: "thread-1",
      projectLocation: location,
      targetCraftPlan: f.targetPlan,
      mode: "after-current-turn",
      prompt: "first",
    });
    const replacement = await f.coordinator.requestSwitch({
      threadId: "thread-1",
      projectLocation: location,
      targetCraftPlan: f.targetPlan,
      mode: "after-current-turn",
      prompt: "replacement",
    });
    expect(first.disposition).toBe("queued");
    expect(replacement.disposition).toBe("queued");
    expect(f.coordinator.hasQueuedSwitch("thread-1")).toBe(true);
    expect(f.emittedStates).toContain("cancelled");

    f.coordinator.cancelQueued("thread-1", replacement.requestId);
    expect(f.coordinator.hasQueuedSwitch("thread-1")).toBe(false);

    const queued = await f.coordinator.requestSwitch({
      threadId: "thread-1",
      projectLocation: location,
      targetCraftPlan: f.targetPlan,
      mode: "after-current-turn",
      prompt: "at boundary",
    });
    f.source.status = "idle";
    f.source.activeTurnId = undefined;
    await f.coordinator.onRuntimeEvent("thread-1", {
      type: "turn.completed",
      threadId: "thread-1",
      turnId: "turn-active",
      state: "completed",
    });
    expect(queued.disposition).toBe("queued");
    expect(f.ledger.active("thread-1")?.runtimeSessionId).toBe(f.target.id);
    f.ledger.close();
  });

  it("fails closed when an abort is not confirmed", async () => {
    const f = fixture({ sourceBusy: true });
    f.source.interruptConfirms = false;
    const result = await f.coordinator.requestSwitch({
      threadId: "thread-1",
      projectLocation: location,
      targetCraftPlan: f.targetPlan,
      mode: "abort-current-turn",
      prompt: "abort then continue",
    });

    expect(result.disposition).toBe("rolled_back");
    expect(result.state.diagnostic).toMatchObject({
      code: "HANDOFF_INTERRUPT_UNCONFIRMED",
      rollback: "succeeded",
    });
    expect(f.prepareTarget).not.toHaveBeenCalled();
    expect(f.ledger.active("thread-1")?.runtimeSessionId).toBe(f.source.id);
    f.ledger.close();
  });
});
