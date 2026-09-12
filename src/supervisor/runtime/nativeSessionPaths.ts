import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve a pool/native CLI session to its real on-disk session path for
 * display and copy (the thread context menu "复制 Session 路径").
 *
 * Sources of truth, in order: the managed account home
 * (`credentialRoot`, == GROK_HOME / KIMI_CODE_HOME / CODEX_HOME for pool
 * rows) when a pool account is known, else the ambient host CLI home.
 * Everything is best-effort and read-only: missing homes, missing session
 * files (a fresh session that never turned yet), and WSL-backed threads
 * resolve to null instead of a fabricated path. Never throws.
 */

export interface NativeSessionPathInput {
  /** Base provider kind: grok | kimi | codex | antigravity (others → null). */
  provider: string;
  /** Managed account home; ambient host home when absent. */
  credentialRoot?: string | undefined;
  /** Provider session id from the sessionRef; home dir fallback when absent. */
  nativeSessionId?: string | undefined;
}

function ambientHome(provider: string): string | undefined {
  const home = homedir();
  switch (provider) {
    case "grok":
      return join(home, ".grok");
    case "kimi": {
      const override = process.env["KIMI_CODE_HOME"]?.trim();
      return override ? override : join(home, ".kimi-code");
    }
    case "codex": {
      const override = process.env["CODEX_HOME"]?.trim();
      return override ? override : join(home, ".codex");
    }
    case "antigravity":
      return join(home, ".gemini", "antigravity-cli");
    default:
      return undefined;
  }
}

function childNames(dir: string, limit = 200): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.slice(0, limit);
}

function childDirs(dir: string, limit = 200): string[] {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (out.length >= limit) break;
    try {
      if (entry.isDirectory()) out.push(entry.name);
    } catch {
      // Ignore entries that vanish mid-scan.
    }
  }
  return out;
}

/** Find `<root> / * / <sessionId>` two levels down (grok/kimi layout). */
function findNestedSessionDir(root: string, sessionId: string): string | undefined {
  for (const level1 of childDirs(root)) {
    const candidate = join(root, level1, sessionId);
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Keep scanning.
    }
  }
  return undefined;
}

/** Find a Codex rollout whose session_meta.id matches (newest files first). */
function findCodexRollout(home: string, sessionId: string): string | undefined {
  let sessionsDir: string;
  try {
    sessionsDir = join(home, "sessions");
    if (!statSync(sessionsDir).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const stack: string[] = [sessionsDir];
  const files: string[] = [];
  while (stack.length > 0 && files.length < 300) {
    const dir = stack.pop()!;
    for (const name of childNames(dir, 300)) {
      const full = join(dir, name);
      if (name.endsWith(".jsonl")) {
        files.push(full);
      } else {
        try {
          if (statSync(full).isDirectory()) stack.push(full);
        } catch {
          // Ignore entries that vanish mid-scan.
        }
      }
    }
  }
  const byMtime = files
    .map((path) => {
      try {
        return { path, mtime: statSync(path).mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { path: string; mtime: number } => entry !== undefined)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 60)
    .map((entry) => entry.path);
  for (const path of byMtime) {
    try {
      const firstLine = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
      const parsed = JSON.parse(firstLine) as {
        session_meta?: { id?: unknown };
        id?: unknown;
      };
      const id = parsed.session_meta?.id ?? parsed.id;
      if (id === sessionId) return path;
    } catch {
      // Unparseable rollout — keep scanning.
    }
  }
  return undefined;
}

function dirIfExists(path: string): string | undefined {
  try {
    return statSync(path).isDirectory() ? path : undefined;
  } catch {
    return undefined;
  }
}

function fileIfExists(path: string): string | undefined {
  try {
    return statSync(path).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

export function resolveNativeSessionPath(input: NativeSessionPathInput): string | undefined {
  const home = input.credentialRoot?.trim() || ambientHome(input.provider);
  if (!home) return undefined;
  try {
    if (!statSync(home).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const sessionId = input.nativeSessionId?.trim();
  switch (input.provider) {
    case "grok":
    case "kimi": {
      const sessionsRoot = join(home, "sessions");
      if (sessionId) {
        return findNestedSessionDir(sessionsRoot, sessionId) ?? dirIfExists(sessionsRoot);
      }
      return dirIfExists(sessionsRoot);
    }
    case "codex": {
      const sessionsRoot = join(home, "sessions");
      if (sessionId) {
        return findCodexRollout(home, sessionId) ?? dirIfExists(sessionsRoot);
      }
      return dirIfExists(sessionsRoot);
    }
    case "antigravity": {
      // Host-global conversation store (no per-account redirection).
      const conversations = join(home, "conversations");
      if (sessionId) {
        return (
          fileIfExists(join(conversations, `${sessionId}.pb`)) ??
          fileIfExists(join(conversations, `${sessionId}.db`)) ??
          dirIfExists(conversations)
        );
      }
      return dirIfExists(conversations);
    }
    default:
      return undefined;
  }
}
