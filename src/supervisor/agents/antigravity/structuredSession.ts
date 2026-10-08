import { randomUUID } from "node:crypto";
import type { spawn } from "node:child_process";
import type {
  PromptSegment,
  RuntimeEvent,
  SessionRef,
  ThreadConfig,
  ThreadStatus,
  ThreadAttention,
} from "@/shared/contracts";
import type { NativeHarnessDiagnostic } from "@/shared/crafting";
import { isHomeScopeLocation } from "@/shared/homeScope";
import { inlinePromptSegmentText } from "@/shared/promptContent";
import { stripGeminiHarnessNoise } from "@/shared/geminiHarnessNoise";
import {
  antigravitySessionEnvForLocation,
  ANTIGRAVITY_DISABLE_AUTO_UPDATE_ENV,
  primeAntigravityUpdateCheckTimestamp,
} from "./detection";
import { ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR } from "@/supervisor/runtime/nativeHarness/descriptors";
import {
  canonicalizeNativeEvent,
  createNativeCanonicalizerTurnState,
  finalResponseRemainder,
  type NativeCanonicalizerTurnState,
} from "@/supervisor/runtime/nativeHarness/nativeEventCanonicalizer";
import {
  buildAntigravityStreamArgs,
  NdjsonProcessTransport,
  type NativeProcessExit,
  type NativeProcessTransportOptions,
  type NativeWireEvent,
} from "@/supervisor/runtime/nativeHarness/nativeTransport";
import { createAntigravityMcpProjection } from "@/supervisor/runtime/nativeHarness/antigravityMcpProjection";
import {
  buildAgentCommand,
  createKnownSessionRef,
  StructuredTransportError,
  type AgentLaunchOptions,
  type CreateStructuredSessionInput,
  type StartTurnOptions,
  type StructuredSessionHandle,
  type StructuredSessionListener,
} from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";
import { isRetryableCapacityError } from "@/shared/retryableCapacityError";
import { explainNativeNetworkError } from "../nativeNetworkError";
import { buildAntigravityArgs, buildAntigravityPrintTimeoutArgs } from "./argv";

interface AntigravityStructuredSessionOptions {
  supportsSeparateModelEffort: boolean;
  emitEffortFlag?: boolean;
  supportsPrintTimeout?: boolean;
  defaultModel: string;
  spawnProcess?: typeof spawn;
}

/**
 * `agy` labels its own in-flight API retries `API error (attempt N)`. When it
 * surfaces one mid-turn it is retry chatter, not a turn outcome — agy usually
 * recovers inside the same turn — so it is shown as a warning instead of an
 * error item that reads like the turn already failed.
 */
const AGY_INTERNAL_RETRY_NOTICE = /\bAPI error \(attempt \d+\)/;

function resultPayload(event: NativeWireEvent): Record<string, unknown> {
  const nested = event.payload.result;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : event.payload;
}

function resultFailureMessage(event: NativeWireEvent): string | undefined {
  if (event.type !== "result") return undefined;
  const payload = resultPayload(event);
  const status = String(payload.status ?? "").toUpperCase();
  if (!["ERROR", "FAILED", "FAILURE", "AUTH_REQUIRED", "BLOCKED"].includes(status)) {
    return undefined;
  }
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)) {
    const message = (payload.error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return `Native provider returned status ${status || "ERROR"}.`;
}

function statusForEvent(event: RuntimeEvent): {
  status: ThreadStatus;
  attention: ThreadAttention;
} | null {
  if (event.type === "turn.started") return { status: "working", attention: "working" };
  if (event.type === "turn.completed") {
    return event.state === "failed"
      ? { status: "error", attention: "none" }
      : { status: "idle", attention: "none" };
  }
  if (event.type === "request.opened") {
    return event.requestType === "tool_call_approval"
      ? { status: "needs_approval", attention: "needs_approval" }
      : { status: "needs_reply", attention: "needs_reply" };
  }
  // Standalone "error" events never flip thread status on their own: every
  // genuine failure path emits `turn.completed state:"failed"` right after the
  // error event, and mid-turn/post-turn noise frames must not toggle the
  // thread into error (which surfaces as a toast).
  return null;
}

/**
 * Official Antigravity `stream-json` session projected onto CraftStation's
 * provider-neutral structured-session boundary. The provider owns the agent
 * loop; this class only transports NDJSON and maps official events.
 */
export class AntigravityStructuredSession implements StructuredSessionHandle {
  launchOptions: AgentLaunchOptions = { suppressResumeConfigOverrides: true };

  private listener: StructuredSessionListener | undefined;
  private transport: NdjsonProcessTransport | undefined;
  private projection: ReturnType<typeof createAntigravityMcpProjection>;
  private providerSessionId: string | undefined;
  private currentTurnId: string | undefined;
  private turnPromise: Promise<void> | undefined;
  private resolveTurn: (() => void) | undefined;
  private rejectTurn: ((error: Error) => void) | undefined;
  private bufferedEvents: RuntimeEvent[] = [];
  private bufferedUpdates: Array<{
    status: ThreadStatus;
    attention: ThreadAttention;
    sessionRef?: SessionRef;
  }> = [];
  private disposed = false;
  private streamedAssistantText = "";
  private streamedReasoningByItem = new Map<string, string>();
  private openReasoningItemIds = new Set<string>();
  private pendingError: string | undefined;
  private pendingClose = false;
  /**
   * Set when the latest `agent_response` reaches a DONE-family state, and
   * cleared when a later tool starts. Narration before tools is not a final
   * answer. A `result` frame that still
   * reports ERROR after that point failed *after* delivering the answer (e.g.
   * a trailing `streamGenerateContent` write hit a dead h2 connection), so the
   * turn is completed with a warning instead of failed-and-retried into a
   * duplicated answer.
   */
  private responseStepCompleted = false;
  /**
   * Keeps `last_check.timestamp` fresh for the session's whole lifetime. The
   * ~15-minute gate is primed once per spawn, but a long-lived session's
   * `language_server` grandchild can still fire `agy --bg-updater` once it
   * expires — and that detached updater allocates its own VISIBLE console
   * window. Refreshing well under the gate window keeps it closed.
   */
  private updateGateRefresh: ReturnType<typeof setInterval> | undefined;
  /**
   * Tool step indexes currently ACTIVE on the wire. `agy` closes every tool
   * step (DONE/ERROR) before a natural end of turn — including background
   * run_command steps, which transition when the task finishes. A SUCCESS
   * `result` with steps still ACTIVE means the print-mode wait was cut off
   * mid-task (its 5m default) and the leftover steps are never reported; the
   * session rejects that as a transport interruption so Craft-Harness can
   * resume the retained conversation within the configured retry budget.
   */
  private activeToolSteps = new Set<number>();
  private sawToolStep = false;
  /**
   * Thinking-run attribution state, reset per turn. Splits step-less thinking
   * frames into contiguous runs so thoughts interleave with tools in the UI
   * instead of collapsing into one turn-top block (see the canonicalizer).
   */
  private thoughtRunState: NativeCanonicalizerTurnState = createNativeCanonicalizerTurnState();
  /** True while we killed the process to stop a turn; exit is not a crash. */
  private ignoringProcessExit = false;

  constructor(
    private readonly input: CreateStructuredSessionInput,
    private readonly options: AntigravityStructuredSessionOptions,
  ) {}

  setListener(listener: StructuredSessionListener): void {
    this.listener = listener;
    if (listener.onRuntimeEvent) {
      for (const event of this.bufferedEvents) listener.onRuntimeEvent(event);
      this.bufferedEvents = [];
    }
    for (const update of this.bufferedUpdates) listener.onUpdate(update);
    this.bufferedUpdates = [];
    if (this.pendingError) {
      listener.onError(this.pendingError);
      this.pendingError = undefined;
    }
    if (this.pendingClose) {
      this.pendingClose = false;
      listener.onClose();
    }
  }

  async activate(): Promise<void> {
    if (this.disposed) throw new Error("Antigravity session was disposed before activation.");
  }

  async openThread(config: ThreadConfig, sessionRef?: SessionRef): Promise<string | undefined> {
    if (this.transport) throw new Error("Antigravity session is already open.");
    if (this.disposed) throw new Error("Antigravity session was disposed before opening.");
    if (sessionRef?.providerSessionId) {
      this.providerSessionId = sessionRef.providerSessionId;
    }
    await this.spawnTransport(config);
    this.emitUpdate({
      status: "idle",
      attention: "none",
      ...(this.providerSessionId
        ? { sessionRef: createKnownSessionRef(this.providerSessionId) }
        : {}),
    });
    // Antigravity creates the canonical conversation id asynchronously and
    // announces it in the first `init` frame. Keep the initial value absent so
    // CraftStation never persists a fabricated provider id; the listener
    // update below supplies the real id as soon as the provider emits it.
    return this.providerSessionId;
  }

  /**
   * (Re)spawn the underlying `agy` process for the retained conversation id.
   * Shared by the initial open and by transparent recovery after the process
   * exits mid-session (crash/OOM/killed): without this, every send after an
   * exit fails permanently with "session is not open" and the thread can
   * never continue.
   */
  private async spawnTransport(config: ThreadConfig): Promise<void> {
    const args = buildAntigravityArgs(
      config,
      "",
      this.providerSessionId,
      this.options.supportsSeparateModelEffort,
      this.options.defaultModel,
      this.options.emitEffortFlag ?? false,
    );
    if (!this.providerSessionId && !isHomeScopeLocation(this.input.projectLocation)) {
      args.unshift("--new-project");
    }

    const projectableMcpServers =
      this.input.projectLocation.kind === "wsl" ? [] : (this.input.mcpServers ?? []);
    if (this.input.projectLocation.kind === "wsl" && (this.input.mcpServers?.length ?? 0) > 0) {
      // Capability/UI and the spawn pipeline already filter this path. Keep the
      // provider boundary defensive for stale/direct callers without logging
      // transport details or failing the otherwise-valid GUI session.
      console.warn("[antigravity] ignored MCP servers for an unsupported WSL session.");
    }
    this.projection = createAntigravityMcpProjection(projectableMcpServers);
    // The env switch silences this process's own updater check, but `agy`
    // re-execs `language_server` with a filtered env — refresh the last-check
    // mtime so the 15-minute gate stays closed for the whole tree.
    primeAntigravityUpdateCheckTimestamp();
    const env = {
      // Kill switch is laid down first so it survives even a caller that
      // forgot baseSpawnEnv: the bg-updater escapes any pseudoconsole we can
      // create and pops a stray terminal window when it fires.
      ...ANTIGRAVITY_DISABLE_AUTO_UPDATE_ENV,
      ...(antigravitySessionEnvForLocation(this.input.baseSpawnEnv, this.input.projectLocation) ??
        {}),
      ...(this.input.projectLocation.kind === "wsl" ? { BROWSER: "/bin/true" } : {}),
      ...(this.input.env ?? {}),
      ...(this.projection?.env ?? {}),
    };
    const command = buildAgentCommand(
      this.input.projectLocation,
      "agy",
      buildAntigravityStreamArgs([
        ...buildAntigravityPrintTimeoutArgs(this.options.supportsPrintTimeout ?? false),
        ...args,
      ]),
      resolveAgentBinaryPath(this.input.projectLocation, "agy"),
      env,
    );
    const transportOptions: NativeProcessTransportOptions = {
      harnessKind: "antigravity",
      command: command.command,
      args: command.args,
      cwd:
        command.cwd ??
        (this.input.projectLocation.kind === "wsl"
          ? this.input.projectLocation.uncPath
          : this.input.projectLocation.path),
      ...(command.env ? { env: command.env } : {}),
      ...(this.options.spawnProcess ? { spawnProcess: this.options.spawnProcess } : {}),
      onEvent: () => undefined,
      onDiagnostic: (diagnostic) => this.handleDiagnostic(diagnostic),
      onProcessExit: (event) => this.handleProcessExit(event),
    };
    try {
      this.transport = new NdjsonProcessTransport(transportOptions);
      this.transport.setEventHandler((event) => this.handleWireEvent(event));
      this.transport.start();
      if (this.updateGateRefresh) clearInterval(this.updateGateRefresh);
      this.updateGateRefresh = setInterval(
        () => primeAntigravityUpdateCheckTimestamp(),
        5 * 60 * 1000,
      );
      this.updateGateRefresh.unref?.();
    } catch (error) {
      this.projection?.dispose();
      this.projection = undefined;
      throw error;
    }
  }

  private clearUpdateGateRefresh(): void {
    if (!this.updateGateRefresh) return;
    clearInterval(this.updateGateRefresh);
    this.updateGateRefresh = undefined;
  }

  async startTurn(
    prompt: string,
    _config: ThreadConfig,
    segments?: PromptSegment[],
    options?: StartTurnOptions,
  ): Promise<void> {
    if (this.disposed) throw new Error("Antigravity session was disposed and cannot be reused.");
    if (this.currentTurnId) {
      // Mid-turn inject: stop the live turn then send. Throwing here used to
      // surface "An Antigravity turn is already active" and leave the process
      // dying from the pending-steer interrupt.
      await this.interruptTurn();
    }
    if (!this.transport) {
      // The process exited after open (crash/OOM/killed) while the session
      // itself was never disposed: respawn transparently against the retained
      // conversation id so the thread can continue instead of failing every
      // subsequent send with "session is not open". A respawn failure throws
      // here with the real spawn error — never a silent no-op.
      await this.spawnTransport(_config);
    }
    const transport = this.transport;
    if (!transport) throw new Error("Antigravity session is not open.");
    if (this.currentTurnId) throw new Error("An Antigravity turn is already active.");
    this.currentTurnId = `turn:${randomUUID()}`;
    this.emitRuntime({
      type: "turn.started",
      threadId: this.input.threadId,
      turnId: this.currentTurnId,
    });
    this.turnPromise = new Promise<void>((resolve, reject) => {
      this.resolveTurn = resolve;
      this.rejectTurn = reject;
    });
    const turnPromise = this.turnPromise;
    // Every send re-arms the ~15-minute updater gate: `language_server`'s
    // filtered env drops AGY_CLI_DISABLE_AUTO_UPDATE, so a stale timestamp at
    // turn start is exactly when the detached --bg-updater pops its console.
    primeAntigravityUpdateCheckTimestamp();
    this.streamedAssistantText = "";
    this.responseStepCompleted = false;
    this.streamedReasoningByItem.clear();
    this.openReasoningItemIds.clear();
    this.activeToolSteps.clear();
    this.sawToolStep = false;
    this.thoughtRunState = createNativeCanonicalizerTurnState();
    const additionalInstructions = [
      ...(segments ?? []).map(inlinePromptSegmentText),
      ...(options?.inlineInstructions ? [options.inlineInstructions] : []),
    ]
      .filter(Boolean)
      .join("\n\n");
    const effectivePrompt = additionalInstructions
      ? `${prompt}\n\n${additionalInstructions}`
      : prompt;
    try {
      transport.send({ event: "user", message: { content: effectivePrompt } });
    } catch (error) {
      this.finishTurn(error instanceof Error ? error : new Error(String(error)));
    }
    return turnPromise;
  }

  async interruptTurn(): Promise<void> {
    if (this.disposed) return;
    const turnId = this.currentTurnId;
    const dying = this.transport;
    if (!dying && !turnId) return;
    this.ignoringProcessExit = true;
    dying?.interrupt();
    // Clear the active-turn guard before emitting interrupted. The idle
    // update drains pending-steer into startTurn; emitting first used to
    // re-enter startTurn while currentTurnId was still set.
    this.finishTurn();
    this.currentTurnId = undefined;
    if (this.transport === dying) {
      this.transport = undefined;
      this.clearUpdateGateRefresh();
      this.projection?.dispose();
      this.projection = undefined;
    }
    if (turnId) {
      this.emitRuntime({
        type: "turn.completed",
        threadId: this.input.threadId,
        turnId,
        state: "interrupted",
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.currentTurnId) {
      this.emitRuntime({
        type: "turn.completed",
        threadId: this.input.threadId,
        turnId: this.currentTurnId,
        state: "cancelled",
      });
      this.finishTurn();
    }
    this.clearUpdateGateRefresh();
    this.transport?.dispose();
    this.transport = undefined;
    this.projection?.dispose();
    this.projection = undefined;
  }

  private emitRuntime(event: RuntimeEvent): void {
    if (this.listener?.onRuntimeEvent) this.listener.onRuntimeEvent(event);
    else this.bufferedEvents.push(event);
    const update = statusForEvent(event);
    if (update) this.emitUpdate(update);
  }

  private emitUpdate(update: {
    status: ThreadStatus;
    attention: ThreadAttention;
    sessionRef?: SessionRef;
  }): void {
    if (this.listener) this.listener.onUpdate(update);
    else this.bufferedUpdates.push(update);
  }

  private handleWireEvent(event: NativeWireEvent): void {
    const turnId = this.currentTurnId ?? `turn:${randomUUID()}`;
    if (
      event.type === "init" &&
      typeof event.payload.conversation_id === "string" &&
      event.payload.conversation_id.trim()
    ) {
      this.providerSessionId = event.payload.conversation_id;
      this.launchOptions = { ...this.launchOptions, resumeThreadId: this.providerSessionId };
      this.emitUpdate({
        status: this.currentTurnId ? "working" : "idle",
        attention: this.currentTurnId ? "working" : "none",
        sessionRef: createKnownSessionRef(this.providerSessionId),
      });
    }
    this.trackToolStep(event);
    const canonicalEvents = canonicalizeNativeEvent({
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      threadId: this.input.threadId,
      turnId,
      correlationId: this.transport?.correlationId ?? "antigravity",
      event,
      thoughtRunState: this.thoughtRunState,
    });
    // `result` decides the turn — compute its failure and the delivered-answer
    // downgrade BEFORE emitting its canonical events, so the error /
    // turn.completed events can be rewritten rather than emitted then undone.
    const incompleteResult =
      event.type === "result" &&
      String(resultPayload(event).status ?? "").toUpperCase() === "SUCCESS" &&
      this.sawToolStep &&
      !this.resultAnswerDelivered(event);
    if (incompleteResult) {
      this.finishTurn(
        new StructuredTransportError(
          "Antigravity 的原生回合在工具调用后提前结束，尚未交付最终回复。已完成的操作保留在原生会话中，可继续此任务。",
        ),
      );
      return;
    }
    const resultFailure = event.type === "result" ? resultFailureMessage(event) : undefined;
    const downgradeResult = Boolean(resultFailure) && this.resultAnswerDelivered(event);
    for (const runtimeEvent of canonicalEvents) {
      if (downgradeResult && runtimeEvent.type === "error") {
        this.emitRuntime({
          type: "warning",
          threadId: this.input.threadId,
          message: runtimeEvent.message,
        });
        continue;
      }
      if (downgradeResult && runtimeEvent.type === "turn.completed") {
        this.emitRuntime({ ...runtimeEvent, state: "completed" });
        continue;
      }
      if (runtimeEvent.type === "error") {
        if (!this.currentTurnId) {
          // Trailing stderr/error frames after the turn finished: keep them
          // visible as warnings instead of error events that flip the thread
          // into error status and pop a toast for an already-completed turn.
          this.emitRuntime({
            type: "warning",
            threadId: this.input.threadId,
            message: runtimeEvent.message,
          });
          continue;
        }
        if (AGY_INTERNAL_RETRY_NOTICE.test(runtimeEvent.message)) {
          this.emitRuntime({
            type: "warning",
            threadId: this.input.threadId,
            message: runtimeEvent.message,
          });
          continue;
        }
      }
      if (runtimeEvent.type === "item.started" && runtimeEvent.itemType === "reasoning") {
        this.openReasoningItemIds.add(runtimeEvent.itemId);
      }
      if (runtimeEvent.type === "item.completed") {
        this.openReasoningItemIds.delete(runtimeEvent.itemId);
      }
      if (runtimeEvent.type === "content.delta" && runtimeEvent.stream === "assistant_text") {
        if (event.type === "result") {
          // `result.response` is the turn's authoritative answer: agy can
          // stream a REGENERATED second reply into the same item (probe-
          // verified: the regen diverges from the first answer's stream, so
          // per-chunk remainder trimming can never catch it). Replace the
          // stream with the snapshot so retracted text is dropped, not left
          // appended after the real answer.
          this.streamedAssistantText = runtimeEvent.delta;
          this.emitRuntime({
            type: "content.set",
            threadId: runtimeEvent.threadId,
            itemId: runtimeEvent.itemId,
            stream: runtimeEvent.stream,
            text: runtimeEvent.delta,
          });
          continue;
        }
        // agy reuses `text_delta` for whole-step snapshots (a DONE
        // agent_response step re-sends its full text), and `result.response`
        // replays the whole answer — every delta must be remainder-trimmed
        // against the running stream, not only the terminal echo.
        const delta = finalResponseRemainder(this.streamedAssistantText, runtimeEvent.delta);
        if (!delta) continue;
        this.streamedAssistantText += delta;
        this.emitRuntime({ ...runtimeEvent, delta });
        continue;
      }
      if (runtimeEvent.type === "content.delta" && runtimeEvent.stream === "reasoning_text") {
        const prior = this.streamedReasoningByItem.get(runtimeEvent.itemId) ?? "";
        const delta = finalResponseRemainder(prior, runtimeEvent.delta);
        if (!delta) continue;
        this.streamedReasoningByItem.set(runtimeEvent.itemId, prior + delta);
        this.openReasoningItemIds.add(runtimeEvent.itemId);
        this.emitRuntime({ ...runtimeEvent, delta });
        continue;
      }
      this.emitRuntime(runtimeEvent);
    }
    if (event.type === "result") {
      for (const itemId of this.openReasoningItemIds) {
        this.emitRuntime({ type: "item.completed", threadId: this.input.threadId, itemId });
      }
      this.openReasoningItemIds.clear();
      this.activeToolSteps.clear();
      if (resultFailure && downgradeResult) {
        // The provider already delivered the answer and then reported a
        // post-answer failure — completing keeps the delivered text and, more
        // importantly, stops Craft-Harness from replaying the turn and
        // generating the identical answer a second time. The error itself was
        // already surfaced as a warning inside the canonical loop.
        this.finishTurn();
      } else {
        this.finishTurn(
          resultFailure ? new Error(resultFailure) : undefined,
          resultFailure === undefined,
        );
      }
    }
  }

  /**
   * Whether the `result` frame's reported failure arrived AFTER the provider
   * already delivered a complete answer: the `agent_response` step reached a
   * DONE-family state, or the frame carries its authoritative `response`
   * snapshot. Either way the answer is in the chat — failing + retrying would
   * only regenerate a duplicate.
   */
  private resultAnswerDelivered(event: NativeWireEvent): boolean {
    if (this.activeToolSteps.size > 0) return false;
    if (this.hasCompletedResponse()) return true;
    const payload = resultPayload(event);
    const response =
      typeof payload.response === "string" ? (stripGeminiHarnessNoise(payload.response) ?? "") : "";
    if (!response.trim()) return false;
    // A non-empty snapshot may only echo narration from before the tools.
    // It proves delivery after tools only when it adds a visible answer.
    return (
      !this.thoughtRunState.textInterrupted ||
      Boolean(finalResponseRemainder(this.streamedAssistantText, response).trim())
    );
  }

  private hasCompletedResponse(): boolean {
    return (
      this.responseStepCompleted &&
      !this.thoughtRunState.textInterrupted &&
      this.activeToolSteps.size === 0
    );
  }

  private trackToolStep(event: NativeWireEvent): void {
    if (event.type !== "step_update") return;
    const step = event.payload.step_update;
    if (!step || typeof step !== "object" || Array.isArray(step)) return;
    const record = step as Record<string, unknown>;
    const state = String(record.state ?? "").toUpperCase();
    if (record.step_type === "agent_response") {
      if (state === "DONE" || state === "COMPLETED" || state === "SUCCESS") {
        this.responseStepCompleted = true;
      }
      return;
    }
    if (record.step_type !== "tool" || typeof record.step_index !== "number") return;
    this.sawToolStep = true;
    this.responseStepCompleted = false;
    if (state === "ACTIVE") {
      this.activeToolSteps.add(record.step_index);
    } else if (state === "DONE" || state === "ERROR") {
      this.activeToolSteps.delete(record.step_index);
    }
  }

  private handleDiagnostic(diagnostic: NativeHarnessDiagnostic): void {
    if (diagnostic.code === "NATIVE_STDERR") return;
    if (this.ignoringProcessExit && diagnostic.code === "NATIVE_PROCESS_CRASHED") return;
    if (this.currentTurnId) {
      // Crash landing after a DONE response step is a post-answer failure —
      // same delivered-answer downgrade as the `result` and process-exit
      // paths.
      if (this.hasCompletedResponse()) {
        this.emitRuntime({
          type: "warning",
          threadId: this.input.threadId,
          message: diagnostic.message,
        });
        this.finishTurn();
        return;
      }
      this.finishTurn(
        diagnostic.code === "NATIVE_PROCESS_CRASHED"
          ? new StructuredTransportError(diagnostic.message)
          : new Error(diagnostic.message),
      );
      return;
    }
    if (diagnostic.code === "NATIVE_PROCESS_CRASHED") {
      // Turn-less process death is a lifecycle event, not a turn failure.
      // `agy` exits 1 right after emitting a failed `result` (probe-verified),
      // so routing this to listener.onError manufactures a SECOND thread
      // failure ("Native process exited with code 1") that buries the real
      // result-payload error with a toast. handleProcessExit already tears
      // the transport down and reports onClose; the next send respawns
      // transparently. Keep the crash visible as a warning instead.
      this.emitRuntime({
        type: "warning",
        threadId: this.input.threadId,
        message: diagnostic.message,
      });
      return;
    }
    if (this.listener) this.listener.onError(diagnostic.message);
    else this.pendingError = diagnostic.message;
  }

  private handleProcessExit(event: NativeProcessExit): void {
    if (this.disposed) return;
    if (this.ignoringProcessExit) {
      this.ignoringProcessExit = false;
      if (this.transport && !this.transport.isProcessRunning) this.transport = undefined;
      return;
    }
    if (this.currentTurnId) {
      // Same delivered-answer rule as the `result` downgrade: agy exits 1
      // right after its closing frame (probe-verified), so a crash landing
      // between the finished answer and the result is a post-answer failure —
      // complete the turn instead of rejecting it into a duplicate-generating
      // retry.
      if (this.hasCompletedResponse()) {
        this.emitRuntime({
          type: "warning",
          threadId: this.input.threadId,
          message: `Antigravity process exited during a turn after the answer was delivered (${event.code ?? "null"}, ${event.signal ?? "none"}).`,
        });
        this.finishTurn();
      } else {
        this.finishTurn(
          new StructuredTransportError(
            `Antigravity process exited during a turn (${event.code ?? "null"}, ${event.signal ?? "none"}).`,
          ),
        );
      }
    }
    this.transport = undefined;
    this.clearUpdateGateRefresh();
    this.projection?.dispose();
    this.projection = undefined;
    if (this.listener) this.listener.onClose();
    else this.pendingClose = true;
  }

  private finishTurn(error?: Error, emitError = true): void {
    if (!this.turnPromise) return;
    const resolve = this.resolveTurn;
    const reject = this.rejectTurn;
    const turnId = this.currentTurnId;
    this.currentTurnId = undefined;
    this.turnPromise = undefined;
    this.resolveTurn = undefined;
    this.rejectTurn = undefined;
    if (error) {
      // Chat-lane quota write-back (same seam as the ACP sessions): a quota
      // or auth failure marks the BOUND pool row so the next resolution
      // skips it. Guarded so bookkeeping can never replace the turn failure
      // or break its rejection below.
      try {
        const observed = this.input.onPromptError?.(error);
        if (observed && typeof (observed as Promise<void>).catch === "function") {
          void (observed as Promise<void>).catch((callbackError) => {
            console.warn("[antigravity] prompt error observer failed:", callbackError);
          });
        }
      } catch (callbackError) {
        console.warn("[antigravity] prompt error observer failed:", callbackError);
      }
      if (turnId) {
        const displayMessage = explainNativeNetworkError(error, "Antigravity") ?? error.message;
        if (
          emitError &&
          !isRetryableCapacityError(displayMessage) &&
          !isRetryableCapacityError(error.message)
        ) {
          this.emitRuntime({
            type: "error",
            threadId: this.input.threadId,
            // Display-only projection: the rejection below keeps the original
            // error so quota/auth matching never sees rewritten text.
            message: displayMessage,
          });
        }
        this.emitRuntime({
          type: "turn.completed",
          threadId: this.input.threadId,
          turnId,
          state: "failed",
        });
      }
      reject?.(error);
    } else {
      resolve?.();
    }
  }
}

export function createAntigravityStructuredSession(
  input: CreateStructuredSessionInput,
  options: AntigravityStructuredSessionOptions,
): StructuredSessionHandle {
  return new AntigravityStructuredSession(input, options);
}
