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
import { antigravitySessionEnvForLocation } from "./detection";
import { ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR } from "@/supervisor/runtime/nativeHarness/descriptors";
import { canonicalizeNativeEvent } from "@/supervisor/runtime/nativeHarness/nativeEventCanonicalizer";
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

function finalResponseRemainder(streamed: string, response: string): string {
  if (!streamed) return response;
  if (response.startsWith(streamed)) return response.slice(streamed.length);
  if (streamed.endsWith(response)) return "";
  const maxOverlap = Math.min(streamed.length, response.length);
  for (let length = maxOverlap; length > 0; length -= 1) {
    if (streamed.endsWith(response.slice(0, length))) return response.slice(length);
  }
  return response;
}

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
  if (event.type === "error") return { status: "error", attention: "none" };
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
  private pendingError: string | undefined;
  private pendingClose = false;
  /**
   * Tool step indexes currently ACTIVE on the wire. `agy` closes every tool
   * step (DONE/ERROR) before a natural end of turn — including background
   * run_command steps, which transition when the task finishes. A SUCCESS
   * `result` with steps still ACTIVE means the print-mode wait was cut off
   * mid-task (its 5m default) and the leftover steps are never reported; the
   * session surfaces that instead of accepting the silent truncation.
   */
  private activeToolSteps = new Set<number>();
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
    const env = {
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
    } catch (error) {
      this.projection?.dispose();
      this.projection = undefined;
      throw error;
    }
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
    this.streamedAssistantText = "";
    this.activeToolSteps.clear();
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
    });
    for (const runtimeEvent of canonicalEvents) {
      if (runtimeEvent.type === "content.delta" && runtimeEvent.stream === "assistant_text") {
        if (event.type === "result") {
          const delta = finalResponseRemainder(this.streamedAssistantText, runtimeEvent.delta);
          if (delta) this.emitRuntime({ ...runtimeEvent, delta });
          continue;
        }
        this.streamedAssistantText += runtimeEvent.delta;
      }
      this.emitRuntime(runtimeEvent);
    }
    if (event.type === "result") {
      const failure = resultFailureMessage(event);
      if (!failure && this.activeToolSteps.size > 0) {
        this.emitRuntime({
          type: "warning",
          threadId: this.input.threadId,
          message:
            `Antigravity reported success but ended the turn with ` +
            `${this.activeToolSteps.size} tool step(s) still running — a long ` +
            `background wait was likely cut off mid-task. Background work may ` +
            `still finish; send a message to continue.`,
        });
      }
      this.activeToolSteps.clear();
      this.finishTurn(failure ? new Error(failure) : undefined, failure === undefined);
    }
  }

  private trackToolStep(event: NativeWireEvent): void {
    if (event.type !== "step_update") return;
    const step = event.payload.step_update;
    if (!step || typeof step !== "object" || Array.isArray(step)) return;
    const record = step as Record<string, unknown>;
    if (record.step_type !== "tool" || typeof record.step_index !== "number") return;
    if (record.state === "ACTIVE") {
      this.activeToolSteps.add(record.step_index);
    } else if (record.state === "DONE" || record.state === "ERROR") {
      this.activeToolSteps.delete(record.step_index);
    }
  }

  private handleDiagnostic(diagnostic: NativeHarnessDiagnostic): void {
    if (diagnostic.code === "NATIVE_STDERR") return;
    if (this.ignoringProcessExit && diagnostic.code === "NATIVE_PROCESS_CRASHED") return;
    if (this.currentTurnId) this.finishTurn(new Error(diagnostic.message));
    else if (this.listener) this.listener.onError(diagnostic.message);
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
      this.finishTurn(
        new Error(
          `Antigravity process exited during a turn (${event.code ?? "null"}, ${event.signal ?? "none"}).`,
        ),
      );
    }
    this.transport = undefined;
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
