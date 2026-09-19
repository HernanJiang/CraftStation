import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { SessionEventHistory } from "../src/supervisor/runtime/sessionEventHistory.ts";

// node --expose-gc scripts/measure-session-history-memory.mjs [result.json]
// 测真实生产类的对象可达性，不把 GC 后的 heapUsed 当成整个 Electron 的内存收益。
assert.equal(typeof globalThis.gc, "function", "Run with --expose-gc");
function createRetainedSnapshot(materialize) {
  const history = new SessionEventHistory();
  history.append({ type: "warning", threadId: "probe", message: "initial" });
  const snapshot = history.snapshot({ sessionId: "probe", entityId: "probe", status: "idle" });
  if (materialize) assert.equal(snapshot.events.length, 1);
  const future = [];
  for (let index = 0; index < 512; index++) {
    const event = { type: "warning", threadId: "probe", message: `later-${index}` };
    future.push(new WeakRef(event));
    history.append(event);
  }
  return { snapshot, future };
}

const scenarios = [false, true].map((materialize) => ({
  materialize,
  ...createRetainedSnapshot(materialize),
}));
for (let round = 0; round < 8; round++) {
  await new Promise((resolve) => setImmediate(resolve));
  globalThis.gc();
}
const rows = scenarios.map(({ materialize, snapshot, future }) => {
  const retainedFutureEvents = future.filter((ref) => ref.deref() !== undefined).length;
  assert.equal(retainedFutureEvents, materialize ? 0 : 127);
  assert.equal(snapshot.events.length, 1);
  return {
    materializedBeforeAppend: materialize,
    appendedAfterSnapshot: future.length,
    retainedFutureEvents,
  };
});
const result = { node: process.version, platform: process.platform, rows };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
