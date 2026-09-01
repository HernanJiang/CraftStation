import Database from "better-sqlite3";

import type { CraftPlan } from "@/shared/crafting";
import {
  conversationCheckpointSchema,
  runtimeSegmentSchema,
  sessionSwitchStateSchema,
  type ConversationCheckpoint,
  type RuntimeSegment,
  type RuntimeSegmentStatus,
  type SessionSwitchState,
} from "@/shared/sessionHandoff";
import { resolveCraftStationPaths } from "@/shared/craftstationPaths";
import { sanitizePortableRecord } from "./redaction";

type Sqlite = InstanceType<typeof Database>;

interface SegmentRow {
  id: string;
  thread_id: string;
  ordinal: number;
  binding_epoch: number;
  status: string;
  craft_plan_id: string;
  recipe_id: string;
  result_item_id: string;
  runtime_binding: string;
  entity_id: string | null;
  runtime_session_id: string | null;
  native_session_ref: string | null;
  predecessor_segment_id: string | null;
  checkpoint_id: string | null;
  created_at: string;
  activated_at: string | null;
  deactivated_at: string | null;
  failure_code: string | null;
}

function segmentFromRow(row: SegmentRow): RuntimeSegment {
  return runtimeSegmentSchema.parse({
    id: row.id,
    threadId: row.thread_id,
    ordinal: row.ordinal,
    bindingEpoch: row.binding_epoch,
    status: row.status,
    craftPlanId: row.craft_plan_id,
    recipeId: row.recipe_id,
    resultItemId: row.result_item_id,
    runtimeBinding: JSON.parse(row.runtime_binding),
    ...(row.entity_id ? { entityId: row.entity_id } : {}),
    ...(row.runtime_session_id ? { runtimeSessionId: row.runtime_session_id } : {}),
    ...(row.native_session_ref ? { nativeSessionRef: row.native_session_ref } : {}),
    ...(row.predecessor_segment_id ? { predecessorSegmentId: row.predecessor_segment_id } : {}),
    ...(row.checkpoint_id ? { checkpointId: row.checkpoint_id } : {}),
    createdAt: row.created_at,
    ...(row.activated_at ? { activatedAt: row.activated_at } : {}),
    ...(row.deactivated_at ? { deactivatedAt: row.deactivated_at } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
  });
}

export class RuntimeSegmentLedger {
  private readonly sqlite: Sqlite;
  private closed = false;

  constructor(baseDir: string, sqlite?: Sqlite) {
    const explicitNativeBinding = process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING?.trim();
    this.sqlite =
      sqlite ??
      new Database(
        resolveCraftStationPaths(baseDir).dbPath,
        explicitNativeBinding ? { nativeBinding: explicitNativeBinding } : undefined,
      );
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("busy_timeout = 5000");
    // The main process owns migrations. The supervisor is a separate process,
    // though, and focused runtime tests construct it without booting main.
    // Keep this additive bootstrap identical to migrations 37-39 so the deep
    // module remains usable in that environment without weakening production
    // schema validation.
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS runtime_segments (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
        binding_epoch INTEGER NOT NULL, status TEXT NOT NULL, craft_plan_id TEXT NOT NULL,
        recipe_id TEXT NOT NULL, result_item_id TEXT NOT NULL, runtime_binding TEXT NOT NULL,
        entity_id TEXT, runtime_session_id TEXT, native_session_ref TEXT,
        predecessor_segment_id TEXT, checkpoint_id TEXT, created_at TEXT NOT NULL,
        activated_at TEXT, deactivated_at TEXT, failure_code TEXT,
        UNIQUE(thread_id, ordinal), UNIQUE(thread_id, binding_epoch)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_segments_one_active
        ON runtime_segments(thread_id) WHERE status = 'active';
      CREATE TABLE IF NOT EXISTS runtime_segment_event_archive (
        id INTEGER PRIMARY KEY AUTOINCREMENT, segment_id TEXT NOT NULL,
        event_type TEXT NOT NULL, event_sequence INTEGER, received_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_checkpoints (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, source_segment_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_switch_transactions (
        request_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, phase TEXT NOT NULL,
        payload TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_switch_one_open
        ON session_switch_transactions(thread_id)
        WHERE phase NOT IN ('active', 'rolled_back', 'failed', 'cancelled');
    `);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.sqlite.close();
  }

  list(threadId: string): RuntimeSegment[] {
    return (
      this.sqlite
        .prepare("SELECT * FROM runtime_segments WHERE thread_id = ? ORDER BY ordinal")
        .all(threadId) as SegmentRow[]
    ).map(segmentFromRow);
  }

  active(threadId: string): RuntimeSegment | undefined {
    const row = this.sqlite
      .prepare("SELECT * FROM runtime_segments WHERE thread_id = ? AND status = 'active'")
      .get(threadId) as SegmentRow | undefined;
    return row ? segmentFromRow(row) : undefined;
  }

  ensureInitial(input: {
    threadId: string;
    plan: CraftPlan;
    entityId: string;
    runtimeSessionId: string;
    nativeSessionRef?: string;
  }): RuntimeSegment {
    const active = this.active(input.threadId);
    if (active) {
      if (active.craftPlanId !== input.plan.id) {
        throw new Error("HANDOFF_ACTIVE_PLAN_MISMATCH");
      }
      this.sqlite
        .prepare(
          "UPDATE runtime_segments SET entity_id=?, runtime_session_id=?, native_session_ref=? WHERE id=? AND status='active'",
        )
        .run(input.entityId, input.runtimeSessionId, input.nativeSessionRef ?? null, active.id);
      return this.active(input.threadId)!;
    }
    const latest = this.list(input.threadId).at(-1);
    // A terminated/failed conversation may be started again with the same
    // durable Thread id. Preserve its history but allocate a fresh Segment;
    // returning the old inactive row would leave the new Session unfenced and
    // unable to receive commands.
    return this.insert({
      ...input,
      id: `segment:${input.threadId}:${(latest?.ordinal ?? -1) + 2}`,
      status: "active",
      activatedAt: new Date().toISOString(),
    });
  }

  prepare(input: {
    threadId: string;
    plan: CraftPlan;
    predecessorSegmentId: string;
  }): RuntimeSegment {
    const rows = this.list(input.threadId);
    return this.insert({
      ...input,
      id: `segment:${input.threadId}:${(rows.at(-1)?.ordinal ?? -1) + 2}`,
      status: "preparing",
    });
  }

  private insert(input: {
    threadId: string;
    plan: CraftPlan;
    id: string;
    status: RuntimeSegmentStatus;
    entityId?: string;
    runtimeSessionId?: string;
    nativeSessionRef?: string;
    predecessorSegmentId?: string;
    activatedAt?: string;
  }): RuntimeSegment {
    const last = this.list(input.threadId).at(-1);
    const now = new Date().toISOString();
    const binding = sanitizePortableRecord(input.plan.runtimeBinding);
    this.sqlite
      .prepare(`INSERT INTO runtime_segments
      (id, thread_id, ordinal, binding_epoch, status, craft_plan_id, recipe_id, result_item_id, runtime_binding, entity_id, runtime_session_id, native_session_ref, predecessor_segment_id, created_at, activated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        input.id,
        input.threadId,
        (last?.ordinal ?? -1) + 1,
        (last?.bindingEpoch ?? 0) + 1,
        input.status,
        input.plan.id,
        input.plan.recipeId,
        input.plan.resultItemId,
        JSON.stringify(binding),
        input.entityId ?? null,
        input.runtimeSessionId ?? null,
        input.nativeSessionRef ?? null,
        input.predecessorSegmentId ?? null,
        now,
        input.activatedAt ?? null,
      );
    return this.list(input.threadId).at(-1)!;
  }

  attachRuntime(
    segmentId: string,
    input: {
      entityId: string;
      runtimeSessionId: string;
      nativeSessionRef?: string;
      checkpointId: string;
    },
  ): RuntimeSegment {
    this.sqlite
      .prepare(
        "UPDATE runtime_segments SET entity_id = ?, runtime_session_id = ?, native_session_ref = ?, checkpoint_id = ? WHERE id = ?",
      )
      .run(
        input.entityId,
        input.runtimeSessionId,
        input.nativeSessionRef ?? null,
        input.checkpointId,
        segmentId,
      );
    return segmentFromRow(
      this.sqlite
        .prepare("SELECT * FROM runtime_segments WHERE id = ?")
        .get(segmentId) as SegmentRow,
    );
  }

  activateCas(threadId: string, sourceId: string, targetId: string): RuntimeSegment {
    const now = new Date().toISOString();
    this.sqlite.transaction(() => {
      const source = this.sqlite
        .prepare(
          "UPDATE runtime_segments SET status='inactive', deactivated_at=? WHERE id=? AND thread_id=? AND status='active'",
        )
        .run(now, sourceId, threadId);
      if (source.changes !== 1) throw new Error("HANDOFF_SOURCE_EPOCH_STALE");
      const target = this.sqlite
        .prepare(
          "UPDATE runtime_segments SET status='active', activated_at=? WHERE id=? AND thread_id=? AND status='preparing'",
        )
        .run(now, targetId, threadId);
      if (target.changes !== 1) throw new Error("HANDOFF_TARGET_NOT_READY");
    })();
    return this.active(threadId)!;
  }

  rollbackCas(
    threadId: string,
    sourceId: string,
    targetId: string,
    failureCode: string,
  ): RuntimeSegment {
    const now = new Date().toISOString();
    this.sqlite.transaction(() => {
      const target = this.sqlite
        .prepare(
          "UPDATE runtime_segments SET status='rolled_back', failure_code=?, deactivated_at=? WHERE id=? AND thread_id=? AND status='active'",
        )
        .run(failureCode, now, targetId, threadId);
      if (target.changes !== 1) throw new Error("HANDOFF_ROLLBACK_TARGET_STALE");
      const source = this.sqlite
        .prepare(
          "UPDATE runtime_segments SET status='active', deactivated_at=NULL WHERE id=? AND thread_id=? AND status='inactive'",
        )
        .run(sourceId, threadId);
      if (source.changes !== 1) throw new Error("HANDOFF_ROLLBACK_SOURCE_UNAVAILABLE");
    })();
    return this.active(threadId)!;
  }

  mark(segmentId: string, status: RuntimeSegmentStatus, failureCode?: string): void {
    if (this.closed) return;
    this.sqlite
      .prepare(
        "UPDATE runtime_segments SET status=?, failure_code=?, deactivated_at=CASE WHEN ? IN ('failed','rolled_back','terminated') THEN ? ELSE deactivated_at END WHERE id=?",
      )
      .run(status, failureCode ?? null, status, new Date().toISOString(), segmentId);
  }

  saveCheckpoint(checkpoint: ConversationCheckpoint): void {
    const parsed = conversationCheckpointSchema.parse(checkpoint);
    this.sqlite
      .prepare(
        "INSERT OR REPLACE INTO conversation_checkpoints (id, thread_id, source_segment_id, schema_version, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        parsed.id,
        parsed.threadId,
        parsed.sourceSegmentId,
        parsed.schemaVersion,
        JSON.stringify(parsed),
        parsed.createdAt,
      );
  }

  readPortableItems(threadId: string): import("./checkpointProjection").PortableLedgerItem[] {
    const exists = this.sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_runtime_items'")
      .get();
    if (!exists) return [];
    const rows = this.sqlite
      .prepare(
        "SELECT item_id, type, state, payload, streams FROM thread_runtime_items WHERE thread_id=? ORDER BY position",
      )
      .all(threadId) as Array<{
      item_id: string;
      type: string;
      state: "started" | "updated" | "completed";
      payload: string | null;
      streams: string | null;
    }>;
    return rows.map((row) => ({
      id: row.item_id,
      type: row.type,
      state: row.state,
      ...(row.payload ? { payload: JSON.parse(row.payload) } : {}),
      streams: row.streams ? JSON.parse(row.streams) : {},
    }));
  }

  latestTurnAnchor(threadId: string): string | undefined {
    const exists = this.sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_completed_turns'")
      .get();
    if (!exists) return undefined;
    return (
      (
        this.sqlite
          .prepare(
            "SELECT anchor_item_id AS id FROM thread_completed_turns WHERE thread_id=? ORDER BY idx DESC LIMIT 1",
          )
          .get(threadId) as { id: string | null } | undefined
      )?.id ?? undefined
    );
  }

  saveSwitchState(state: SessionSwitchState): void {
    const parsed = sessionSwitchStateSchema.parse(state);
    this.sqlite
      .prepare(
        "INSERT INTO session_switch_transactions(request_id, thread_id, phase, payload, updated_at) VALUES(?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET phase=excluded.phase,payload=excluded.payload,updated_at=excluded.updated_at",
      )
      .run(
        parsed.requestId,
        parsed.threadId,
        parsed.phase,
        JSON.stringify(parsed),
        parsed.updatedAt,
      );
  }

  readSwitchState(threadId: string): SessionSwitchState | undefined {
    const row = this.sqlite
      .prepare(
        "SELECT payload FROM session_switch_transactions WHERE thread_id=? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(threadId) as { payload: string } | undefined;
    return row ? sessionSwitchStateSchema.parse(JSON.parse(row.payload)) : undefined;
  }

  /**
   * A Supervisor restart loses the in-memory lock/queue and every native
   * process. Resolve any durable non-terminal transaction before accepting
   * new input so it cannot later be mistaken for a live second writer.
   */
  recoverInterruptedSwitches(): SessionSwitchState[] {
    const rows = this.sqlite
      .prepare(
        `SELECT payload FROM session_switch_transactions
         WHERE phase NOT IN ('active', 'rolled_back', 'failed', 'cancelled')
         ORDER BY updated_at`,
      )
      .all() as Array<{ payload: string }>;
    const recovered: SessionSwitchState[] = [];
    for (const row of rows) {
      const state = sessionSwitchStateSchema.parse(JSON.parse(row.payload));
      let rollbackSucceeded = false;
      const active = this.active(state.threadId);
      if (state.targetSegmentId && active?.id === state.targetSegmentId) {
        try {
          this.rollbackCas(
            state.threadId,
            state.sourceSegmentId,
            state.targetSegmentId,
            "HANDOFF_SUPERVISOR_RESTARTED",
          );
          rollbackSucceeded = true;
        } catch {
          rollbackSucceeded = false;
        }
      } else {
        if (state.targetSegmentId) {
          const target = this.sqlite
            .prepare("SELECT * FROM runtime_segments WHERE id = ?")
            .get(state.targetSegmentId) as SegmentRow | undefined;
          if (target && target.status === "preparing") {
            this.mark(target.id, "rolled_back", "HANDOFF_SUPERVISOR_RESTARTED");
          }
        }
        rollbackSucceeded = Boolean(this.active(state.threadId));
      }
      const phase = rollbackSucceeded ? "rolled_back" : "failed";
      state.phase = phase;
      state.updatedAt = new Date().toISOString();
      state.diagnostic = {
        correlationId: state.requestId,
        phase,
        operation: "recover-interrupted-switch",
        code: "HANDOFF_SUPERVISOR_RESTARTED",
        message:
          "The Supervisor restarted before the Runtime switch completed; the transaction was closed without activating two writers.",
        rollback: rollbackSucceeded ? "succeeded" : "failed",
      };
      delete state.activeSegment;
      delete state.activeAccountBinding;
      this.saveSwitchState(state);
      recovered.push(state);
    }
    return recovered;
  }

  archiveStaleEvent(segmentId: string, eventType: string, eventSequence?: number): void {
    this.sqlite
      .prepare(
        "INSERT INTO runtime_segment_event_archive(segment_id,event_type,event_sequence,received_at) VALUES(?,?,?,?)",
      )
      .run(segmentId, eventType, eventSequence ?? null, new Date().toISOString());
  }
}
