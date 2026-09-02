import { randomUUID } from "node:crypto";
import type { ProjectLocation } from "@/shared/contracts";
import type {
  CraftPlan,
  CraftRequestResolution,
  CraftSession,
  CraftSessionStatus,
  NativeEventEnvelope,
  NativeHarnessDiagnostic,
  RuntimeBinding,
  SessionSnapshot,
  StartTurnCommand,
  TurnResult,
  TurnStatus,
} from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { CraftingError } from "@/shared/crafting/errors";
import { mapOpenCodeNativeEvent, OpenCodeEventMapperState } from "./events";
import {
  OpenCodeNativeTransport,
  type OpenCodeNativeClient,
  type OpenCodeNativeConnection,
  type OpenCodeNativeTransportOptions,
} from "./transport";
import { buildOpenCodeNativeDiagnostic } from "./diagnostics";
import type { OpenCodeNativeServerLease } from "./serverPool";

interface PendingTurn {
  readonly turnId: string;
  readonly startIndex: number;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

export interface OpenCodeNativeSessionOptions {
  readonly entityId: string;
  readonly threadId: string;
  readonly projectLocation: ProjectLocation;
  readonly plan: CraftPlan;
  readonly sessionRef?: string | undefined;
  readonly transport?: OpenCodeNativeTransport | OpenCodeNativeServerLease | undefined;
  readonly transportFactory?:
    | ((options: OpenCodeNativeTransportOptions) => OpenCodeNativeTransport)
    | undefined;
  readonly onDiagnostic?: ((diagnostic: NativeHarnessDiagnostic) => void) | undefined;
}

function projectPath(location: ProjectLocation): string {
  return location.kind === "wsl" ? location.linuxPath : location.path;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function providerID(binding: RuntimeBinding): string {
  return binding.providerID ?? binding.vendor;
}

export function assertSupportedOpenCodePlanOptions(plan: CraftPlan): void {
  const configured = record(plan.runtimeBinding.options);
  const unsupportedOptions = Object.keys(configured).filter(
    (key) => key !== "permission" && key !== "agent",
  );
  const overrides = plan.overrides ?? {};
  const unsupportedOverrides = Object.keys(overrides).filter(
    (key) => key !== "model" && key !== "reasoningEffort",
  );
  if (unsupportedOptions.length === 0 && unsupportedOverrides.length === 0) return;
  const names = [...unsupportedOptions, ...unsupportedOverrides.map((name) => `override.${name}`)];
  throw CraftingError.runtimeUnavailable(
    "opencode",
    `OpenCode executable plan contains unsupported options: ${names.join(", ")}.`,
    "Configure these capabilities through a verified Supervisor resolver or remove them from the executable plan.",
  );
}

function safeRuntimeMetadata(plan: CraftPlan): Record<string, unknown> {
  const options = record(plan.runtimeBinding.options);
  const redact = (value: unknown, key = ""): unknown => {
    if (/(?:api[_ -]?key|token|cookie|password|secret|credential|authorization)/iu.test(key))
      return "[REDACTED]";
    if (Array.isArray(value)) return value.slice(0, 32).map((entry) => redact(entry));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .slice(0, 64)
          .map(([name, entry]) => [name, redact(entry, name)]),
      );
    }
    if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
    return value;
  };
  const safeOptions = redact(options) as Record<string, unknown>;
  return {
    craftstation: {
      harnessKind: plan.runtimeBinding.harnessKind,
      providerID: providerID(plan.runtimeBinding),
      modelID: plan.runtimeBinding.modelId,
      authConfigured: Boolean(plan.runtimeBinding.authRef),
      profileConfigured: Boolean(plan.runtimeBinding.profileRef),
      workspace: plan.workspace,
      overrides: plan.overrides,
      options: safeOptions,
    },
  };
}

function diagnostic(
  correlationId: string,
  operation: string,
  error: unknown,
  code: NativeHarnessDiagnostic["code"] = "NATIVE_EXECUTION_FAILED",
): NativeHarnessDiagnostic {
  return buildOpenCodeNativeDiagnostic({
    code,
    operation,
    message: error,
    correlationId,
  });
}

/** CraftStation-owned adapter around the official OpenCode HTTP/OpenAPI/SSE API. */
export class OpenCodeNativeSession implements CraftSession {
  private _status: CraftSessionStatus = "idle";
  private _providerSessionId: string | undefined;
  private readonly sessionId: string;
  private _activeTurnId: string | undefined;
  private _activeTurnStatus: TurnStatus | undefined;
  private _disposed = false;
  private _sequence = 0;
  private readonly _events: RuntimeEvent[] = [];
  private readonly _nativeEvents: NativeEventEnvelope[] = [];
  private readonly _diagnostics: NativeHarnessDiagnostic[] = [];
  private readonly _listeners = new Set<(event: RuntimeEvent, snapshot: SessionSnapshot) => void>();
  private readonly connection: OpenCodeNativeConnection;
  private unsubscribe: (() => void) | undefined;
  private pendingTurn: PendingTurn | undefined;
  private readonly responseParts: string[] = [];
  private readonly mapperState = new OpenCodeEventMapperState();

  // F43: Session model identity is frozen at creation time and sticky across turns.
  readonly effectiveProviderID: string;
  readonly effectiveModelID: string;

  private constructor(
    private readonly options: OpenCodeNativeSessionOptions,
    connection: OpenCodeNativeConnection,
    providerSessionId: string,
  ) {
    this.connection = connection;
    this._providerSessionId = providerSessionId;
    this.sessionId = `sess:opencode:${providerSessionId}`;
    const binding = options.plan.runtimeBinding;
    this.effectiveProviderID = providerID(binding);
    this.effectiveModelID = binding.modelId;

    this.unsubscribe = connection.subscribe((raw) => this.onNativeEvent(raw));
    this.emit({ type: "session.started", threadId: options.threadId });
  }

  static async open(options: OpenCodeNativeSessionOptions): Promise<OpenCodeNativeSession> {
    assertSupportedOpenCodePlanOptions(options.plan);
    const transport =
      options.transport ??
      (options.transportFactory ?? ((input) => new OpenCodeNativeTransport(input)))({
        projectLocation: options.projectLocation,
        ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
      });
    let connection: OpenCodeNativeConnection;
    try {
      connection = await transport.connect();
    } catch (error) {
      const diagnosticRecord = diagnostic(
        transport.correlationId,
        "transport.connect",
        error,
        "RUNTIME_UNAVAILABLE",
      );
      options.onDiagnostic?.(diagnosticRecord);
      throw new Error(`${diagnosticRecord.code}: ${diagnosticRecord.message}`, { cause: error });
    }
    const directory = options.plan.workspace ?? projectPath(options.projectLocation);
    const client = connection.client;
    try {
      let sessionID = options.sessionRef;
      if (sessionID) {
        const result = await client.session.get({ directory, sessionID });
        sessionID =
          typeof record(result.data).id === "string" ? String(record(result.data).id) : sessionID;
      } else {
        const runtimeBinding = options.plan.runtimeBinding;
        const createInput: Record<string, unknown> = {
          directory,
          title: `craftstation/${options.threadId.slice(0, 12)}`,
          metadata: safeRuntimeMetadata(options.plan),
        };
        createInput.model = { providerID: providerID(runtimeBinding), id: runtimeBinding.modelId };
        const configuredOptions = record(runtimeBinding.options);
        if (configuredOptions.permission !== undefined) {
          createInput.permission = configuredOptions.permission;
        }
        const result = await client.session.create(createInput);
        sessionID =
          typeof record(result.data).id === "string" ? String(record(result.data).id) : undefined;
      }
      if (!sessionID) throw new Error("OpenCode session operation returned no session id.");
      return new OpenCodeNativeSession(options, connection, sessionID);
    } catch (error) {
      const diagnosticRecord = diagnostic(
        connection.correlationId,
        options.sessionRef ? "session.get" : "session.create",
        error,
        options.sessionRef ? "NATIVE_SESSION_NOT_FOUND" : "NATIVE_EXECUTION_FAILED",
      );
      options.onDiagnostic?.(diagnosticRecord);
      await connection.dispose().catch(() => undefined);
      throw new Error(`${diagnosticRecord.code}: ${diagnosticRecord.message}`, { cause: error });
    }
  }

  get id(): string {
    return this.sessionId;
  }
  get threadId(): string {
    return this.options.threadId;
  }
  get entityId(): string {
    return this.options.entityId;
  }
  get sessionRef(): string | undefined {
    return this._providerSessionId;
  }
  get nativeSessionRef(): string | undefined {
    return this._providerSessionId;
  }
  get status(): CraftSessionStatus {
    return this._status;
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
      activeTurnId: this._activeTurnId,
      activeTurnStatus: this._activeTurnStatus,
      events: [...this._events],
      nativeSessionRef: this._providerSessionId,
      nativeEvents: [...this._nativeEvents],
      diagnostics: [...this._diagnostics],
      effectiveOverrides: this.options.plan.overrides,
      metadata: safeRuntimeMetadata(this.options.plan),
    };
  }

  subscribe(listener: (event: RuntimeEvent, snapshot: SessionSnapshot) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  async startTurn(command: StartTurnCommand): Promise<TurnResult> {
    if (this._disposed || !this._providerSessionId) {
      throw CraftingError.executionFailed("OpenCode session is not active.");
    }

    // F43: Validate sticky model identity. Model cannot be mutated per-turn within an established session.
    if (command.overrides?.model && command.overrides.model !== this.effectiveModelID) {
      throw CraftingError.incompatibleCombination(
        `Cannot override model to '${command.overrides.model}' in active session '${this.sessionId}'. Model identity '${this.effectiveModelID}' is sticky. Create a new session to switch models.`,
      );
    }

    const turnId = command.turnId ?? `turn:${randomUUID()}`;
    const startIndex = this._events.length;
    this.responseParts.length = 0;
    this._activeTurnId = turnId;
    this._activeTurnStatus = "running";
    this._status = "busy";
    this.emit({ type: "turn.started", threadId: this.threadId, turnId });

    const pending = new Promise<void>((resolve, reject) => {
      this.pendingTurn = { turnId, startIndex, resolve, reject };
    });

    const abort = () => {
      void this.interrupt(turnId);
    };
    command.signal?.addEventListener("abort", abort, { once: true });

    try {
      const binding = this.options.plan.runtimeBinding;
      const configured = record(binding.options);
      await this.connection.client.session.promptAsync({
        directory: this.options.plan.workspace ?? projectPath(this.options.projectLocation),
        sessionID: this._providerSessionId,
        model: {
          providerID: this.effectiveProviderID,
          modelID: this.effectiveModelID,
        },
        ...(configured.agent ? { agent: configured.agent } : {}),
        ...((command.overrides?.reasoningEffort ?? this.options.plan.overrides?.reasoningEffort)
          ? {
              variant:
                command.overrides?.reasoningEffort ?? this.options.plan.overrides?.reasoningEffort,
            }
          : {}),
        parts: [{ type: "text", text: command.prompt }],
      });
      await pending;
    } catch (error) {
      this.pendingTurn = undefined;
      const diagnosticRecord = diagnostic(
        this.connection.correlationId,
        "session.promptAsync",
        error,
      );
      this._diagnostics.push(diagnosticRecord);
      this.options.onDiagnostic?.(diagnosticRecord);
      this._activeTurnStatus = command.signal?.aborted ? "interrupted" : "failed";
      this._status = "error";
      throw error instanceof CraftingError
        ? error
        : CraftingError.executionFailed(diagnosticRecord.message);
    } finally {
      command.signal?.removeEventListener("abort", abort);
    }

    const events = this._events.slice(startIndex);
    const status = this._activeTurnStatus ?? "completed";
    return {
      turnId,
      status,
      events,
      ...(this.responseParts.length > 0 ? { response: this.responseParts.join("") } : {}),
    };
  }

  // F42: Permission and question response closed loop
  async respondToRequest(requestId: string, resolution: CraftRequestResolution): Promise<void> {
    if (this._disposed || !this._providerSessionId) return;
    try {
      const client = this.connection.client;
      const directory = this.options.plan.workspace ?? projectPath(this.options.projectLocation);
      let outcome: "accepted" | "declined" | "answered";
      if (resolution.kind === "permission") {
        await client.permission.reply({
          directory,
          requestID: requestId,
          reply: resolution.response,
          ...(resolution.message ? { message: resolution.message } : {}),
        });
        outcome = resolution.response === "reject" ? "declined" : "accepted";
      } else if (resolution.action === "answer") {
        await client.question.reply({
          directory,
          requestID: requestId,
          answers: resolution.answers.map((answer) => [...answer]),
        });
        outcome = "answered";
      } else {
        await client.question.reject({ directory, requestID: requestId });
        outcome = "declined";
      }
      this.emit({
        type: "request.resolved",
        threadId: this.threadId,
        requestId,
        outcome,
      });
    } catch (error) {
      const diagnosticRecord = diagnostic(
        this.connection.correlationId,
        resolution.kind === "permission"
          ? "permission.reply"
          : resolution.action === "answer"
            ? "question.reply"
            : "question.reject",
        error,
      );
      this._diagnostics.push(diagnosticRecord);
      this.options.onDiagnostic?.(diagnosticRecord);
      throw error;
    }
  }

  async interrupt(_turnId?: string): Promise<void> {
    if (this._disposed || !this._providerSessionId) return;
    try {
      await this.connection.client.session.abort({
        directory: this.options.plan.workspace ?? projectPath(this.options.projectLocation),
        sessionID: this._providerSessionId,
      });
      if (this.pendingTurn) {
        this._activeTurnStatus = "interrupted";
        const pending = this.pendingTurn;
        this.pendingTurn = undefined;
        pending.resolve();
      }
    } catch (error) {
      const diagnosticRecord = diagnostic(this.connection.correlationId, "session.abort", error);
      this._diagnostics.push(diagnosticRecord);
      this.options.onDiagnostic?.(diagnosticRecord);
      // The abort call failed, but the user asked for Stop: settle the local
      // pending turn so the session accepts the next prompt instead of hanging
      // on a promise no one will resolve. The supervisor's interrupt watchdog
      // is still armed as the last-resort force close.
      if (this.pendingTurn) {
        this._activeTurnStatus = "interrupted";
        const pending = this.pendingTurn;
        this.pendingTurn = undefined;
        pending.resolve();
      }
      throw error;
    }
  }

  async summarize(): Promise<void> {
    if (this._disposed || !this._providerSessionId) return;
    try {
      await this.connection.client.session.summarize({
        directory: this.options.plan.workspace ?? projectPath(this.options.projectLocation),
        sessionID: this._providerSessionId,
        providerID: this.effectiveProviderID,
        modelID: this.effectiveModelID,
      });
    } catch (error) {
      const diagnosticRecord = diagnostic(
        this.connection.correlationId,
        "session.summarize",
        error,
      );
      this._diagnostics.push(diagnosticRecord);
      this.options.onDiagnostic?.(diagnosticRecord);
      throw error;
    }
  }

  async readMessages(): Promise<readonly unknown[]> {
    if (this._disposed || !this._providerSessionId) return [];
    try {
      const result = await this.connection.client.session.messages({
        directory: this.options.plan.workspace ?? projectPath(this.options.projectLocation),
        sessionID: this._providerSessionId,
      });
      return Array.isArray(result.data) ? result.data : [];
    } catch (error) {
      const diagnosticRecord = diagnostic(this.connection.correlationId, "session.messages", error);
      this._diagnostics.push(diagnosticRecord);
      this.options.onDiagnostic?.(diagnosticRecord);
      throw error;
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

  async terminate(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    const pending = this.pendingTurn;
    this.pendingTurn = undefined;
    pending?.reject(new Error("OpenCode session terminated."));
    try {
      if (this._providerSessionId) {
        await this.connection.client.session.delete({
          directory: this.options.plan.workspace ?? projectPath(this.options.projectLocation),
          sessionID: this._providerSessionId,
        });
      }
    } catch (error) {
      const diagnosticRecord = diagnostic(
        this.connection.correlationId,
        "session.delete",
        error,
        "CLEANUP_FAILED",
      );
      this._diagnostics.push(diagnosticRecord);
      this.options.onDiagnostic?.(diagnosticRecord);
    } finally {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      await this.connection.dispose();
      this._status = "terminated";
      this.emit({ type: "session.exited", threadId: this.threadId, reason: "normal" });
      this._listeners.clear();
      this.mapperState.reset();
    }
  }

  private onNativeEvent(raw: unknown): void {
    const candidate = record(raw);
    const outer = typeof candidate.type === "string" ? candidate : record(candidate.payload);
    const properties =
      Object.keys(record(outer.properties)).length > 0
        ? record(outer.properties)
        : record(outer.data);
    const nativeSessionID =
      typeof properties.sessionID === "string"
        ? properties.sessionID
        : typeof record(properties.info).id === "string"
          ? String(record(properties.info).id)
          : undefined;
    if (nativeSessionID && nativeSessionID !== this._providerSessionId) return;
    const turnId = this._activeTurnId ?? `turn:${this._providerSessionId ?? "unknown"}`;
    const mapped = mapOpenCodeNativeEvent(
      {
        raw,
        threadId: this.threadId,
        turnId,
        sequence: this._sequence++,
      },
      this.mapperState,
    );
    if (mapped.diagnostic) {
      const diagnosticRecord = {
        ...mapped.diagnostic,
        correlationId: this.connection.correlationId,
      };
      this._diagnostics.push(diagnosticRecord);
      this.options.onDiagnostic?.(diagnosticRecord);
    }
    if (!mapped.event) return;
    this.emit(mapped.event);

    if (mapped.event.type === "content.delta") {
      this.responseParts.push(mapped.event.delta);
    }

    // F41: Settle pendingTurn on error, completed, or aborted without hanging
    if (mapped.event.type === "error" && this.pendingTurn) {
      this._activeTurnStatus = "failed";
      this._status = "error";
      const pending = this.pendingTurn;
      this.pendingTurn = undefined;
      pending.reject(new Error(mapped.event.message));
    } else if (mapped.event.type === "turn.completed" && this.pendingTurn) {
      this._activeTurnStatus = mapped.event.state === "interrupted" ? "interrupted" : "completed";
      this._status = "idle";
      const pending = this.pendingTurn;
      this.pendingTurn = undefined;
      pending.resolve();
    } else if (mapped.event.type === "session.exited") {
      this._status = "terminated";
      if (this.pendingTurn) {
        const pending = this.pendingTurn;
        this.pendingTurn = undefined;
        pending.reject(new Error("OpenCode session exited."));
      }
    }
  }

  private emit(event: RuntimeEvent): void {
    const envelope = event.nativeEnvelope ?? {
      harnessKind: "opencode" as const,
      source: "canonical-adapter" as const,
      nativeType: event.type,
      ...(this._providerSessionId ? { providerSessionId: this._providerSessionId } : {}),
      sequence: this._sequence++,
      receivedAt: new Date().toISOString(),
    };
    const next = { ...event, nativeEnvelope: envelope };
    this._events.push(next);
    this._nativeEvents.push(envelope);
    const snapshot = this.getSnapshot();
    for (const listener of this._listeners) listener(next, snapshot);
  }
}

export type { OpenCodeNativeClient };
