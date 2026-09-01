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
import { buildAntigravityArgs } from "./argv";

interface AntigravityStructuredSessionOptions {
  supportsSeparateModelEffort: boolean;
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

    this.providerSessionId = sessionRef?.providerSessionId;
    const args = buildAntigravityArgs(
      config,
      "",
      this.providerSessionId,
      this.options.supportsSeparateModelEffort,
      this.options.defaultModel,
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
      ...(this.input.baseSpawnEnv ?? {}),
      ...(this.input.projectLocation.kind === "wsl" ? { BROWSER: "/bin/true" } : {}),
      ...(this.input.env ?? {}),
      ...(this.projection?.env ?? {}),
    };
    const command = buildAgentCommand(
      this.input.projectLocation,
      "agy",
      buildAntigravityStreamArgs(args),
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

  async startTurn(
    prompt: string,
    _config: ThreadConfig,
    segments?: PromptSegment[],
    options?: StartTurnOptions,
  ): Promise<void> {
    if (this.disposed || !this.transport) throw new Error("Antigravity session is not open.");
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
      this.transport.send({ event: "user", message: { content: effectivePrompt } });
    } catch (error) {
      this.finishTurn(error instanceof Error ? error : new Error(String(error)));
    }
    return turnPromise;
  }

  async interruptTurn(): Promise<void> {
    if (!this.transport || !this.currentTurnId) return;
    this.transport.interrupt();
    this.emitRuntime({
      type: "turn.completed",
      threadId: this.input.threadId,
      turnId: this.currentTurnId,
      state: "interrupted",
    });
    this.finishTurn();
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
      this.finishTurn(failure ? new Error(failure) : undefined, failure === undefined);
    }
  }

  private handleDiagnostic(diagnostic: NativeHarnessDiagnostic): void {
    if (diagnostic.code === "NATIVE_STDERR") return;
    if (this.currentTurnId) this.finishTurn(new Error(diagnostic.message));
    else if (this.listener) this.listener.onError(diagnostic.message);
    else this.pendingError = diagnostic.message;
  }

  private handleProcessExit(event: NativeProcessExit): void {
    if (this.disposed) return;
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
      if (turnId) {
        if (emitError) {
          this.emitRuntime({
            type: "error",
            threadId: this.input.threadId,
            message: error.message,
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
