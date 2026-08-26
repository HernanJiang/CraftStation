/**
 * Shared helpers for decoding question-answer responses from the renderer.
 *
 * Every provider that accepts question/answer input rounds-trips a response
 * payload through the renderer that can take several shapes:
 *   - `"answer-string"`
 *   - `["a", "b"]`
 *   - `{ answers: ["a", "b"] }`
 *   - `{ optionIds: ["a", "b"] }`
 *   - `{ optionId: "a" }`
 *
 * Each provider used to walk those shapes independently. Keep the decoders
 * here so the providers agree on which shapes are valid.
 */

export function chosenOptionIds(raw: unknown): string[] {
  if (typeof raw === "string") return raw.length > 0 ? [raw] : [];
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === "string" && value.length > 0);
  }
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.answers)) {
    return obj.answers.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  }
  if (Array.isArray(obj.optionIds)) {
    return obj.optionIds.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  }
  if (typeof obj.optionId === "string" && obj.optionId.length > 0) return [obj.optionId];
  return [];
}
