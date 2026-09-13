/**
 * Clipboard payload for "Copy Thread Address".
 *
 * Identity is `harness:nativeSessionId`. The on-disk session file/dir is
 * appended only when it is that session — never a project cwd and never a
 * parent `sessions` / `conversations` store.
 */

export interface ThreadAddressClipboardEntry {
  harness: string;
  nativeSessionId?: string | undefined;
  path?: string | null | undefined;
}

export function sessionNameMatches(name: string, sessionId: string): boolean {
  const id = sessionId.trim();
  if (!id) return false;
  const stem = name.replace(/\.(jsonl|json|pb|db|sqlite)$/i, "");
  if (stem === id || name === id) return true;
  const lowerStem = stem.toLowerCase();
  const lowerId = id.toLowerCase();
  if (lowerStem === lowerId) return true;
  if (lowerStem === `session_${lowerId}` || lowerStem === `session-${lowerId}`) return true;
  if (lowerId.startsWith("session_") && lowerStem === lowerId.slice("session_".length)) return true;
  if (lowerId.startsWith("session-") && lowerStem === lowerId.slice("session-".length)) return true;
  return false;
}

export function isGenericSessionStore(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/u, "");
  return /\/(sessions|conversations|storage)$/i.test(normalized);
}

export function formatThreadAddressClipboard(
  entries: readonly ThreadAddressClipboardEntry[],
): string | undefined {
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (line: string) => {
    if (!line || seen.has(line)) return;
    seen.add(line);
    lines.push(line);
  };
  for (const entry of entries) {
    const harness = entry.harness.trim();
    const sessionId = entry.nativeSessionId?.trim();
    if (harness && sessionId) push(`${harness}:${sessionId}`);
    const path = entry.path?.trim();
    if (!path || isGenericSessionStore(path)) continue;
    const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
    if (
      sessionId &&
      !sessionNameMatches(base, sessionId) &&
      !path.toLowerCase().includes(sessionId.toLowerCase())
    ) {
      continue;
    }
    push(path);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}
