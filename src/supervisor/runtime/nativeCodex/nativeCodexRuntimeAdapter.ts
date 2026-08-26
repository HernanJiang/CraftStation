import { randomUUID } from "node:crypto";
import type {
  CraftPlan,
  CraftSession,
  CraftSessionStatus,
  Entity,
  HarnessRuntimeAdapter,
  PromptResult,
  RuntimeOverrides,
  SessionEventListener,
  SessionSnapshot,
  StartTurnCommand,
  TurnResult,
  TurnStatus,
} from "@/shared/crafting";
import { CraftingError } from "@/shared/crafting/errors";
import { logCraftingEvent } from "@/shared/crafting/logging";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { AppServerClient } from "./appServerClient";
import { AppServerProcessHost } from "./appServerProcessHost";
import { mapCodexNotificationToRuntimeEvents, type EventMappingContext } from "./eventMapping";
import type { JsonRpcRequest } from "./types";

export interface NativeCodexAdapterOptions {
  client?: AppServerClient | undefined;
  host?: AppServerProcessHost | undefined;
  approvalHandler?: ((request: JsonRpcRequest) => Promise<unknown>) | undefined;
  turnTimeoutMs?: number | undefined;
}

export class NativeCodexCraftSession implements CraftSession {
  private _status: CraftSessionStatus = "idle";
  private _activeTurnId?: string | undefined;
  private _activeTurnStatus?: TurnStatus | undefined;
  private readonly _events: RuntimeEvent[] = [];
  private readonly _listeners = new Set<SessionEventListener>();
  private _effectiveOverrides?: RuntimeOverrides | undefined;
  private _unsubscribeNotif?: (() => void) | undefined;
  private readonly _mappingContext: EventMappingContext;

  constructor(
    readonly id: string,
    readonly entityId: string,
    readonly threadId: string,
    private readonly client: AppServerClient,
    readonly sessionRef?: string | undefined,
    initialOverrides?: RuntimeOverrides | undefined,
    private readonly turnTimeoutMs = 120000,
  ) {
    this._effectiveOverrides = initialOverrides;
    this._mappingContext = {
      threadId: this.threadId,
      activeItemIds: new Set<string>(),
    };

    // Listen to official server notifications and map them to CraftStation RuntimeEvents
    this._unsubscribeNotif = this.client.onNotification((notif) => {
      const params = (notif.params ?? {}) as Record<string, any>;
      // Filter events belonging to this thread if threadId is provided
      if (params.threadId && params.threadId !== this.threadId) return;

      const events = mapCodexNotificationToRuntimeEvents(notif, this._mappingContext);
      for (const event of events) {
        this.emitEvent(event);
      }
    });
  }

  get status(): CraftSessionStatus {
    return this._status;
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
      effectiveOverrides: this._effectiveOverrides ? { ...this._effectiveOverrides } : undefined,
    };
  }

  subscribe(listener: SessionEventListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private emitEvent(event: RuntimeEvent): void {
    this._events.push(event);
    const snapshot = this.getSnapshot();
    for (const listener of this._listeners) {
      try {
        listener(event, snapshot);
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
    try {
      await this.client.interruptTurn({
        threadId: this.threadId,
        turnId: currentTurnId,
      });
    } catch (err) {
      console.warn("[NativeCodexCraftSession] Interrupt error:", err);
    } finally {
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

    const exitEvent: RuntimeEvent = {
      type: "session.exited",
      threadId: this.threadId,
      reason: "normal",
    };
    this.emitEvent(exitEvent);
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

      const unsub = this.subscribe((event) => {
        turnEvents.push(event);
        if (event.type === "content.delta" && event.stream === "assistant_text") {
          accumulatedResponse += event.delta;
        } else if (event.type === "turn.completed") {
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

      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        unsub();
      };

      if (this.turnTimeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          cleanup();
          this._status = "idle";
          this._activeTurnStatus = "failed";
          reject(
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
          cleanup();
          return resolve({ turnId, status: "interrupted", events: turnEvents });
        }
        command.signal.addEventListener("abort", () => {
          void this.interrupt(turnId);
        });
      }

      this.client
        .startTurn({
          threadId: this.threadId,
          turnId,
          input: [{ type: "text", text: command.prompt }],
          model: this._effectiveOverrides?.model,
          effort: this._effectiveOverrides?.reasoningEffort,
          serviceTier: this._effectiveOverrides?.serviceTier,
          approvalPolicy: this._effectiveOverrides?.approvalPolicy,
        })
        .catch((err) => {
          cleanup();
          this._status = "error";
          this._activeTurnStatus = "failed";
          const errorMsg = err instanceof Error ? err.message : String(err);
          reject(CraftingError.executionFailed(errorMsg, { turnId, sessionId: this.id }));
        });
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

  private _client?: AppServerClient | undefined;
  private _host?: AppServerProcessHost | undefined;

  constructor(private readonly options?: NativeCodexAdapterOptions | undefined) {
    this._client = options?.client;
    this._host = options?.host;
    if (this._client && options?.approvalHandler) {
      this._client.setServerRequestHandler(options.approvalHandler);
    }
  }

  supports(craftPlan: CraftPlan): boolean {
    return craftPlan.runtimeBinding.harnessKind === "codex";
  }

  get host(): AppServerProcessHost | undefined {
    return this._host;
  }

  private async ensureClient(): Promise<AppServerClient> {
    if (this._client) return this._client;

    if (!this._host) {
      this._host = new AppServerProcessHost();
    }

    const transport = await this._host.start();
    const client = new AppServerClient(transport);

    if (this.options?.approvalHandler) {
      client.setServerRequestHandler(this.options.approvalHandler);
    }

    await client.initialize();
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
      metadata: {
        vendor: craftPlan.runtimeBinding.vendor,
        modelId: craftPlan.runtimeBinding.modelId,
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
    );
  }

  async resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession> {
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
    );
  }
}
