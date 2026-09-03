import { randomUUID } from "node:crypto";
import type {
  CraftPlan,
  CraftSession,
  CraftSessionStatus,
  Entity,
  HarnessRuntimeAdapter,
  NativeEventEnvelope,
  NativeHarnessDiagnostic,
  PromptResult,
  RuntimeOverrides,
  SessionEventListener,
  SessionSnapshot,
  StartTurnCommand,
  TurnResult,
  TurnStatus,
} from "@/shared/crafting";
import { CODEX_NATIVE_HARNESS_DESCRIPTOR } from "../nativeHarness/descriptors";
import { CraftingError } from "@/shared/crafting/errors";
import { logCraftingEvent } from "@/shared/crafting/logging";
import type { AccountBinding, PromptSegment, ResolvedMcpServer } from "@/shared/contracts";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { buildCodexMcp } from "@/supervisor/agents/userMcp";
import { AppServerClient } from "./appServerClient";
import { verifyProfileIdentity } from "../nativeProfile";
import { AppServerProcessHost } from "./appServerProcessHost";
import { mapCodexNotificationToRuntimeEvents, type EventMappingContext } from "./eventMapping";
import { NativeCodexSubAgentRouter } from "./subAgentMapping";
import type { JsonRpcRequest } from "./types";

const DEFAULT_COLLABORATION_INSTRUCTIONS =
  "You are operating in default mode. You may use provider-native collaboration tools, including spawning and waiting for subagents, when the user explicitly requests delegation.";

function codexDiagnostic(
  phase: NativeHarnessDiagnostic["phase"],
  operation: string,
  error: unknown,
  details?: Record<string, unknown>,
): NativeHarnessDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  let code: NativeHarnessDiagnostic["code"] = "NATIVE_EXECUTION_FAILED";
  if (/auth|credential|sign[ -]?in|login/i.test(message)) code = "AUTH_REQUIRED";
  else if (/protocol|json-rpc/i.test(message)) code = "PROTOCOL_MISMATCH";
  else if (/closed|exit|crash|process/i.test(message)) code = "NATIVE_PROCESS_CRASHED";

  return {
    code,
    harnessKind: "codex",
    phase,
    operation,
    message,
    ...(details ? { details } : {}),
    occurredAt: new Date().toISOString(),
  };
}

export interface NativeCodexAdapterOptions {
  client?: AppServerClient | undefined;
  host?: AppServerProcessHost | undefined;
  approvalHandler?: ((request: JsonRpcRequest) => Promise<unknown>) | undefined;
  turnTimeoutMs?: number | undefined;
  accountBinding?: AccountBinding | undefined;
  /** Supervisor-resolved MCP servers selected by the CraftPlan. */
  mcpServers?: readonly ResolvedMcpServer[] | undefined;
  codexHome?: string | undefined;
  skillSegments?: readonly PromptSegment[] | undefined;
  inlineSkillInstructions?: string | undefined;
}

export class NativeCodexCraftSession implements CraftSession {
  private _status: CraftSessionStatus = "idle";
  private _activeTurnId?: string | undefined;
  private _activeTurnStatus?: TurnStatus | undefined;
  private readonly _events: RuntimeEvent[] = [];
  private readonly _nativeEvents: NativeEventEnvelope[] = [];
  private readonly _diagnostics: NativeHarnessDiagnostic[] = [];
  private readonly _listeners = new Set<SessionEventListener>();
  private _effectiveOverrides?: RuntimeOverrides | undefined;
  private _unsubscribeNotif?: (() => void) | undefined;
  private _unsubscribeClose?: (() => void) | undefined;
  private readonly _mappingContext: EventMappingContext;
  private readonly _subAgentRouter: NativeCodexSubAgentRouter;
  private _sequence = 0;

  constructor(
    readonly id: string,
    readonly entityId: string,
    readonly threadId: string,
    private readonly client: AppServerClient,
    readonly sessionRef?: string | undefined,
    initialOverrides?: RuntimeOverrides | undefined,
    private readonly turnTimeoutMs = 120000,
    usageScopeFresh = true,
    accountId?: string,
    private readonly runtimeModelId = "unknown",
    private readonly skillSegments?: readonly PromptSegment[],
    private readonly inlineSkillInstructions?: string,
  ) {
    this._effectiveOverrides = initialOverrides;
    this._mappingContext = {
      threadId: this.threadId,
      activeItemIds: new Set<string>(),
      usageScopeFresh,
      ...(accountId ? { accountId } : {}),
    };
    this._subAgentRouter = new NativeCodexSubAgentRouter(this.threadId);

    // Listen to official server notifications and map them to CraftStation RuntimeEvents
    this._unsubscribeNotif = this.client.onNotification((notif) => {
      const params = (notif.params ?? {}) as Record<string, any>;
      const childEvents = this._subAgentRouter.routeChildNotification(notif.method, params);
      const events =
        childEvents ??
        this._subAgentRouter.observeMainEvents(
          mapCodexNotificationToRuntimeEvents(notif, this._mappingContext),
          params,
        );
      for (const event of events) {
        this.emitEvent(event, notif.method, "native");
      }
    });
    this._unsubscribeClose = this.client.onClose(() => {
      if (this._status === "terminated") return;
      const error = new Error("Codex App-Server transport closed unexpectedly.");
      this._diagnostics.push(codexDiagnostic("turn", "transport-close", error));
      this._status = "error";
      this.emitEvent(
        { type: "error", threadId: this.threadId, message: error.message },
        "transport/closed",
        "native",
      );
      this.emitEvent(
        {
          type: "session.exited",
          threadId: this.threadId,
          reason: "native-process-error",
        },
        "transport/closed",
        "native",
      );
    });
  }

  get status(): CraftSessionStatus {
    return this._status;
  }

  get nativeSessionRef(): string | undefined {
    return this.sessionRef ?? this.threadId;
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
      nativeSessionRef: this.nativeSessionRef,
      nativeEvents: [...this._nativeEvents],
      diagnostics: [...this._diagnostics],
      effectiveOverrides: this._effectiveOverrides ? { ...this._effectiveOverrides } : undefined,
    };
  }

  subscribe(listener: SessionEventListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private emitEvent(
    event: RuntimeEvent,
    nativeType: string = event.type,
    source: NativeEventEnvelope["source"] = "canonical-adapter",
  ): void {
    const nextEvent = event.nativeEnvelope
      ? event
      : {
          ...event,
          nativeEnvelope: {
            harnessKind: CODEX_NATIVE_HARNESS_DESCRIPTOR.harnessKind,
            source,
            nativeType,
            providerSessionId: this.nativeSessionRef ?? this.threadId,
            sequence: this._sequence++,
            receivedAt: new Date().toISOString(),
          },
        };
    this._events.push(nextEvent);
    if (nextEvent.nativeEnvelope) this._nativeEvents.push(nextEvent.nativeEnvelope);
    const snapshot = this.getSnapshot();
    for (const listener of this._listeners) {
      try {
        listener(nextEvent, snapshot);
      } catch (err) {
        console.error("[NativeCodexCraftSession] Error in listener:", err);
      }
    }
  }

  async steer(instructions: string): Promise<void> {
    if (this._status === "terminated" || !this._activeTurnId) {
      throw CraftingError.executionFailed("No active turn to steer", { sessionId: this.id });
    }
    await this.client.steerTurn({
      threadId: this.threadId,
      turnId: this._activeTurnId,
      input: [{ type: "text", text: instructions }],
    });
  }

  async interrupt(_turnId?: string): Promise<void> {
    if (this._status === "terminated") return;
    const currentTurnId = this._activeTurnId;
    // A failed turn/interrupt propagates: the supervisor's interrupt watchdog
    // owns the force-close decision. Faking `turn.completed` here would strand
    // the renderer's Stop while the app-server turn keeps running.
    await this.client.interruptTurn({
      threadId: this.threadId,
      turnId: currentTurnId,
    });
    if (this._activeTurnStatus === "running" && currentTurnId) {
      this._activeTurnStatus = "interrupted";
      this._status = "idle";
      this.emitEvent({
        type: "turn.completed",
        threadId: this.threadId,
        turnId: currentTurnId,
        state: "interrupted",
      });
    }
  }

  async terminate(): Promise<void> {
    if (this._status === "terminated") return;
    this._status = "terminated";
    this._activeTurnStatus = undefined;
    this._activeTurnId = undefined;

    if (this._unsubscribeNotif) {
      this._unsubscribeNotif();
      this._unsubscribeNotif = undefined;
    }
    if (this._unsubscribeClose) {
      this._unsubscribeClose();
      this._unsubscribeClose = undefined;
    }

    const exitEvent: RuntimeEvent = {
      type: "session.exited",
      threadId: this.threadId,
      reason: "normal",
    };
    this.emitEvent(exitEvent, "session/terminated");
    this._listeners.clear();

    logCraftingEvent({
      phase: "runtime",
      operation: "terminateSession",
      status: "success",
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
    });
  }

  async startTurn(command: StartTurnCommand): Promise<TurnResult> {
    if (this._status === "terminated") {
      throw CraftingError.executionFailed(
        `Cannot start turn on terminated session '${this.id}'`,
        { sessionId: this.id, threadId: this.threadId },
        "Re-create entity and session.",
      );
    }

    const turnId = command.turnId ?? `turn:${randomUUID()}`;
    this._activeTurnId = turnId;
    this._activeTurnStatus = "running";
    this._status = "busy";
    this._mappingContext.turnId = turnId;

    if (command.overrides) {
      this._effectiveOverrides = {
        ...this._effectiveOverrides,
        ...command.overrides,
      };
    }

    const turnEvents: RuntimeEvent[] = [];
    let accumulatedResponse = "";

    return new Promise<TurnResult>((resolve, reject) => {
      let timeoutTimer: NodeJS.Timeout | undefined;
      let settled = false;
      let unsub = () => {};
      const onAbort = () => {
        void this.interrupt(turnId);
      };

      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        command.signal?.removeEventListener("abort", onAbort);
        unsub();
      };

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        this._status = "error";
        this._activeTurnStatus = "failed";
        const diagnostic = codexDiagnostic("turn", "startTurn", error, {
          turnId,
          sessionId: this.id,
        });
        this._diagnostics.push(diagnostic);
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.emitEvent(
          { type: "error", threadId: this.threadId, message: errorMsg },
          "turn/start",
          "native",
        );
        this.emitEvent(
          {
            type: "turn.completed",
            threadId: this.threadId,
            turnId,
            state: "failed",
          },
          "turn/completed",
          "canonical-adapter",
        );
        reject(
          error instanceof CraftingError
            ? error
            : CraftingError.executionFailed(errorMsg, { turnId, sessionId: this.id }),
        );
      };

      unsub = this.subscribe((event) => {
        turnEvents.push(event);
        if (settled) return;
        if (event.type === "content.delta" && event.stream === "assistant_text") {
          accumulatedResponse += event.delta;
        } else if (event.type === "turn.completed") {
          settled = true;
          cleanup();
          this._status = "idle";
          this._activeTurnStatus = event.state;
          if (event.state === "failed") {
            const errorEv = turnEvents.find((e) => e.type === "error") as any;
            const errMsg = errorEv?.message || "Turn execution failed on app-server";
            reject(CraftingError.executionFailed(errMsg, { turnId, sessionId: this.id }));
          } else {
            resolve({
              turnId,
              status: event.state,
              events: turnEvents,
              response: accumulatedResponse || undefined,
            });
          }
        }
      });

      if (this.turnTimeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          fail(
            CraftingError.executionFailed(
              `Turn execution timed out after ${this.turnTimeoutMs}ms waiting for turn.completed`,
              { turnId, sessionId: this.id },
            ),
          );
        }, this.turnTimeoutMs);
      }

      if (command.signal) {
        if (command.signal.aborted) {
          void this.interrupt(turnId);
          settled = true;
          cleanup();
          return resolve({ turnId, status: "interrupted", events: turnEvents });
        }
        command.signal.addEventListener("abort", onAbort, { once: true });
      }

      this.client
        .startTurn({
          threadId: this.threadId,
          turnId,
          input: [
            ...(this.skillSegments ?? []).flatMap((segment) =>
              segment.kind === "skill" && segment.path
                ? [{ type: "skill" as const, name: segment.name, path: segment.path }]
                : [],
            ),
            { type: "text", text: command.prompt },
            ...(this.inlineSkillInstructions
              ? [{ type: "text" as const, text: this.inlineSkillInstructions }]
              : []),
          ],
          model: this._effectiveOverrides?.model,
          effort: this._effectiveOverrides?.reasoningEffort,
          serviceTier: this._effectiveOverrides?.serviceTier,
          approvalPolicy: this._effectiveOverrides?.approvalPolicy,
          collaborationMode: {
            mode: "default",
            settings: {
              model: this._effectiveOverrides?.model ?? this.runtimeModelId,
              reasoning_effort: this._effectiveOverrides?.reasoningEffort ?? "medium",
              developer_instructions: DEFAULT_COLLABORATION_INSTRUCTIONS,
            },
          },
        })
        .catch(fail);
    });
  }

  async sendPrompt(
    prompt: string,
    onEvent?: (event: RuntimeEvent) => void,
    _timeoutMs?: number | undefined,
  ): Promise<PromptResult> {
    const unsub = onEvent ? this.subscribe((ev) => onEvent(ev)) : undefined;
    try {
      const result = await this.startTurn({ prompt });
      return {
        response: result.response ?? "",
        events: [...result.events],
        error: result.error,
      };
    } finally {
      unsub?.();
    }
  }
}

export class NativeCodexRuntimeAdapter implements HarnessRuntimeAdapter {
  readonly id = "codex-native-runtime";
  readonly harnessKind = "codex";
  readonly descriptor = CODEX_NATIVE_HARNESS_DESCRIPTOR;
  private readonly accountBinding: AccountBinding | undefined;

  private _client?: AppServerClient | undefined;
  private _host?: AppServerProcessHost | undefined;
  private readonly ownsHost: boolean;
  private readonly diagnostics: NativeHarnessDiagnostic[] = [];

  constructor(private readonly options?: NativeCodexAdapterOptions | undefined) {
    this.accountBinding = options?.accountBinding;
    this._client = options?.client;
    this._host = options?.host;
    this.ownsHost = !options?.client && !options?.host;
    if (this._client && options?.approvalHandler) {
      this._client.setServerRequestHandler(options.approvalHandler);
    }
  }

  async dispose(): Promise<void> {
    this._client = undefined;
    if (this.ownsHost) await this._host?.stop();
    this._host = undefined;
  }

  supports(craftPlan: CraftPlan): boolean {
    return craftPlan.runtimeBinding.harnessKind === "codex";
  }

  get host(): AppServerProcessHost | undefined {
    return this._host;
  }

  getDiagnostics(): readonly NativeHarnessDiagnostic[] {
    return [...this.diagnostics];
  }

  private async ensureClient(): Promise<AppServerClient> {
    if (this._client) return this._client;

    if (!this._host) {
      const mcp = buildCodexMcp(this.options?.mcpServers ?? []);
      this._host = new AppServerProcessHost({
        ...(mcp.args.length > 0 ? { args: mcp.args } : {}),
        ...(Object.keys(mcp.env).length > 0 ? { env: mcp.env } : {}),
        ...(this.options?.codexHome ? { codexHome: this.options.codexHome } : {}),
      });
    }

    const transport = await this._host.start();
    const client = new AppServerClient(transport);

    if (this.options?.approvalHandler) {
      client.setServerRequestHandler(this.options.approvalHandler);
    }

    await client.initialize();
    if (this.options?.accountBinding && this.options.codexHome) {
      try {
        verifyProfileIdentity("codex", this.options.codexHome, {
          accountId: this.options.accountBinding.accountId,
        });
      } catch (err) {
        console.warn("[codex] account identity verification warning:", err);
      }
    }
    this._client = client;
    return client;
  }

  async spawnEntity(craftPlan: CraftPlan): Promise<Entity> {
    if (!this.supports(craftPlan)) {
      throw CraftingError.runtimeUnavailable(
        craftPlan.runtimeBinding.harnessKind,
        `Harness kind '${craftPlan.runtimeBinding.harnessKind}' is not supported by NativeCodexRuntimeAdapter`,
        "Select the supported Codex harness.",
      );
    }

    const entityId = `entity:codex:${randomUUID()}`;
    const entity: Entity = {
      id: entityId,
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
        ...(craftPlan.runtimeBinding.environment
          ? { environment: craftPlan.runtimeBinding.environment }
          : {}),
        overrides: craftPlan.overrides,
      },
    };

    logCraftingEvent({
      phase: "runtime",
      operation: "spawnEntity",
      status: "success",
      entityId,
      recipeId: craftPlan.recipeId,
      modelId: craftPlan.runtimeBinding.modelId,
      harnessKind: "codex",
    });

    return entity;
  }

  async createSession(entity: Entity): Promise<CraftSession> {
    try {
      const client = await this.ensureClient();
      const overrides = entity.craftPlan.overrides;

      const threadStartRes = await client.startThread({
        cwd: entity.craftPlan.workspace,
        model: overrides?.model ?? entity.craftPlan.runtimeBinding.modelId,
        serviceTier: overrides?.serviceTier,
        approvalPolicy: overrides?.approvalPolicy,
      });

      // Official Codex App-Server thread IDs are UUIDs generated by the server
      const threadId = threadStartRes?.thread?.id ?? entity.craftPlan.threadId ?? randomUUID();
      const sessionId = `sess:codex:${threadId}`;

      entity.status = "running";
      if (this.accountBinding) {
        // The host has already applied CODEX_HOME before the app-server process
        // was spawned. Retain the binding on the entity/session seam for sticky
        // lifecycle diagnostics; no later quota refresh can mutate it.
        entity.metadata = {
          ...entity.metadata,
          accountBinding: this.accountBinding,
        };
      }

      logCraftingEvent({
        phase: "runtime",
        operation: "createSession",
        status: "success",
        sessionId,
        entityId: entity.id,
        threadId,
      });

      return new NativeCodexCraftSession(
        sessionId,
        entity.id,
        threadId,
        client,
        undefined,
        overrides,
        this.options?.turnTimeoutMs,
        true,
        this.accountBinding?.accountId,
        overrides?.model ?? entity.craftPlan.runtimeBinding.modelId,
        this.options?.skillSegments,
        this.options?.inlineSkillInstructions,
      );
    } catch (error) {
      this.diagnostics.push(
        codexDiagnostic("start", "createSession", error, { entityId: entity.id }),
      );
      throw error;
    }
  }

  async resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession> {
    try {
      const client = await this.ensureClient();
      const threadId = sessionRef || entity.craftPlan.threadId || `thread:${randomUUID()}`;
      const sessionId = `sess:codex:${threadId}`;

      await client.resumeThread({ threadId });
      entity.status = "running";

      logCraftingEvent({
        phase: "recovery",
        operation: "resumeSession",
        status: "success",
        sessionId,
        entityId: entity.id,
        threadId,
        details: { sessionRef },
      });

      return new NativeCodexCraftSession(
        sessionId,
        entity.id,
        threadId,
        client,
        sessionRef,
        entity.craftPlan.overrides,
        this.options?.turnTimeoutMs,
        false,
        this.accountBinding?.accountId,
        entity.craftPlan.overrides?.model ?? entity.craftPlan.runtimeBinding.modelId,
        this.options?.skillSegments,
        this.options?.inlineSkillInstructions,
      );
    } catch (error) {
      this.diagnostics.push(
        codexDiagnostic("resume", "resumeSession", error, { entityId: entity.id, sessionRef }),
      );
      throw error;
    }
  }
}
