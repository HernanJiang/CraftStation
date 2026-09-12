interface ContextLedgerItem {
  id: string;
  type: string;
  state: string;
  payload?: unknown;
  streams: Record<string, string>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function contentText(payload: unknown): string {
  const content = record(payload)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      const value = record(block);
      if (value?.kind === "text" && typeof value.text === "string") return [value.text];
      if (value?.kind === "file" && typeof value.path === "string") return [`@${value.path}`];
      return [];
    })
    .join("\n");
}

function itemText(item: ContextLedgerItem): string {
  if (item.type === "user_message" || item.type === "assistant_message") {
    return contentText(item.payload) || item.streams.assistant_text || "";
  }
  return "";
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9-_]{8,}/g,
  /xox[bpas]-[A-Za-z0-9-]{8,}/g,
  /gh[pousr]_[A-Za-z0-9]{8,}/g,
  /AIza[A-Za-z0-9-_]{8,}/g,
];

function redactSecrets(text: string): string {
  let next = text;
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, "[redacted]");
  }
  return next;
}

/**
 * Build inherited conversation context for a scheduled run from persisted
 * runtime items. Text only — never native session ids, connections, or
 * process handles. Returns null when there is nothing worth inheriting.
 */
export function buildScheduleThreadContextText(
  items: readonly ContextLedgerItem[],
  options?: { maxMessages?: number; maxChars?: number },
): string | null {
  const maxMessages = options?.maxMessages ?? 8;
  const maxChars = options?.maxChars ?? 4_000;
  const messages = items
    .filter((item) => item.state === "completed")
    .flatMap((item) => {
      if (item.type !== "user_message" && item.type !== "assistant_message") return [];
      const raw = itemText(item).trim();
      if (!raw) return [];
      return [{ role: item.type === "user_message" ? "User" : "Assistant", text: raw }];
    })
    .slice(-maxMessages);
  if (messages.length === 0) return null;
  const lines = messages.map((entry) => `${entry.role}: ${entry.text}`);
  let text = redactSecrets(lines.join("\n\n"));
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}…`;
  return text;
}

/**
 * Last completed assistant text from persisted runtime items. Null when the
 * runtime did not persist a final message — callers must not invent a summary.
 */
export function extractScheduleRunSummary(
  items: readonly ContextLedgerItem[],
): string | null {
  const messages = items
    .filter((item) => item.type === "assistant_message" && item.state === "completed")
    .map((item) => itemText(item).trim())
    .filter((text) => text.length > 0);
  const last = messages.at(-1);
  return last ? redactSecrets(last) : null;
}
