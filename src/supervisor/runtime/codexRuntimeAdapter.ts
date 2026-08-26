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
import type { ProjectLocation, RuntimeEvent, ThreadConfig } from "@/shared/contracts";
import type { ThreadSessionManager } from "./threadSessionManager";

export interface CodexRuntimeAdapterOptions {
  threadSessionManager: ThreadSessionManager;
  defaultProjectLocation?: ProjectLocation | undefined;
  /** Hook to listen to runtime events broadcast by ThreadSessionManager */
  subscribeRuntimeEvents?:
    | ((listener: (threadId: string, event: RuntimeEvent) => void) => () => void)
    | undefined;
}

export class CodexCraftSession implements CraftSession {
  private readonly _events: RuntimeEvent[] = [];
  private readonly _listeners = new Set<SessionEventListener>();
  private _activeTurnId?: string | undefined;
  private _activeTurnStatus?: TurnStatus | undefined;
  private _effectiveOverrides?: RuntimeOverrides | undefined;

  getSnapshot(): SessionSnapshot {
    return {
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      status: this._status,
      activeTurnId: this._activeTurnId,
      activeTurnStatus: this._activeTurnStatus,
      events: [...this._events],
      effectiveOverrides: this._effectiveOverrides,
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
        console.error("[CodexCraftSession] Error in event listener:", err);
      }
    }
  }

  async interrupt(_turnId?: string): Promise<void> {
    if (this._status === "terminated") return;
    try {
      await this.manager.interruptThread({ threadId: this.threadId });
    } catch (err) {
      console.warn("[CodexCraftSession] interrupt error:", err);
    }
  }

  async startTurn(command: StartTurnCommand): Promise<TurnResult> {
    const turnId = command.turnId ?? "turn:" + randomUUID();
    this._activeTurnId = turnId;
    this._activeTurnStatus = "running";
    const turnEvents: RuntimeEvent[] = [];

    try {
      const promptResult = await this.sendPrompt(command.prompt, (ev) => {
        turnEvents.push(ev);
        this.emitEvent(ev);
      });
      this._activeTurnStatus = "completed";
      return {
        turnId,
        status: "completed",
        events: turnEvents,
        response: promptResult.response,
      };
    } catch (err) {
      this._activeTurnStatus = "failed";
      return {
        turnId,
        status: "failed",
        events: turnEvents,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private _status: CraftSessionStatus = "active";
  readonly sessionRef?: string | undefined;

  constructor(
    readonly id: string,
    readonly entityId: string,
    readonly threadId: string,
    private readonly manager: ThreadSessionManager,
    sessionRef?: string | undefined,
    private readonly config?: ThreadConfig | undefined,
    private readonly subscribeEvents?:
      | ((listener: (threadId: string, event: RuntimeEvent) => void) => () => void)
      | undefined,
  ) {
    if (sessionRef !== undefined) {
      this.sessionRef = sessionRef;
    }
  }

  get status(): CraftSessionStatus {
    return this._status;
  }

  async sendPrompt(
    prompt: string,
    onEvent?: (event: RuntimeEvent) => void,
    timeoutMs = 60000,
  ): Promise<PromptResult> {
    if (this._status === "terminated") {
      throw CraftingError.executionFailed(
        `Cannot send prompt to terminated session '${this.id}'`,
        { sessionId: this.id, threadId: this.threadId },
        "Re-create the entity and session before sending prompts.",
      );
    }

    if (!this.subscribeEvents) {
      logCraftingEvent({
        phase: "runtime",
        operation: "sendPrompt",
        status: "failed",
        sessionId: this.id,
        entityId: this.entityId,
        threadId: this.threadId,
        error: {
          code: "RUNTIME_UNAVAILABLE",
          message:
            "No runtime event subscription provided to CodexCraftSession; cannot observe turn events.",
        },
      });
      throw CraftingError.runtimeUnavailable(
        "codex",
        "No runtime event bus connected to Codex session. Cannot observe response or turn completion.",
        "Ensure the supervisor runtime event bus is connected to CodexRuntimeAdapter.",
      );
    }

    const correlationId = randomUUID();
    logCraftingEvent({
      phase: "runtime",
      operation: "sendPrompt",
      status: "started",
      correlationId,
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
    });

    this._status = "busy";
    const collectedEvents: RuntimeEvent[] = [];
    let accumulatedResponse = "";
    let turnCompletedState: string | undefined;
    let turnErrorMessage: string | undefined;

    let unsubscribe: (() => void) | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const turnPromise = new Promise<void>((resolve, reject) => {
      unsubscribe = this.subscribeEvents!((tId, event) => {
        if (tId !== this.threadId) return;

        collectedEvents.push(event);
        onEvent?.(event);

        if (event.type === "content.delta" && event.stream === "assistant_text") {
          accumulatedResponse += event.delta;
        }

        if (event.type === "turn.completed") {
          turnCompletedState = event.state;
          if (event.state === "failed") {
            turnErrorMessage = "Agent turn completed with failure status";
            reject(
              CraftingError.executionFailed(turnErrorMessage, {
                threadId: this.threadId,
                state: event.state,
              }),
            );
          } else {
            resolve();
          }
        } else if (event.type === "error") {
          turnErrorMessage = event.message;
          reject(
            CraftingError.executionFailed(`Codex runtime error: ${event.message}`, {
              threadId: this.threadId,
              error: event.message,
            }),
          );
        } else if (event.type === "session.exited") {
          if (event.reason && event.reason !== "normal") {
            reject(
              CraftingError.executionFailed(`Codex session exited unexpectedly: ${event.reason}`, {
                threadId: this.threadId,
                reason: event.reason,
              }),
            );
          } else {
            resolve();
          }
        }
      });

      timeoutTimer = setTimeout(() => {
        reject(
          CraftingError.executionFailed(
            `Turn timed out after ${timeoutMs}ms without completion event.`,
            { threadId: this.threadId, timeoutMs },
            "Check Codex process status or increase timeout limit.",
          ),
        );
      }, timeoutMs);
    });

    try {
      await this.manager.sendThreadInput({
        threadId: this.threadId,
        prompt,
        config: this.config ?? { model: "gpt-5.3-codex" },
      });

      await turnPromise;

      this._status = "idle";

      logCraftingEvent({
        phase: "runtime",
        operation: "sendPrompt",
        status: "success",
        correlationId,
        sessionId: this.id,
        entityId: this.entityId,
        threadId: this.threadId,
        details: {
          turnState: turnCompletedState,
          eventCount: collectedEvents.length,
          responseLength: accumulatedResponse.length,
        },
      });

      return {
        response: accumulatedResponse,
        events: collectedEvents,
      };
    } catch (err) {
      this._status = "error";
      const craftingErr =
        err instanceof CraftingError
          ? err
          : CraftingError.executionFailed(
              `Failed to send prompt: ${err instanceof Error ? err.message : String(err)}`,
              { threadId: this.threadId, originalError: String(err) },
              "Check Codex CLI logs and network connection.",
            );

      logCraftingEvent({
        phase: "runtime",
        operation: "sendPrompt",
        status: "failed",
        correlationId,
        sessionId: this.id,
        entityId: this.entityId,
        threadId: this.threadId,
        error: craftingErr.toDetail(),
      });

      throw craftingErr;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      unsubscribe?.();
    }
  }

  async terminate(): Promise<void> {
    if (this._status === "terminated") return;
    try {
      logCraftingEvent({
        phase: "runtime",
        operation: "terminateSession",
        status: "started",
        sessionId: this.id,
        entityId: this.entityId,
        threadId: this.threadId,
      });

      await this.manager.closeThread({ threadId: this.threadId });

      logCraftingEvent({
        phase: "runtime",
        operation: "terminateSession",
        status: "success",
        sessionId: this.id,
        entityId: this.entityId,
        threadId: this.threadId,
      });
    } finally {
      this._status = "terminated";
    }
  }
}

export class CodexHarnessRuntimeAdapter implements HarnessRuntimeAdapter {
  readonly id = "codex-structured";
  readonly harnessKind = "codex";

  constructor(private readonly options: CodexRuntimeAdapterOptions) {}

  supports(craftPlan: CraftPlan): boolean {
    return craftPlan.runtimeBinding.harnessKind === "codex";
  }

  async spawnEntity(craftPlan: CraftPlan): Promise<Entity> {
    if (!this.supports(craftPlan)) {
      throw CraftingError.runtimeUnavailable(
        craftPlan.runtimeBinding.harnessKind,
        `Harness kind '${craftPlan.runtimeBinding.harnessKind}' is not supported by Codex adapter`,
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
    const threadId = entity.craftPlan.threadId ?? randomUUID();
    const modelId = entity.craftPlan.runtimeBinding.modelId;
    const workspace = entity.craftPlan.workspace ?? process.cwd();
    const projectLocation =
      this.options.defaultProjectLocation ??
      ({
        kind: process.platform === "win32" ? "windows" : "posix",
        path: workspace,
      } satisfies ProjectLocation);

    const threadConfig: ThreadConfig = {
      model: modelId,
    };

    logCraftingEvent({
      phase: "runtime",
      operation: "createSession",
      status: "started",
      entityId: entity.id,
      threadId,
      modelId,
    });

    try {
      await this.options.threadSessionManager.startThread({
        threadId,
        projectLocation,
        agentKind: "codex",
        prompt: "",
        config: threadConfig,
        initialSize: { cols: 80, rows: 24 },
        presentationMode: "gui",
      });

      entity.status = "running";
      const sessionId = `sess:codex:${threadId}`;

      logCraftingEvent({
        phase: "runtime",
        operation: "createSession",
        status: "success",
        sessionId,
        entityId: entity.id,
        threadId,
        modelId,
      });

      return new CodexCraftSession(
        sessionId,
        entity.id,
        threadId,
        this.options.threadSessionManager,
        undefined,
        threadConfig,
        this.options.subscribeRuntimeEvents,
      );
    } catch (err) {
      entity.status = "error";
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();

      let craftingErr: CraftingError;
      if (
        lower.includes("auth") ||
        lower.includes("unauthorized") ||
        lower.includes("login") ||
        lower.includes("401")
      ) {
        craftingErr = CraftingError.authRequired(
          "codex",
          "Please log in to Codex or configure your OpenAI credentials.",
        );
      } else if (
        lower.includes("not found") ||
        lower.includes("enoent") ||
        lower.includes("eperm") ||
        lower.includes("spawn ") ||
        lower.includes("structured runtime session creation failed") ||
        lower.includes("unavailable") ||
        lower.includes("cannot find")
      ) {
        craftingErr = CraftingError.runtimeUnavailable(
          "codex",
          `Codex runtime binary is not available: ${message}`,
        );
      } else {
        craftingErr = CraftingError.executionFailed(`Failed to create Codex session: ${message}`, {
          entityId: entity.id,
          threadId,
          error: message,
        });
      }

      logCraftingEvent({
        phase: "runtime",
        operation: "createSession",
        status: "failed",
        entityId: entity.id,
        threadId,
        error: craftingErr.toDetail(),
      });

      throw craftingErr;
    }
  }

  async resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession> {
    const threadId = entity.craftPlan.threadId ?? randomUUID();
    const modelId = entity.craftPlan.runtimeBinding.modelId;
    const workspace = entity.craftPlan.workspace ?? process.cwd();
    const projectLocation =
      this.options.defaultProjectLocation ??
      ({
        kind: process.platform === "win32" ? "windows" : "posix",
        path: workspace,
      } satisfies ProjectLocation);

    const threadConfig: ThreadConfig = {
      model: modelId,
    };

    logCraftingEvent({
      phase: "recovery",
      operation: "resumeSession",
      status: "started",
      entityId: entity.id,
      threadId,
      sessionId: sessionRef,
    });

    try {
      await this.options.threadSessionManager.startThread({
        threadId,
        projectLocation,
        agentKind: "codex",
        prompt: "",
        config: threadConfig,
        sessionRef: {
          providerSessionId: sessionRef,
          discoveredAt: new Date().toISOString(),
        },
        initialSize: { cols: 80, rows: 24 },
        presentationMode: "gui",
      });

      entity.status = "running";
      const sessionId = `sess:codex:${threadId}`;

      logCraftingEvent({
        phase: "recovery",
        operation: "resumeSession",
        status: "success",
        sessionId,
        entityId: entity.id,
        threadId,
      });

      return new CodexCraftSession(
        sessionId,
        entity.id,
        threadId,
        this.options.threadSessionManager,
        sessionRef,
        threadConfig,
        this.options.subscribeRuntimeEvents,
      );
    } catch (err) {
      entity.status = "error";
      const message = err instanceof Error ? err.message : String(err);

      const craftingErr = CraftingError.recoveryFailed(
        `Failed to resume Codex session with ref '${sessionRef}': ${message}`,
        { entityId: entity.id, sessionRef, error: message },
        "Check if the rollout file exists on disk or recreate the session.",
      );

      logCraftingEvent({
        phase: "recovery",
        operation: "resumeSession",
        status: "failed",
        entityId: entity.id,
        threadId,
        error: craftingErr.toDetail(),
      });

      throw craftingErr;
    }
  }
}
