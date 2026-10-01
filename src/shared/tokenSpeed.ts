/**
 * Estimated token throughput for streamed model output.
 *
 * Providers do not push per-token counters mid-decode (e.g. Codex's
 * `thread/tokenUsage/updated` only lands at each model-call boundary), so a
 * live "tok/s" reading has to be derived from the streamed text itself. The
 * estimate uses two bucket rates for cl100k-class tokenizers: ASCII/code at
 * ~4 chars/token and CJK text at ~1.6 chars/token. It is intentionally a
 * speed gauge, not a billing figure — the persisted usage ledger stays on
 * provider-reported counters only.
 */

/** CJK Unified Ideographs + common CJK punctuation ranges (BMP). */
const CJK_CHAR_RE = /[　-鿿豈-﫿！-｠￠-￦]/u;

const CHARS_PER_TOKEN_CJK = 1.6;
const CHARS_PER_TOKEN_OTHER = 4;

/**
 * Rough token estimate for one streamed text delta. Counts code units
 * (`string.length`) per bucket; surrogate pairs count as 2 units, which is
 * close enough for a rate gauge.
 */
export function estimateStreamedTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const char of text) {
    if (CJK_CHAR_RE.test(char)) cjk += 1;
  }
  const other = text.length - cjk;
  return cjk / CHARS_PER_TOKEN_CJK + other / CHARS_PER_TOKEN_OTHER;
}

/** Format a tokens-per-second reading for the status bar (`≈ 42 tok/s`). */
export function formatTokenRate(tokensPerSecond: number): string {
  if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return "--";
  const rounded =
    tokensPerSecond >= 100 ? Math.round(tokensPerSecond) : Math.round(tokensPerSecond * 10) / 10;
  return `≈ ${rounded} tok/s`;
}
