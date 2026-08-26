import type { AgentCapability, LabeledOption } from "@/shared/contracts";

/**
 * Snap a raw token count to a clean human label that round-trips through the
 * renderer's `parseContextTokenLimit` (which only accepts `\d+(?:\.\d+)?[kKmM]`).
 *
 * Power-of-two registry sizes like 131072 are reported as "128K" (the
 * conventional name) instead of "131K"; round counts pass through verbatim.
 */
export function formatContextWindowLabel(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "";
  const POWERS_OF_TWO_K = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    const rounded = Math.round(m * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded.toFixed(0)}M` : `${rounded.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1024;
    const snapPow2 = POWERS_OF_TWO_K.find((size) => Math.abs(k - size) / size < 0.02);
    if (snapPow2) return `${snapPow2}K`;
    return `${Math.round(tokens / 1000)}K`;
  }
  return String(tokens);
}

/**
 * Build the `contextSizes` / `modelContextSizes` capability fields from a
 * `modelId → tokenLimit` map. Sizes are deduplicated by label and sorted
 * ascending. Use when a provider knows each model's context window upfront
 * (registry lookup, hardcoded table, etc.) and wants the renderer's
 * context-usage dock + model-picker description to surface the value.
 */
export function buildContextSizeCapabilities(
  modelTokens: ReadonlyMap<string, number>,
): Pick<AgentCapability, "contextSizes" | "modelContextSizes"> {
  const sizesById = new Map<string, { id: string; label: string; tokens: number }>();
  const modelContextSizes: Record<string, string[]> = {};
  for (const [modelId, tokens] of modelTokens) {
    const label = formatContextWindowLabel(tokens);
    if (!label) continue;
    if (!sizesById.has(label)) {
      sizesById.set(label, { id: label, label, tokens });
    }
    modelContextSizes[modelId] = [label];
  }
  const contextSizes: LabeledOption[] = [...sizesById.values()]
    .sort((a, b) => a.tokens - b.tokens)
    .map(({ id, label }) => ({ id, label }));
  return {
    ...(contextSizes.length > 0 ? { contextSizes } : {}),
    ...(Object.keys(modelContextSizes).length > 0 ? { modelContextSizes } : {}),
  };
}
