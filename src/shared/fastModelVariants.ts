/**
 * Vendor "fast tier" model conventions. Several providers ship the fast lane
 * as a separate advertised model id — Grok exposes `grok-4.7-build-fast` next
 * to `grok-4.7`, Kimi Code exposes `kimi-for-coding-highspeed` next to
 * `kimi-for-coding`. CraftStation surfaces speed as the per-model Fast toggle
 * (`ThreadConfig.fast`), so detection folds these variant rows into their base
 * model and the wire layer rewrites the model id back to the variant.
 */
const FAST_VARIANT_SUFFIXES = ["-build-fast", "-highspeed", "-fast"] as const;

/**
 * Fold advertised fast-variant ids into their base model. A `X-fast` /
 * `X-build-fast` / `X-highspeed` id only counts as a variant when `X` itself
 * is advertised — an unpaired `grok-code-fast-1` stays a standalone row.
 */
export function splitFastModelVariants(modelIds: readonly string[]): {
  /** Picker rows with variant rows removed. */
  models: string[];
  /** Base ids that support `fast` (drives the Fast toggle). */
  fastModels: string[];
  /** Base id -> advertised variant id, for wire-time resolution. */
  fastVariantByBase: Record<string, string>;
} {
  const all = new Set(modelIds);
  const fastModels: string[] = [];
  const fastVariantByBase: Record<string, string> = {};
  const variantIds = new Set<string>();
  for (const id of modelIds) {
    for (const suffix of FAST_VARIANT_SUFFIXES) {
      if (!id.endsWith(suffix)) continue;
      const base = id.slice(0, -suffix.length);
      // First declared variant wins when a base advertises several; a
      // suffix whose stripped base is not advertised (`grok-4.7-build` via
      // `-fast`) must fall through to the next suffix (`-build-fast` →
      // `grok-4.7`).
      if (base.length > 0 && all.has(base) && fastVariantByBase[base] === undefined) {
        fastVariantByBase[base] = id;
        fastModels.push(base);
        variantIds.add(id);
        break;
      }
    }
  }
  return {
    models: modelIds.filter((id) => !variantIds.has(id)),
    fastModels,
    fastVariantByBase,
  };
}

/**
 * Base -> fast-variant spelling for wire paths (launch `-m`, ACP
 * `session/set_model`). The catalog-derived `fastVariantByBase` map wins —
 * Grok's current variant is `grok-4.7-build-fast`, not the `grok-4.7-fast` a
 * naive suffix guess produces. Without a map entry a small heuristic covers
 * the known vendor conventions; anything else returns null so a stale
 * `fast:true` degrades to the base id rather than fabricating `k3-fast`.
 */
export function fastVariantModelId(
  modelId: string,
  fastVariantByBase?: Record<string, string>,
): string | null {
  // Already a variant id (e.g. `grok-4.7-build-fast`) — nothing to rewrite.
  if (FAST_VARIANT_SUFFIXES.some((suffix) => modelId.endsWith(suffix))) return null;
  const mapped = fastVariantByBase?.[modelId];
  if (mapped !== undefined) return mapped;
  if (/(^|\/)kimi-for-coding$/.test(modelId)) return `${modelId}-highspeed`;
  if (/^grok-\d/.test(modelId)) return `${modelId}-build-fast`;
  return null;
}
