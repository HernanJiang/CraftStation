/**
 * Provider retry logs that are not a failed turn.
 *
 * Gemini / Antigravity often stream:
 *   API error (attempt 2) UNAVAILABLE (code 503): No capacity available for
 *   model gemini-3.8-flash-high on the server
 * then succeed on a later attempt. Painting that as assistant text or an
 * error dock is noise — the turn still completes.
 */
export function isRetryableCapacityError(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const attempt = /API error \(attempt \d+\)/i.test(trimmed);
  if (!attempt) return false;
  return (
    /UNAVAILABLE\s*\(code\s*503\)/i.test(trimmed) ||
    /\bcode 503\b/i.test(trimmed) ||
    /No capacity available for model/i.test(trimmed)
  );
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
