/**
 * Kimi Code CLI streams its context-compaction bookkeeping into the text
 * stream: "Compacting conversation context…", "Compaction is blocked by the
 * current turn…", "Compaction completed.", "Messages compacted: N",
 * "Tokens before/after: …". That is harness-internal status, not assistant
 * or thinking text — painted in chat it reads like an error the user must
 * act on (the "blocked" line especially), when it is purely internal.
 *
 * Line-oriented: the CLI may stream the block line by line or as one chunk.
 * Leave all other text (including in-stream whitespace) untouched.
 */

/** One Kimi CLI compaction status block. Counts are the CLI's own before/after. */
export interface KimiCompactionNotice {
  phase?: "running" | "blocked" | "completed";
  messages?: number;
  before?: number;
  after?: number;
}

const LIST_MARKER = /^\s*(?:[-*•·]\s+)?/;

function compactionBody(line: string): string {
  return line.replace(LIST_MARKER, "").trim();
}

function parseCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw.replaceAll(",", ""), 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readCompactionLine(line: string): KimiCompactionNotice | undefined {
  const body = compactionBody(line);
  if (!body) return undefined;
  if (/^compacting conversation context/i.test(body)) return { phase: "running" };
  if (/^compaction is blocked by the current turn/i.test(body)) return { phase: "blocked" };
  if (/^compaction completed\b/i.test(body)) return { phase: "completed" };
  const messages = parseCount(/^messages compacted:\s*([\d,]+)/i.exec(body)?.[1]);
  if (messages !== undefined) return { messages };
  const before = parseCount(/^tokens before:\s*([\d,]+)/i.exec(body)?.[1]);
  if (before !== undefined) return { before };
  const after = parseCount(/^tokens after:\s*([\d,]+)/i.exec(body)?.[1]);
  if (after !== undefined) return { after };
  return undefined;
}

/** Official compaction facts from a Kimi text chunk. Undefined when the chunk has none. */
export function readKimiCompactionNotice(text: string): KimiCompactionNotice | undefined {
  if (!text) return undefined;
  let notice: KimiCompactionNotice | undefined;
  for (const line of text.split(/\r?\n/)) {
    const part = readCompactionLine(line);
    if (!part) continue;
    notice ??= {};
    if (part.phase) notice.phase = part.phase;
    if (part.messages !== undefined) notice.messages = part.messages;
    if (part.before !== undefined) notice.before = part.before;
    if (part.after !== undefined) notice.after = part.after;
  }
  return notice;
}

export function stripKimiHarnessNoise(text: string): string | undefined {
  if (!text) return undefined;
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => !readCompactionLine(line));
  if (kept.length === lines.length) return text;
  const next = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return next.length > 0 ? next : undefined;
}
