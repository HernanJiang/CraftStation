import { randomUUID } from "node:crypto";

import type { AccountBinding, ProjectLocation, RuntimeEvent } from "@/shared/contracts";
import {
  compositionProvenanceSchema,
  craftPlanSchema,
  type CraftPlan,
  type CraftSession,
  type Entity,
} from "@/shared/crafting";
import type {
  RequestSessionSwitchPayload,
  RuntimeExecutionEnvelope,
  RuntimeSegment,
  SessionSwitchResult,
  SessionSwitchState,
} from "@/shared/sessionHandoff";
import { projectConversationCheckpoint, renderCheckpointForTarget } from "./checkpointProjection";
import { sanitizePortableRecord } from "./redaction";
import { RuntimeSegmentLedger } from "./segmentLedger";

export class SessionHandoffError extends Error {
  constructor(
    readonly code: string,
    readonly phase: SessionSwitchState["phase"],
    message: string,
  ) {
    super(message);
    this.name = "SessionHandoffError";
  }
}

export interface PreparedTargetRuntime {
  entity: Entity;
  session: CraftSession;
  plan: CraftPlan;
  accountBinding?: AccountBinding;
}

export interface SessionHandoffCoordinatorDependencies {
  ledger: RuntimeSegmentLedger;
  getSession(threadId: string): CraftSession | undefined;
  getPlan(threadId: string): CraftPlan | undefined;
  getPendingRequestCount(threadId: string): number;
  prepareTarget(
    plan: CraftPlan,
    projectLocation: ProjectLocation,
    accountId?: string,
    accountMode?: "explicit" | "preferred" | "selected" | "auto",
  ): Promise<PreparedTargetRuntime>;
  activateTarget(threadId: string, target: PreparedTargetRuntime, segment: RuntimeSegment): void;
  restoreSource(
    threadId: string,
    plan: CraftPlan,
    session: CraftSession,
    segment: RuntimeSegment,
  ): void;
  commitTarget(threadId: string): void;
  emitState(state: SessionSwitchState): void;
}

interface PendingRequest {
  payload: RequestSessionSwitchPayload;
  state: SessionSwitchState;
}

const DEFAULT_ABORT_CONFIRM_TIMEOUT_MS = 20_000;

export interface SessionHandoffCoordinatorOptions {
  abortConfirmTimeoutMs?: number;
  boundaryPollIntervalMs?: number;
}

export class SessionHandoffCoordinator {
  private readonly locks = new Map<string, Promise<SessionSwitchResult>>();
  private readonly queued = new Map<string, PendingRequest>();
  private readonly boundaryGates = new Map<string, Set<string>>();

  constructor(
    private readonly deps: SessionHandoffCoordinatorDependencies,
    private readonly options: SessionHandoffCoordinatorOptions = {},
  ) {
    for (const state of this.deps.ledger.recoverInterruptedSwitches()) {
      this.deps.emitState(state);
    }
  }

  ensureInitialSegment(input: {
    threadId: string;
    plan: CraftPlan;
    entityId: string;
    session: CraftSession;
  }): RuntimeSegment {
    const nativeSessionRef = input.session.nativeSessionRef ?? input.session.sessionRef;
    return this.deps.ledger.ensureInitial({
      threadId: input.threadId,
      plan: input.plan,
      entityId: input.entityId,
      runtimeSessionId: input.session.id,
      ...(nativeSessionRef ? { nativeSessionRef } : {}),
    });
  }

  terminateActive(threadId: string): void {
    const active = this.deps.ledger.active(threadId);
    if (active) this.deps.ledger.mark(active.id, "terminated");
  }

  executionEnvelope(threadId: string, session: CraftSession): RuntimeExecutionEnvelope | undefined {
    const active = this.deps.ledger.active(threadId);
    if (!active || active.runtimeSessionId !== session.id) return undefined;
    return {
      segmentId: active.id,
      runtimeSessionId: session.id,
      bindingEpoch: active.bindingEpoch,
    };
  }

  acceptsEvent(threadId: string, event: RuntimeEvent): boolean {
    const execution = event.execution;
    if (!execution) return true;
    const active = this.deps.ledger.active(threadId);
    if (
      active?.id === execution.segmentId &&
      active.runtimeSessionId === execution.runtimeSessionId &&
      active.bindingEpoch === execution.bindingEpoch
    ) {
      return true;
    }
    this.deps.ledger.archiveStaleEvent(execution.segmentId, event.type, execution.eventSequence);
    return false;
  }

  /**
   * Active-execution fence for crafted commands (v0.9 F1). Fail closed: a
   * crafted active command WITHOUT a caller-bound execution envelope is
   * rejected, as is any envelope that no longer matches the ledger's active
   * Segment (segmentId, runtimeSessionId or bindingEpoch drifted). Legacy
   * non-crafted threads never reach this seam.
   */
  assertActiveExecution(
    threadId: string,
    expected: RuntimeExecutionEnvelope | undefined,
    allowDuringSwitch = false,
  ): RuntimeSegment {
    const active = this.deps.ledger.active(threadId);
    if (!active) {
      throw new SessionHandoffError(
        "HANDOFF_ACTIVE_SEGMENT_MISSING",
        "failed",
        "No active Runtime Segment is available for this conversation.",
      );
    }
    if (
      !expected ||
      typeof expected.segmentId !== "string" ||
      typeof expected.runtimeSessionId !== "string" ||
      typeof expected.bindingEpoch !== "number"
    ) {
      throw new SessionHandoffError(
        "HANDOFF_ACTIVE_EXECUTION_REQUIRED",
        "failed",
        "This command must carry the conversation's active Runtime execution envelope.",
      );
    }
    if (
      expected.segmentId !== active.id ||
      expected.runtimeSessionId !== active.runtimeSessionId ||
      expected.bindingEpoch !== active.bindingEpoch
    ) {
      throw new SessionHandoffError(
        "HANDOFF_EXECUTION_STALE",
        "failed",
        "The command targets a stale Runtime Segment binding.",
      );
    }
    if (!allowDuringSwitch && this.locks.has(threadId)) {
      throw new SessionHandoffError(
        "HANDOFF_SWITCH_IN_PROGRESS",
        "failed",
        "A Runtime switch is already preparing for this conversation.",
      );
    }
    return active;
  }

  hasQueuedSwitch(threadId: string): boolean {
    return this.queued.has(threadId);
  }

  async requestSwitch(payload: RequestSessionSwitchPayload): Promise<SessionSwitchResult> {
    const existingLock = this.locks.get(payload.threadId);
    if (existingLock) return existingLock;
    const source = this.requireSource(payload.threadId);
    const state = this.newState(payload, source);
    if (payload.mode === "after-current-turn" && !this.isSafeBoundary(payload.threadId)) {
      const previous = this.queued.get(payload.threadId);
      if (previous) this.transition(previous.state, "cancelled", "replace-queued-switch");
      this.queued.set(payload.threadId, { payload, state });
      this.transition(state, "queued", "wait-for-safe-boundary");
      return { requestId: state.requestId, disposition: "queued", state };
    }
    return this.startLocked(payload, state);
  }

  cancelQueued(threadId: string, requestId: string): void {
    const request = this.queued.get(threadId);
    if (!request || request.state.requestId !== requestId) return;
    this.queued.delete(threadId);
    this.transition(request.state, "cancelled", "cancel-queued-switch");
  }

  readState(threadId: string): SessionSwitchState | undefined {
    return this.queued.get(threadId)?.state ?? this.deps.ledger.readSwitchState(threadId);
  }

  async onRuntimeEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    this.updateBoundaryGates(threadId, event);
    if (event.type !== "turn.completed") return;
    const request = this.queued.get(threadId);
    if (!request || !this.isSafeBoundary(threadId)) return;
    this.queued.delete(threadId);
    await this.startLocked(request.payload, request.state).catch(() => undefined);
  }

  private startLocked(
    payload: RequestSessionSwitchPayload,
    state: SessionSwitchState,
  ): Promise<SessionSwitchResult> {
    const operation = this.performSwitch(payload, state).finally(() => {
      this.locks.delete(payload.threadId);
    });
    this.locks.set(payload.threadId, operation);
    return operation;
  }

  private async performSwitch(
    payload: RequestSessionSwitchPayload,
    state: SessionSwitchState,
  ): Promise<SessionSwitchResult> {
    const sourceSession = this.requireSession(payload.threadId);
    const sourcePlan = this.requirePlan(payload.threadId);
    const sourceSegment = this.requireSource(payload.threadId);
    let target: PreparedTargetRuntime | undefined;
    let targetSegment: RuntimeSegment | undefined;
    try {
      if (payload.mode === "abort-current-turn" && !this.isSafeBoundary(payload.threadId)) {
        this.transition(state, "interrupting_source", "interrupt-source");
        await sourceSession.interrupt(sourceSession.getSnapshot().activeTurnId);
        await this.waitForSafeBoundary(payload.threadId);
      }
      if (!this.isSafeBoundary(payload.threadId)) {
        throw new SessionHandoffError(
          "HANDOFF_SOURCE_NOT_SAFE",
          state.phase,
          "The source Runtime did not reach a safe completed-turn boundary.",
        );
      }

      this.transition(state, "preparing", "project-checkpoint");
      const latestTurnAnchor = this.deps.ledger.latestTurnAnchor(payload.threadId);
      const checkpoint = projectConversationCheckpoint({
        threadId: payload.threadId,
        sourceSegment,
        sourcePlan,
        items: this.deps.ledger.readPortableItems(payload.threadId),
        ...(latestTurnAnchor ? { lastCompletedTurnAnchorItemId: latestTurnAnchor } : {}),
      });
      this.deps.ledger.saveCheckpoint(checkpoint);
      this.transition(state, "checkpointed", "persist-checkpoint");

      targetSegment = this.deps.ledger.prepare({
        threadId: payload.threadId,
        plan: payload.targetCraftPlan,
        predecessorSegmentId: sourceSegment.id,
      });
      state.targetSegmentId = targetSegment.id;
      this.transition(state, "target_starting", "start-target-runtime");
      target = payload.accountId
        ? await this.deps.prepareTarget(
            payload.targetCraftPlan,
            payload.projectLocation,
            payload.accountId,
            payload.accountMode,
          )
        : await this.deps.prepareTarget(payload.targetCraftPlan, payload.projectLocation);
      const targetNativeSessionRef = target.session.nativeSessionRef ?? target.session.sessionRef;
      targetSegment = this.deps.ledger.attachRuntime(targetSegment.id, {
        entityId: target.entity.id,
        runtimeSessionId: target.session.id,
        ...(targetNativeSessionRef ? { nativeSessionRef: targetNativeSessionRef } : {}),
        checkpointId: checkpoint.id,
      });
      this.transition(state, "target_ready", "target-runtime-ready");

      this.transition(state, "activating", "compare-and-swap-active-binding");
      const active = this.deps.ledger.activateCas(
        payload.threadId,
        sourceSegment.id,
        targetSegment.id,
      );
      this.deps.activateTarget(payload.threadId, target, active);

      const bootstrap = [renderCheckpointForTarget(checkpoint), payload.prompt.trim()]
        .filter(Boolean)
        .join("\n\n");
      if (bootstrap) await target.session.sendPrompt(bootstrap);
      this.deps.commitTarget(payload.threadId);
      state.activeSegment = active;
      if (target.accountBinding) state.activeAccountBinding = target.accountBinding;
      this.transition(state, "active", "activate-target-runtime");
      await sourceSession.terminate().catch(() => undefined);
      return { requestId: state.requestId, disposition: "activated", state };
    } catch (error) {
      const code =
        error instanceof SessionHandoffError ? error.code : "HANDOFF_TARGET_START_FAILED";
      this.transition(state, "rolling_back", "rollback-target", code, error);
      let sourceStillActive = this.deps.ledger.active(payload.threadId)?.id === sourceSegment.id;
      if (
        !sourceStillActive &&
        targetSegment &&
        this.deps.ledger.active(payload.threadId)?.id === targetSegment.id
      ) {
        try {
          const restored = this.deps.ledger.rollbackCas(
            payload.threadId,
            sourceSegment.id,
            targetSegment.id,
            code,
          );
          this.deps.restoreSource(payload.threadId, sourcePlan, sourceSession, restored);
          sourceStillActive = true;
        } catch {
          sourceStillActive = false;
        }
      } else if (targetSegment) {
        this.deps.ledger.mark(targetSegment.id, "rolled_back", code);
      }
      if (target) await target.session.terminate().catch(() => undefined);
      const rollback = sourceStillActive ? "succeeded" : "failed";
      this.transition(
        state,
        sourceStillActive ? "rolled_back" : "failed",
        "rollback-complete",
        code,
        error,
        rollback,
      );
      return {
        requestId: state.requestId,
        disposition: sourceStillActive ? "rolled_back" : "failed",
        state,
      };
    }
  }

  private requireSession(threadId: string): CraftSession {
    const session = this.deps.getSession(threadId);
    if (!session)
      throw new SessionHandoffError(
        "HANDOFF_SOURCE_SESSION_MISSING",
        "failed",
        "The source native Session is not live or recoverable.",
      );
    return session;
  }

  private requirePlan(threadId: string): CraftPlan {
    const plan = this.deps.getPlan(threadId);
    if (!plan)
      throw new SessionHandoffError(
        "HANDOFF_SOURCE_PLAN_MISSING",
        "failed",
        "The source immutable CraftPlan is unavailable.",
      );
    return plan;
  }

  private requireSource(threadId: string): RuntimeSegment {
    const source = this.deps.ledger.active(threadId);
    if (!source)
      throw new SessionHandoffError(
        "HANDOFF_ACTIVE_SEGMENT_MISSING",
        "failed",
        "The conversation has no active Runtime Segment.",
      );
    return source;
  }

  private isSafeBoundary(threadId: string): boolean {
    const session = this.deps.getSession(threadId);
    if (!session || this.deps.getPendingRequestCount(threadId) > 0) return false;
    const snapshot = session.getSnapshot();
    return (
      snapshot.status === "idle" &&
      !snapshot.activeTurnId &&
      (this.boundaryGates.get(threadId)?.size ?? 0) === 0
    );
  }

  private updateBoundaryGates(threadId: string, event: RuntimeEvent): void {
    let gates = this.boundaryGates.get(threadId);
    if (!gates) {
      gates = new Set();
      this.boundaryGates.set(threadId, gates);
    }
    if (event.type === "turn.started") gates.add(`turn:${event.turnId}`);
    if (event.type === "turn.completed") gates.delete(`turn:${event.turnId}`);
    if (event.type === "request.opened") gates.add(`request:${event.requestId}`);
    if (event.type === "request.resolved") gates.delete(`request:${event.requestId}`);
    if (
      event.type === "item.started" &&
      [
        "command_execution",
        "file_change",
        "tool_call",
        "mcp_tool_call",
        "dynamic_tool_call",
        "question_answer",
      ].includes(event.itemType)
    ) {
      gates.add(`item:${event.itemId}`);
    }
    if (event.type === "item.completed") gates.delete(`item:${event.itemId}`);
    if (event.type === "session.exited") gates.clear();
    if (gates.size === 0) this.boundaryGates.delete(threadId);
  }

  private async waitForSafeBoundary(threadId: string): Promise<void> {
    const deadline =
      Date.now() + (this.options.abortConfirmTimeoutMs ?? DEFAULT_ABORT_CONFIRM_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (this.isSafeBoundary(threadId)) return;
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.boundaryPollIntervalMs ?? 25),
      );
    }
    throw new SessionHandoffError(
      "HANDOFF_INTERRUPT_UNCONFIRMED",
      "interrupting_source",
      "The official Runtime did not confirm interruption before the phase timeout.",
    );
  }

  private newState(
    payload: RequestSessionSwitchPayload,
    source: RuntimeSegment,
  ): SessionSwitchState {
    const now = new Date().toISOString();
    return {
      requestId: `switch:${randomUUID()}`,
      threadId: payload.threadId,
      mode: payload.mode,
      phase: "preparing",
      sourceSegmentId: source.id,
      targetBinding: payload.targetCraftPlan.runtimeBinding,
      targetCraftPlan: craftPlanSchema.parse(sanitizePortableRecord(payload.targetCraftPlan)),
      ...(payload.targetProvenance
        ? {
            targetProvenance: compositionProvenanceSchema.parse(
              sanitizePortableRecord(payload.targetProvenance),
            ),
          }
        : {}),
      requestedAt: now,
      updatedAt: now,
    };
  }

  private transition(
    state: SessionSwitchState,
    phase: SessionSwitchState["phase"],
    operation: string,
    code?: string,
    error?: unknown,
    rollback?: "not-required" | "succeeded" | "failed",
  ): void {
    state.phase = phase;
    state.updatedAt = new Date().toISOString();
    state.diagnostic = {
      correlationId: state.requestId,
      phase,
      operation,
      ...(code ? { code } : {}),
      ...(error ? { message: error instanceof Error ? error.message : String(error) } : {}),
      ...(rollback ? { rollback } : {}),
    };
    this.deps.ledger.saveSwitchState(state);
    this.deps.emitState(state);
  }
}
