import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { resolveBetterSqliteNativeBindingOptions } from "./connection";
import {
  DATABASE_MIGRATIONS,
  LATEST_SCHEMA_VERSION,
  runDatabaseMigrations,
  validateMigrationRegistry,
} from "./migrations";

// node_modules/better-sqlite3 may be compiled for Electron's ABI (see
// projectsThreads.test.ts). Fall back to the Node-ABI binding used by the
// headless server so the real upgrade-path test never silently skips.
const serverNativeBinding = join(process.cwd(), "dist", "server-native", "better_sqlite3.node");

function openTestSqlite(path: string): InstanceType<typeof Database> {
  const options = resolveBetterSqliteNativeBindingOptions();
  try {
    return new Database(path, options);
  } catch (error) {
    if (options?.nativeBinding || !existsSync(serverNativeBinding)) throw error;
    return new Database(path, { nativeBinding: serverNativeBinding });
  }
}

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
      [37, "runtime segment ledger"],
      [38, "conversation checkpoints"],
      [39, "session switch transactions"],
    ]);
    expect(LATEST_SCHEMA_VERSION).toBe(39);
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

describe("database migration upgrade path", () => {
  it("upgrades a v32 database to the latest schema with the handoff tables and indexes", () => {
    const sqlite = openTestSqlite(":memory:");
    try {
      // Minimal v32 baseline: only the tables that migrations 33+ mutate
      // (projects/threads columns, usage_events dimensions, app_state version).
      sqlite.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          location_kind TEXT NOT NULL,
          location_path TEXT,
          location_distro TEXT,
          location_linux_path TEXT,
          location_unc_path TEXT,
          last_draft_config TEXT,
          scripts TEXT,
          search_settings TEXT,
          worktree_location TEXT,
          mcp_servers TEXT,
          workspace_id TEXT,
          disabled INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          agent_kind TEXT NOT NULL,
          config TEXT NOT NULL,
          status TEXT NOT NULL,
          attention TEXT NOT NULL,
          can_resume_with_config INTEGER NOT NULL DEFAULT 0,
          session_ref TEXT,
          terminal_prompt TEXT,
          worktree_path TEXT,
          worktree_branch TEXT,
          pr_number INTEGER,
          archived INTEGER NOT NULL DEFAULT 0,
          done INTEGER NOT NULL DEFAULT 0,
          done_at TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          active_turn_started_at TEXT,
          last_turn_started_at TEXT,
          last_turn_ended_at TEXT
        );
        CREATE TABLE usage_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          kind TEXT NOT NULL,
          provider TEXT,
          model TEXT,
          mode TEXT,
          fast INTEGER NOT NULL DEFAULT 0,
          effort TEXT,
          name TEXT,
          value INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE app_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO app_state (key, value) VALUES ('schema_version', '32');
      `);

      runDatabaseMigrations(sqlite, 32);

      const objects = sqlite.prepare("SELECT type, name FROM sqlite_master").all() as {
        type: string;
        name: string;
      }[];
      for (const table of [
        "runtime_segments",
        "runtime_segment_event_archive",
        "conversation_checkpoints",
        "session_switch_transactions",
      ]) {
        expect(objects).toContainEqual({ type: "table", name: table });
      }
      expect(objects).toContainEqual({ type: "index", name: "idx_runtime_segments_one_active" });
      expect(objects).toContainEqual({ type: "index", name: "idx_session_switch_one_open" });
      const threadColumns = sqlite.prepare("PRAGMA table_info(threads)").all() as {
        name: string;
      }[];
      expect(threadColumns.some((column) => column.name === "composition_provenance")).toBe(true);
      expect(threadColumns.some((column) => column.name === "account_binding")).toBe(true);
      const version = sqlite
        .prepare("SELECT value FROM app_state WHERE key = 'schema_version'")
        .get() as {
        value: string;
      };
      expect(version.value).toBe(String(LATEST_SCHEMA_VERSION));
      expect(DATABASE_MIGRATIONS.at(-1)?.version).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      sqlite.close();
    }
  });
});
