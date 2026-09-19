import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CodeHighlightCache } from "../src/renderer/components/thread/ChatPane/parts/items/codeHighlightCache.ts";
import { getShikiHighlighter } from "../src/renderer/components/thread/ChatPane/parts/items/shikiClient.ts";

// 相同真实 Shiki 生成器；before 精确重放旧 CodeBlock 的 200 条 Map 缓存。
// 每个模式独立进程运行，显式 GC 后只测保留堆，不用 synthetic HTML 代替高亮结果。
const [mode, output] = process.argv.slice(2);
assert.ok(mode === "before" || mode === "after");
assert.equal(typeof globalThis.gc, "function", "Run with --expose-gc");
const highlighter = await getShikiHighlighter();
highlighter.codeToHtml('{"warmup":true}', { lang: "json", theme: "github-dark" });
async function heap() {
  for (let round = 0; round < 6; round++) {
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.gc();
  }
  return process.memoryUsage().heapUsed;
}
const cache = mode === "before" ? new Map() : new CodeHighlightCache();
const before = await heap();
let generatedBytes = 0;
let maxHtmlLength = 0;
const cpu = process.cpuUsage();
const start = performance.now();
for (let index = 0; index < 80; index++) {
  const text = JSON.stringify(
    {
      index,
      records: Array.from({ length: 400 }, (_, row) => ({
        row,
        value: `fixture-${index}-${row}`,
        detail: "complete original text",
      })),
      tail: `TAIL_MARKER_${index}`,
    },
    null,
    2,
  );
  const key = `github-dark::json::${text}`;
  const html = highlighter.codeToHtml(text, { lang: "json", theme: "github-dark" });
  assert.ok(html.includes(`TAIL_MARKER_${index}`));
  generatedBytes += (key.length + html.length) * 2;
  maxHtmlLength = Math.max(maxHtmlLength, html.length);
  if (mode === "before" && cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(key, html);
  assert.equal(cache.get(key), html);
}
const wallMs = performance.now() - start;
const usedCpu = process.cpuUsage(cpu);
const after = await heap();
const result = {
  mode,
  blocks: 80,
  highlighter: "production Shiki",
  retainedHeapGrowthBytes: after - before,
  heapBefore: before,
  heapAfter: after,
  generatedTextBudgetBytes: generatedBytes,
  maxHtmlLength,
  wallMs,
  cpuMs: (usedCpu.user + usedCpu.system) / 1000,
};
// 引用保持到最后一次 GC 之后，防止优化器将整个缓存视为无后续用途。
assert.ok(cache);
if (output) writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
