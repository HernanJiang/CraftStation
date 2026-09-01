import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DATABASE_MIGRATIONS,
  LATEST_SCHEMA_VERSION,
  runDatabaseMigrations,
  validateMigrationRegistry,
} from "./migrations";

describe("database migration registry", () => {
  it("keeps the published migration history append-only", () => {
    expect(DATABASE_MIGRATIONS.map(({ version, name }) => [version, name])).toEqual([
      [2, "threads.done"],
      [3, "threads.group_id"],
      [4, "threads.group_name"],
      [5, "projects.search_settings"],
      [6, "threads.starred"],
      [7, "normalize model context suffixes"],
      [8, "thread presentation"],
      [9, "thread runtime items"],
      [10, "thread runtime parent item"],
      [11, "thread turn timestamps"],
      [12, "thread completed turns"],
      [13, "projects.disabled"],
      [14, "threads.done_at"],
      [15, "thread context usage"],
      [16, "project notes"],
      [19, "usage events"],
      [20, "thread status source"],
      [21, "scheduled tasks"],
      [22, "scheduled task runs"],
      [23, "scheduled task project"],
      [24, "project MCP servers"],
      [25, "remote command receipts"],
      [26, "thread parent"],
      [27, "token usage ledger"],
      [28, "pull request watches"],
      [29, "project workspace"],
      [30, "repair empty thread models"],
      [31, "project worktree location"],
      [32, "pr watch blocked reason"],
      [33, "project GitHub account"],
      [34, "projects.icon"],
      [35, "threads.composition_provenance"],
      [36, "threads.account_binding and usage dimensions"],
      [40, "thread collaboration ledger"],
    ]);
    expect(LATEST_SCHEMA_VERSION).toBe(40);
    expect(() => validateMigrationRegistry()).not.toThrow();
  });

  it("rejects duplicate, reordered, or non-integer versions", () => {
    expect(() =>
      validateMigrationRegistry([
        { version: 2, name: "first" },
        { version: 2, name: "duplicate" },
      ]),
    ).toThrow(/strictly increasing/i);
    expect(() =>
      validateMigrationRegistry([
        { version: 3, name: "first" },
        { version: 2, name: "reordered" },
      ]),
    ).toThrow(/strictly increasing/i);
    expect(() => validateMigrationRegistry([{ version: 1.5, name: "fractional" }])).toThrow(
      /integer/i,
    );
  });

  it("rejects duplicate migration names", () => {
    expect(() =>
      validateMigrationRegistry([
        { version: 2, name: "same operation" },
        { version: 3, name: "same operation" },
      ]),
    ).toThrow(/name is duplicated/i);
  });
});

const serverNativeBindingCandidates = [
  join(process.cwd(), "dist", "server-native", "better_sqlite3.node"),
  join(process.cwd(), "..", "..", "dist", "server-native", "better_sqlite3.node"),
];
const serverNativeBinding = serverNativeBindingCandidates.find(existsSync);
let nativeBindingEnv: string | undefined;
let sqliteAvailable = true;
try {
  new Database(":memory:").close();
} catch {
  if (serverNativeBinding) nativeBindingEnv = serverNativeBinding;
  else sqliteAvailable = false;
}

/**
 * Minimal pre-v2 base schema (the tables migrations 2..40 alter or reference).
 * Mirrors the CREATE TABLE IF NOT EXISTS baseline in db/connection.ts so the
 * v40 migration body can be exercised in isolation against a legacy database.
 */
function createLegacyBaseTables(sqlite: InstanceType<typeof Database>): void {
  sqlite.exec(`
    CREATE TABLE app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_draft_config TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      agent_kind TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL,
      attention TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function indexNames(sqlite: InstanceType<typeof Database>, table: string): Map<string, boolean> {
  const rows = sqlite.prepare(`PRAGMA index_list(${table})`).all() as Array<{
    name: string;
    unique: number;
  }>;
  return new Map(rows.map((row) => [row.name, row.unique === 1]));
}

describe.skipIf(!sqliteAvailable)("migration v40 thread collaboration ledger", () => {
  let dir: string;
  let sqlite: InstanceType<typeof Database>;

  beforeEach(() => {
    if (nativeBindingEnv) process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
    dir = mkdtempSync(join(tmpdir(), "craftstation-migrations-v40-"));
    sqlite = new Database(
      join(dir, "state.sqlite"),
      nativeBindingEnv ? { nativeBinding: nativeBindingEnv } : undefined,
    );
    sqlite.pragma("foreign_keys = ON");
    createLegacyBaseTables(sqlite);
    // Seed rows the way a real v36 profile would hold them; the v40 migration
    // must upgrade in place without touching them.
    sqlite
      .prepare("INSERT INTO projects (id, name, created_at) VALUES ('project-1', 'Repo', ?)")
      .run("2026-01-01T00:00:00.000Z");
    const insertThread = sqlite.prepare(
      "INSERT INTO threads (id, project_id, title, agent_kind, config, status, attention, created_at, updated_at) VALUES (?, 'project-1', ?, 'codex', '{}', 'idle', 'none', ?, ?)",
    );
    insertThread.run(
      "thread-a",
      "Thread A",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    insertThread.run(
      "thread-b",
      "Thread B",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );

    runDatabaseMigrations(sqlite, 36);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING;
  });

  function insertLink(id: string, participantA: string, participantB: string): void {
    sqlite
      .prepare(
        "INSERT INTO thread_conversation_links (id, project_id, participant_a_thread_id, participant_b_thread_id, status, created_at, updated_at) VALUES (?, 'project-1', ?, ?, 'active', ?, ?)",
      )
      .run(id, participantA, participantB, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  }

  function insertExchange(
    id: string,
    linkId: string,
    sequence: number,
    idempotencyKey: string,
    sourceThreadId = "thread-a",
  ): void {
    sqlite
      .prepare(
        `INSERT INTO thread_exchanges
           (id, link_id, project_id, source_thread_id, target_thread_id, sequence,
            delivery_mode, status, request, source_provenance, target_provenance,
            idempotency_key, request_item_id, hop_depth, created_at, updated_at)
         VALUES (?, ?, 'project-1', ?, 'thread-b', ?, 'after-current-turn', 'created',
                 'question', '{}', '{}', ?, 'item-1', 0, ?, ?)`,
      )
      .run(
        id,
        linkId,
        sourceThreadId,
        sequence,
        idempotencyKey,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
  }

  it("creates both ledger tables with their unique constraints and indexes", () => {
    const tables = new Set(
      (
        sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    expect(tables.has("thread_conversation_links")).toBe(true);
    expect(tables.has("thread_exchanges")).toBe(true);

    const linkIndexes = indexNames(sqlite, "thread_conversation_links");
    expect(linkIndexes.get("idx_thread_conversation_links_participants")).toBe(true);

    const exchangeIndexes = indexNames(sqlite, "thread_exchanges");
    expect(exchangeIndexes.get("idx_thread_exchanges_source_idempotency")).toBe(true);
    expect(exchangeIndexes.get("idx_thread_exchanges_link_sequence_unique")).toBe(true);
    expect(exchangeIndexes.get("idx_thread_exchanges_target_status_sequence")).toBe(false);
    expect(exchangeIndexes.get("idx_thread_exchanges_source_updated")).toBe(false);
    expect(exchangeIndexes.get("idx_thread_exchanges_link_sequence")).toBe(false);
  });

  it("enforces unique (source_thread_id, idempotency_key) on exchanges", () => {
    insertLink("link-1", "thread-a", "thread-b");
    insertExchange("exchange-1", "link-1", 1, "key-1");
    expect(() => insertExchange("exchange-dup", "link-1", 2, "key-1")).toThrow(
      /UNIQUE constraint failed/,
    );
    // A different source thread may reuse the same idempotency key.
    insertExchange("exchange-other-source", "link-1", 3, "key-1", "thread-b");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM thread_exchanges").get()).toMatchObject({
      count: 2,
    });
  });

  it("enforces unique (link_id, sequence) on exchanges", () => {
    insertLink("link-2", "thread-a", "thread-b");
    insertExchange("exchange-2", "link-2", 1, "key-2");
    expect(() => insertExchange("exchange-dup-seq", "link-2", 1, "key-3")).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it("cascades exchange deletion when the conversation link is deleted", () => {
    insertLink("link-3", "thread-a", "thread-b");
    insertExchange("exchange-3", "link-3", 1, "key-4");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM thread_exchanges").get()).toMatchObject({
      count: 1,
    });

    sqlite.prepare("DELETE FROM thread_conversation_links WHERE id = 'link-3'").run();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM thread_exchanges").get()).toMatchObject({
      count: 0,
    });
  });

  it("cascades link deletion when a participant thread is deleted", () => {
    insertLink("link-4", "thread-a", "thread-b");
    insertExchange("exchange-4", "link-4", 1, "key-5");

    sqlite.prepare("DELETE FROM threads WHERE id = 'thread-a'").run();
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM thread_conversation_links").get(),
    ).toMatchObject({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM thread_exchanges").get()).toMatchObject({
      count: 0,
    });
  });

  it("upgrades in place without losing existing project and thread data", () => {
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get()).toMatchObject({
      count: 1,
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM threads").get()).toMatchObject({
      count: 2,
    });
    expect(
      sqlite.prepare("SELECT value FROM app_state WHERE key = 'schema_version'").get(),
    ).toMatchObject({ value: "40" });

    // Re-running the migration (as a retry after a partial failure would) is a
    // no-op that keeps the ledger usable and the data intact.
    expect(() => runDatabaseMigrations(sqlite, 36)).not.toThrow();
    insertLink("link-5", "thread-a", "thread-b");
    insertExchange("exchange-5", "link-5", 1, "key-6");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM thread_exchanges").get()).toMatchObject({
      count: 1,
    });
  });
});
