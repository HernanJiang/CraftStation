import { randomUUID } from "node:crypto";
import type { spawn } from "node:child_process";
import type {
  PromptSegment,
  RuntimeEvent,
  SessionRef,
  ThreadAttention,
  ThreadConfig,
  ThreadStatus,
} from "@/shared/contracts";
import type { NativeHarnessDiagnostic } from "@/shared/crafting";
import { inlinePromptSegmentText } from "@/shared/promptContent";
import {
  NdjsonProcessTransport,
  type NativeProcessExit,
  type NativeProcessTransportOptions,
  type NativeWireEvent,
} from "@/supervisor/runtime/nativeHarness/nativeTransport";
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
import { buildCommandCodePrintArgs } from "./argv";
import {
  createCommandCodeMapperState,
  mapCommandCodeFrame,
  type CommandCodeMapperState,
} from "./canonicalMapping";
import { detectCommandCodeInvalidSessionRef } from "./session";
import { isUuid } from "./sessionFiles";

interface CommandCodeStructuredSessionOptions {
  spawnProcess?: typeof spawn;
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
  if (event.type === "error") return { status: "error", attention: "none" };
  return null;
}

function effectivePrompt(
  prompt: string,
  segments: PromptSegment[] | undefined,
  options: StartTurnOptions | undefined,
): string {
  const extra = [
    ...(segments ?? []).map(inlinePromptSegmentText),
    ...(options?.inlineInstructions ? [options.inlineInstructions] : []),
  ]
    .filter(Boolean)
    .join("\n\n");
  return extra ? `${prompt}\n\n${extra}` : prompt;
}

function resumeIdFrom(sessionId: string | undefined): string | undefined {
  return sessionId && isUuid(sessionId) ? sessionId : undefined;
}

/**
 * Official Command Code headless session: one `-p --output-format json` process
 * per CraftStation turn, resumed with `--resume <sessionId>`. Not ACP, not a
 * TUI, and not a long-lived stdin protocol — the CLI exits after each print.
 */
export class CommandCodeStructuredSession implements StructuredSessionHandle {
  launchOptions: AgentLaunchOptions = { suppressResumeConfigOverrides: true };

  private listener: StructuredSessionListener | undefined;
  private transport: NdjsonProcessTransport | undefined;
  private providerSessionId: string | undefined;
  private currentTurnId: string | undefined;
  private turnPromise: Promise<void> | undefined;
  private resolveTurn: (() => void) | undefined;
  private rejectTurn: ((error: Error) => void) | undefined;
  private mapper: CommandCodeMapperState = createCommandCodeMapperState();
  private bufferedEvents: RuntimeEvent[] = [];
  private bufferedUpdates: Array<{
    status: ThreadStatus;
    attention: ThreadAttention;
    sessionRef?: SessionRef;
  }> = [];
  private disposed = false;
  private pendingError: string | undefined;
  private pendingClose = false;
  private retriedInvalidResume = false;
  private turnGeneration = 0;

  constructor(
    private readonly input: CreateStructuredSessionInput,
    private readonly options: CommandCodeStructuredSessionOptions = {},
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
    if (this.disposed) throw new Error("Command Code session was disposed before activation.");
  }

  async openThread(_config: ThreadConfig, sessionRef?: SessionRef): Promise<string | undefined> {
    if (this.disposed) throw new Error("Command Code session was disposed before opening.");
    this.providerSessionId = sessionRef?.providerSessionId ?? this.providerSessionId;
    if (this.providerSessionId) {
      this.launchOptions = { ...this.launchOptions, resumeThreadId: this.providerSessionId };
    }
    this.emitUpdate({
      status: "idle",
      attention: "none",
      ...(this.providerSessionId
        ? { sessionRef: createKnownSessionRef(this.providerSessionId) }
        : {}),
    });
    return this.providerSessionId;
  }

  async startTurn(
    prompt: string,
    config: ThreadConfig,
    segments?: PromptSegment[],
    options?: StartTurnOptions,
  ): Promise<void> {
    if (this.disposed) throw new Error("Command Code session is not open.");
    if (this.currentTurnId) throw new Error("A Command Code turn is already active.");
    this.currentTurnId = options?.turnId ?? `turn:${randomUUID()}`;
    this.mapper = createCommandCodeMapperState();
    this.retriedInvalidResume = false;
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
    this.spawnPrintTurn(effectivePrompt(prompt, segments, options), config);
    return turnPromise;
  }

  async interruptTurn(): Promise<void> {
    if (!this.currentTurnId) return;
    this.turnGeneration += 1;
    this.transport?.interrupt();
    this.emitRuntime({
      type: "turn.completed",
      threadId: this.input.threadId,
      turnId: this.currentTurnId,
      state: "interrupted",
    });
    this.finishTurn();
    this.clearTransport();
  }

  forceCompleteTurn(): void {
    if (!this.currentTurnId) return;
    this.turnGeneration += 1;
    this.emitRuntime({
      type: "turn.completed",
      threadId: this.input.threadId,
      turnId: this.currentTurnId,
      state: "cancelled",
    });
    this.finishTurn();
    this.clearTransport();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.turnGeneration += 1;
    if (this.currentTurnId) {
      this.emitRuntime({
        type: "turn.completed",
        threadId: this.input.threadId,
        turnId: this.currentTurnId,
        state: "cancelled",
      });
      this.finishTurn();
    }
    this.clearTransport();
    if (this.listener) this.listener.onClose();
    else this.pendingClose = true;
  }

  private spawnPrintTurn(prompt: string, config: ThreadConfig): void {
    const generation = ++this.turnGeneration;
    const resume = resumeIdFrom(this.providerSessionId);
    const args = buildCommandCodePrintArgs(config, prompt, resume);
    const env = {
      ...(this.input.baseSpawnEnv ?? {}),
      ...(this.input.env ?? {}),
    };
    const command = buildAgentCommand(
      this.input.projectLocation,
      "command-code",
      args,
      resolveAgentBinaryPath(this.input.projectLocation, "command-code"),
      env,
    );
    const transportOptions: NativeProcessTransportOptions = {
      harnessKind: "commandcode",
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
      onDiagnostic: (diagnostic) => {
        if (generation !== this.turnGeneration) return;
        this.handleDiagnostic(diagnostic);
      },
      onProcessExit: (event) => {
        if (generation !== this.turnGeneration) return;
        this.handleProcessExit(event, prompt, config);
      },
    };
    this.transport = new NdjsonProcessTransport(transportOptions);
    this.transport.setEventHandler((event) => {
      if (generation !== this.turnGeneration) return;
      this.handleWireEvent(event, prompt, config);
    });
    this.transport.start();
  }

  private handleWireEvent(event: NativeWireEvent, prompt: string, config: ThreadConfig): void {
    if (!this.currentTurnId || this.disposed) return;
    const mapped = mapCommandCodeFrame({
      threadId: this.input.threadId,
      turnId: this.currentTurnId,
      event,
      state: this.mapper,
    });
    if (this.shouldRetryInvalidResume(mapped.errorMessage, mapped.resultState)) {
      this.retryFreshTurn(prompt, config);
      return;
    }
    if (mapped.sessionId) this.rememberSession(mapped.sessionId);
    for (const runtimeEvent of mapped.events) this.emitRuntime(runtimeEvent);
    if (!mapped.resultState) return;
    this.finishTurn(
      mapped.resultState === "failed"
        ? new Error(mapped.errorMessage ?? "Command Code headless run failed.")
        : undefined,
      mapped.resultState !== "failed",
    );
    this.clearTransport();
  }

  private handleDiagnostic(diagnostic: NativeHarnessDiagnostic): void {
    if (diagnostic.code === "NATIVE_STDERR") return;
    if (this.mapper.receivedResult || this.disposed) return;
    if (this.currentTurnId) this.finishTurn(new Error(diagnostic.message));
    else if (this.listener) this.listener.onError(diagnostic.message);
    else this.pendingError = diagnostic.message;
  }

  private handleProcessExit(event: NativeProcessExit, prompt: string, config: ThreadConfig): void {
    if (this.disposed) return;
    this.transport = undefined;
    if (this.mapper.receivedResult || !this.currentTurnId) return;
    if (this.shouldRetryInvalidResume(this.mapper.lastError, "failed")) {
      this.retryFreshTurn(prompt, config);
      return;
    }
    this.finishTurn(
      new Error(
        this.mapper.lastError ??
          `Command Code process exited during a turn (${event.code ?? "null"}, ${event.signal ?? "none"}).`,
      ),
    );
  }

  private shouldRetryInvalidResume(
    errorMessage: string | undefined,
    resultState: string | undefined,
  ): boolean {
    return (
      resultState === "failed" &&
      Boolean(errorMessage) &&
      detectCommandCodeInvalidSessionRef(errorMessage ?? "") &&
      !this.retriedInvalidResume &&
      Boolean(resumeIdFrom(this.providerSessionId))
    );
  }

  private retryFreshTurn(prompt: string, config: ThreadConfig): void {
    this.retriedInvalidResume = true;
    this.turnGeneration += 1;
    this.providerSessionId = undefined;
    this.clearTransport();
    this.mapper = createCommandCodeMapperState();
    this.spawnPrintTurn(prompt, config);
  }

  private rememberSession(sessionId: string): void {
    this.providerSessionId = sessionId;
    this.launchOptions = { ...this.launchOptions, resumeThreadId: sessionId };
    this.emitUpdate({
      status: this.currentTurnId ? "working" : "idle",
      attention: this.currentTurnId ? "working" : "none",
      sessionRef: createKnownSessionRef(sessionId),
    });
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
        if (!this.mapper.receivedResult) {
          this.emitRuntime({
            type: "turn.completed",
            threadId: this.input.threadId,
            turnId,
            state: "failed",
          });
        }
      }
      reject?.(error);
    } else {
      resolve?.();
    }
  }

  private clearTransport(): void {
    const transport = this.transport;
    this.transport = undefined;
    transport?.dispose();
  }
}

export function createCommandCodeStructuredSession(
  input: CreateStructuredSessionInput,
  options: CommandCodeStructuredSessionOptions = {},
): StructuredSessionHandle {
  return new CommandCodeStructuredSession(input, options);
}
