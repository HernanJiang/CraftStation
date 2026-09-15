import { randomUUID } from "node:crypto";
import {
  MuseClient,
  readSessionDurability,
  spawnMspConnection,
  type ApprovalHandler,
  type FoldedItem,
  type Session,
  type Turn,
} from "@muse-code/sdk";
import type {
  PromptSegment,
  RuntimeEvent,
  ThreadAttention,
  ThreadConfig,
  ThreadServerRequestId,
  ThreadStatus,
} from "@/shared/contracts";
import {
  createKnownSessionRef,
  type CreateStructuredSessionInput,
  type StartTurnOptions,
  type StructuredSessionHandle,
  type StructuredSessionListener,
} from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";
import { MUSE_FOREIGN_BASE_URL_ENV } from "./foreignEndpoint";
import { stripModelProviderPrefix } from "@/shared/harnessCompatibility";
import { buildMuseServeCommand } from "./argv";
import { resolveWindowsMuseLaunchLocation } from "./wslFallback";
import {
  isMuseCompactPrompt,
  closeMusePlanItem,
  isMuseReasoningDeltaField,
  mapMuseContextUsage,
  mapMuseGoal,
  mapMuseItemCompleted,
  mapMuseItemDelta,
  mapMuseItemStarted,
  mapMuseTodoList,
  museItemVisibleText,
  museToolNameFromItem,
  type MuseMappedItem,
} from "./mspCanonicalMapping";

/** Muse 1.0.2 SS1.4.1: `name` must match `^[a-z0-9_]+$`. */
export const MUSE_MSP_CLIENT_INFO = { name: "craftstation", version: "1.1.0" } as const;

const NOOP_LISTENER: StructuredSessionListener = {
  onClose() {},
  onError() {},
  onUpdate() {},
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** MSP `ApprovalMode` values we actually send on start / setApprovalMode. */
export type MuseMspApprovalMode = "allowAll" | "onRequest" | "promptUnmatched";

/**
 * ThreadConfig.approvalPolicy → MSP session approval mode.
 * yolo / never / bypassPermissions all mean "do not stop for tool approval".
 */
export function museMspApprovalMode(config: ThreadConfig): MuseMspApprovalMode | undefined {
  const policy = config.approvalPolicy;
  if (policy === "yolo" || policy === "never" || policy === "bypassPermissions") return "allowAll";
  if (policy === "on-request") return "onRequest";
  if (policy === "untrusted") return "promptUnmatched";
  return undefined;
}

function isBypassApproval(config: ThreadConfig): boolean {
  return museMspApprovalMode(config) === "allowAll";
}

/** Payload for `session/setApprovalMode` (resume cannot take approvalMode on the verb). */
export function museMspSetApprovalModeParams(
  sessionId: string,
  config: ThreadConfig,
): { sessionId: string; mode: MuseMspApprovalMode } | undefined {
  const mode = museMspApprovalMode(config);
  if (!mode) return undefined;
  return { sessionId, mode };
}

export function resolveMuseMspApprovalChoice(
  config: ThreadConfig,
  choices: ReadonlyArray<{ choiceId: string; decision?: string }>,
): string | undefined {
  if (!isBypassApproval(config)) return undefined;
  return (
    choices.find((choice) => choice.decision === "approvedForSession")?.choiceId ??
    choices.find((choice) => choice.decision === "approved")?.choiceId ??
    choices[0]?.choiceId
  );
}

export class MuseMspSession implements StructuredSessionHandle {
  readonly launchOptions;
  private listener: StructuredSessionListener = NOOP_LISTENER;
  private disposed = false;
  private currentConfig: ThreadConfig;
  private sessionRef: ReturnType<typeof createKnownSessionRef>;
  private currentTurnId: string | undefined;
  private turnCompletion: Promise<void> = Promise.resolve();
  private resolveTurnCompletion: (() => void) | undefined;
  private interruptRequested = false;
  private readonly pendingApprovals = new Map<
    string,
    { resolve: (choiceId: string) => void; reject: (error: unknown) => void }
  >();
  private readonly itemKinds = new Map<string, string>();
  private readonly seenItems = new Set<string>();
  private readonly completedItems = new Set<string>();
  private planItemId: string | undefined;
  private goalItemId: string | undefined;
  private lastTodoSignature: string | undefined;
  private lastGoalSignature: string | undefined;
  private appliedApprovalMode: MuseMspApprovalMode | undefined;

  private constructor(
    private readonly input: CreateStructuredSessionInput,
    private readonly client: MuseClient,
    private readonly connection: {
      command: (method: string, params: Record<string, unknown>) => Promise<unknown>;
    },
    private readonly session: Session,
  ) {
    this.launchOptions = {
      ...(input.agentSettings ? { agentSettings: input.agentSettings } : {}),
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
    };
    this.currentConfig = input.config;
    this.sessionRef = createKnownSessionRef(session.sessionId);
    this.session.onApproval((request) => this.handleApproval(request));
  }

  static async create(input: CreateStructuredSessionInput): Promise<MuseMspSession> {
    const location =
      (await resolveWindowsMuseLaunchLocation(input.projectLocation)) ?? input.projectLocation;
    const workspaceRoot = location.kind === "wsl" ? location.linuxPath : location.path;
    const extraEnv = { ...input.baseSpawnEnv, ...input.env };
    const spec = buildMuseServeCommand(
      location,
      resolveAgentBinaryPath(location, "muse"),
      extraEnv,
    );
    let stderrTail = "";
    const handshake = spawnMspConnection({
      command: spec.command,
      args: spec.args,
      ...(spec.cwd
        ? { cwd: spec.cwd }
        : location.kind !== "wsl" && workspaceRoot
          ? { cwd: workspaceRoot }
          : {}),
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      onStderr: (chunk) => {
        stderrTail = `${stderrTail}${chunk}`.slice(-2_000);
      },
    });
    let spawned;
    try {
      spawned = await handshake.initialize({
        clientInfo: MUSE_MSP_CLIENT_INFO,
        capabilities: { requestedCapabilities: ["userShell"] },
      });
    } catch (error) {
      await handshake.close().catch(() => undefined);
      throw wrapMuseServeHandshakeError(error, stderrTail);
    }
    const client = new MuseClient(spawned.connection, {
      durability: readSessionDurability(spawned.initializeResult),
      host: spawned,
    });
    try {
      const session = await openOrStartMuseSession(
        client,
        input.sessionRef?.providerSessionId,
        buildMuseMspStartOptions(workspaceRoot, input.config, extraEnv) as Parameters<
          MuseClient["startSession"]
        >[0],
      );
      const handle = new MuseMspSession(input, client, spawned.connection, session);
      await handle.syncMspApprovalMode(input.config);
      return handle;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  ownsProviderSession(providerSessionId: string): boolean {
    return providerSessionId === this.sessionRef.providerSessionId;
  }

  setListener(listener: StructuredSessionListener): void {
    this.listener = listener;
    this.emit({ type: "session.started", threadId: this.input.threadId });
    this.publishUpdate("idle", "none");
  }

  async startTurn(
    prompt: string,
    config: ThreadConfig,
    _segments?: PromptSegment[],
    options?: StartTurnOptions,
  ): Promise<void> {
    if (this.disposed) throw new Error("Muse session is closed.");
    this.currentConfig = config;
    await this.syncMspApprovalMode(config);
    this.beginTurn(prompt, options?.userMessageItemId);
    this.publishUpdate("working", "none");
    const completion = this.turnCompletion;
    try {
      if (isMuseCompactPrompt(prompt)) {
        await this.runCompact();
        await completion;
        return;
      }
      const turn = await this.session.sendUserTurn(
        museTurnOptions(prompt, config) as Parameters<Session["sendUserTurn"]>[0],
      );
      this.currentTurnId = turn.turnId;
      await this.consumeTurn(turn);
      await completion;
    } catch (error) {
      if (this.interruptRequested) {
        this.finishTurn("cancelled");
        return;
      }
      this.failTurn(errorMessage(error));
    }
  }

  async interruptTurn(): Promise<void> {
    this.interruptRequested = true;
    const turnId = this.currentTurnId;
    try {
      await this.connection.command("turn/interrupt", {
        sessionId: this.session.sessionId,
        ...(turnId ? { turnId } : {}),
        retract: true,
      });
    } catch {
      await this.connection.command("turn/cancel", {
        sessionId: this.session.sessionId,
        ...(turnId ? { turnId } : {}),
      }).catch(() => undefined);
    }
  }

  forceCompleteTurn(): void {
    this.finishTurn("cancelled");
  }

  async resolveServerRequest(requestId: ThreadServerRequestId, response: unknown): Promise<void> {
    const pending = this.pendingApprovals.get(String(requestId));
    if (!pending) return;
    this.pendingApprovals.delete(String(requestId));
    const rec = response && typeof response === "object" ? (response as Record<string, unknown>) : {};
    const choiceId =
      typeof rec.optionId === "string"
        ? rec.optionId
        : Array.isArray(rec.optionIds) && typeof rec.optionIds[0] === "string"
          ? rec.optionIds[0]
          : "";
    const denied = /deny|reject|abort|cancel/i.test(choiceId);
    this.emit({
      type: "request.resolved",
      threadId: this.input.threadId,
      requestId: String(requestId),
      outcome: denied ? "declined" : "accepted",
    });
    pending.resolve(choiceId);
    this.publishUpdate(this.currentTurnId ? "working" : "idle", "none");
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pendingApprovals.values()) {
      pending.reject(new Error("Muse session closed."));
    }
    this.pendingApprovals.clear();
    this.finishTurn("cancelled");
    await this.client.close().catch(() => undefined);
    this.emit({ type: "session.exited", threadId: this.input.threadId, reason: "disposed" });
    this.listener.onClose();
  }

  private beginTurn(prompt: string, userMessageItemId?: string): void {
    this.currentTurnId = `muse-turn-${randomUUID()}`;
    this.interruptRequested = false;
    this.itemKinds.clear();
    this.seenItems.clear();
    this.completedItems.clear();
    this.turnCompletion = new Promise<void>((resolve) => {
      this.resolveTurnCompletion = resolve;
    });
    this.emit({
      type: "turn.started",
      threadId: this.input.threadId,
      turnId: this.currentTurnId,
    });
    const userItemId = userMessageItemId ?? `muse-user-${randomUUID()}`;
    this.emit({
      type: "item.started",
      threadId: this.input.threadId,
      itemId: userItemId,
      itemType: "user_message",
      payload: { content: [{ kind: "text", text: prompt }] },
    });
    this.emit({ type: "item.completed", threadId: this.input.threadId, itemId: userItemId });
  }

  private async consumeTurn(turn: Turn): Promise<void> {
    const deltas = (async () => {
      for await (const delta of turn.deltas()) this.applyDelta(delta);
    })();
    const items = (async () => {
      for await (const item of turn.items()) this.applyItem(item);
    })();
    const outcome = await turn.completed;
    await Promise.all([deltas, items]);
    this.syncFoldItems();
    this.publishSessionState();
    if (this.interruptRequested || outcome.kind === "unqueued" || outcome.kind === "terminalUnknown") {
      this.finishTurn("cancelled");
      return;
    }
    if (outcome.kind === "completed" && outcome.params.terminal === "failed") {
      this.failTurn(outcome.params.error?.message ?? "Muse turn failed.");
      return;
    }
    this.finishTurn("completed");
  }

  private applyItem(item: FoldedItem): void {
    const mapped = foldedToMapped(item);
    this.itemKinds.set(mapped.itemId, mapped.kind);
    const terminal = Boolean(item.status && item.status !== "inProgress");
    if (this.seenItems.has(mapped.itemId)) {
      if (terminal && !this.completedItems.has(mapped.itemId)) {
        this.completedItems.add(mapped.itemId);
        for (const event of mapMuseItemCompleted(this.input.threadId, mapped)) this.emit(event);
        this.publishSessionState();
      }
      return;
    }
    this.seenItems.add(mapped.itemId);
    for (const event of mapMuseItemStarted(this.input.threadId, mapped)) this.emit(event);
    if (terminal) {
      this.completedItems.add(mapped.itemId);
      for (const event of mapMuseItemCompleted(this.input.threadId, mapped)) this.emit(event);
    }
    this.publishSessionState();
  }

  private applyDelta(delta: { itemId: string; field?: string; delta: string }): void {
    let kind = this.itemKinds.get(delta.itemId);
    if (!kind && isMuseReasoningDeltaField(delta.field)) {
      kind = "reasoning";
      this.itemKinds.set(delta.itemId, kind);
      if (!this.seenItems.has(delta.itemId)) {
        this.seenItems.add(delta.itemId);
        for (const event of mapMuseItemStarted(this.input.threadId, {
          itemId: delta.itemId,
          kind: "reasoning",
        })) {
          this.emit(event);
        }
      }
    }
    const event = mapMuseItemDelta(
      this.input.threadId,
      { itemId: delta.itemId, field: delta.field, delta: delta.delta },
      kind,
    );
    if (event) this.emit(event);
  }

  private async syncMspApprovalMode(config: ThreadConfig): Promise<void> {
    const params = museMspSetApprovalModeParams(this.session.sessionId, config);
    if (!params || params.mode === this.appliedApprovalMode) return;
    try {
      await this.connection.command("session/setApprovalMode", {
        commandId: randomUUID(),
        sessionId: params.sessionId,
        mode: params.mode,
      });
      this.appliedApprovalMode = params.mode;
    } catch {
      // Older hosts may lack the verb. yolo still auto-resolves via handleApproval.
    }
  }

  private handleApproval: ApprovalHandler = (request) => {
    const choices = request.availableChoices ?? [];
    const auto = resolveMuseMspApprovalChoice(this.currentConfig, choices);
    if (auto) return { choiceId: auto };
    const requestId = request.approvalId;
    this.emit({
      type: "request.opened",
      threadId: this.input.threadId,
      requestId,
      requestType: "tool_call_approval",
      payload: {
        summary: `Execute ${request.toolName}`,
        details: { toolName: request.toolName, input: request.rawArgs },
        options: choices.map((choice) => ({
          optionId: choice.choiceId,
          label: choice.label,
        })),
      },
    });
    this.publishUpdate("working", "needs_approval");
    return new Promise((resolve, reject) => {
      this.pendingApprovals.set(requestId, {
        resolve: (choiceId) => resolve({ choiceId }),
        reject,
      });
    });
  };

  private async runCompact(): Promise<void> {
    await this.connection.command("session/compact", {
      commandId: randomUUID(),
      sessionId: this.session.sessionId,
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !this.disposed && this.currentTurnId) {
      this.syncFoldItems();
      this.publishSessionState();
      const compacting = this.session.fold.items
        .list()
        .some((item) => item.kind === "compaction" && item.status === "inProgress");
      if (!compacting) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.syncFoldItems();
    this.publishSessionState();
    this.finishTurn("completed");
  }

  private syncFoldItems(): void {
    for (const item of this.session.fold.items.list()) this.applyItem(item);
  }

  private publishSessionState(): void {
    this.publishContextUsage();
    this.publishTodoList();
    this.publishGoal();
  }

  private publishTodoList(): void {
    const snapshot = this.session.fold.sessionState.get("session/todoListChanged");
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const signature = JSON.stringify(
      items.map((item) => [item.text, item.status]),
    );
    if (signature === this.lastTodoSignature) return;
    this.lastTodoSignature = signature;
    const mapped = mapMuseTodoList(
      this.input.threadId,
      items.map((item) => ({
        text: item.text,
        ...(typeof item.status === "string" ? { status: item.status } : {}),
      })),
      this.planItemId,
    );
    this.planItemId = mapped.planItemId;
    for (const event of mapped.events) this.emit(event);
  }

  private publishGoal(): void {
    const snapshot = this.session.fold.sessionState.get("session/goalChanged");
    const goal = snapshot?.goal ?? null;
    const signature = JSON.stringify(goal ?? null);
    if (signature === this.lastGoalSignature) return;
    this.lastGoalSignature = signature;
    const mapped = mapMuseGoal(
      this.input.threadId,
      goal
        ? {
            objective: goal.objective,
            ...(typeof goal.status === "string" ? { status: goal.status } : {}),
            ...(typeof goal.currentWork === "string" ? { currentWork: goal.currentWork } : {}),
            ...(typeof goal.percentComplete === "number"
              ? { percentComplete: goal.percentComplete }
              : {}),
          }
        : null,
      this.goalItemId,
    );
    this.goalItemId = mapped.goalItemId;
    for (const event of mapped.events) this.emit(event);
  }

  private publishContextUsage(): void {
    const usage = this.session.fold.sessionState.get("session/contextUsage");
    const tokens = this.session.fold.sessionState.get("session/tokenUsage") as
      | {
          promptTokens?: number;
          inputTokens?: number;
          outputTokens?: number;
          cachedTokens?: number;
          cacheReadTokens?: number;
          reasoningTokens?: number;
          cumulative?: {
            promptTokens?: number;
            outputTokens?: number;
            cachedTokens?: number;
            cacheReadTokens?: number;
          };
        }
      | undefined;
    const promptTokens = tokens?.promptTokens ?? tokens?.cumulative?.promptTokens ?? tokens?.inputTokens;
    const outputTokens = tokens?.outputTokens ?? tokens?.cumulative?.outputTokens;
    const cacheReadTokens =
      tokens?.cacheReadTokens ?? tokens?.cachedTokens ?? tokens?.cumulative?.cacheReadTokens;
    const event = mapMuseContextUsage(this.input.threadId, {
      ...(usage?.usedTokens !== undefined ? { usedTokens: usage.usedTokens } : {}),
      ...(usage?.windowTokens !== undefined ? { windowTokens: usage.windowTokens } : {}),
      ...(promptTokens !== undefined ? { promptTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      ...(tokens?.reasoningTokens !== undefined ? { reasoningTokens: tokens.reasoningTokens } : {}),
    });
    if (event) this.emit(event);
  }

  private failTurn(message: string): void {
    this.emit({ type: "error", threadId: this.input.threadId, message });
    this.finishTurn("failed");
  }

  private finishTurn(state: "completed" | "failed" | "cancelled"): void {
    const turnId = this.currentTurnId;
    if (!turnId) {
      this.resolveTurnCompletion?.();
      this.resolveTurnCompletion = undefined;
      return;
    }
    this.currentTurnId = undefined;
    this.closeOpenPlanItem();
    this.emit({
      type: "turn.completed",
      threadId: this.input.threadId,
      turnId,
      state,
    });
    this.publishUpdate("idle", "none");
    this.resolveTurnCompletion?.();
    this.resolveTurnCompletion = undefined;
  }

  /**
   * Close the open plan item at the turn boundary (mirrors the ACP
   * `closeOpenTurnItems` plan close). Resets the todo signature so the next
   * turn re-publishes the todo list as a fresh plan item and the dock keeps
   * reflecting cross-turn plan progress.
   */
  private closeOpenPlanItem(): void {
    if (!this.planItemId) return;
    const snapshot = this.session.fold.sessionState.get("session/todoListChanged");
    const rawItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const items = rawItems
      .filter((item) => typeof item?.text === "string")
      .map((item) => ({
        text: item.text as string,
        ...(typeof item.status === "string" ? { status: item.status } : {}),
      }));
    for (const event of closeMusePlanItem(this.input.threadId, this.planItemId, items)) {
      this.emit(event);
    }
    this.planItemId = undefined;
    this.lastTodoSignature = undefined;
  }

  private publishUpdate(status: ThreadStatus, attention: ThreadAttention): void {
    this.listener.onUpdate({
      status,
      attention,
      sessionRef: this.sessionRef,
    });
  }

  private emit(event: RuntimeEvent): void {
    this.listener.onRuntimeEvent?.(event);
  }
}

function isMuseMissingSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /not\s+found|no such |unknown session|does not exist|can't be resumed|invalid (conversation|session)/i.test(
    message,
  );
}

/**
 * Resume a Muse MSP session when the id is still live in this `muse serve`
 * process. A previous serve, a remapped OpenCode/Codex thread id, or a wiped
 * session store all come back as "session … was not found" — start fresh
 * instead of failing structured-session creation.
 */
export async function openOrStartMuseSession(
  client: Pick<MuseClient, "resumeSession" | "startSession">,
  resumeId: string | undefined,
  startOptions: Parameters<MuseClient["startSession"]>[0],
): Promise<Session> {
  const sessionId = resumeId?.trim();
  if (!sessionId) return client.startSession(startOptions);
  try {
    return await client.resumeSession({ sessionId });
  } catch (error) {
    if (!isMuseMissingSessionError(error)) throw error;
    return client.startSession(startOptions);
  }
}

export function buildMuseMspStartOptions(
  workspaceRoot: string,
  config: ThreadConfig,
  extraEnv?: Record<string, string>,
): {
  workspaceRoot: string;
  modelId?: string;
  providerId?: string;
  approvalMode?: "allowAll";
} {
  const options: {
    workspaceRoot: string;
    modelId?: string;
    providerId?: string;
    approvalMode?: "allowAll";
  } = { workspaceRoot };
  const modelId = config.model ? stripModelProviderPrefix(config.model) : "";
  if (modelId) options.modelId = modelId;
  if (extraEnv?.[MUSE_FOREIGN_BASE_URL_ENV]?.trim()) options.providerId = "meta";
  if (museMspApprovalMode(config) === "allowAll") options.approvalMode = "allowAll";
  return options;
}

function wrapMuseServeHandshakeError(error: unknown, stderrTail: string): Error {
  const message = errorMessage(error);
  const hint = stderrTail.replace(/\s+/gu, " ").trim().slice(0, 180);
  if (hint && !/sk-[a-z0-9]|api[_-]?key|bearer |password/iu.test(hint)) {
    return new Error(`Muse serve handshake failed: ${message} (${hint})`);
  }
  return new Error(`Muse serve handshake failed: ${message}`);
}

function museTurnOptions(
  prompt: string,
  config: ThreadConfig,
): { input: Array<{ type: "text"; text: string }>; reasoningEffort?: typeof MUSE_EFFORTS[number] } {
  const options: {
    input: Array<{ type: "text"; text: string }>;
    reasoningEffort?: (typeof MUSE_EFFORTS)[number];
  } = { input: [{ type: "text", text: prompt }] };
  if (isMuseEffort(config.effort)) options.reasoningEffort = config.effort;
  return options;
}

const MUSE_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "ultra"] as const;

function isMuseEffort(value: string | undefined): value is (typeof MUSE_EFFORTS)[number] {
  return value !== undefined && (MUSE_EFFORTS as readonly string[]).includes(value);
}

function foldedToMapped(item: FoldedItem): MuseMappedItem {
  const rec = item as unknown as Record<string, unknown>;
  const toolName = museToolNameFromItem(rec);
  const kind = String(item.kind);
  const text = museItemVisibleText(rec, kind);
  return {
    itemId: String(item.itemId),
    kind,
    ...(text ? { text } : {}),
    ...(typeof rec.fallbackText === "string" ? { fallbackText: rec.fallbackText } : {}),
    ...(toolName ? { toolName } : {}),
    ...(rec.args !== undefined ? { args: rec.args } : {}),
    ...(typeof rec.status === "string" ? { status: rec.status } : {}),
    ...(typeof rec.commandText === "string" ? { commandText: rec.commandText } : {}),
    ...(typeof rec.exitCode === "number" ? { exitCode: rec.exitCode } : {}),
    ...(typeof rec.durationMs === "number" ? { durationMs: rec.durationMs } : {}),
    ...(typeof rec.visibleOutput === "string" ? { visibleOutput: rec.visibleOutput } : {}),
    ...(typeof rec.objective === "string" ? { objective: rec.objective } : {}),
    ...(typeof rec.role === "string" ? { role: rec.role } : {}),
    ...(typeof rec.subagentId === "string" ? { subagentId: rec.subagentId } : {}),
    ...(typeof rec.childSessionId === "string" ? { childSessionId: rec.childSessionId } : {}),
    ...(rec.result !== undefined ? { result: rec.result } : {}),
    ...(typeof rec.failureReason === "string" ? { failureReason: rec.failureReason } : {}),
    ...(typeof rec.outcome === "string" ? { outcome: rec.outcome } : {}),
    ...(typeof rec.reason === "string" ? { reason: rec.reason } : {}),
    ...(typeof rec.trigger === "string" ? { trigger: rec.trigger } : {}),
    ...(typeof rec.tokensBefore === "number" ? { tokensBefore: rec.tokensBefore } : {}),
    ...(typeof rec.tokensAfter === "number" ? { tokensAfter: rec.tokensAfter } : {}),
  };
}
