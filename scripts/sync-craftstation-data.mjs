#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const [left, right] = process.argv.slice(2);
if (!left || !right) {
  console.error("Usage: sync-craftstation-data.mjs <leftDataDir> <rightDataDir>");
  process.exit(2);
}

const excludedDirectories = new Set(["cache", "logs", "runtime", "userData"]);
const excludedFiles = new Set(["chrome-bridge.json"]);

function isExcluded(name, isDirectory) {
  return isDirectory
    ? excludedDirectories.has(name)
    : excludedFiles.has(name) || /(?:\.lock|\.tmp|\.sqlite-(?:wal|shm))$/i.test(name);
}

function dataMtime(root) {
  const state = join(root, "state.sqlite");
  try {
    return statSync(state).mtimeMs;
  } catch {
    try {
      return statSync(root).mtimeMs;
    } catch {
      return 0;
    }
  }
}

function chooseSource() {
  const leftExists = existsSync(left);
  const rightExists = existsSync(right);
  if (!leftExists && !rightExists) return left;
  if (!leftExists) return right;
  if (!rightExists) return left;
  return dataMtime(right) > dataMtime(left) ? right : left;
}

function syncTree(source, target, current = "") {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (isExcluded(entry.name, entry.isDirectory())) continue;
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      syncTree(sourcePath, targetPath, join(current, entry.name));
    } else if (entry.isFile()) {
      mkdirSync(join(targetPath, ".."), { recursive: true });
      cpSync(sourcePath, targetPath, { force: true, preserveTimestamps: true });
    }
  }

  // Remove durable files that no longer exist on the source, while retaining
  // excluded runtime directories/files in the target.
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (isExcluded(entry.name, entry.isDirectory())) continue;
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (!existsSync(sourcePath)) {
      rmSync(targetPath, { recursive: true, force: true });
    }
  }
}

const source = chooseSource();
const target = source === left ? right : left;
mkdirSync(source, { recursive: true });
mkdirSync(target, { recursive: true });
console.log(`[CraftStation] Syncing data: ${source} -> ${target}`);
syncTree(source, target);
process.exit(0);
