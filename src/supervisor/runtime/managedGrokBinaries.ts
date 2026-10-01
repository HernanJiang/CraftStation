import { copyFileSync, existsSync, readdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { isNewerVersion } from "@/shared/agents/updateResolver";

/**
 * Managed Grok binary maintenance.
 *
 * The official `@xai-official/grok` npm wrapper resolves `$GROK_HOME/bin/grok`
 * first and runs it with NO version check; the packaged binary only lands in
 * `$GROK_HOME/bin` when the canonical file is absent. Every CraftStation
 * account-pool Grok profile gets its own `GROK_HOME` under the account store,
 * so its pinned `bin/grok.exe` freezes at the version first launched there —
 * updating the global install never reaches the binaries sessions actually
 * run. Detection and the post-update hook below keep the managed copies in
 * step with the freshly updated default home.
 */

const GROK_BIN_NAME = process.platform === "win32" ? "grok.exe" : "grok";
const GROK_VERSIONED_RE = /^grok-(\d+\.\d+\.\d+)(?:\.exe)?$/;

/** Same resolution the npm wrapper uses: `$GROK_HOME` else `~/.grok`. */
export function defaultGrokHomeDir(): string {
  const override = process.env.GROK_HOME?.trim();
  return override || join(homedir(), ".grok");
}

export function craftStationAccountsRoot(baseDir: string): string {
  return join(baseDir, "craftstation-accounts");
}

/** Every `<accountsRoot>/profile-<id>/bin` that actually holds a grok binary. */
export function listManagedGrokBinDirs(accountsRoot: string): string[] {
  if (!existsSync(accountsRoot)) return [];
  let entries: string[];
  try {
    entries = readdirSync(accountsRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith("profile-") &&
          existsSync(join(accountsRoot, entry.name, "bin", GROK_BIN_NAME)),
      )
      .map((entry) => join(accountsRoot, entry.name, "bin"));
  } catch {
    return [];
  }
  return entries;
}

/** Newest `grok-<semver>` filename inside a bin dir, or undefined. */
export function grokBinVersionFromDir(binDir: string): string | undefined {
  let best: string | undefined;
  let entries: string[];
  try {
    entries = readdirSync(binDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  for (const name of entries) {
    const match = GROK_VERSIONED_RE.exec(name);
    if (!match?.[1]) continue;
    if (!best || isNewerVersion(match[1], best)) best = match[1];
  }
  return best;
}

export interface GrokManagedSyncReport {
  /** Version that was propagated (newest versioned file in the source home). */
  sourceVersion?: string;
  /** Profile ids (`profile-<id>` dir names) whose canonical binary was refreshed. */
  synced: string[];
  /** Profiles already on the source version. */
  current: string[];
  /** Profiles that could not be swapped (typically a running thread holds the exe). */
  stale: { profile: string; error: string }[];
}

/**
 * Copy the newest versioned binary from `sourceHome/bin` into every managed
 * profile bin dir and swap the canonical `grok(.exe)` onto it. A running
 * session locks `grok.exe` on Windows, so the swap first tries an in-place
 * overwrite and falls back to parking the old file as `grok.exe.old-*`;
 * profiles that still fail are reported stale instead of throwing.
 */
export function syncManagedGrokBinaries(input: {
  accountsRoot: string;
  sourceHome: string;
}): GrokManagedSyncReport {
  const report: GrokManagedSyncReport = { synced: [], current: [], stale: [] };
  const sourceBin = join(input.sourceHome, "bin");
  const sourceVersion = grokBinVersionFromDir(sourceBin);
  if (!sourceVersion) return report;
  report.sourceVersion = sourceVersion;
  const ext = process.platform === "win32" ? ".exe" : "";
  const sourceFile = join(sourceBin, `grok-${sourceVersion}${ext}`);
  if (!existsSync(sourceFile)) return report;

  for (const binDir of listManagedGrokBinDirs(input.accountsRoot)) {
    const profile = basename(binDir.replace(/[\\/]bin$/, ""));
    const existing = grokBinVersionFromDir(binDir);
    if (existing && !isNewerVersion(sourceVersion, existing)) {
      report.current.push(profile);
      continue;
    }
    try {
      const destVersioned = join(binDir, `grok-${sourceVersion}${ext}`);
      if (!existsSync(destVersioned)) copyFileSync(sourceFile, destVersioned);
      const canonical = join(binDir, GROK_BIN_NAME);
      try {
        copyFileSync(destVersioned, canonical);
      } catch {
        // A running session locks the exe; rename-aside still works on
        // Windows (rename is allowed on running images, delete is not).
        renameSync(canonical, `${canonical}.old-${Date.now().toString(36)}`);
        copyFileSync(destVersioned, canonical);
      }
      report.synced.push(profile);
    } catch (error) {
      report.stale.push({
        profile,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}
