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

// Authorization material must survive syncs in both directions. Direction is
// chosen by state.sqlite mtime, which says nothing about auth freshness — an
// older/emptier data root must never delete or clobber the other side's
// provider authorizations (account rows, credential homes, sealing keys).
// These entries merge by per-file mtime (newer wins, missing restores) and
// are never deleted.
const AUTH_MATERIAL_DIRS = new Set(["craftstation-accounts"]);
const AUTH_MATERIAL_FILE_PATTERN =
  /^(secret-key(\.[0-9a-f]{12})?\.safe|provider-secrets(\.durable)?\.json|secret-key\.durable)$/i;

function isAuthMaterial(name, isDirectory, underAuthDir) {
  if (underAuthDir) return true;
  if (isDirectory) return AUTH_MATERIAL_DIRS.has(name);
  return AUTH_MATERIAL_FILE_PATTERN.test(name);
}

function mtimeMs(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
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

function syncTree(source, target, current = "", underAuthDir = false) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (isExcluded(entry.name, entry.isDirectory())) continue;
    const entryIsAuth =
      isAuthMaterial(entry.name, entry.isDirectory(), underAuthDir) ||
      (entry.isDirectory() && underAuthDir);
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      syncTree(sourcePath, targetPath, join(current, entry.name), entryIsAuth);
    } else if (entry.isFile()) {
      // Auth files merge newer-wins; everything else mirrors the source.
      if (entryIsAuth && existsSync(targetPath) && mtimeMs(sourcePath) <= mtimeMs(targetPath)) {
        continue;
      }
      mkdirSync(join(targetPath, ".."), { recursive: true });
      cpSync(sourcePath, targetPath, { force: true, preserveTimestamps: true });
    }
  }

  // Remove durable files that no longer exist on the source, while retaining
  // excluded runtime directories/files in the target. Authorization material
  // is never deleted: absence on the source only means that side never had
  // (or has not yet synced) those credentials.
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (isExcluded(entry.name, entry.isDirectory())) continue;
    if (isAuthMaterial(entry.name, entry.isDirectory(), underAuthDir)) continue;
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
