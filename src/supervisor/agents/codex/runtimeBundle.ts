import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { resolveCraftStationBaseDir } from "@/shared/craftstationPaths";

const prepared = new Map<string, string>();

function inventory(root: string, timestamps = true): string {
  return JSON.stringify(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        const stat = statSync(path);
        return [relative(root, path), stat.size, ...(timestamps ? [stat.mtimeMs] : [])];
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

/** Pin the executable and its helper processes to one immutable installation.
 * npm can replace a helper while an old app-server remains alive; that mixes
 * IPC versions. Copy the complete vendor bundle, never individual executables.
 */
export function prepareCodexRuntimeBundle(
  executable: string,
  cacheRoot = join(resolveCraftStationBaseDir(), "cache", "codex-runtime"),
): string {
  if (!existsSync(join(dirname(executable), "codex-code-mode-host.exe"))) return executable;
  cacheRoot = resolve(cacheRoot);
  const source =
    basename(dirname(executable)) === "bin" ? dirname(dirname(executable)) : dirname(executable);
  const executableRelative = relative(source, executable);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const files = inventory(source);
    const identity = JSON.stringify({ source, cacheRoot, files });
    const cached = prepared.get(identity);
    if (cached && existsSync(cached)) return cached;
    mkdirSync(cacheRoot, { recursive: true });
    for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("bundle-")) continue;
      const root = join(cacheRoot, entry.name);
      try {
        if (
          readFileSync(join(root, ".source.json"), "utf8") === identity &&
          existsSync(join(root, executableRelative))
        ) {
          const path = join(root, executableRelative);
          prepared.set(identity, path);
          return path;
        }
      } catch {
        /* Incomplete snapshots are never executable candidates. */
      }
    }
    const staging = mkdtempSync(join(cacheRoot, ".staging-"));
    try {
      cpSync(source, staging, { recursive: true, preserveTimestamps: true });
      // Copying timestamps can round sub-millisecond precision on Windows.
      if (inventory(source) !== files || inventory(staging, false) !== inventory(source, false))
        continue;
      writeFileSync(join(staging, ".source.json"), identity, "utf8");
      const destination = join(cacheRoot, `bundle-${basename(staging).slice(".staging-".length)}`);
      renameSync(staging, destination);
      const path = join(destination, executableRelative);
      prepared.set(identity, path);
      return path;
    } finally {
      // Only our unpublished temporary directory is disposable; running bundles
      // are retained so neither CLI updates nor cleanup can replace their helpers.
      if (dirname(staging) === cacheRoot) rmSync(staging, { recursive: true, force: true });
    }
  }
  throw new Error(
    "CODEX_RUNTIME_UPDATING: Codex installation changed during startup. Retry after the CLI update finishes.",
  );
}
