import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { MAX_RUNTIME_OUTPUT_CHARS, RUNTIME_OUTPUT_TRUNCATION_MARKER } from "@/shared/runtimeStream";
import {
  closeDatabase,
  getSqlite,
  initDatabase,
  runStartupDatabaseMaintenance,
} from "./connection";

// 真实 SQLite WAL + 生产初始化/维护链；不与全量测试/构建并行采样。
it.skipIf(!process.env.CRAFTSTATION_DB_BENCHMARK)(
  "measures initDatabase versus deferred startup maintenance",
  () => {
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    const rows = [];
    for (const size of [
      { usage: 10_000, items: 1_000 },
      { usage: 200_000, items: 20_000 },
    ]) {
      const samples: { initMs: number; maintenanceMs: number }[] = [];
      for (let sample = 0; sample < 3; sample++) {
        const directory = mkdtempSync(join(tmpdir(), "craftstation-maintenance-benchmark-"));
        const dbPath = join(directory, "state.sqlite");
        try {
          initDatabase(dbPath);
          const now = Date.now();
          const seed = getSqlite().transaction(() => {
            getSqlite()
              .prepare(
                "INSERT INTO projects (id, name, location_kind, created_at) VALUES ('project', 'benchmark', 'posix', ?)",
              )
              .run("2026-01-01T00:00:00.000Z");
            getSqlite()
              .prepare(
                "INSERT INTO threads (id, project_id, title, agent_kind, config, status, attention, created_at, updated_at) VALUES ('thread', 'project', 'benchmark', 'codex', '{}', 'idle', 'none', ?, ?)",
              )
              .run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
            const insertUsage = getSqlite().prepare(
              "INSERT INTO usage_events (ts, kind, provider, model) VALUES (?, 'completion', 'fixture', 'fixture-model')",
            );
            for (let index = 0; index < size.usage; index++) {
              insertUsage.run(index % 2 === 0 ? now - 800 * 86_400_000 : now - 86_400_000);
            }
            const insertItem = getSqlite().prepare(
              "INSERT INTO thread_runtime_items (thread_id, item_id, position, type, state, streams) VALUES ('thread', ?, ?, 'command_execution', 'completed', ?)",
            );
            for (let index = 0; index < size.items; index++) {
              insertItem.run(
                `item-${index}`,
                index,
                JSON.stringify({ command_output: "x".repeat(4096) }),
              );
            }
            for (let index = 0; index < 20; index++) {
              insertItem.run(
                `oversized-${index}`,
                size.items + index,
                JSON.stringify({ command_output: "x".repeat(MAX_RUNTIME_OUTPUT_CHARS + 1) }),
              );
            }
          });
          seed();
          closeDatabase();

          const initStart = performance.now();
          initDatabase(dbPath);
          const initMs = performance.now() - initStart;

          const maintenanceStart = performance.now();
          runStartupDatabaseMaintenance();
          const maintenanceMs = performance.now() - maintenanceStart;

          const stale = getSqlite()
            .prepare("SELECT COUNT(*) AS count FROM usage_events WHERE ts < ?")
            .get(Date.now() - 730 * 86_400_000) as { count: number };
          expect(stale.count).toBe(0);
          const oversized = getSqlite()
            .prepare("SELECT streams FROM thread_runtime_items WHERE item_id LIKE 'oversized-%'")
            .all() as Array<{ streams: string }>;
          expect(oversized).toHaveLength(20);
          for (const row of oversized) {
            const output = (JSON.parse(row.streams) as { command_output: string }).command_output;
            expect(output).toHaveLength(MAX_RUNTIME_OUTPUT_CHARS);
            expect(output.startsWith(RUNTIME_OUTPUT_TRUNCATION_MARKER)).toBe(true);
          }
          samples.push({ initMs, maintenanceMs });
        } finally {
          closeDatabase();
          rmSync(directory, { recursive: true, force: true });
        }
      }
      rows.push({
        ...size,
        initMs: median(samples.map((sample) => sample.initMs)),
        maintenanceMs: median(samples.map((sample) => sample.maintenanceMs)),
        samples,
      });
    }
    console.log(JSON.stringify(rows));
  },
  120_000,
);
