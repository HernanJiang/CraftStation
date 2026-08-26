import { randomUUID } from "./webCrypto";
import type {
  CraftSession,
  CraftSessionStatus,
  Entity,
  HarnessRuntimeAdapter,
  PromptResult,
  SessionEventListener,
  SessionSnapshot,
  StartTurnCommand,
  TurnResult,
  TurnStatus,
} from "./runtimeInterface";
import type { CraftPlan, RuntimeOverrides } from "./types";
import { CraftingError } from "./errors";
import { logCraftingEvent } from "./logging";
import type { RuntimeEvent } from "../contracts/runtimeEvent";

export interface FakeCodexHarnessOptions {
  responseGenerator?:
    | ((prompt: string, overrides?: RuntimeOverrides) => string | AsyncIterable<string>)
    | undefined;
  chunkDelayMs?: number | undefined;
  failOnTurn?: boolean | undefined;
  failureMessage?: string | undefined;
}

export class FakeCodexCraftSession implements CraftSession {
  private _status: CraftSessionStatus = "idle";
  private _activeTurnId?: string | undefined;
  private _activeTurnStatus?: TurnStatus | undefined;
  private readonly _events: RuntimeEvent[] = [];
  private readonly _listeners = new Set<SessionEventListener>();
  private _effectiveOverrides?: RuntimeOverrides | undefined;
  private _interrupted = false;

  constructor(
    readonly id: string,
    readonly entityId: string,
    readonly threadId: string,
    readonly sessionRef?: string | undefined,
    initialOverrides?: RuntimeOverrides | undefined,
    private readonly options?: FakeCodexHarnessOptions | undefined,
  ) {
    this._effectiveOverrides = initialOverrides;
    this._status = "idle";
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
        console.error("[FakeCodexCraftSession] Error in event listener:", err);
      }
    }
  }

  async steer(instructions: string): Promise<void> {
    if (this._status === "terminated" || !this._activeTurnId) {
      throw CraftingError.executionFailed("No active turn to steer", { sessionId: this.id });
    }
    logCraftingEvent({
      phase: "runtime",
      operation: "steerTurn",
      status: "success",
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      details: { instructions, turnId: this._activeTurnId },
    });
  }

  async interrupt(turnId?: string): Promise<void> {
    if (this._status === "terminated") return;
    if (!this._activeTurnId || (turnId && turnId !== this._activeTurnId)) return;

    this._interrupted = true;
    this._activeTurnStatus = "interrupted";
    this._status = "idle";

    const completedEvent: RuntimeEvent = {
      type: "turn.completed",
      threadId: this.threadId,
      turnId: this._activeTurnId,
      state: "interrupted",
    };
    this.emitEvent(completedEvent);

    logCraftingEvent({
      phase: "runtime",
      operation: "interruptTurn",
      status: "success",
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      details: { turnId: this._activeTurnId },
    });
  }

  async terminate(): Promise<void> {
    if (this._status === "terminated") return;
    this._status = "terminated";
    this._activeTurnStatus = undefined;
    this._activeTurnId = undefined;

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
        "Cannot start turn on terminated session " + this.id,
        { sessionId: this.id, threadId: this.threadId },
        "Re-create entity and session.",
      );
    }

    const turnId = command.turnId ?? "turn:" + randomUUID();
    this._activeTurnId = turnId;
    this._activeTurnStatus = "running";
    this._status = "busy";
    this._interrupted = false;

    if (command.overrides) {
      this._effectiveOverrides = {
        ...this._effectiveOverrides,
        ...command.overrides,
      };
    }

    const correlationId = randomUUID();
    logCraftingEvent({
      phase: "runtime",
      operation: "startTurn",
      status: "started",
      correlationId,
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      details: { turnId, overrides: this._effectiveOverrides },
    });

    const turnEvents: RuntimeEvent[] = [];
    const recordAndEmit = (event: RuntimeEvent) => {
      turnEvents.push(event);
      this.emitEvent(event);
    };

    recordAndEmit({
      type: "turn.started",
      threadId: this.threadId,
      turnId,
    });

    const userItemId = "item:user:" + randomUUID();
    recordAndEmit({
      type: "item.started",
      threadId: this.threadId,
      itemId: userItemId,
      itemType: "user_message",
      payload: { content: [{ type: "text", text: command.prompt }] },
    });
    recordAndEmit({
      type: "item.completed",
      threadId: this.threadId,
      itemId: userItemId,
    });

    if (command.signal) {
      if (command.signal.aborted) {
        await this.interrupt(turnId);
        return {
          turnId,
          status: "interrupted",
          events: turnEvents,
        };
      }
      command.signal.addEventListener("abort", () => {
        void this.interrupt(turnId);
      });
    }

    if (this.options?.failOnTurn) {
      this._status = "error";
      this._activeTurnStatus = "failed";
      const errorMsg = this.options.failureMessage ?? "Fake Codex App-Server turn execution failed";
      recordAndEmit({
        type: "error",
        threadId: this.threadId,
        message: errorMsg,
      });
      recordAndEmit({
        type: "turn.completed",
        threadId: this.threadId,
        turnId,
        state: "failed",
      });
      throw CraftingError.executionFailed(errorMsg, { turnId, sessionId: this.id });
    }

    const assistantItemId = "item:assistant:" + randomUUID();
    recordAndEmit({
      type: "item.started",
      threadId: this.threadId,
      itemId: assistantItemId,
      itemType: "assistant_message",
    });

    const defaultResponse = "[FakeCodex] Processed prompt: " + JSON.stringify(command.prompt);
    const responseText = this.options?.responseGenerator
      ? typeof this.options.responseGenerator(command.prompt, this._effectiveOverrides) === "string"
        ? this.options.responseGenerator(command.prompt, this._effectiveOverrides)
        : defaultResponse
      : defaultResponse;

    const chunks = String(responseText).match(/.{1,12}/g) ?? [String(responseText)];
    for (const chunk of chunks) {
      if (this._interrupted) break;
      if (this.options?.chunkDelayMs && this.options.chunkDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.options!.chunkDelayMs));
      }
      recordAndEmit({
        type: "content.delta",
        threadId: this.threadId,
        itemId: assistantItemId,
        stream: "assistant_text",
        delta: chunk,
      });
    }

    if (this._interrupted) {
      return {
        turnId,
        status: "interrupted",
        events: turnEvents,
      };
    }

    recordAndEmit({
      type: "item.completed",
      threadId: this.threadId,
      itemId: assistantItemId,
    });

    this._status = "idle";
    this._activeTurnStatus = "completed";
    recordAndEmit({
      type: "turn.completed",
      threadId: this.threadId,
      turnId,
      state: "completed",
    });

    logCraftingEvent({
      phase: "runtime",
      operation: "startTurn",
      status: "success",
      correlationId,
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      details: {
        turnId,
        eventCount: turnEvents.length,
        responseLength: String(responseText).length,
      },
    });

    return {
      turnId,
      status: "completed",
      events: turnEvents,
      response: String(responseText),
    };
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

export class FakeCodexParityHarness implements HarnessRuntimeAdapter {
  readonly id = "fake-codex-parity";
  readonly harnessKind = "codex";

  constructor(private readonly options?: FakeCodexHarnessOptions | undefined) {}

  supports(craftPlan: CraftPlan): boolean {
    return craftPlan.runtimeBinding.harnessKind === "codex";
  }

  async spawnEntity(craftPlan: CraftPlan): Promise<Entity> {
    if (!this.supports(craftPlan)) {
      throw CraftingError.runtimeUnavailable(
        craftPlan.runtimeBinding.harnessKind,
        "Harness kind " +
          craftPlan.runtimeBinding.harnessKind +
          " is not supported by FakeCodexParityHarness",
        "Select the supported Codex harness.",
      );
    }

    const entityId = "entity:fake-codex:" + randomUUID();
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
    const threadId = entity.craftPlan.threadId ?? "thread:" + randomUUID();
    const sessionId = "sess:fake-codex:" + threadId;

    entity.status = "running";

    logCraftingEvent({
      phase: "runtime",
      operation: "createSession",
      status: "success",
      sessionId,
      entityId: entity.id,
      threadId,
    });

    return new FakeCodexCraftSession(
      sessionId,
      entity.id,
      threadId,
      undefined,
      entity.craftPlan.overrides,
      this.options,
    );
  }

  async resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession> {
    const threadId = entity.craftPlan.threadId ?? "thread:" + randomUUID();
    const sessionId = "sess:fake-codex:" + threadId;

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

    return new FakeCodexCraftSession(
      sessionId,
      entity.id,
      threadId,
      sessionRef,
      entity.craftPlan.overrides,
      this.options,
    );
  }
}
