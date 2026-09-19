import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";

// 隔离文件系统延迟，测生产 writer 的已排空条目是否仍保活，不制造一万个真实日志文件。
assert.equal(typeof globalThis.gc, "function", "Run node --expose-gc");
const original = fs.appendFile;
fs.appendFile = async () => {};
syncBuiltinESMExports();
const { BufferedLogWriter } = await import("../src/supervisor/runtime/bufferedLogWriter.ts");
const writer = new BufferedLogWriter();
async function collect() {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.gc();
  }
  return process.memoryUsage().heapUsed;
}
const before = await collect();
for (let index = 0; index < 10_000; index++) {
  const path = `fixture/independent-thread-${index}/output.log`;
  writer.append(path, "fixture text");
  await writer.flush(path);
}
const after = await collect();
const result = {
  paths: 10_000,
  heapBefore: before,
  heapAfter: after,
  retainedHeapGrowthBytes: after - before,
  retainedEntries: writer.entries.size,
  fsMocked: true,
};
assert.equal(writer.entries.size <= 10_000, true);
await writer.dispose();
fs.appendFile = original;
syncBuiltinESMExports();
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
