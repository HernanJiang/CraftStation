import { randomUUID } from "node:crypto";
import { resolveExecutablePath } from "@/supervisor/agents/base";
import { buildAntigravityModelArgs } from "@/supervisor/agents/antigravity/argv";
import {
  CraftPlan,
  CraftSession,
  CraftSessionStatus,
  Entity,
  HarnessRuntimeAdapter,
  NativeHarnessDescriptor,
  NativeHarnessDiagnostic,
  NativeEventEnvelope,
  RuntimeOverrides,
  SessionSnapshot,
  StartTurnCommand,
  TurnResult,
  TurnStatus,
  nativeRuntimeExecutionConfigForPlan,
  type NativeRuntimeExecutionConfig,
} from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import type { ProjectLocation, PromptSegment, ResolvedMcpServer } from "@/shared/contracts";
import { CraftingError } from "@/shared/crafting/errors";
import { inlinePromptSegmentText } from "@/shared/promptContent";
import { canonicalizeNativeEvent } from "./nativeEventCanonicalizer";
import {
  createAntigravityStreamTransport,
  createDeepSeekJsonRpcTransport,
  buildDeepSeekJsonRpcArgs,
  nativeProcessDiagnostic,
  type NdjsonProcessTransport,
  type NativeProcessExit,
  type NativeWireEvent,
} from "./nativeTransport";
import {
  createAntigravityMcpProjection,
  type AntigravityMcpProjection,
} from "./antigravityMcpProjection";

type NativeMode = "antigravity" | "deepseek";

const DEFAULT_DEEPSEEK_READINESS_TIMEOUT_MS = 15_000;
const DEFAULT_DEEPSEEK_SHUTDOWN_TIMEOUT_MS = 2_000;

function locationPath(location: ProjectLocation): string {
  return location.kind === "wsl" ? location.linuxPath : location.path;
}

function objectOptions(plan: CraftPlan): Record<string, unknown> {
  return plan.runtimeBinding.options ?? {};
}

function isDshCli(command: string): boolean {
  const normalized = command.toLowerCase().replace(/\\/g, "/");
  return (
    normalized.endsWith("/dsh") ||
    normalized.endsWith("/dsh.exe") ||
    normalized.endsWith("/dsh.cmd") ||
    normalized.endsWith("/dsh.ps1") ||
    normalized === "dsh"
  );
}

function executableFor(mode: NativeMode, plan: CraftPlan): string | undefined {
  const configured = objectOptions(plan).executablePath;
  if (typeof configured === "string" && configured.trim()) return configured;
  return mode === "antigravity"
    ? resolveExecutablePath("agy")
    : (resolveExecutablePath("dsh-jsonrpc-agent") ?? resolveExecutablePath("dsh"));
}

function effectiveOverrides(plan: CraftPlan): RuntimeOverrides {
  return plan.overrides ?? {};
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function deepSeekTerminalError(event: NativeWireEvent): CraftingError | undefined {
  if (event.type !== "session.event") return undefined;
  const params = recordValue(event.payload.params) ?? event.payload;
  const nativeEvent = recordValue(params.event);
  if (nativeEvent?.type !== "turn/end") return undefined;
  const data = recordValue(nativeEvent.data);
  const reason = recordValue(data?.reason);
  const reasonKind = typeof reason?.kind === "string" ? reason.kind : undefined;
  if (!reasonKind || !["error", "failed", "max-tokens", "blocked"].includes(reasonKind))
    return undefined;

  const providerError = recordValue(reason?.failure) ?? recordValue(reason?.error);
  const providerCode =
    typeof providerError?.code === "string" || typeof providerError?.code === "number"
      ? String(providerError.code)
      : undefined;
  const status = typeof providerError?.status === "number" ? providerError.status : undefined;
  const providerMessage =
    typeof providerError?.message === "string" ? providerError.message : undefined;
  if (
    status === 401 ||
    providerCode === "AUTH" ||
    /auth|api key|credential/iu.test(providerMessage ?? "")
  ) {
    return CraftingError.authRequired(
      "deepseek",
      "Configure a valid DEEPSEEK_API_KEY for the official DeepSeek Harness runtime.",
    );
  }

  return CraftingError.executionFailed(
    "The official DeepSeek Harness turn failed.",
    {
      ...(providerCode ? { providerCode } : {}),
      ...(status !== undefined ? { status } : {}),
      reason: reasonKind,
    },
    "Inspect the DeepSeek Harness diagnostic and retry after the provider error is resolved.",
  );
}

class NativeProcessCraftSession implements CraftSession {
  private _status: CraftSessionStatus = "idle";
  private _turnId: string | undefined;
  private _turnPromise: Promise<TurnResult> | undefined;
  private _resolveTurn: ((result: TurnResult) => void) | undefined;
  private _rejectTurn: ((error: unknown) => void) | undefined;
  private _response = "";
  private _disposed = false;
  private _sessionExited = false;
  private _terminating = false;
  private _nativeSessionRef: string | undefined;
  private _abortCleanup: (() => void) | undefined;
  private _turnEventsStart = 0;
  private readonly _events: RuntimeEvent[] = [];
  private readonly _nativeEvents: NativeEventEnvelope[] = [];
  private readonly _diagnostics: NativeHarnessDiagnostic[] = [];
  private readonly _listeners = new Set<(event: RuntimeEvent, snapshot: SessionSnapshot) => void>();
  private readonly _explicitNativeSessionRef: string | undefined;

  constructor(
    readonly id: string,
    readonly entityId: string,
    private readonly descriptor: NativeHarnessDescriptor,
    private readonly transport: NdjsonProcessTransport,
    readonly threadId: string,
    private readonly mode: NativeMode,
    private readonly plan: CraftPlan,
    private readonly runtimeConfig: NativeRuntimeExecutionConfig,
    private readonly cwd: string,
    nativeSessionRef?: string,
    private readonly onTerminated?: (session: NativeProcessCraftSession) => void,
    private readonly skillSegments?: readonly PromptSegment[],
    private readonly inlineSkillInstructions?: string,
  ) {
    this._explicitNativeSessionRef = nativeSessionRef;
    this._nativeSessionRef = nativeSessionRef ?? (mode === "deepseek" ? "main" : undefined);
    transport.setEventHandler((event) => this.onWireEvent(event));
    transport.start();
  }

  get status(): CraftSessionStatus {
    return this._status;
  }
  get sessionRef(): string | undefined {
    return this._nativeSessionRef;
  }
  get nativeSessionRef(): string | undefined {
    return this._nativeSessionRef;
  }
  getDiagnostics(): readonly NativeHarnessDiagnostic[] {
    return [...this._diagnostics];
  }
  /** Internal Supervisor view; this config is never sent to the provider wire. */
  getRuntimeConfig(): NativeRuntimeExecutionConfig {
    return this.runtimeConfig;
  }
  addDiagnostic(record: NativeHarnessDiagnostic): void {
    this._diagnostics.push(record);
  }

  async initializeDeepSeek(): Promise<void> {
    if (this.mode !== "deepseek") return;
    const options = objectOptions(this.plan);
    const timeoutMs =
      typeof options.readinessTimeoutMs === "number" && options.readinessTimeoutMs > 0
        ? options.readinessTimeoutMs
        : DEFAULT_DEEPSEEK_READINESS_TIMEOUT_MS;
    const result = await this.transport.sendRequest(
      {
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "initialize",
        params: {
          cwd: this.cwd,
          provider: "deepseek-official",
          model: effectiveOverrides(this.plan).model ?? this.plan.runtimeBinding.modelId,
        },
      },
      { timeoutMs },
    );
    const resultBody = result.result;
    if (resultBody && typeof resultBody === "object" && !Array.isArray(resultBody)) {
      const providerSessionId = (resultBody as Record<string, unknown>).sessionId;
      if (
        !this._explicitNativeSessionRef &&
        typeof providerSessionId === "string" &&
        providerSessionId.trim()
      ) {
        this._nativeSessionRef = providerSessionId;
      }
    }
    this.emit({ type: "session.started", threadId: this.threadId });
  }

  getSnapshot(): SessionSnapshot {
    return {
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      status: this._status,
      activeTurnId: this._turnId,
      activeTurnStatus: this._turnId ? "running" : undefined,
      events: [...this._events],
      ...(this.nativeSessionRef ? { nativeSessionRef: this.nativeSessionRef } : {}),
      nativeEvents: [...this._nativeEvents],
      diagnostics: [...this._diagnostics],
      runtimeConfig: this.runtimeConfig,
      effectiveOverrides: effectiveOverrides(this.plan),
    };
  }

  subscribe(listener: (event: RuntimeEvent, snapshot: SessionSnapshot) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private emit(event: RuntimeEvent): void {
    const next = {
      ...event,
      nativeEnvelope: {
        ...(event.nativeEnvelope ?? {}),
        correlationId: this.transport.correlationId,
      },
    } as RuntimeEvent;
    this._events.push(next);
    if (next.nativeEnvelope) this._nativeEvents.push(next.nativeEnvelope);
    const snapshot = this.getSnapshot();
    for (const listener of this._listeners) listener(next, snapshot);
  }

  private onWireEvent(event: NativeWireEvent): void {
    if (event.type === "jsonrpc.response") {
      return;
    }
    if (
      this.mode === "antigravity" &&
      !this._explicitNativeSessionRef &&
      event.type === "init" &&
      typeof event.payload.conversation_id === "string" &&
      event.payload.conversation_id.trim()
    ) {
      this._nativeSessionRef = event.payload.conversation_id;
    }
    const turnId = this._turnId ?? `turn:${randomUUID()}`;
    const terminalError = this.mode === "deepseek" ? deepSeekTerminalError(event) : undefined;
    const canonicalEvents = canonicalizeNativeEvent({
      descriptor: this.descriptor,
      threadId: this.threadId,
      turnId,
      correlationId: this.transport.correlationId,
      event,
    });
    const events =
      event.type === "result" && this._response.length > 0
        ? canonicalEvents.filter(
            (next) => !(next.type === "content.delta" && next.stream === "assistant_text"),
          )
        : canonicalEvents;
    for (const next of events) {
      if (
        next.type === "turn.started" &&
        this._events.some(
          (record) =>
            record.type === "turn.started" && (record as Record<string, unknown>).turnId === turnId,
        )
      ) {
        continue;
      }
      // Antigravity emits streamed text and then repeats the complete answer
      // in its terminal `result` event. Keep the canonical result useful when
      // a provider only emits `result`, but do not double-count the streamed
      // response when both forms are present.
      if (
        next.type === "content.delta" &&
        next.stream === "assistant_text" &&
        (event.type !== "result" || this._response.length === 0)
      ) {
        this._response += next.delta;
      }
      this.emit(next);
      if (next.type === "turn.completed") {
        this.finishTurn(
          next.state === "completed" ? "completed" : next.state,
          next.state === "failed" ? terminalError : undefined,
        );
      }
      if (next.type === "session.exited") {
        this.finalizeSessionExit(next.reason ?? "provider-exited", true);
      }
    }
  }

  private failTurn(error: Error): void {
    this._diagnostics.push({
      code: "NATIVE_EXECUTION_FAILED",
      harnessKind: this.descriptor.harnessKind,
      phase: "turn",
      operation: "native-response",
      message: error.message,
      occurredAt: new Date().toISOString(),
    });
    this.emit({
      type: "error",
      threadId: this.threadId,
      message: "Native provider execution failed.",
    });
    this.finishTurn("failed", error);
  }

  private finishTurn(status: TurnStatus, error?: Error): void {
    if (!this._turnId || !this._turnPromise) return;
    const turnId = this._turnId;
    this._abortCleanup?.();
    this._abortCleanup = undefined;
    this._turnId = undefined;
    this._turnPromise = undefined;
    if (this._status !== "terminated") {
      this._status = error ? "error" : "idle";
    }
    const hasCompletedEvent = this._events.some(
      (e) => e.type === "turn.completed" && (e as Record<string, unknown>).turnId === turnId,
    );
    if (!hasCompletedEvent) {
      this.emit({
        type: "turn.completed",
        threadId: this.threadId,
        turnId,
        state:
          status === "interrupted"
            ? "interrupted"
            : status === "cancelled"
              ? "cancelled"
              : status === "failed"
                ? "failed"
                : "completed",
      });
    }
    const result: TurnResult = {
      turnId,
      status,
      events: this._events.slice(this._turnEventsStart),
      ...(this._response ? { response: this._response } : {}),
      ...(error ? { error: error.message } : {}),
    };
    const resolve = this._resolveTurn;
    const reject = this._rejectTurn;
    this._resolveTurn = undefined;
    this._rejectTurn = undefined;
    if (error) {
      reject?.(
        error instanceof CraftingError
          ? error
          : CraftingError.executionFailed(error.message, { turnId }),
      );
    } else resolve?.(result);
  }

  private finalizeSessionExit(
    reason: string,
    eventAlreadyEmitted = false,
    error?: Error,
    turnStatus: TurnStatus = error ? "failed" : "cancelled",
  ): void {
    if (this._sessionExited) return;
    this._sessionExited = true;
    if (this._turnId) this.finishTurn(turnStatus, error);
    this._disposed = true;
    this.transport.dispose();
    this._status = "terminated";
    if (!eventAlreadyEmitted) {
      this.emit({ type: "session.exited", threadId: this.threadId, reason });
    }
    this.onTerminated?.(this);
    this._listeners.clear();
  }

  handleProcessExit(event: NativeProcessExit): void {
    const activeTurn = this._turnId !== undefined;
    const expectedExit = this._terminating || this._disposed;
    const failedExit = !event.cleanExit || activeTurn;
    const error = failedExit
      ? CraftingError.executionFailed("Native provider process exited unexpectedly.", {
          code: event.code,
          signal: event.signal,
        })
      : undefined;
    this.finalizeSessionExit(
      expectedExit ? "normal" : failedExit ? "process-crashed" : "process-exited",
      false,
      error,
    );
  }

  private sendAntigravity(prompt: string): void {
    this.transport.send({ event: "user", message: { content: prompt } });
  }

  private sendDeepSeek(prompt: string, signal?: AbortSignal): void {
    const sessionId = this._nativeSessionRef ?? "main";
    void this.transport
      .sendRequest(
        {
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "session/prompt",
          params: { sessionId, contentBlocks: [{ type: "text", text: prompt }] },
        },
        signal ? { signal } : undefined,
      )
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        this.failTurn(new Error(publicError(error)));
      });
  }

  async startTurn(command: StartTurnCommand): Promise<TurnResult> {
    if (this._disposed || this._status === "terminated") {
      throw CraftingError.executionFailed("Cannot use a disposed or terminated native session.");
    }
    if (this._turnId) throw CraftingError.executionFailed("A native turn is already active.");
    this._turnId = command.turnId ?? `turn:${randomUUID()}`;
    this._turnEventsStart = this._events.length;
    this._response = "";
    this._status = "busy";
    this.emit({ type: "turn.started", threadId: this.threadId, turnId: this._turnId });
    this._turnPromise = new Promise<TurnResult>((resolve, reject) => {
      this._resolveTurn = resolve;
      this._rejectTurn = reject;
    });
    const turnPromise = this._turnPromise;
    if (command.signal) {
      const onAbort = () => {
        this.transport.interrupt();
        if (process.platform === "win32") {
          this.finalizeSessionExit("interrupted", false, undefined, "interrupted");
          return;
        }
        this.finishTurn("interrupted");
      };
      this._abortCleanup = () => command.signal?.removeEventListener("abort", onAbort);
      if (command.signal.aborted) {
        onAbort();
        return turnPromise;
      }
      command.signal.addEventListener("abort", onAbort, { once: true });
    }
    const skillPrompt = [
      ...(this.skillSegments ?? []).map(inlinePromptSegmentText),
      ...(this.inlineSkillInstructions ? [this.inlineSkillInstructions] : []),
    ]
      .filter(Boolean)
      .join("\n\n");
    const effectivePrompt = skillPrompt ? `${command.prompt}\n\n${skillPrompt}` : command.prompt;
    try {
      if (this.mode === "antigravity") this.sendAntigravity(effectivePrompt);
      else this.sendDeepSeek(effectivePrompt, command.signal);
    } catch (error) {
      this.failTurn(new Error(publicError(error)));
    }
    return turnPromise;
  }

  async interrupt(): Promise<void> {
    this.transport.interrupt();
    if (process.platform === "win32") {
      // On Windows, child.kill() terminates the process.
      // Mark session as terminated so subsequent turns do not attempt to write to a dead process.
      this.finalizeSessionExit("interrupted", false, undefined, "interrupted");
      return;
    }
    this.finishTurn("interrupted");
  }

  async terminate(): Promise<void> {
    if (this._disposed) return;
    this._abortCleanup?.();
    this._abortCleanup = undefined;
    this.finishTurn("cancelled");
    this._terminating = true;
    if (this.mode === "deepseek") {
      const options = objectOptions(this.plan);
      const timeoutMs =
        typeof options.cleanupTimeoutMs === "number" && options.cleanupTimeoutMs > 0
          ? options.cleanupTimeoutMs
          : DEFAULT_DEEPSEEK_SHUTDOWN_TIMEOUT_MS;
      try {
        await this.transport.sendRequest(
          {
            jsonrpc: "2.0",
            id: randomUUID(),
            method: "shutdown",
          },
          { timeoutMs },
        );
      } catch {
        // The provider may already have exited; disposal below remains authoritative.
      }
    }
    // The DSH protocol requires shutdown to be sent while the stdio transport
    // is still live. Marking the session disposed before the request would
    // make NdjsonProcessTransport reject it locally and skip the wire frame.
    this.finalizeSessionExit("normal");
  }

  disposeAfterReadinessFailure(): void {
    if (this._disposed) return;
    this._abortCleanup?.();
    this._abortCleanup = undefined;
    this._disposed = true;
    this.transport.dispose();
    this._status = "terminated";
    this.onTerminated?.(this);
    this._listeners.clear();
  }

  handleDiagnostic(record: NativeHarnessDiagnostic): void {
    this.addDiagnostic(record);
    if (record.code === "NATIVE_STDERR") return;
    if (
      [
        "RUNTIME_UNAVAILABLE",
        "NATIVE_PROCESS_CRASHED",
        "PROTOCOL_MISMATCH",
        "NATIVE_EXECUTION_FAILED",
      ].includes(record.code) &&
      this._turnId
    ) {
      this.failTurn(new Error("Native provider process exited unexpectedly."));
    }
  }
  async sendPrompt(
    prompt: string,
    onEvent?: (event: RuntimeEvent) => void,
  ): Promise<{ response: string; events: RuntimeEvent[]; error?: string }> {
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

export interface NativeProcessHarnessRuntimeAdapterOptions {
  descriptor: NativeHarnessDescriptor;
  projectLocation: ProjectLocation;
  mode: NativeMode;
  runtimeCommand?: string;
  runtimeArgs?: readonly string[];
  runtimeEnv?: Record<string, string>;
  profileRef?: string;
  spawnProcess?: typeof import("node:child_process").spawn;
  onDiagnostic?: (diagnostic: NativeHarnessDiagnostic) => void;
  skillSegments?: readonly PromptSegment[];
  inlineSkillInstructions?: string;
  mcpServers?: readonly ResolvedMcpServer[];
}

export class NativeProcessHarnessRuntimeAdapter implements HarnessRuntimeAdapter {
  readonly id: string;
  readonly harnessKind: string;
  readonly descriptor: NativeHarnessDescriptor;
  private readonly diagnostics: NativeHarnessDiagnostic[] = [];
  private readonly sessions = new Set<NativeProcessCraftSession>();
  private readonly transports = new Set<NdjsonProcessTransport>();

  constructor(private readonly options: NativeProcessHarnessRuntimeAdapterOptions) {
    this.id = options.descriptor.id;
    this.harnessKind = options.descriptor.harnessKind;
    this.descriptor = options.descriptor;
  }
  supports(plan: CraftPlan): boolean {
    return plan.runtimeBinding.harnessKind === this.harnessKind;
  }
  getDiagnostics(): readonly NativeHarnessDiagnostic[] {
    return [...this.diagnostics];
  }
  getActiveSessions(): readonly CraftSession[] {
    return [...this.sessions];
  }
  getLifecycleSnapshot(): {
    activeSessions: number;
    activeTransports: number;
    runningProcesses: number;
    pendingRequests: number;
  } {
    return {
      activeSessions: this.sessions.size,
      activeTransports: this.transports.size,
      runningProcesses: [...this.transports].filter((transport) => transport.isProcessRunning)
        .length,
      pendingRequests: [...this.transports].reduce(
        (total, transport) => total + transport.pendingRequestCount,
        0,
      ),
    };
  }

  async spawnEntity(plan: CraftPlan): Promise<Entity> {
    if (!this.supports(plan))
      throw CraftingError.runtimeUnavailable(
        this.harnessKind,
        "Native adapter does not support this CraftPlan.",
      );
    if (this.options.mode === "deepseek") {
      const options = objectOptions(plan);
      const configPath =
        typeof options.configPath === "string" && options.configPath.trim()
          ? options.configPath.trim()
          : process.env.DSH_CORDIS_CONFIG?.trim();
      if (!configPath) {
        const record = nativeProcessDiagnostic(
          this.harnessKind,
          "Official DSH runtime requires an explicit Cordis config path (no synthetic Entity created).",
        );
        this.diagnostics.push(record);
        this.options.onDiagnostic?.(record);
        throw CraftingError.runtimeUnavailable(this.harnessKind, record.message);
      }
    }
    return {
      id: `entity:${this.harnessKind}:${randomUUID()}`,
      resultItemId: plan.resultItemId,
      craftPlan: plan,
      status: "spawned",
      createdAt: new Date().toISOString(),
      nativeHarness: this.descriptor,
      metadata: { vendor: plan.runtimeBinding.vendor, modelId: plan.runtimeBinding.modelId },
    };
  }
  async createSession(entity: Entity): Promise<CraftSession> {
    return this.openSession(entity);
  }
  async resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession> {
    return this.openSession(entity, sessionRef);
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.sessions].map((session) => session.terminate()));
    for (const transport of [...this.transports]) transport.dispose();
    this.sessions.clear();
    this.transports.clear();
  }

  private async openSession(entity: Entity, sessionRef?: string): Promise<CraftSession> {
    const command =
      this.options.runtimeCommand ?? executableFor(this.options.mode, entity.craftPlan);
    if (!command) {
      const record = nativeProcessDiagnostic(
        this.harnessKind,
        `Official ${this.harnessKind} runtime executable was not discovered.`,
      );
      this.diagnostics.push(record);
      this.options.onDiagnostic?.(record);
      throw CraftingError.runtimeUnavailable(this.harnessKind, record.message);
    }
    const options = objectOptions(entity.craftPlan);
    const runtimeConfig = nativeRuntimeExecutionConfigForPlan(entity.craftPlan);
    const args: string[] = [];
    if (this.options.mode === "antigravity") {
      args.push(
        ...buildAntigravityModelArgs(runtimeConfig.model, runtimeConfig.reasoningEffort),
        ...(runtimeConfig.approvalPolicy === "never" ? ["--dangerously-skip-permissions"] : []),
        ...(sessionRef ? ["--conversation", sessionRef] : []),
        ...(this.options.runtimeArgs ?? []),
      );
    } else {
      const configPath =
        typeof options.configPath === "string" && options.configPath.trim()
          ? options.configPath.trim()
          : process.env.DSH_CORDIS_CONFIG?.trim();
      if (!configPath) {
        // dsh-jsonrpc-agent and dsh JSON-RPC runtime strictly require an explicit Cordis configuration
        // containing the JSON-RPC server plugin. Without it, fail-closed with RUNTIME_UNAVAILABLE.
        const record = nativeProcessDiagnostic(
          this.harnessKind,
          "Official DSH runtime requires an explicit Cordis config path (no synthetic Entity created).",
        );
        this.diagnostics.push(record);
        this.options.onDiagnostic?.(record);
        throw CraftingError.runtimeUnavailable(this.harnessKind, record.message);
      }
      if (isDshCli(command)) {
        const profile =
          this.options.profileRef ??
          (typeof options.profile === "string" ? options.profile : undefined) ??
          "sdk";
        args.push(...buildDeepSeekJsonRpcArgs(profile, this.options.runtimeArgs ?? []));
        args.push("--patch", configPath);
      } else {
        args.push(...(this.options.runtimeArgs ?? []));
        args.push(configPath);
      }
    }
    let session: NativeProcessCraftSession | undefined;
    let antigravityMcpProjection: AntigravityMcpProjection | undefined;
    if (this.options.mode === "antigravity") {
      try {
        antigravityMcpProjection = createAntigravityMcpProjection(this.options.mcpServers ?? []);
      } catch (error) {
        const record = nativeProcessDiagnostic(this.harnessKind, publicError(error));
        this.diagnostics.push(record);
        this.options.onDiagnostic?.(record);
        throw CraftingError.runtimeUnavailable(this.harnessKind, record.message);
      }
    }
    const transport =
      this.options.mode === "antigravity"
        ? createAntigravityStreamTransport({
            harnessKind: this.harnessKind,
            command,
            cwd: locationPath(this.options.projectLocation),
            args,
            ...(this.options.runtimeEnv || antigravityMcpProjection
              ? {
                  env: {
                    ...(this.options.runtimeEnv ?? {}),
                    ...(antigravityMcpProjection?.env ?? {}),
                  },
                }
              : {}),
            ...(this.options.spawnProcess ? { spawnProcess: this.options.spawnProcess } : {}),
            onEvent: () => undefined,
            onDiagnostic: (record) => {
              this.diagnostics.push(record);
              session?.handleDiagnostic(record);
            },
            onProcessExit: (event) => session?.handleProcessExit(event),
          })
        : createDeepSeekJsonRpcTransport({
            harnessKind: this.harnessKind,
            command,
            cwd: locationPath(this.options.projectLocation),
            args,
            env: {
              ...(this.options.runtimeEnv ?? {}),
              ...(typeof options.configPath === "string" && options.configPath.trim()
                ? { DSH_CORDIS_CONFIG: options.configPath.trim() }
                : {}),
            },
            ...(this.options.spawnProcess ? { spawnProcess: this.options.spawnProcess } : {}),
            onEvent: () => undefined,
            onDiagnostic: (record) => {
              this.diagnostics.push(record);
              session?.handleDiagnostic(record);
            },
            onProcessExit: (event) => session?.handleProcessExit(event),
          });
    this.transports.add(transport);
    session = new NativeProcessCraftSession(
      `sess:${this.harnessKind}:${randomUUID()}`,
      entity.id,
      this.descriptor,
      transport,
      entity.craftPlan.threadId ?? entity.id,
      this.options.mode,
      entity.craftPlan,
      runtimeConfig,
      locationPath(this.options.projectLocation),
      sessionRef,
      (terminatedSession) => {
        this.sessions.delete(terminatedSession);
        this.transports.delete(transport);
        antigravityMcpProjection?.dispose();
      },
      this.options.skillSegments,
      this.options.inlineSkillInstructions,
    );
    try {
      await session.initializeDeepSeek();
    } catch (error) {
      const protocolMismatch = session
        .getDiagnostics()
        .some((diagnostic) => diagnostic.code === "PROTOCOL_MISMATCH");
      const record = nativeProcessDiagnostic(this.harnessKind, publicError(error));
      this.diagnostics.push(record);
      session.handleDiagnostic(record);
      session.disposeAfterReadinessFailure();
      antigravityMcpProjection?.dispose();
      if (protocolMismatch) {
        throw CraftingError.protocolMismatch(
          this.harnessKind,
          "Official native runtime returned an incompatible machine protocol.",
        );
      }
      throw CraftingError.runtimeUnavailable(this.harnessKind, record.message);
    }
    this.sessions.add(session);
    entity.status = "running";
    return session;
  }
}
