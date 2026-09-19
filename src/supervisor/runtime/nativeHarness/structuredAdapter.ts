import { SessionEventHistory } from "../sessionEventHistory";
import { randomUUID } from "node:crypto";
import type {
  CraftPlan,
  CraftRequestResolution,
  CraftSession,
  CraftSessionStatus,
  Entity,
  HarnessRuntimeAdapter,
  NativeHarnessDescriptor,
  NativeHarnessDiagnostic,
  SessionSnapshot,
  StartTurnCommand,
  TurnResult,
  TurnStatus,
} from "@/shared/crafting";
import { nativeRuntimeExecutionConfigForPlan } from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import type {
  AccountBinding,
  PromptSegment,
  ProjectLocation,
  ResolvedMcpServer,
  ThreadConfig,
} from "@/shared/contracts";
import { CraftingError } from "@/shared/crafting/errors";
import { logCraftingEvent } from "@/shared/crafting/logging";
import type {
  AgentAdapter,
  StructuredSessionHandle,
  StructuredSessionListener,
} from "@/supervisor/agents/base";

function configForPlan(plan: CraftPlan, defaultApprovalPolicy?: string): ThreadConfig {
  const overrides = plan.overrides;
  const runtime = nativeRuntimeExecutionConfigForPlan(plan);
  const approvalPolicy =
    overrides?.approvalPolicy ?? runtime.approvalPolicy ?? defaultApprovalPolicy;
  return {
    model: overrides?.model ?? plan.runtimeBinding.modelId,
    ...((overrides?.reasoningEffort ?? runtime.reasoningEffort)
      ? { effort: overrides?.reasoningEffort ?? runtime.reasoningEffort }
      : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...runtime.permissionConfig,
  };
}

function statusFromThreadStatus(status: string): CraftSessionStatus {
  switch (status) {
    case "working":
    case "launching":
    case "needs_approval":
    case "needs_reply":
      return "busy";
    case "error":
      return "error";
    case "finished":
      return "terminated";
    default:
      return "idle";
  }
}

function statusFromTurnState(state: string | undefined): TurnStatus {
  switch (state) {
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "cancelled":
      return "cancelled";
    default:
      return "completed";
  }
}

function diagnosticCodeForError(error: unknown): NativeHarnessDiagnostic["code"] {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("RUNTIME_UNAVAILABLE")) return "RUNTIME_UNAVAILABLE";
  if (/auth|credential|sign[ -]?in|login/i.test(message)) return "AUTH_REQUIRED";
  if (/protocol|json-rpc|acp/i.test(message)) return "PROTOCOL_MISMATCH";
  if (/exited unexpectedly|crash|exit code/i.test(message)) return "NATIVE_PROCESS_CRASHED";
  return "NATIVE_EXECUTION_FAILED";
}

function diagnostic(
  descriptor: NativeHarnessDescriptor,
  phase: NativeHarnessDiagnostic["phase"],
  operation: string,
  error: unknown,
  details?: Record<string, unknown>,
): NativeHarnessDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: diagnosticCodeForError(error),
    harnessKind: descriptor.harnessKind,
    phase,
    operation,
    message,
    ...(details ? { details } : {}),
    occurredAt: new Date().toISOString(),
  };
}

function withNativeEnvelope(
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

export interface StructuredNativeHarnessRuntimeAdapterOptions {
  adapter: AgentAdapter;
  descriptor: NativeHarnessDescriptor;
  projectLocation: ProjectLocation;
  accountBinding?: AccountBinding;
  profileRef?: string;
  /** Supervisor-resolved, authorized and tool-filtered MCP descriptors for this plan. */
  mcpServers?: readonly ResolvedMcpServer[];
  /** Supervisor-validated CraftPlan skill invocations. */
  skillSegments?: readonly PromptSegment[];
  /** Portable SKILL.md fallback for roots this provider cannot load natively. */
  inlineSkillInstructions?: string;
  onPromptError?: (error: unknown) => void | Promise<void>;
}

class StructuredNativeCraftSession implements CraftSession {
  private _status: CraftSessionStatus = "idle";
  private _providerSessionId: string | undefined;
  private _activeTurnId: string | undefined;
  private _activeTurnStatus: TurnStatus | undefined;
  private _disposed = false;
  private _sequence = 0;
  private pendingCompletion: { resolve: () => void; reject: (error: Error) => void } | undefined;
  private completionPromise: Promise<void> | undefined;
  private readonly history = new SessionEventHistory();
  private readonly _listeners = new Set<(event: RuntimeEvent, snapshot: SessionSnapshot) => void>();

  constructor(
    readonly id: string,
    readonly entityId: string,
    private readonly descriptor: NativeHarnessDescriptor,
    private readonly handle: StructuredSessionHandle,
    private readonly config: ThreadConfig,
    readonly threadId: string,
    providerSessionId: string | undefined,
    private readonly skillSegments: readonly PromptSegment[] | undefined,
    private readonly inlineSkillInstructions: string | undefined,
  ) {
    this._providerSessionId = providerSessionId;
    const listener: StructuredSessionListener = {
      onClose: () => {
        if (this._disposed) return;
        this.pendingCompletion?.reject(new Error("Native process exited during the turn."));
        this._status = "terminated";
        this.emit({
          type: "session.exited",
          threadId: this.threadId,
          reason: "native-process-exit",
        });
      },
      onError: (message) => {
        this.pendingCompletion?.reject(new Error(message));
        const record = diagnostic(descriptor, "turn", "native-session-error", new Error(message));
        this.history.addDiagnostic(record);
        this._status = "error";
        this.emit({ type: "error", threadId: this.threadId, message });
      },
      onUpdate: (update) => {
        if (update.sessionRef) this._providerSessionId = update.sessionRef.providerSessionId;
        this._status = statusFromThreadStatus(update.status);
        if (update.status === "error" && update.errorMessage) {
          this.emit({ type: "error", threadId: this.threadId, message: update.errorMessage });
        }
      },
      onRuntimeEvent: (event) => {
        // The owned seam announces admission once, including handles that
        // only emit completion. Do not open the same turn a second time.
        if (event.type === "turn.started" && this._activeTurnStatus === "running") return;
        if (event.type === "turn.completed") {
          this._activeTurnStatus = statusFromTurnState(event.state);
          this._status = event.state === "failed" ? "error" : "idle";
        }
        this.emit(event);
        if (event.type === "turn.completed") this.pendingCompletion?.resolve();
      },
    };
    handle.setListener(listener);
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
    return this.history.readDiagnostics();
  }

  getSnapshot(): SessionSnapshot {
    return this.history.snapshot({
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      status: this._status,
      activeTurnId: this._activeTurnId,
      activeTurnStatus: this._activeTurnStatus,
      nativeSessionRef: this._providerSessionId,
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
    });
  }

  subscribe(listener: (event: RuntimeEvent, snapshot: SessionSnapshot) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private emit(event: RuntimeEvent): void {
    const next = withNativeEnvelope(
      event,
      this.descriptor,
      this._providerSessionId,
      this._sequence++,
    );
    this.history.append(next);
    const snapshot = this.getSnapshot();
    for (const listener of this._listeners) {
      try {
        listener(next, snapshot);
      } catch (error) {
        console.warn(`[native:${this.descriptor.harnessKind}] session listener failed`, error);
      }
    }
  }

  async startTurn(command: StartTurnCommand): Promise<TurnResult> {
    if (this._disposed) {
      throw CraftingError.executionFailed(
        `Cannot start a turn on disposed ${this.descriptor.label}.`,
        { sessionId: this.id },
      );
    }
    if (!this.handle.startTurn) {
      throw CraftingError.runtimeUnavailable(
        this.descriptor.harnessKind,
        `${this.descriptor.label} does not expose a structured turn operation.`,
      );
    }

    const turnStart = this.history.eventCount;
    const turnId = command.turnId ?? `turn:${randomUUID()}`;
    this._activeTurnId = turnId;
    this._activeTurnStatus = "running";
    this._status = "busy";
    this.emit({ type: "turn.started", threadId: this.threadId, turnId });
    if (command.userMessageItemId) {
      // Echo suppression in the native mapper assumes the runtime publishes
      // this row. UI-only optimistic paint is not durable or visible to peers.
      this.emit({
        type: "item.started",
        threadId: this.threadId,
        itemId: command.userMessageItemId,
        itemType: "user_message",
        payload: { content: [{ kind: "text", text: command.prompt }] },
      });
      this.emit({
        type: "item.completed",
        threadId: this.threadId,
        itemId: command.userMessageItemId,
      });
    }
    const completion =
      this.handle.turnCompletionMode === "event"
        ? new Promise<void>((resolve, reject) => {
            this.pendingCompletion = { resolve, reject };
          })
        : undefined;
    this.completionPromise = completion;
    // The terminal notification can precede the admission response. Observe
    // rejection immediately, then await the same promise after admission.
    void completion?.catch(() => undefined);
    const onAbort = () => {
      void this.handle.interruptTurn?.();
    };
    command.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      Object.assign(this.config, {
        ...(command.overrides?.model ? { model: command.overrides.model } : {}),
        ...(command.overrides?.reasoningEffort
          ? { effort: command.overrides.reasoningEffort }
          : {}),
        ...(command.overrides?.approvalPolicy
          ? { approvalPolicy: command.overrides.approvalPolicy }
          : {}),
        ...command.overrides?.permissionConfig,
      });
      await this.handle.startTurn(
        command.prompt,
        this.config,
        this.skillSegments?.length
          ? [{ kind: "text", content: command.prompt }, ...this.skillSegments]
          : undefined,
        {
          turnId,
          ...(command.userMessageItemId ? { userMessageItemId: command.userMessageItemId } : {}),
          ...(this.inlineSkillInstructions
            ? { inlineInstructions: this.inlineSkillInstructions }
            : {}),
        },
      );
      if (completion) await completion;
    } catch (error) {
      this._status = "error";
      this._activeTurnStatus = "failed";
      const record = diagnostic(this.descriptor, "turn", "startTurn", error, {
        sessionId: this.id,
      });
      this.history.addDiagnostic(record);
      this.emit({
        type: "error",
        threadId: this.threadId,
        message: error instanceof Error ? error.message : String(error),
      });
      this.emit({
        type: "turn.completed",
        threadId: this.threadId,
        turnId,
        state: "failed",
      });
      throw error instanceof CraftingError
        ? error
        : CraftingError.executionFailed(error instanceof Error ? error.message : String(error), {
            sessionId: this.id,
            harnessKind: this.descriptor.harnessKind,
          });
    } finally {
      this.pendingCompletion = undefined;
      this.completionPromise = undefined;
      command.signal?.removeEventListener("abort", onAbort);
    }

    const events = this.history.eventsSince(turnStart);
    const completed = [...events].reverse().find((event) => event.type === "turn.completed");
    const turnStatus = statusFromTurnState(
      completed?.type === "turn.completed" ? completed.state : undefined,
    );
    this._activeTurnStatus = turnStatus;
    this._status = this._disposed ? "terminated" : "idle";
    const response = events
      .filter(
        (event): event is Extract<RuntimeEvent, { type: "content.delta" }> =>
          event.type === "content.delta" && event.stream === "assistant_text",
      )
      .map((event) => event.delta)
      .join("");
    if (!completed) {
      this.emit({
        type: "turn.completed",
        threadId: this.threadId,
        turnId,
        state:
          turnStatus === "failed" || turnStatus === "interrupted" || turnStatus === "cancelled"
            ? turnStatus
            : "completed",
      });
    }
    return {
      turnId,
      status: turnStatus,
      events: this.history.eventsSince(turnStart),
      ...(response ? { response } : {}),
    };
  }

  async respondToRequest(requestId: string, resolution: CraftRequestResolution): Promise<void> {
    if (this._disposed) return;
    if (!this.handle.resolveServerRequest) {
      throw new Error(`Crafted thread ${this.threadId} does not support request resolution.`);
    }
    if (resolution.kind === "permission") {
      await this.handle.resolveServerRequest(requestId, {
        optionId: resolution.optionId ?? resolution.response,
        ...(resolution.message ? { message: resolution.message } : {}),
      });
      return;
    }
    if (resolution.action === "reject") {
      await this.handle.resolveServerRequest(requestId, { action: "cancel" });
      return;
    }
    await this.handle.resolveServerRequest(requestId, {
      answers: Object.fromEntries(resolution.answers.map((row, index) => [`q${index}`, [...row]])),
    });
  }

  async interrupt(): Promise<void> {
    if (this._disposed) return;
    if (!this.handle.interruptTurn) {
      // No native cancel on this handle. Refuse to fake a stop: throw so the
      // supervisor's interrupt watchdog force-closes the turn instead of the
      // renderer believing a still-running turn was interrupted.
      this.history.addDiagnostic(
        diagnostic(
          this.descriptor,
          "interrupt",
          "interrupt",
          new Error("interruptTurn unavailable"),
        ),
      );
      throw new Error("native handle does not support interruptTurn");
    }
    try {
      await this.handle.interruptTurn();
    } catch (error) {
      this.history.addDiagnostic(diagnostic(this.descriptor, "interrupt", "interrupt", error));
      throw error;
    }
    // Only the native terminal event settles status. An abort RPC response
    // acknowledges the request, not completion; keep the watchdog armed.
  }

  async steer(instructions: string): Promise<void> {
    if (this._disposed) return;
    if (this.handle.steerTurn) {
      await this.handle.steerTurn(instructions, this.config);
      return;
    }
    await this.interrupt();
    await this.completionPromise;
    await this.startTurn({ prompt: instructions });
  }

  async terminate(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    if (this.pendingCompletion) {
      this.emit({
        type: "turn.completed",
        threadId: this.threadId,
        turnId: this._activeTurnId ?? `turn:${randomUUID()}`,
        state: "cancelled",
      });
      this.pendingCompletion.resolve();
    }
    try {
      await this.handle.dispose();
    } catch (error) {
      this.history.addDiagnostic(diagnostic(this.descriptor, "dispose", "dispose", error));
      this._status = "error";
      throw error;
    } finally {
      this._status = "terminated";
      this._activeTurnId = undefined;
      this._activeTurnStatus = undefined;
      this.emit({
        type: "session.exited",
        threadId: this.threadId,
        reason: "normal",
      });
      this._listeners.clear();
    }
  }

  async sendPrompt(
    prompt: string,
    onEvent?: (event: RuntimeEvent) => void,
  ): Promise<{
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

export class StructuredNativeHarnessRuntimeAdapter implements HarnessRuntimeAdapter {
  readonly id: string;
  readonly harnessKind: string;
  readonly descriptor: NativeHarnessDescriptor;
  private readonly diagnostics: NativeHarnessDiagnostic[] = [];
  private readonly sessions = new Set<StructuredNativeCraftSession>();

  constructor(private readonly options: StructuredNativeHarnessRuntimeAdapterOptions) {
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
    const entity: Entity = {
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
    logCraftingEvent({
      phase: "runtime",
      operation: "spawnEntity",
      status: "success",
      entityId: entity.id,
      recipeId: craftPlan.recipeId,
      modelId: craftPlan.runtimeBinding.modelId,
      harnessKind: this.harnessKind,
    });
    return entity;
  }

  async createSession(entity: Entity): Promise<CraftSession> {
    return this.openSession(entity);
  }

  async resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession> {
    return this.openSession(entity, sessionRef);
  }

  private async openSession(entity: Entity, sessionRef?: string): Promise<CraftSession> {
    const createStructuredSession = this.options.adapter.createStructuredSession;
    if (!createStructuredSession) {
      const error = CraftingError.runtimeUnavailable(
        this.harnessKind,
        `${this.descriptor.label} has no structured native session factory.`,
      );
      this.diagnostics.push(
        diagnostic(this.descriptor, "readiness", "createStructuredSession", error),
      );
      throw error;
    }

    const config = configForPlan(
      entity.craftPlan,
      this.options.adapter.capabilities.defaultApprovalPolicy,
    );
    const threadId = entity.craftPlan.threadId ?? entity.id;
    let handle: StructuredSessionHandle | undefined;
    try {
      handle = await createStructuredSession({
        threadId,
        projectLocation: this.options.projectLocation,
        config,
        ...(this.options.accountBinding ? { accountBinding: this.options.accountBinding } : {}),
        runtimeConfig: nativeRuntimeExecutionConfigForPlan(entity.craftPlan),
        presentationMode: "gui",
        ...(this.options.mcpServers !== undefined ? { mcpServers: this.options.mcpServers } : {}),
        ...(this.options.onPromptError ? { onPromptError: this.options.onPromptError } : {}),
        ...(this.options.profileRef || entity.craftPlan.runtimeBinding.profileRef
          ? {
              agentSettings: {
                profileRef: this.options.profileRef ?? entity.craftPlan.runtimeBinding.profileRef!,
              },
            }
          : {}),
        ...(this.options.adapter.baseSpawnEnv
          ? { baseSpawnEnv: this.options.adapter.baseSpawnEnv }
          : {}),
      });
      if (!handle) {
        throw CraftingError.runtimeUnavailable(
          this.harnessKind,
          `${this.descriptor.label} declined the requested native session.`,
        );
      }
      await handle.activate?.();
      const providerSessionId = await handle.openThread?.(
        config,
        sessionRef
          ? { providerSessionId: sessionRef, discoveredAt: new Date().toISOString() }
          : undefined,
      );
      entity.status = "running";
      const session = new StructuredNativeCraftSession(
        `sess:${this.harnessKind}:${providerSessionId ?? randomUUID()}`,
        entity.id,
        this.descriptor,
        handle,
        config,
        threadId,
        providerSessionId,
        this.options.skillSegments,
        this.options.inlineSkillInstructions,
      );
      this.sessions.add(session);
      session.subscribe((event) => {
        if (event.type === "session.exited") this.sessions.delete(session);
      });
      return session;
    } catch (error) {
      this.diagnostics.push(
        diagnostic(this.descriptor, sessionRef ? "resume" : "start", "openSession", error, {
          entityId: entity.id,
        }),
      );
      await handle?.dispose().catch(() => undefined);
      throw error instanceof CraftingError
        ? error
        : CraftingError.executionFailed(error instanceof Error ? error.message : String(error), {
            harnessKind: this.harnessKind,
            entityId: entity.id,
          });
    }
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.sessions].map((session) => session.terminate()));
    this.sessions.clear();
  }
}
