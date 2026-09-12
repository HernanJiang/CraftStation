import { randomUUID } from "node:crypto";
import type {
  ThreadCollaborationError,
  ThreadContextCapsule,
  ThreadDeliveryMode,
  ThreadExchange,
  ThreadExchangeStatus,
  ThreadRuntimeProvenance,
} from "@/shared/threadCollaboration";
import { threadExchangeSchema } from "@/shared/threadCollaboration";
import { getSqlite } from "../db/connection";

const ACTIVE_LINK_STATUSES: readonly ThreadExchangeStatus[] = [
  "created",
  "queued",
  "delivering",
  "delivered",
  "target_working",
  "needs_attention",
  "cancelling",
  "timed_out",
];

const PRE_DELIVERY_STATUSES: readonly ThreadExchangeStatus[] = [
  "created",
  "queued",
  "needs_attention",
];

export interface CreateExchangeInput {
  projectId: string;
  sourceThreadId: string;
  targetThreadId: string;
  deliveryMode: ThreadDeliveryMode;
  request: string;
  contextCapsule: ThreadContextCapsule | null;
  sourceProvenance: ThreadRuntimeProvenance;
  targetProvenance: ThreadRuntimeProvenance;
  idempotencyKey: string;
  conversationLinkId?: string;
  causalParentExchangeId?: string;
  hopDepth: number;
}

export type CreateExchangeResult =
  | { created: true; exchange: ThreadExchange }
  | { created: false; exchange: ThreadExchange };

export interface DeliveryClaim {
  exchange: ThreadExchange;
  token: string;
}

export interface DeliveryAnchors {
  baselineTurnIndex: number;
  requestAnchorItemId: string | null;
  deliveredAt: string;
}

export interface ReplyAnchors {
  turnIndex: number;
  anchorItemId: string;
  excerpt: string;
  repliedAt: string;
}

interface ExchangeRow {
  id: string;
  link_id: string;
  project_id: string;
  source_thread_id: string;
  target_thread_id: string;
  sequence: number;
  delivery_mode: string;
  status: string;
  request: string;
  context_capsule: string | null;
  source_provenance: string;
  target_provenance: string;
  idempotency_key: string;
  request_item_id: string;
  delivery_baseline_turn_index: number | null;
  delivery_anchor_item_id: string | null;
  reply_turn_index: number | null;
  reply_anchor_item_id: string | null;
  reply_excerpt: string | null;
  causal_parent_exchange_id: string | null;
  hop_depth: number;
  error: string | null;
  claim_token: string | null;
  claim_expires_at: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  replied_at: string | null;
}

/**
 * Durable exchange ledger and transactional outbox for long-lived thread dialogue.
 * Runtime delivery remains outside this class; a short-lived claim is the seam that
 * prevents two host workers from sending the same queued request concurrently.
 */
export class ExchangeRepository {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  create(input: CreateExchangeInput): CreateExchangeResult {
    const sqlite = getSqlite();
    return sqlite.transaction((): CreateExchangeResult => {
      const existing = this.findByIdempotencyKey(input.sourceThreadId, input.idempotencyKey);
      if (existing) {
        assertIdempotencyMatch(existing, input);
        return { created: false, exchange: existing };
      }

      const [participantA, participantB] = [input.sourceThreadId, input.targetThreadId].sort();
      const stamp = this.now().toISOString();
      let link = sqlite
        .prepare(
          `SELECT id FROM thread_conversation_links
           WHERE project_id = ? AND participant_a_thread_id = ? AND participant_b_thread_id = ?`,
        )
        .get(input.projectId, participantA, participantB) as { id: string } | undefined;
      if (input.conversationLinkId && input.conversationLinkId !== link?.id) {
        throw collaborationRepositoryError(
          "THREAD_COLLABORATION_LINK_MISMATCH",
          `Conversation link ${input.conversationLinkId} does not match the source and target threads.`,
        );
      }
      if (!link) {
        link = { id: `thread-link-${this.newId()}` };
        sqlite
          .prepare(
            `INSERT INTO thread_conversation_links
               (id, project_id, participant_a_thread_id, participant_b_thread_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', ?, ?)`,
          )
          .run(link.id, input.projectId, participantA, participantB, stamp, stamp);
      }

      const sequenceRow = sqlite
        .prepare(
          "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM thread_exchanges WHERE link_id = ?",
        )
        .get(link.id) as { sequence: number };
      const exchangeId = `thread-exchange-${this.newId()}`;
      const requestItemId = `thread-exchange-request-${exchangeId}`;
      sqlite
        .prepare(
          `INSERT INTO thread_exchanges
             (id, link_id, project_id, source_thread_id, target_thread_id, sequence,
              delivery_mode, status, request, context_capsule, source_provenance,
              target_provenance, idempotency_key, request_item_id,
              delivery_baseline_turn_index, delivery_anchor_item_id, reply_turn_index,
              reply_anchor_item_id, reply_excerpt, causal_parent_exchange_id, hop_depth,
              error, claim_token, claim_expires_at, created_at, updated_at, delivered_at, replied_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?,
                   NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL)`,
        )
        .run(
          exchangeId,
          link.id,
          input.projectId,
          input.sourceThreadId,
          input.targetThreadId,
          sequenceRow.sequence,
          input.deliveryMode,
          input.request,
          jsonOrNull(input.contextCapsule),
          JSON.stringify(input.sourceProvenance),
          JSON.stringify(input.targetProvenance),
          input.idempotencyKey,
          requestItemId,
          input.causalParentExchangeId ?? null,
          input.hopDepth,
          stamp,
          stamp,
        );
      sqlite
        .prepare("UPDATE thread_conversation_links SET updated_at = ? WHERE id = ?")
        .run(stamp, link.id);
      return { created: true, exchange: this.require(exchangeId) };
    })();
  }

  get(exchangeId: string): ThreadExchange | null {
    const row = getSqlite()
      .prepare("SELECT * FROM thread_exchanges WHERE id = ?")
      .get(exchangeId) as ExchangeRow | undefined;
    return row ? rowToExchange(row) : null;
  }

  getByIdempotencyKey(sourceThreadId: string, key: string): ThreadExchange | null {
    return this.findByIdempotencyKey(sourceThreadId, key);
  }

  require(exchangeId: string): ThreadExchange {
    const exchange = this.get(exchangeId);
    if (!exchange) {
      throw collaborationRepositoryError(
        "THREAD_COLLABORATION_EXCHANGE_NOT_FOUND",
        `Thread exchange not found: ${exchangeId}.`,
      );
    }
    return exchange;
  }

  listForThread(threadId: string, limit = 30): ThreadExchange[] {    const rows = getSqlite()
      .prepare(
        `SELECT * FROM thread_exchanges
         WHERE source_thread_id = ? OR target_thread_id = ?
         ORDER BY updated_at DESC, sequence DESC LIMIT ?`,
      )
      .all(threadId, threadId, limit) as ExchangeRow[];
    return rows.map(rowToExchange);
  }

  /** Queued exchanges addressed to one target, oldest first (wake/retry surface). */
  listQueuedForTarget(targetThreadId: string, limit = 50): ThreadExchange[] {
    const rows = getSqlite()
      .prepare(
        `SELECT * FROM thread_exchanges
         WHERE target_thread_id = ? AND status = 'queued'
         ORDER BY sequence ASC LIMIT ?`,
      )
      .all(targetThreadId, limit) as ExchangeRow[];
    return rows.map(rowToExchange);
  }

  countQueuedBySource(sourceThreadId: string): number {    const row = getSqlite()
      .prepare(
        `SELECT COUNT(*) AS count FROM thread_exchanges
         WHERE source_thread_id = ? AND status IN ('created', 'queued')`,
      )
      .get(sourceThreadId) as { count: number };
    return row.count;
  }

  hasEarlierUnsettled(exchangeId: string): boolean {
    const exchange = this.require(exchangeId);
    const row = getSqlite()
      .prepare(
        `SELECT id FROM thread_exchanges
         WHERE link_id = ? AND sequence < ?
           AND status IN (${sqlPlaceholders(ACTIVE_LINK_STATUSES.length)})
         LIMIT 1`,
      )
      .get(exchange.linkId, exchange.sequence, ...ACTIVE_LINK_STATUSES) as
      | { id: string }
      | undefined;
    return row !== undefined;
  }

  markQueued(exchangeId: string): ThreadExchange {
    return this.transition(exchangeId, ["created"], "queued");
  }

  claim(exchangeId: string, leaseMs = 30_000): DeliveryClaim | null {
    const sqlite = getSqlite();
    return sqlite.transaction((): DeliveryClaim | null => {
      const stamp = this.now();
      const token = `thread-exchange-claim-${this.newId()}`;
      const expiresAt = new Date(stamp.getTime() + leaseMs).toISOString();
      const result = sqlite
        .prepare(
          `UPDATE thread_exchanges
           SET status = 'delivering', claim_token = ?, claim_expires_at = ?, updated_at = ?
           WHERE id = ? AND status = 'queued'
             AND (claim_token IS NULL OR claim_expires_at IS NULL OR claim_expires_at <= ?)`,
        )
        .run(token, expiresAt, stamp.toISOString(), exchangeId, stamp.toISOString());
      if (result.changes !== 1) return null;
      return { exchange: this.require(exchangeId), token };
    })();
  }

  markDelivered(exchangeId: string, token: string, anchors: DeliveryAnchors): ThreadExchange {
    const stamp = this.now().toISOString();
    const result = getSqlite()
      .prepare(
        `UPDATE thread_exchanges
         SET status = 'delivered', delivery_baseline_turn_index = ?,
             delivery_anchor_item_id = ?, delivered_at = ?, updated_at = ?,
             claim_token = NULL, claim_expires_at = NULL
         WHERE id = ? AND status = 'delivering' AND claim_token = ?`,
      )
      .run(
        anchors.baselineTurnIndex,
        anchors.requestAnchorItemId,
        anchors.deliveredAt,
        stamp,
        exchangeId,
        token,
      );
    if (result.changes !== 1) throw staleClaimError(exchangeId);
    return this.require(exchangeId);
  }

  markTargetWorking(exchangeId: string): ThreadExchange {
    return this.transition(
      exchangeId,
      ["delivered", "needs_attention", "timed_out"],
      "target_working",
    );
  }

  markNeedsAttention(exchangeId: string): ThreadExchange {
    return this.transition(
      exchangeId,
      ["queued", "delivered", "target_working", "timed_out"],
      "needs_attention",
    );
  }

  requeueBeforeDelivery(exchangeId: string): ThreadExchange {
    const exchange = this.require(exchangeId);
    if (exchange.deliveredAt !== null) return exchange;
    return this.transition(exchangeId, ["needs_attention"], "queued");
  }

  markReplied(exchangeId: string, anchors: ReplyAnchors): ThreadExchange {
    const result = getSqlite()
      .prepare(
        `UPDATE thread_exchanges
         SET status = 'replied', reply_turn_index = ?, reply_anchor_item_id = ?,
             reply_excerpt = ?, replied_at = ?, updated_at = ?,
             claim_token = NULL, claim_expires_at = NULL
         WHERE id = ? AND status IN ('delivered', 'target_working', 'needs_attention', 'timed_out')`,
      )
      .run(
        anchors.turnIndex,
        anchors.anchorItemId,
        anchors.excerpt,
        anchors.repliedAt,
        this.now().toISOString(),
        exchangeId,
      );
    if (result.changes !== 1) return this.require(exchangeId);
    return this.require(exchangeId);
  }

  markFailed(
    exchangeId: string,
    error: ThreadCollaborationError,
    allowed: readonly ThreadExchangeStatus[] = ACTIVE_LINK_STATUSES,
  ): ThreadExchange {
    return this.transition(exchangeId, allowed, "failed", error);
  }

  markTimedOut(exchangeId: string): ThreadExchange {
    return this.transition(
      exchangeId,
      ["delivered", "target_working", "needs_attention"],
      "timed_out",
    );
  }

  cancelBeforeDelivery(exchangeId: string): ThreadExchange {
    return this.transition(exchangeId, PRE_DELIVERY_STATUSES, "cancelled");
  }

  cancelAfterDelivery(exchangeId: string): ThreadExchange {
    return this.transition(
      exchangeId,
      ["delivered", "target_working", "needs_attention", "timed_out"],
      "cancelled",
    );
  }

  /**
   * A process crash in the narrow delivering/send window is intentionally not
   * retried: the runtime may already have accepted the input. Marking it failed
   * is the only fail-closed choice until the target protocol offers a durable
   * idempotency acknowledgement.
   */
  failExpiredClaims(): ThreadExchange[] {
    const sqlite = getSqlite();
    const now = this.now().toISOString();
    const rows = sqlite
      .prepare(
        `SELECT id FROM thread_exchanges
         WHERE status = 'delivering' AND claim_expires_at IS NOT NULL AND claim_expires_at <= ?`,
      )
      .all(now) as Array<{ id: string }>;
    return rows.map(({ id }) =>
      this.markFailed(id, {
        code: "THREAD_COLLABORATION_DELIVERY_UNCERTAIN",
        message:
          "The host restarted while delivery was in progress. The request was not retried because the target may already have accepted it.",
        retryable: false,
      }),
    );
  }

  listRecoverable(): ThreadExchange[] {
    const rows = getSqlite()
      .prepare(
        `SELECT * FROM thread_exchanges
         WHERE status IN ('created', 'queued', 'delivered', 'target_working', 'needs_attention', 'timed_out')
         ORDER BY created_at ASC`,
      )
      .all() as ExchangeRow[];
    return rows.map(rowToExchange);
  }

  private findByIdempotencyKey(sourceThreadId: string, key: string): ThreadExchange | null {
    const row = getSqlite()
      .prepare("SELECT * FROM thread_exchanges WHERE source_thread_id = ? AND idempotency_key = ?")
      .get(sourceThreadId, key) as ExchangeRow | undefined;
    return row ? rowToExchange(row) : null;
  }

  private transition(
    exchangeId: string,
    allowed: readonly ThreadExchangeStatus[],
    status: ThreadExchangeStatus,
    error?: ThreadCollaborationError,
  ): ThreadExchange {
    const result = getSqlite()
      .prepare(
        `UPDATE thread_exchanges SET status = ?, error = ?, updated_at = ?,
           claim_token = NULL, claim_expires_at = NULL
         WHERE id = ? AND status IN (${sqlPlaceholders(allowed.length)})`,
      )
      .run(
        status,
        error ? JSON.stringify(error) : null,
        this.now().toISOString(),
        exchangeId,
        ...allowed,
      );
    if (result.changes !== 1) return this.require(exchangeId);
    return this.require(exchangeId);
  }
}

function rowToExchange(row: ExchangeRow): ThreadExchange {
  return threadExchangeSchema.parse({
    id: row.id,
    linkId: row.link_id,
    projectId: row.project_id,
    sourceThreadId: row.source_thread_id,
    targetThreadId: row.target_thread_id,
    sequence: row.sequence,
    deliveryMode: row.delivery_mode,
    status: row.status,
    request: row.request,
    contextCapsule: parseJson(row.context_capsule),
    sourceProvenance: parseJson(row.source_provenance),
    targetProvenance: parseJson(row.target_provenance),
    idempotencyKey: row.idempotency_key,
    requestItemId: row.request_item_id,
    deliveryBaselineTurnIndex: row.delivery_baseline_turn_index,
    deliveryAnchorItemId: row.delivery_anchor_item_id,
    replyTurnIndex: row.reply_turn_index,
    replyAnchorItemId: row.reply_anchor_item_id,
    replyExcerpt: row.reply_excerpt,
    causalParentExchangeId: row.causal_parent_exchange_id,
    hopDepth: row.hop_depth,
    error: parseJson(row.error),
    claimToken: row.claim_token,
    claimExpiresAt: row.claim_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveredAt: row.delivered_at,
    repliedAt: row.replied_at,
  });
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function jsonOrNull(value: unknown | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function collaborationRepositoryError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function staleClaimError(exchangeId: string): Error {
  return collaborationRepositoryError(
    "THREAD_COLLABORATION_STALE_CLAIM",
    `Delivery claim for ${exchangeId} is no longer current.`,
  );
}

function assertIdempotencyMatch(existing: ThreadExchange, input: CreateExchangeInput): void {
  const matches =
    existing.projectId === input.projectId &&
    existing.sourceThreadId === input.sourceThreadId &&
    existing.targetThreadId === input.targetThreadId &&
    existing.deliveryMode === input.deliveryMode &&
    existing.request === input.request &&
    JSON.stringify(existing.contextCapsule) === JSON.stringify(input.contextCapsule) &&
    existing.causalParentExchangeId === (input.causalParentExchangeId ?? null) &&
    existing.hopDepth === input.hopDepth &&
    (!input.conversationLinkId || existing.linkId === input.conversationLinkId);
  if (!matches) {
    throw collaborationRepositoryError(
      "THREAD_COLLABORATION_IDEMPOTENCY_CONFLICT",
      `Idempotency key ${input.idempotencyKey} is already bound to another thread dialogue request.`,
    );
  }
}
