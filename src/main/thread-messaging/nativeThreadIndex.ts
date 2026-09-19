import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSqlite } from "../db/connection";
import {
  formatNativeAddress,
  normalizeWorkspacePath,
  parseNativeAddress,
} from "@/shared/nativeThreads";

/**
 * Native thread index: stable `harness:nativeId` addresses, workspace peer
 * scope, and the durable CraftStation-thread binding for claimed external
 * threads. Discovery reads provider-native session stores directly and never
 * creates sessions; binding never copies messages.
 */

export interface DiscoveredNativeThread {
  harness: string;
  nativeId: string;
  address: string;
  workspace: string | null;
  title: string;
  updatedAt: number | undefined;
}

export interface NativeBinding {
  address: string;
  threadId: string;
  harness: string;
  nativeId: string;
  workspace: string;
  origin: string;
  boundAt: string;
}

const ADDRESS_PART = /^[A-Za-z0-9_.-]+$/;

/** This round's in-scope harnesses. Others are rejected, never guessed. */
export const NATIVE_MESSAGING_HARNESSES: ReadonlySet<string> = new Set([
  "codex",
  "kimi",
  "opencode",
  "grok",
  "antigravity",
  "devin",
]);

export function assertKnownHarness(harness: string): void {
  if (!NATIVE_MESSAGING_HARNESSES.has(harness)) {
    throw new Error(
      `Harness "${harness}" is not in this round's native-messaging scope (${[...NATIVE_MESSAGING_HARNESSES].join(", ")}).`,
    );
  }
  if (!ADDRESS_PART.test(harness)) throw new Error(`Invalid harness id: ${harness}.`);
}

/**
 * Best-effort harness from a model id so CrossAgents spawn/switch cannot
 * silently keep the sender's harness while the UI shows a different model.
 * Returns null when the model does not imply a known native harness.
 */
export function inferNativeHarnessFromModel(model: string): string | null {
  const value = model.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("gemini") || value.startsWith("google:") || value.includes("antigravity")) {
    return "antigravity";
  }
  if (value.includes("grok") || value.startsWith("xai:")) return "grok";
  // Cognition Devin family (swe, swe-1, swe-2-max, …). No kimi/codex model id
  // carries these markers, so the check cannot steal an existing inference.
  if (
    value === "swe" ||
    /^swe[-_]/.test(value) ||
    value.includes("cognition") ||
    value.includes("devin")
  ) {
    return "devin";
  }
  if (value.includes("kimi") || value.startsWith("moonshot:") || /^k[0-9]/.test(value)) {
    return "kimi";
  }
  if (value.includes("muse") || value.includes("opencode")) return "opencode";
  if (
    value.includes("codex") ||
    value.startsWith("openai:") ||
    value.includes("gpt-") ||
    /^o[0-9]/.test(value)
  ) {
    return "codex";
  }
  return null;
}

export function resolveWorkspace(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  try {
    return normalizeWorkspacePath(realpathSync.native(normalized));
  } catch {
    return normalized;
  }
}

export function workspacesEqual(left: string, right: string): boolean {
  return resolveWorkspace(left) === resolveWorkspace(right);
}

export interface CodexDiscoveryOptions {
  /** Extra Codex homes to scan (managed profiles); host default is always included. */
  extraHomes?: readonly string[];
  /** Only return threads whose recorded cwd matches this workspace. */
  workspace?: string;
  /** Cap on rollout files read per scan (newest first by mtime). */
  maxFiles?: number;
}

function codexHomeCandidates(extraHomes: readonly string[] = []): string[] {
  const homes = [join(homedir(), ".codex")];
  const envHome = process.env.CODEX_HOME?.trim();
  if (envHome) homes.push(envHome);
  for (const extra of extraHomes) {
    if (extra.trim()) homes.push(extra.trim());
  }
  return [...new Set(homes)];
}

interface RolloutFile {
  path: string;
  mtimeMs: number;
}

function collectRolloutFiles(sessionsDir: string, out: RolloutFile[], budget: number): void {
  if (out.length >= budget) return;
  let names: string[];
  try {
    names = readdirSync(sessionsDir, { withFileTypes: true }).map((entry) =>
      entry.isDirectory() ? `${entry.name}/` : entry.name,
    );
  } catch {
    return;
  }
  for (const name of names) {
    if (out.length >= budget) return;
    const full = join(sessionsDir, name);
    if (name.endsWith("/")) {
      collectRolloutFiles(full, out, budget);
      continue;
    }
    if (!name.endsWith(".jsonl")) continue;
    try {
      out.push({ path: full, mtimeMs: statSync(full).mtimeMs });
    } catch {
      continue;
    }
  }
}

function readSessionMeta(
  path: string,
): { id: string; cwd?: string; updatedAt?: number } | undefined {
  let firstLine: string;
  try {
    const content = readFileSync(path, "utf8");
    firstLine = content.split(/\r?\n/, 1)[0] ?? "";
    if (!firstLine) return undefined;
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: { id?: string; cwd?: string };
    };
    if (parsed.type !== "session_meta" || !parsed.payload?.id) return undefined;
    return {
      id: parsed.payload.id,
      ...(parsed.payload.cwd ? { cwd: parsed.payload.cwd } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Discover Codex native threads by scanning rollout stores (host default +
 * managed homes). Matches Test D's requirement: a thread created by a plain
 * external `codex` CLI is discoverable without CraftStation ever spawning.
 */
export function discoverCodexThreads(
  options: CodexDiscoveryOptions = {},
): DiscoveredNativeThread[] {
  const maxFiles = options.maxFiles ?? 500;
  const workspace = options.workspace ? resolveWorkspace(options.workspace) : undefined;
  const seen = new Map<string, DiscoveredNativeThread>();
  for (const home of codexHomeCandidates(options.extraHomes)) {
    const sessionsDir = join(home, "sessions");
    if (!existsSync(sessionsDir)) continue;
    const files: RolloutFile[] = [];
    collectRolloutFiles(sessionsDir, files, maxFiles);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const file of files) {
      const meta = readSessionMeta(file.path);
      if (!meta) continue;
      if (workspace && (!meta.cwd || resolveWorkspace(meta.cwd) !== workspace)) continue;
      if (seen.has(meta.id)) continue;
      seen.set(meta.id, {
        harness: "codex",
        nativeId: meta.id,
        address: formatNativeAddress("codex", meta.id),
        workspace: meta.cwd ? resolveWorkspace(meta.cwd) : null,
        title: meta.id,
        updatedAt: Math.floor(file.mtimeMs),
      });
    }
  }
  return [...seen.values()];
}

// -- Durable bindings (native_thread_bindings, migration v41) ---------------

export function getNativeBinding(address: string): NativeBinding | null {
  const { harness } = parseNativeAddress(address);
  assertKnownHarness(harness);
  const row = getSqlite()
    .prepare("SELECT * FROM native_thread_bindings WHERE address = ?")
    .get(address) as NativeBindingRow | undefined;
  return row ? rowToBinding(row) : null;
}

export function getNativeBindingByThread(threadId: string): NativeBinding | null {
  const row = getSqlite()
    .prepare("SELECT * FROM native_thread_bindings WHERE thread_id = ?")
    .get(threadId) as NativeBindingRow | undefined;
  return row ? rowToBinding(row) : null;
}

export function listNativeBindingsByWorkspace(workspace: string): NativeBinding[] {
  const rows = getSqlite()
    .prepare("SELECT * FROM native_thread_bindings WHERE workspace = ? ORDER BY bound_at ASC")
    .all(resolveWorkspace(workspace)) as NativeBindingRow[];
  return rows.map(rowToBinding);
}

export function putNativeBinding(input: {
  address: string;
  threadId: string;
  workspace: string;
  origin: "craftstation" | "external";
  boundAt: string;
}): NativeBinding {
  const { harness, nativeId } = parseNativeAddress(input.address);
  assertKnownHarness(harness);
  getSqlite()
    .prepare(
      `INSERT INTO native_thread_bindings
         (address, thread_id, harness, native_id, workspace, origin, bound_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         thread_id = excluded.thread_id,
         workspace = excluded.workspace,
         origin = excluded.origin,
         bound_at = excluded.bound_at`,
    )
    .run(
      input.address,
      input.threadId,
      harness,
      nativeId,
      resolveWorkspace(input.workspace),
      input.origin,
      input.boundAt,
    );
  return getNativeBinding(input.address)!;
}

export function deleteNativeBindingsForThread(threadId: string): void {
  getSqlite().prepare("DELETE FROM native_thread_bindings WHERE thread_id = ?").run(threadId);
}

export function deleteNativeBinding(address: string): void {
  getSqlite().prepare("DELETE FROM native_thread_bindings WHERE address = ?").run(address);
}

interface NativeBindingRow {
  address: string;
  thread_id: string;
  harness: string;
  native_id: string;
  workspace: string;
  origin: string;
  bound_at: string;
}

function rowToBinding(row: NativeBindingRow): NativeBinding {
  return {
    address: row.address,
    threadId: row.thread_id,
    harness: row.harness,
    nativeId: row.native_id,
    workspace: row.workspace,
    origin: row.origin,
    boundAt: row.bound_at,
  };
}
