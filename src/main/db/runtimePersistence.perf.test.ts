import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { closeDatabase, getSqlite, initDatabase } from "./connection";
import { dbUpsertProject, dbUpsertThread } from "./projectsThreads";
import { dbApplyThreadRuntimeEvents, dbGetThreadRuntimeItems } from "./runtimeItems";

// 真实 SQLite WAL + 生产持久化链；不与全量测试/构建并行采样。
it.skipIf(!process.env.CRAFTSTATION_DB_BENCHMARK)(
  "measures durable concurrent streaming batches",
  async () => {
    const rows = [];
    for (const threads of [1, 8]) {
      const samples = [];
      for (let sample = 0; sample < 6; sample++) {
        const directory = mkdtempSync(join(tmpdir(), "craftstation-db-benchmark-"));
        const dbPath = join(directory, "state.sqlite");
        try {
          initDatabase(dbPath);
          const now = "2026-09-19T00:00:00.000Z";
          dbUpsertProject(
            {
              id: "project",
              name: "benchmark",
              location: { kind: "posix", path: directory },
              createdAt: now,
            },
            0,
          );
          for (let index = 0; index < threads; index++) {
            const thread: Thread = {
              id: `thread-${index}`,
              projectId: "project",
              title: "benchmark",
              agentKind: "codex",
              config: { model: "fixture" },
              status: "working",
              attention: "working",
              canResumeWithConfig: false,
              archived: false,
              done: false,
              starred: false,
              presentationMode: "gui",
              createdAt: now,
              updatedAt: now,
            };
            dbUpsertThread(thread, index);
            dbApplyThreadRuntimeEvents(thread.id, [
              {
                type: "item.started",
                threadId: thread.id,
                itemId: "answer",
                itemType: "assistant_message",
              },
            ]);
          }
          getSqlite().pragma("wal_checkpoint(TRUNCATE)");
          await new Promise<void>((resolve) => setImmediate(resolve));
          const cpu = process.cpuUsage();
          const heapStart = process.memoryUsage().heapUsed;
          let heapPeak = heapStart;
          const begin = performance.now();
          for (let tick = 0; tick < 1000; tick++) {
            for (let index = 0; index < threads; index++) {
              const threadId = `thread-${index}`;
              dbApplyThreadRuntimeEvents(threadId, [
                {
                  type: "content.delta",
                  threadId,
                  itemId: "answer",
                  stream: "assistant_text",
                  delta: "可复现 runtime delta 🙂\n",
                },
              ]);
            }
            if (tick % 100 === 0) heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
          }
          const wallMs = performance.now() - begin;
          const usedCpu = process.cpuUsage(cpu);
          const data = {
            wallMs,
            cpuMs: (usedCpu.user + usedCpu.system) / 1000,
            heapPeakGrowthBytes: heapPeak - heapStart,
            databaseBytes: statSync(dbPath).size,
            walBytes: statSync(`${dbPath}-wal`).size,
          };
          for (let index = 0; index < threads; index++) {
            const threadId = `thread-${index}`;
            const text = dbGetThreadRuntimeItems(threadId)[0]?.streams.assistant_text;
            expect(text).toBe("可复现 runtime delta 🙂\n".repeat(1000));
          }
          if (sample > 0) samples.push(data);
        } finally {
          closeDatabase();
          rmSync(directory, { recursive: true, force: true });
        }
      }
      rows.push({ threads, batches: threads * 1000, samples });
    }
    writeFileSync(
      process.env.CRAFTSTATION_DB_BENCHMARK!,
      JSON.stringify({ node: process.version, rows }, null, 2),
    );
  },
  120_000,
);
