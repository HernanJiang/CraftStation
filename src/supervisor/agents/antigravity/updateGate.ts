import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * `agy`'s background self-updater gate is the mtime of
 * `~/.gemini/antigravity-cli/last_check.timestamp`: when it is more than ~15
 * minutes stale, the next `agy` invocation spawns `--bg-updater`, which
 * allocates its own VISIBLE console window — the stray terminal users see.
 * `AGY_CLI_DISABLE_AUTO_UPDATE` silences the check only in the process that
 * receives it; `agy` re-execs itself as `language_server` with a filtered
 * environment, so the gate still fires from that grandchild. Refreshing the
 * timestamp is therefore the reliable suppression: every `agy` invocation
 * (ours or foreign, parent or grandchild) then takes the "<15min" fast path
 * and never spawns the updater.
 *
 * `agy` itself writes the file empty — only the mtime carries the signal —
 * so the prime only needs to touch it. Best-effort like the stray-updater
 * reaper in antigravityProcessScan: never throws, never blocks a spawn.
 */
const ANTIGRAVITY_CLI_STATE_DIR = join(homedir(), ".gemini", "antigravity-cli");
const ANTIGRAVITY_LAST_CHECK_FILE = join(ANTIGRAVITY_CLI_STATE_DIR, "last_check.timestamp");

export function primeAntigravityUpdateCheckTimestamp(options?: {
  now?: Date;
  filePath?: string;
}): void {
  const filePath = options?.filePath ?? ANTIGRAVITY_LAST_CHECK_FILE;
  const now = options?.now ?? new Date();
  try {
    utimesSync(filePath, now, now);
  } catch {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, "");
    } catch {
      // Best-effort — never block a spawn on the prime.
    }
  }
}
