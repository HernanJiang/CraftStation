import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, bumpProfileDataGeneration, initDatabase } from "../db/connection";
import { dbAppendUsageEvents } from "../db/usageEvents";
import { computeProfileCoreStats } from "./coreStats";

const serverNativeBinding = join(process.cwd(), "dist", "server-native", "better_sqlite3.node");
let nativeBindingEnv: string | undefined;
let sqliteAvailable = true;
try {
  new Database(":memory:").close();
} catch {
  if (existsSync(serverNativeBinding)) {
    nativeBindingEnv = serverNativeBinding;
  } else {
    sqliteAvailable = false;
  }
}

describe.skipIf(!sqliteAvailable)("coreStats craft modes + AI git actions (real sqlite)", () => {
  let dir: string;

  beforeEach(() => {
    if (nativeBindingEnv) {
      process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
    }
    dir = mkdtempSync(join(tmpdir(), "craftstation-corestats-test-"));
    initDatabase(join(dir, "state.sqlite"));
    // Fresh DB file, but the usage-events + core caches are keyed on the
    // process-global profile generation: invalidate so this test never reads
    // the previous test's rows.
    bumpProfileDataGeneration();
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING;
  });

  it("counts only auto/efficient/creative craft_mode uses with shares", () => {
    const ts = Date.now();
    dbAppendUsageEvents([
      { ts, kind: "craft_mode", name: "auto", provider: "codex", model: "gpt-5.6" },
      { ts, kind: "craft_mode", name: "auto", provider: "codex", model: "gpt-5.6" },
      { ts, kind: "craft_mode", name: "auto", provider: "codex", model: "gpt-5.6" },
      { ts, kind: "craft_mode", name: "efficient", provider: "codex", model: "gpt-5.6" },
      // Unknown mode names and legacy chat/CLI presentation rows are ignored.
      { ts, kind: "craft_mode", name: "turbo" },
      { ts, kind: "thread_started", provider: "codex", model: "gpt-5.6", mode: "chat" },
      { ts, kind: "thread_started", provider: "codex", model: "gpt-5.6", mode: "cli" },
    ]);

    const stats = computeProfileCoreStats({ utcOffsetMinutes: 0 });
    expect(stats.modes).toEqual([
      { key: "auto", label: "自动模式", count: 3, percent: 75 },
      { key: "efficient", label: "高效模式", count: 1, percent: 25 },
    ]);
    // Legacy presentation rows still count threads, never modes.
    expect(stats.totals.totalThreads).toBe(2);
  });

  it("returns an honest empty mode list with no craft_mode rows", () => {
    const stats = computeProfileCoreStats({ utcOffsetMinutes: 0 });
    expect(stats.modes).toEqual([]);
  });

  it("aggregates commit/push/pr/conflict/branch and buckets unknown kinds as other", () => {
    const ts = Date.now();
    dbAppendUsageEvents([
      { ts, kind: "ai_commit", provider: "codex", model: "gpt-5.6" },
      { ts, kind: "ai_commit", provider: "codex", model: "gpt-5.6" },
      { ts, kind: "ai_push", provider: "codex", model: "gpt-5.6" },
      { ts, kind: "ai_conflict", provider: "codex", model: "gpt-5.6" },
      { ts, kind: "ai_future_kind", provider: "codex", model: "gpt-5.6" },
    ]);

    const stats = computeProfileCoreStats({ utcOffsetMinutes: 0 });
    expect(stats.aiActions.map((a) => a.type)).toEqual([
      "commit",
      "push",
      "conflict",
      "other",
    ]);
    const byType = new Map(stats.aiActions.map((a) => [a.type, a]));
    expect(byType.get("commit")).toMatchObject({ label: "Commit", count: 2 });
    expect(byType.get("push")).toMatchObject({ label: "Push", count: 1 });
    expect(byType.get("conflict")).toMatchObject({ label: "Merge / Conflict Resolve", count: 1 });
    expect(byType.get("other")).toMatchObject({ label: "其他 Git Action", count: 1 });
    // Zero-count kinds (pr, branch) are omitted, never fabricated.
    expect(byType.has("pr")).toBe(false);
    expect(byType.has("branch")).toBe(false);
  });
});
