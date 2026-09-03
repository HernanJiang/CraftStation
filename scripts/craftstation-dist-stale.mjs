#!/usr/bin/env node
// Exits 0 when the built dist/ output is up to date with tracked sources,
// exits 1 when a rebuild is needed. Used by launch-craftstation.cmd so a
// desktop shortcut always opens the code you just updated.
//
// Staleness rule: any build input newer than either dist entry means stale.
// Build inputs are the directories/files vite + tsdown compile from. Local
// scratch files (specs, fixtures, tmp scripts) are still inputs to some
// configs, so a broad mtime sweep is the safe choice here — the cost is one
// extra `pnpm build` after editing sources, never a stale UI.
import { statSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root || !existsSync(join(root, "package.json"))) {
  console.error("[craftstation] craftstation-dist-stale: missing repo root argument");
  process.exit(2);
}

const distEntries = [
  join(root, "dist", "main", "main.cjs"),
  join(root, "dist", "renderer", "index.html"),
];
const distTimes = distEntries.map((p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
});
const oldestDist = Math.min(...distTimes);
if (oldestDist === 0) {
  console.log("[craftstation] dist entry missing; rebuild required");
  process.exit(1);
}

const inputDirs = ["src", "packages", "public"];
const inputFiles = [
  "index.html",
  "vite.config.ts",
  "tsdown.config.ts",
  "package.json",
  "lingui.config.ts",
  "postcss.config.mjs",
];

let newestInput = 0;
let newestPath = "";

function consider(path, mtimeMs) {
  if (mtimeMs > newestInput) {
    newestInput = mtimeMs;
    newestPath = path;
  }
}

for (const dir of inputDirs) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  const stack = [abs];
  while (stack.length > 0) {
    const dirPath = stack.pop();
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      // Skip node_modules inside packages/ workspaces and Vite caches.
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const child = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        try {
          consider(child, statSync(child).mtimeMs);
        } catch {
          // Unreadable files (locks, pending deletes) never block a launch.
        }
      }
    }
  }
}

for (const file of inputFiles) {
  const abs = join(root, file);
  if (!existsSync(abs)) continue;
  try {
    consider(abs, statSync(abs).mtimeMs);
  } catch {
    // ignore
  }
}

if (newestInput > oldestDist) {
  console.log(`[craftstation] sources newer than dist; rebuild required (newest: ${newestPath})`);
  process.exit(1);
}

console.log("[craftstation] dist is up to date");
process.exit(0);
