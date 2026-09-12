import type { Thread, ThreadStatus } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import {
  THREAD_COLLABORATION_MAX_HOP_DEPTH,
  THREAD_COLLABORATION_MAX_QUEUED_PER_SOURCE,
  THREAD_COLLABORATION_REPLY_EXCERPT_CHARS,
  type ThreadDialogueRequest,
  type ThreadExchange,
  type ThreadRuntimeProvenance,
  type ThreadTargetSummary,
  threadDialogueRequestSchema,
} from "@/shared/threadCollaboration";
import {
  dbGetThreadCompletedTurns,
  dbGetThreadRuntimeItem,
  type PersistedCompletedTurn,
  type PersistedRuntimeItem,
} from "../db";
import { ExchangeRepository } from "./ExchangeRepository";
import {
  BoundedThreadContextProjection,
  redactCollaborationDiagnostic,
  redactCollaborationText,
  resolveThreadRuntimeProvenance,
  type RuntimeProvenanceResolver,
  type ThreadContextProjection,
} from "./provenance";
import {
  THREAD_CONTROL_SETTLED_STATUSES,
  ThreadControlAdapter,
} from "./ThreadControlAdapter";

const ATTENTION_STATUSES: ReadonlySet<ThreadStatus> = new Set(["needs_approval", "needs_reply"]);
const TERMINAL_EXCHANGE_STATUSES = new Set(["replied", "failed", "cancelled"]);

export interface ThreadCollaborationServiceDeps {
  control: ThreadControlAdapter;
  repository?: ExchangeRepository;
  provenanceResolver?: RuntimeProvenanceResolver;
  contextProjection?: ThreadContextProjection;
  getCompletedTurns?: (threadId: string) => PersistedCompletedTurn[];
  getRuntimeItem?: (threadId: string, itemId: string) => PersistedRuntimeItem | null;
  now?: () => Date;
  onExchangeChanged?: (exchange: ThreadExchange) => void;
}

export interface AuthorizedDialogueRequest {
  actorThreadId: string;
  request: ThreadDialogueRequest;
}

/**
 * Main-process control plane shared by desktop IPC, remote HTTP and App Controls
 * MCP. The module owns policy, queueing and correlation; transports may not
 * call Supervisor send/interrupt primitives around it.
 */
export class ThreadCollaborationService {
  readonly repository: ExchangeRepository;
  private readonly contextProjection: ThreadContextProjection;
  private readonly getCompletedTurns: (threadId: string) => PersistedCompletedTurn[];
  private readonly getRuntimeItem: (
    threadId: string,
    itemId: string,
  ) => PersistedRuntimeItem | null;
  private readonly now: () => Date;
  private eventChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ThreadCollaborationServiceDeps) {
    this.repository = deps.repository ?? new ExchangeRepository(deps.now);
    this.contextProjection = deps.contextProjection ?? new BoundedThreadContextProjection();
    this.getCompletedTurns = deps.getCompletedTurns ?? dbGetThreadCompletedTurns;
    this.getRuntimeItem = deps.getRuntimeItem ?? dbGetThreadRuntimeItem;
    this.now = deps.now ?? (() => new Date());
  }

  listTargets(sourceThreadId: string, query?: string): ThreadTargetSummary[] {
    const source = this.deps.control.require(sourceThreadId);
    const needle = query?.trim().toLocaleLowerCase();
    const sourceComposition = resolveThreadRuntimeProvenance(source, this.deps.provenanceResolver);
    return this.deps.control
      .list()
      .filter((thread) => thread.id !== source.id && thread.projectId === source.projectId)
      .map((thread) => {
        const snapshot = this.deps.control.snapshot(thread.id);
        const provenance = resolveThreadRuntimeProvenance(thread, this.deps.provenanceResolver);
        const sameWorktree = normalizedWorktree(source) === normalizedWorktree(thread);
        const sameComposition = isSameRuntimeComposition(sourceComposition, provenance);
        return {
          threadId: thread.id,
          projectId: thread.projectId,
          title: thread.title,
          status: snapshot.status,
          attention: snapshot.attention,
          provenance,
          sameWorktree,
          ...(!sameWorktree
            ? {
                crossWorktreeWarning:
                  "This target uses another worktree. Messages do not synchronize files between worktrees.",
              }
            : {}),
          available: thread.sessionRef !== undefined || thread.canResumeWithConfig || snapshot.live,
          sameComposition,
        } satisfies ThreadTargetSummary;
      })
      .filter((target) =>
        needle
          ? [
              target.title,
              target.provenance.modelId,
              target.provenance.harnessId,
              target.status,
              target.provenance.worktreePath ?? "",
            ].some((value) => value.toLocaleLowerCase().includes(needle))
          : true,
      );
  }

  async requestDialogue(input: AuthorizedDialogueRequest): Promise<ThreadExchange> {
    const request = threadDialogueRequestSchema.parse(input.request);
    if (input.actorThreadId !== request.sourceThreadId) {
      throw collaborationError(
        "THREAD_COLLABORATION_SOURCE_UNAUTHORIZED",
        "The caller may only create an exchange from its own thread identity.",
      );
    }
    const source = this.deps.control.require(request.sourceThreadId);
    const target = this.deps.control.require(request.targetThreadId);
    this.assertRequestPolicy(source, target, request);

    const createInput = {
      projectId: source.projectId,
      sourceThreadId: source.id,
      targetThreadId: target.id,
      deliveryMode: request.deliveryMode,
      request: redactCollaborationText(request.request),
      contextCapsule: this.contextProjection.project(request.context),
      sourceProvenance: resolveThreadRuntimeProvenance(source, this.deps.provenanceResolver),
      targetProvenance: resolveThreadRuntimeProvenance(target, this.deps.provenanceResolver),
      idempotencyKey: request.idempotencyKey,
      ...(request.conversationLinkId ? { conversationLinkId: request.conversationLinkId } : {}),
      ...(request.causalParentExchangeId
        ? { causalParentExchangeId: request.causalParentExchangeId }
        : {}),
      hopDepth: request.hopDepth,
    };
    const existing = this.repository.getByIdempotencyKey(source.id, request.idempotencyKey);
    if (
      !existing &&
      this.repository.countQueuedBySource(source.id) >= THREAD_COLLABORATION_MAX_QUEUED_PER_SOURCE
    ) {
      throw collaborationError(
        "THREAD_COLLABORATION_QUEUE_LIMIT",
        `Thread ${source.id} already has ${THREAD_COLLABORATION_MAX_QUEUED_PER_SOURCE} queued exchanges.`,
      );
    }
    const result = this.repository.create(createInput);
    if (!result.created) return result.exchange;
    const queued = this.repository.markQueued(result.exchange.id);
    this.publish(queued);
    return this.tryDeliver(queued.id);
  }

  readExchange(actorThreadId: string, exchangeId: string): ThreadExchange {
    const exchange = this.repository.require(exchangeId);
    this.assertParticipant(actorThreadId, exchange);
    return exchange;
  }

  listExchanges(actorThreadId: string, threadId: string, limit = 30): ThreadExchange[] {
    if (actorThreadId !== threadId) {
      throw collaborationError(
        "THREAD_COLLABORATION_SOURCE_UNAUTHORIZED",
        "A thread may only list its own collaboration exchanges.",
      );
    }
    this.deps.control.require(threadId);
    return this.repository.listForThread(threadId, limit);
  }

  async waitForExchange(
    actorThreadId: string,
    exchangeId: string,
    afterUpdatedAt: string | undefined,
    timeoutMs: number,
  ): Promise<{ timedOut: boolean; exchange: ThreadExchange }> {
    let exchange = this.readExchange(actorThreadId, exchangeId);
    if (
      !afterUpdatedAt ||
      exchange.updatedAt !== afterUpdatedAt ||
      TERMINAL_EXCHANGE_STATUSES.has(exchange.status)
    ) {
      return { timedOut: false, exchange };
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(250, deadline - Date.now())),
      );
      exchange = this.readExchange(actorThreadId, exchangeId);
      if (
        exchange.updatedAt !== afterUpdatedAt ||
        TERMINAL_EXCHANGE_STATUSES.has(exchange.status)
      ) {
        return { timedOut: false, exchange };
      }
    }
    if (["delivered", "target_working", "needs_attention"].includes(exchange.status)) {
      exchange = this.repository.markTimedOut(exchange.id);
      this.publish(exchange);
    }
    return { timedOut: true, exchange };
  }

  cancelExchange(actorThreadId: string, exchangeId: string): ThreadExchange {
    const exchange = this.readExchange(actorThreadId, exchangeId);
    if (exchange.sourceThreadId !== actorThreadId) {
      throw collaborationError(
        "THREAD_COLLABORATION_CANCEL_UNAUTHORIZED",
        "Only the source thread may cancel an exchange.",
      );
    }
    const beforeDelivery =
      exchange.status === "created" ||
      exchange.status === "queued" ||
      (exchange.status === "needs_attention" && exchange.deliveredAt === null);
    const afterDelivery =
      exchange.status === "delivered" ||
      exchange.status === "target_working" ||
      exchange.status === "timed_out" ||
      (exchange.status === "needs_attention" && exchange.deliveredAt !== null);
    if (!beforeDelivery && !afterDelivery) {
      throw collaborationError(
        "THREAD_COLLABORATION_ALREADY_DELIVERED",
        "The exchange is already settled and cannot be cancelled.",
      );
    }
    const cancelled = beforeDelivery
      ? this.repository.cancelBeforeDelivery(exchangeId)
      : this.repository.cancelAfterDelivery(exchangeId);
    this.publish(cancelled);
    return cancelled;
  }

  observeSupervisorEvent(event: SupervisorEvent): void {
    if (event.type !== "thread-state" && event.type !== "thread-exited") return;
    const threadId = event.threadId;
    this.eventChain = this.eventChain
      .then(() =>
        this.reconcileThread(threadId, event.type === "thread-state" ? event.status : "inactive"),
      )
      .catch((error) => {
        console.error("[thread-collaboration] event reconciliation failed", {
          threadId,
          error: redactCollaborationDiagnostic(error),
        });
      });
  }

  async recover(): Promise<void> {    for (const exchange of this.repository.failExpiredClaims()) this.publish(exchange);
    for (let exchange of this.repository.listRecoverable()) {
      if (exchange.status === "created") {
        exchange = this.repository.markQueued(exchange.id);
        this.publish(exchange);
      }
      if (exchange.status === "needs_attention" && exchange.deliveredAt === null) {
        const target = await this.deps.control.refreshSnapshot(exchange.targetThreadId);
        if (!ATTENTION_STATUSES.has(target.status)) {
          exchange = this.repository.requeueBeforeDelivery(exchange.id);
          this.publish(exchange);
        }
      }
      if (exchange.status === "queued") await this.tryDeliver(exchange.id);
      if (
        ["delivered", "target_working", "needs_attention", "timed_out"].includes(exchange.status)
      ) {
        this.captureReply(exchange.id);
      }
    }
  }

  /**
   * Re-drive delivery for one target's queued exchanges without interrupting
   * it (wake_peer). Ordinary queued messages still wait for the target's
   * current turn to settle; this only retries what is already deliverable.
   * Returns the exchanges in their post-retry state.
   */
  async retryQueuedForTarget(targetThreadId: string): Promise<ThreadExchange[]> {
    this.deps.control.require(targetThreadId);
    const out: ThreadExchange[] = [];
    for (const exchange of this.repository.listQueuedForTarget(targetThreadId)) {
      out.push(await this.tryDeliver(exchange.id));
    }
    return out;
  }

  private async reconcileThread(threadId: string, status: ThreadStatus): Promise<void> {
    const exchanges = this.repository
      .listForThread(threadId, 100)
      .filter((exchange) => exchange.targetThreadId === threadId);
    if (status === "working") {
      for (const exchange of exchanges.filter(
        (entry) =>
          entry.status === "delivered" ||
          ((entry.status === "needs_attention" || entry.status === "timed_out") &&
            entry.deliveredAt !== null),
      )) {
        this.publish(this.repository.markTargetWorking(exchange.id));
      }
      return;
    }
    if (ATTENTION_STATUSES.has(status)) {
      for (const exchange of exchanges.filter((entry) =>
        ["delivered", "target_working", "timed_out"].includes(entry.status),
      )) {
        this.publish(this.repository.markNeedsAttention(exchange.id));
      }
      return;
    }
    if (THREAD_CONTROL_SETTLED_STATUSES.has(status)) {
      for (const exchange of exchanges.filter(
        (entry) => entry.status === "needs_attention" && entry.deliveredAt === null,
      )) {
        const queued = this.repository.requeueBeforeDelivery(exchange.id);
        this.publish(queued);
        await this.tryDeliver(queued.id);
      }
      for (const exchange of exchanges.filter(
        (entry) =>
          ["delivered", "target_working", "timed_out"].includes(entry.status) ||
          (entry.status === "needs_attention" && entry.deliveredAt !== null),
      )) {
        this.captureReply(exchange.id);
      }
      for (const exchange of exchanges.filter((entry) => entry.status === "queued")) {
        await this.tryDeliver(exchange.id);
      }
    }
  }

  private async tryDeliver(exchangeId: string): Promise<ThreadExchange> {
    let exchange = this.repository.require(exchangeId);
    if (exchange.status !== "queued") return exchange;
    let target = await this.deps.control.refreshSnapshot(exchange.targetThreadId);
    if (target.status === "error") {
      return this.fail(
        exchange.id,
        collaborationError(
          "THREAD_COLLABORATION_RUNTIME_UNAVAILABLE",
          "The target thread is in an error state; the request was not delivered.",
        ),
        "THREAD_COLLABORATION_RUNTIME_UNAVAILABLE",
      );
    }
    if (
      exchange.deliveryMode === "interrupt-and-send" &&
      !THREAD_CONTROL_SETTLED_STATUSES.has(target.status)
    ) {
      try {
        target = await this.deps.control.interruptAndWait(exchange.targetThreadId);
      } catch (error) {
        return this.fail(exchange.id, error, "THREAD_COLLABORATION_INTERRUPT_FAILED");
      }
    }

    const claim = this.repository.claim(exchange.id);
    if (!claim) return this.repository.require(exchange.id);
    exchange = claim.exchange;
    const turns = this.getCompletedTurns(exchange.targetThreadId);
    const deliveredAt = this.now().toISOString();
    try {
      await this.deps.control.deliverSettled(
        exchange.targetThreadId,
        buildTargetEnvelope(exchange),
        exchange.requestItemId,
      );
      const delivered = this.repository.markDelivered(exchange.id, claim.token, {
        baselineTurnIndex: turns.length,
        requestAnchorItemId: exchange.requestItemId,
        deliveredAt,
      });
      this.publish(delivered);
      return delivered;
    } catch (error) {
      return this.fail(exchange.id, error, "THREAD_COLLABORATION_DELIVERY_FAILED");
    }
  }

  private captureReply(exchangeId: string): ThreadExchange {
    const exchange = this.repository.require(exchangeId);
    if (exchange.deliveryBaselineTurnIndex === null || exchange.deliveredAt === null)
      return exchange;
    const turns = this.getCompletedTurns(exchange.targetThreadId);
    for (let index = exchange.deliveryBaselineTurnIndex; index < turns.length; index += 1) {
      const turn = turns[index];
      if (!turn?.anchorItemId || Date.parse(turn.endedAt) < Date.parse(exchange.deliveredAt))
        continue;
      const item = this.getRuntimeItem(exchange.targetThreadId, turn.anchorItemId);
      if (!item || item.type !== "assistant_message" || item.state !== "completed") continue;
      const excerpt = redactCollaborationText(
        assistantText(item),
        THREAD_COLLABORATION_REPLY_EXCERPT_CHARS,
      );
      if (!excerpt) continue;
      const replied = this.repository.markReplied(exchange.id, {
        turnIndex: index,
        anchorItemId: turn.anchorItemId,
        excerpt,
        repliedAt: turn.endedAt,
      });
      this.publish(replied);
      return replied;
    }
    return exchange;
  }

  private assertRequestPolicy(
    source: Thread,
    target: Thread,
    request: ThreadDialogueRequest,
  ): void {
    if (source.id === target.id) {
      throw collaborationError(
        "THREAD_COLLABORATION_SELF_TARGET",
        "A thread cannot start a long-lived dialogue with itself.",
      );
    }
    if (source.projectId !== target.projectId) {
      throw collaborationError(
        "THREAD_COLLABORATION_CROSS_PROJECT",
        "Cross-thread dialogue is restricted to threads in the same project.",
      );
    }
    // The composition policy is frozen on resolved runtime provenance, never on
    // raw agentKind/config.model strings: a crafted thread's runtimeBinding is
    // authoritative. An identical Model×Harness pair has nothing to exchange
    // across runtimes, so it fails closed with a stable error.
    const sourceComposition = resolveThreadRuntimeProvenance(source, this.deps.provenanceResolver);
    const targetComposition = resolveThreadRuntimeProvenance(target, this.deps.provenanceResolver);
    if (isSameRuntimeComposition(sourceComposition, targetComposition)) {
      throw collaborationError(
        "THREAD_COLLABORATION_SAME_COMPOSITION",
        `Cross-thread dialogue requires a different Model or Harness; both threads run ` +
          `${targetComposition.modelId} on ${targetComposition.harnessId}.`,
      );
    }
    if (request.hopDepth > THREAD_COLLABORATION_MAX_HOP_DEPTH) {
      throw collaborationError("THREAD_COLLABORATION_HOP_LIMIT", "Dialogue hop limit exceeded.");
    }
    if (request.causalParentExchangeId) {
      const parent = this.repository.require(request.causalParentExchangeId);
      if (parent.projectId !== source.projectId || parent.targetThreadId !== source.id) {
        throw collaborationError(
          "THREAD_COLLABORATION_INVALID_CAUSAL_PARENT",
          "The causal parent must be an exchange delivered to the source thread in the same project.",
        );
      }
      if (request.hopDepth !== parent.hopDepth + 1) {
        throw collaborationError(
          "THREAD_COLLABORATION_INVALID_HOP",
          "A causal follow-on must increment its parent exchange hop depth exactly once.",
        );
      }
      if (target.id === parent.sourceThreadId) {
        throw collaborationError(
          "THREAD_COLLABORATION_LOOP",
          "The request would immediately loop back to its causal source.",
        );
      }
    }
  }

  private assertParticipant(actorThreadId: string, exchange: ThreadExchange): void {
    if (actorThreadId !== exchange.sourceThreadId && actorThreadId !== exchange.targetThreadId) {
      throw collaborationError(
        "THREAD_COLLABORATION_EXCHANGE_UNAUTHORIZED",
        "Only exchange participants may read this collaboration record.",
      );
    }
  }

  private fail(exchangeId: string, error: unknown, fallbackCode: string): ThreadExchange {
    const message = redactCollaborationDiagnostic(error);
    const code = classifyErrorCode(error, fallbackCode);
    const failed = this.repository.markFailed(exchangeId, {
      code,
      message,
      retryable: code === "THREAD_COLLABORATION_RUNTIME_UNAVAILABLE",
    });
    this.publish(failed);
    return failed;
  }

  private publish(exchange: ThreadExchange): void {
    this.deps.onExchangeChanged?.(exchange);
  }
}

function buildTargetEnvelope(exchange: ThreadExchange): string {
  const from = exchange.sourceProvenance.title.trim() || exchange.sourceThreadId;
  const context = exchange.contextCapsule?.text
    ? `\n\n${exchange.contextCapsule.text}`
    : "";
  return `来自「${from}」的任务：\n${exchange.request}${context}`;
}

function assistantText(item: PersistedRuntimeItem): string {
  const streamText = Object.values(item.streams).join("").trim();
  if (streamText) return streamText;
  const payload = item.payload as { content?: Array<{ kind?: string; text?: string }> } | undefined;
  return (payload?.content ?? [])
    .filter((block) => block.kind === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}

function normalizedWorktree(thread: Thread): string {
  return (thread.worktreePath ?? "").replaceAll("\\", "/").toLocaleLowerCase();
}

/** Cross-composition policy: identical resolved Model AND Harness pairs never
 * dialogue with each other — unless they are provably distinct native
 * threads (both sides carry a native session id and the ids differ). Two
 * live Kimi sessions on the same model are different peers and must be able
 * to message each other; without native identities on both sides the check
 * fails closed exactly as before. */
function isSameRuntimeComposition(
  left: ThreadRuntimeProvenance,
  right: ThreadRuntimeProvenance,
): boolean {
  if (left.modelId !== right.modelId || left.harnessId !== right.harnessId) return false;
  const leftNative = left.nativeSessionId?.trim();
  const rightNative = right.nativeSessionId?.trim();
  if (leftNative && rightNative && leftNative !== rightNative) return false;
  return true;
}

function classifyErrorCode(error: unknown, fallback: string): string {
  const explicit =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  if (explicit.startsWith("THREAD_")) return explicit;
  const text = redactCollaborationDiagnostic(error).toLocaleLowerCase();
  if (/auth|unauthorized|credential|login/.test(text)) return "THREAD_COLLABORATION_AUTH_REQUIRED";
  if (/quota|rate limit|usage limit/.test(text)) return "THREAD_COLLABORATION_QUOTA_EXHAUSTED";
  if (/binary|executable|not installed|enoent/.test(text))
    return "THREAD_COLLABORATION_BINARY_UNAVAILABLE";
  if (/unsupported|capability/.test(text)) return "THREAD_COLLABORATION_CAPABILITY_UNAVAILABLE";
  if (/unknown thread session|unavailable|econn/.test(text))
    return "THREAD_COLLABORATION_RUNTIME_UNAVAILABLE";
  return fallback;
}

function collaborationError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
