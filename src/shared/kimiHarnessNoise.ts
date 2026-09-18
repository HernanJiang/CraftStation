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

const KIMI_COMPACTION_LINE =
  /^\s*(?:Compacting conversation context|Compaction is blocked by the current turn|Compaction completed|Messages compacted:|Tokens (?:before|after):)/i;

export function stripKimiHarnessNoise(text: string): string | undefined {
  if (!text) return undefined;
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => !KIMI_COMPACTION_LINE.test(line));
  if (kept.length === lines.length) return text;
  const next = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return next.length > 0 ? next : undefined;
}
