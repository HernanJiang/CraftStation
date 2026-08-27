import { randomUUID } from "node:crypto";
import { spawn as spawnPty, type IPty } from "node-pty";
import type {
  CraftPlan,
  CraftSession,
  CraftSessionStatus,
  Entity,
  HarnessRuntimeAdapter,
  NativeEventEnvelope,
  NativeHarnessDescriptor,
  NativeHarnessDiagnostic,
  SessionSnapshot,
  StartTurnCommand,
  TurnResult,
  TurnStatus,
} from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import type { AccountBinding, ProjectLocation, ThreadConfig } from "@/shared/contracts";
import { CraftingError } from "@/shared/crafting/errors";
import {
  resolveLaunchSpec,
  type AgentAdapter,
  type AgentArgvSpec,
  type CommandSpec,
  type TerminalStatusHint,
} from "@/supervisor/agents/base";

function configForPlan(plan: CraftPlan): ThreadConfig {
  return {
    model: plan.overrides?.model ?? plan.runtimeBinding.modelId,
    ...(plan.overrides?.reasoningEffort ? { effort: plan.overrides.reasoningEffort } : {}),
    ...(plan.overrides?.approvalPolicy ? { approvalPolicy: plan.overrides.approvalPolicy } : {}),
  };
}

function cwdForLocation(location: ProjectLocation): string {
  return location.kind === "wsl" ? process.cwd() : location.path;
}

function diagnosticCode(error: unknown): NativeHarnessDiagnostic["code"] {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("RUNTIME_UNAVAILABLE")) return "RUNTIME_UNAVAILABLE";
  if (/auth|credential|sign[ -]?in|login/i.test(message)) return "AUTH_REQUIRED";
  if (/protocol|pty|spawn/i.test(message)) return "PROTOCOL_MISMATCH";
  if (/exit|crash/i.test(message)) return "NATIVE_PROCESS_CRASHED";
  return "NATIVE_EXECUTION_FAILED";
}

function makeDiagnostic(
  descriptor: NativeHarnessDescriptor,
  phase: NativeHarnessDiagnostic["phase"],
  operation: string,
  error: unknown,
  details?: Record<string, unknown>,
): NativeHarnessDiagnostic {
  return {
    code: diagnosticCode(error),
    harnessKind: descriptor.harnessKind,
    phase,
    operation,
    message: error instanceof Error ? error.message : String(error),
    ...(details ? { details } : {}),
    occurredAt: new Date().toISOString(),
  };
}

function withEnvelope(
  event: RuntimeEvent,
  descriptor: NativeHarnessDescriptor,
  providerSessionId: string | undefined,
  sequence: number,
): RuntimeEvent {
  return {
    ...event,
    nativeEnvelope: {
      harnessKind: descriptor.harnessKind,
      source: "canonical-adapter",
      nativeType: event.type,
      ...(providerSessionId ? { providerSessionId } : {}),
      sequence,
      receivedAt: new Date().toISOString(),
    },
  };
}

async function writeInput(pty: Pick<IPty, "write">, input: readonly string[]): Promise<void> {
  for (const part of input) {
    const wait = /^@wait:(\d+)$/u.exec(part);
    if (wait) {
      await new Promise<void>((resolve) => setTimeout(resolve, Number(wait[1])));
      continue;
    }
    pty.write(part);
  }
}

interface PtyTurn {
  turnId: string;
  response: string;
  eventsStart: number;
  sawWorking: boolean;
  settleTimer?: ReturnType<typeof setTimeout>;
  resolve: (result: TurnResult) => void;
  reject: (error: unknown) => void;
}

class PtyNativeCraftSession implements CraftSession {
  private _status: CraftSessionStatus = "idle";
  private _providerSessionId: string | undefined;
  private _turn: PtyTurn | undefined;
  private _disposed = false;
  private _sequence = 0;
  private readonly _events: RuntimeEvent[] = [];
  private readonly _nativeEvents: NativeEventEnvelope[] = [];
  private readonly _diagnostics: NativeHarnessDiagnostic[] = [];
  private readonly _listeners = new Set<
    (event: RuntimeEvent, snapshot: SessionSnapshot) => void
  >();
  private readonly _dataDisposable: { dispose(): void };
  private readonly _exitDisposable: { dispose(): void };

  constructor(
    readonly id: string,
    readonly entityId: string,
    readonly threadId: string,
    private readonly descriptor: NativeHarnessDescriptor,
    private readonly adapter: AgentAdapter,
    private readonly pty: IPty,
    private readonly config: ThreadConfig,
    providerSessionId: string | undefined,
    private readonly turnTimeoutMs: number,
  ) {
    this._providerSessionId = providerSessionId;
    this._dataDisposable = pty.onData((data) => this.handleData(data));
    this._exitDisposable = pty.onExit(({ exitCode, signal }) =>
      this.handleExit(exitCode, signal),
    );
  }

  get status(): CraftSessionStatus {
    return this._status;
  }

  get sessionRef(): string | undefined {
    return this._providerSessionId;
  }

  get nativeSessionRef(): string | undefined {
    return this._providerSessionId;
  }

  getDiagnostics(): readonly NativeHarnessDiagnostic[] {
    return [...this._diagnostics];
  }

  getSnapshot(): SessionSnapshot {
    return {
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      status: this._status,
      activeTurnId: this._turn?.turnId,
      activeTurnStatus: this._turn ? "running" : undefined,
      events: [...this._events],
      nativeSessionRef: this._providerSessionId,
      nativeEvents: [...this._nativeEvents],
      diagnostics: [...this._diagnostics],
      effectiveOverrides: {
        ...(this.config.model ? { model: this.config.model } : {}),
        ...(this.config.effort
          ? { reasoningEffort: this.config.effort as "low" | "medium" | "high" }
          : {}),
        ...(this.config.approvalPolicy
          ? {
              approvalPolicy: this.config.approvalPolicy as
                | "always"
                | "auto"
                | "never"
                | "on-demand",
            }
          : {}),
      },
    };
  }

  subscribe(listener: (event: RuntimeEvent, snapshot: SessionSnapshot) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private emit(event: RuntimeEvent): void {
    const next = withEnvelope(
      event,
      this.descriptor,
      this._providerSessionId,
      this._sequence++,
    );
    this._events.push(next);
    if (next.nativeEnvelope) this._nativeEvents.push(next.nativeEnvelope);
    const snapshot = this.getSnapshot();
    for (const listener of this._listeners) {
      try {
        listener(next, snapshot);
      } catch (error) {
        console.warn(`[native:${this.descriptor.harnessKind}] session listener failed`, error);
      }
    }
  }

  private handleData(data: string): void {
    if (!this._turn) return;
    this._turn.response += data;
    this.emit({
      type: "content.delta",
      threadId: this.threadId,
      itemId: `item:${this._turn.turnId}`,
      stream: "assistant_text",
      delta: data,
    });

    const hint = this.adapter.detectTerminalStatus?.(data);
    if (hint) this.applyStatusHint(hint);
  }

  private applyStatusHint(hint: TerminalStatusHint): void {
    if (!this._turn) return;
    if (hint.status === "working" || hint.attention === "working") {
      this._turn.sawWorking = true;
      this._status = "busy";
      return;
    }
    if (hint.status === "error" || hint.attention === "error") {
      this.finishTurn("failed", new Error("Native PTY reported an error state."));
      return;
    }
    if ((hint.status === "idle" || hint.status === "finished") && this._turn.sawWorking) {
      if (this._turn.settleTimer) clearTimeout(this._turn.settleTimer);
      this._turn.settleTimer = setTimeout(() => this.finishTurn("completed"), 30);
    }
  }

  private handleExit(exitCode: number, signal?: number): void {
    if (this._disposed) return;
    const error =
      exitCode === 0
        ? undefined
        : new Error(
            `${this.descriptor.label} native process exited with code ${exitCode}${
              signal !== undefined ? ` (signal ${signal})` : ""
            }.`,
          );
    if (this._turn) {
      this.finishTurn(error ? "failed" : "completed", error);
    }
    if (error) {
      this._diagnostics.push(
        makeDiagnostic(this.descriptor, "turn", "native-process-exit", error, { exitCode, signal }),
      );
      this._status = "error";
      this.emit({ type: "error", threadId: this.threadId, message: error.message });
    } else {
      this._status = "terminated";
    }
    this.emit({
      type: "session.exited",
      threadId: this.threadId,
      reason: error ? "native-process-error" : "native-process-exit",
    });
  }

  private finishTurn(status: TurnStatus, error?: Error): void {
    const turn = this._turn;
    if (!turn) return;
    this._turn = undefined;
    if (turn.settleTimer) clearTimeout(turn.settleTimer);
    this._status = error ? "error" : "idle";
    this.emit({
      type: "turn.completed",
      threadId: this.threadId,
      turnId: turn.turnId,
      state:
        status === "completed"
          ? "completed"
          : status === "interrupted"
            ? "interrupted"
            : status === "cancelled"
              ? "cancelled"
              : "failed",
    });
    const result: TurnResult = {
      turnId: turn.turnId,
      status,
      events: this._events.slice(turn.eventsStart),
      ...(turn.response ? { response: turn.response } : {}),
      ...(error ? { error: error.message } : {}),
    };
    if (error) turn.reject(CraftingError.executionFailed(error.message, { turnId: turn.turnId }));
    else turn.resolve(result);
  }

  async startTurn(command: StartTurnCommand): Promise<TurnResult> {
    if (this._disposed) {
      throw CraftingError.executionFailed(`Cannot use disposed ${this.descriptor.label}.`);
    }
    if (this._turn) {
      throw CraftingError.executionFailed(
        `A turn is already active in ${this.descriptor.label}.`,
        { sessionId: this.id },
      );
    }
    const turnId = command.turnId ?? `turn:${randomUUID()}`;
    const eventsStart = this._events.length;
    this._turn = {
      turnId,
      response: "",
      eventsStart,
      sawWorking: false,
      resolve: () => undefined,
      reject: () => undefined,
    };
    const activeTurn = this._turn;
    this._status = "busy";
    this.emit({ type: "turn.started", threadId: this.threadId, turnId });
    const userItemId = `user:${turnId}`;
    this.emit({
      type: "item.started",
      threadId: this.threadId,
      itemId: userItemId,
      itemType: "user_message",
      payload: { content: [{ kind: "text", text: command.prompt }] },
    });
    this.emit({ type: "item.completed", threadId: this.threadId, itemId: userItemId });

    const result = new Promise<TurnResult>((resolve, reject) => {
      activeTurn.resolve = resolve;
      activeTurn.reject = reject;
    });
    const input =
      this.adapter.buildDirectInput?.(command.prompt, undefined, this.config) ??
      [command.prompt, "\r"];
    if (command.signal?.aborted) {
      await this.interrupt(turnId);
      return result;
    }
    const onAbort = () => {
      void this.interrupt(turnId);
    };
    command.signal?.addEventListener("abort", onAbort, { once: true });
    if (this.turnTimeoutMs > 0) {
      activeTurn.settleTimer = setTimeout(() => {
        this._diagnostics.push(
          makeDiagnostic(this.descriptor, "turn", "turn-timeout", new Error("Native PTY turn timed out"), {
            turnId,
          }),
        );
        this.finishTurn("failed", new Error(`Turn timed out after ${this.turnTimeoutMs}ms.`));
      }, this.turnTimeoutMs);
    }
    try {
      await writeInput(this.pty, input);
    } catch (error) {
      command.signal?.removeEventListener("abort", onAbort);
      this.finishTurn("failed", error instanceof Error ? error : new Error(String(error)));
      return result;
    }
    command.signal?.removeEventListener("abort", onAbort);
    return result;
  }

  async interrupt(turnId?: string): Promise<void> {
    if (this._disposed) return;
    if (!this._turn || (turnId && this._turn.turnId !== turnId)) return;
    this.pty.write("\u0003");
    this.finishTurn("interrupted");
  }

  async terminate(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    if (this._turn) this.finishTurn("cancelled");
    this._dataDisposable.dispose();
    this._exitDisposable.dispose();
    try {
      this.pty.kill();
    } catch (error) {
      this._diagnostics.push(makeDiagnostic(this.descriptor, "dispose", "pty-kill", error));
    }
    this._status = "terminated";
    this._listeners.clear();
  }

  async sendPrompt(prompt: string, onEvent?: (event: RuntimeEvent) => void): Promise<{
    response: string;
    events: RuntimeEvent[];
    error?: string;
  }> {
    const unsubscribe = onEvent ? this.subscribe((event) => onEvent(event)) : undefined;
    try {
      const result = await this.startTurn({ prompt });
      return {
        response: result.response ?? "",
        events: [...result.events],
        ...(result.error ? { error: result.error } : {}),
      };
    } finally {
      unsubscribe?.();
    }
  }
}

export interface PtyNativeHarnessRuntimeAdapterOptions {
  adapter: AgentAdapter;
  descriptor: NativeHarnessDescriptor;
  projectLocation: ProjectLocation;
  accountBinding?: AccountBinding;
  profileRef?: string;
  turnTimeoutMs?: number;
  spawnPty?: (spec: CommandSpec, cwd: string) => IPty;
}

export class PtyNativeHarnessRuntimeAdapter implements HarnessRuntimeAdapter {
  readonly id: string;
  readonly harnessKind: string;
  readonly descriptor: NativeHarnessDescriptor;
  private readonly diagnostics: NativeHarnessDiagnostic[] = [];

  constructor(private readonly options: PtyNativeHarnessRuntimeAdapterOptions) {
    this.id = options.descriptor.id;
    this.harnessKind = options.descriptor.harnessKind;
    this.descriptor = options.descriptor;
  }

  supports(craftPlan: CraftPlan): boolean {
    return craftPlan.runtimeBinding.harnessKind === this.harnessKind;
  }

  getDiagnostics(): readonly NativeHarnessDiagnostic[] {
    return [...this.diagnostics];
  }

  async spawnEntity(craftPlan: CraftPlan): Promise<Entity> {
    if (!this.supports(craftPlan)) {
      throw CraftingError.runtimeUnavailable(
        craftPlan.runtimeBinding.harnessKind,
        `Native adapter '${this.harnessKind}' cannot execute this CraftPlan.`,
      );
    }
    return {
      id: `entity:${this.harnessKind}:${randomUUID()}`,
      resultItemId: craftPlan.resultItemId,
      craftPlan,
      status: "spawned",
      createdAt: new Date().toISOString(),
      nativeHarness: this.descriptor,
      metadata: {
        vendor: craftPlan.runtimeBinding.vendor,
        modelId: craftPlan.runtimeBinding.modelId,
        ...(craftPlan.runtimeBinding.profileRef
          ? { profileRef: craftPlan.runtimeBinding.profileRef }
          : {}),
        ...(this.options.accountBinding ? { accountBinding: this.options.accountBinding } : {}),
      },
    };
  }

  async createSession(entity: Entity): Promise<CraftSession> {
    return this.openSession(entity);
  }

  async resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession> {
    return this.openSession(entity, sessionRef);
  }

  private async openSession(entity: Entity, sessionRef?: string): Promise<CraftSession> {
    const config = configForPlan(entity.craftPlan);
    const argv: AgentArgvSpec = sessionRef
      ? this.options.adapter.buildResumeArgv(
          this.options.projectLocation,
          config,
          "",
          { providerSessionId: sessionRef, discoveredAt: new Date().toISOString() },
        )
      : this.options.adapter.buildLaunchArgv(
          this.options.projectLocation,
          config,
          "",
          undefined,
        );
    const spec = resolveLaunchSpec(this.options.projectLocation, argv);
    try {
      const pty = this.options.spawnPty
        ? this.options.spawnPty(spec, cwdForLocation(this.options.projectLocation))
        : spawnPty(spec.command, spec.args, {
            name: "xterm-color",
            cols: 120,
            rows: 40,
            cwd: spec.cwd ?? cwdForLocation(this.options.projectLocation),
            env: Object.fromEntries(
              Object.entries({ ...process.env, ...(spec.env ?? {}) }).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            ),
          });

      const providerSessionRef =
        argv.sessionRef?.providerSessionId ??
        (await this.options.adapter.discoverSessionRef?.(this.options.projectLocation))?.providerSessionId;
      entity.status = "running";
      return new PtyNativeCraftSession(
        `sess:${this.harnessKind}:${providerSessionRef ?? randomUUID()}`,
        entity.id,
        entity.craftPlan.threadId ?? entity.id,
        this.descriptor,
        this.options.adapter,
        pty,
        config,
        providerSessionRef,
        this.options.turnTimeoutMs ?? 120_000,
      );
    } catch (error) {
      this.diagnostics.push(
        makeDiagnostic(this.descriptor, sessionRef ? "resume" : "start", "spawn", error, {
          entityId: entity.id,
        }),
      );
      throw error instanceof CraftingError
        ? error
        : CraftingError.runtimeUnavailable(
            this.harnessKind,
            `Unable to start ${this.descriptor.label}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
    }
  }
}
