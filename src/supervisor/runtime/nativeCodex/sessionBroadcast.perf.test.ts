import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { AppServerClient } from "./appServerClient";
import { JsonRpcTransport } from "./jsonRpcTransport";
import { NativeCodexCraftSession } from "./nativeCodexRuntimeAdapter";

// 显式启用，避免性能采样与常规全量测试争抢 CPU。相同脚本可用于改造前后的源码。
it.skipIf(!process.env.CRAFTSTATION_SESSION_BENCHMARK)(
  "measures the real notification-to-session broadcast path without dropping history",
  async () => {
    const rows: Array<{
      count: number;
      readEvery: number;
      samplesMs: number[];
      medianMs: number;
      events: number;
    }> = [];
    for (const readEvery of [0, 100, 1]) {
      for (const count of readEvery === 1 ? [1000, 5000] : [1000, 5000, 15000]) {
        const samplesMs: number[] = [];
        let retained = 0;
        for (let sample = 0; sample < 6; sample++) {
          // 独立采样进入新的 event-loop turn，避免将上一轮的临时对象保活计入下一轮。
          await new Promise<void>((resolve) => setImmediate(resolve));
          const input = new PassThrough();
          const output = new PassThrough();
          const client = new AppServerClient(new JsonRpcTransport(input, output));
          const session = new NativeCodexCraftSession("session", "entity", "thread", client);
          let received = 0;
          let observedSession = "";
          let observedNativeCount = 0;
          const unsubscribe = session.subscribe((_event, snapshot) => {
            received++;
            observedSession = snapshot.sessionId;
            if (readEvery && received % readEvery === 0) {
              retained = snapshot.events.length;
              observedNativeCount = snapshot.nativeEvents?.length ?? 0;
            }
          });
          const notification =
            JSON.stringify({
              jsonrpc: "2.0",
              method: "item/agentMessage/delta",
              params: { threadId: "thread", itemId: "message", delta: "token" },
            }) + "\n";
          const begin = performance.now();
          for (let index = 0; index < count; index++) input.write(notification);
          const elapsed = performance.now() - begin;
          // 首轮只预热；验证放在计时外，确保完整事件和原生 envelope 都保留。
          const snapshot = session.getSnapshot();
          expect(snapshot.events.length).toBeGreaterThanOrEqual(count);
          expect(snapshot.nativeEvents).toHaveLength(snapshot.events.length);
          expect(received).toBe(snapshot.events.length);
          expect(observedSession).toBe("session");
          expect(observedNativeCount).toBe(readEvery ? retained : 0);
          retained = snapshot.events.length;
          if (sample > 0) samplesMs.push(elapsed);
          unsubscribe();
          await session.terminate();
          input.destroy();
          output.destroy();
        }
        rows.push({
          count,
          readEvery,
          samplesMs,
          medianMs: [...samplesMs].sort((a, b) => a - b)[2]!,
          events: retained,
        });
      }
    }
    const result = { node: process.version, platform: process.platform, rows };
    writeFileSync(process.env.CRAFTSTATION_SESSION_BENCHMARK!, JSON.stringify(result, null, 2));
  },
  120_000,
);
