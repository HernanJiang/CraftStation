/**
 * Provider retry logs that are not a failed turn.
 *
 * Gemini / Antigravity often stream:
 *   API error (attempt 1): UNAVAILABLE (code 503): No capacity available for
 *   model gemini-3.8-flash-high on the server
 * then succeed on a later attempt. Painting that as assistant text or an
 * error dock is noise — the turn still completes.
 *
 * Match both the "API error (attempt N)" wrapper (optional colon) and the
 * bare capacity-503 body, so a post-answer error item still gets dropped.
 * Do not treat generic UNAVAILABLE/quota 503s as retry noise.
 */
export function isRetryableCapacityError(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const capacityPhrase = /No capacity available for model/i.test(trimmed);
  // The capacity phrase is unique retry noise even without the UNAVAILABLE 503
  // wrapper — Gemini/Antigravity/Devin have all streamed it as a bare body.
  if (capacityPhrase) return true;
  const unavailable503 =
    /UNAVAILABLE\s*\(code\s*503\)/i.test(trimmed) || /\bcode 503\b/i.test(trimmed);
  const attempt = /API error\s*\(attempt\s*\d+\)\s*:?/i.test(trimmed);
  return attempt && unavailable503;
}

/** Drop whole chunks / lines that are only retryable capacity noise. */
export function stripRetryableCapacityNoise(text: string): string | undefined {
  if (!text) return undefined;
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => !isRetryableCapacityError(line));
  if (kept.every((line) => line.trim().length === 0)) return undefined;
  if (kept.length === lines.length) return text;
  const next = kept.join("\n").replace(/^\n+|\n+$/g, "");
  return next.length > 0 ? next : undefined;
}
