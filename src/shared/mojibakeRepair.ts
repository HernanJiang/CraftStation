import iconv from "iconv-lite";

/**
 * One-shot repair for user text that was corrupted by a UTF-8-as-GBK
 * (mis)encoding round trip — e.g. a settings field written by a tool that
 * decoded the file with the system ANSI codepage. The signature characters
 * (锛/紝/潯/鈥/″…) are the GBK glyph pairs produced when UTF-8 punctuation
 * and CJK bytes are decoded as GBK, and essentially never appear in
 * intentional text.
 */

const MARKER_RE = /[锛紝潯鈥″熺槸繘庤鏄紘娉诲垝璁]/g;
const MIN_MARKERS = 2;

/**
 * Returns the decoded original when `value` looks like UTF-8 text that was
 * mis-decoded as GBK, otherwise the input unchanged. Only Node-side callers
 * (settings readers) use this — it pulls in iconv-lite and must not leak into
 * the renderer bundle.
 */
export function repairGbkMojibake(value: string): string {
  const markers = value.match(MARKER_RE)?.length ?? 0;
  if (markers < MIN_MARKERS) return value;
  let repaired: string;
  try {
    repaired = iconv.decode(iconv.encode(value, "gbk"), "utf8");
  } catch {
    return value;
  }
  if (!repaired || repaired === value) return value;
  // GBK pair-boundary corruption can leave a few unrecoverable bytes
  // (replacement chars / stray '?'); tolerate a small residue — the result is
  // still far more readable than the mojibake — but reject wholesale garbage.
  let fffd = 0;
  for (const ch of repaired) if (ch === "\uFFFD") fffd++;
  if (fffd > 4) return value;
  // A real mojibake round trip shrinks the string (UTF-8 CJK is 3 bytes → 1.5
  // GBK chars on average); reject anything that does not shorten.
  if (repaired.length >= value.length) return value;
  // Repaired text must not still look mojibake itself.
  const stillMarkers = repaired.match(MARKER_RE)?.length ?? 0;
  if (stillMarkers >= MIN_MARKERS) return value;
  return repaired;
}
