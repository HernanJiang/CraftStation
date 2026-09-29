/**
 * Vendor "fast tier" model conventions. Several providers ship the fast lane
 * as a separate advertised model id — Grok exposes `grok-4.7-fast` next to
 * `grok-4.7`, Kimi Code exposes `kimi-for-coding-highspeed` next to
 * `kimi-for-coding`. CraftStation surfaces speed as the per-model Fast toggle
 * (`ThreadConfig.fast`), so detection folds these variant rows into their base
 * model and the wire layer rewrites the model id back to the variant.
 */
const FAST_VARIANT_SUFFIXES = ["-highspeed", "-fast"] as const;

/**
 * Fold advertised fast-variant ids into their base model. A `X-fast` /
 * `X-highspeed` id only counts as a variant when `X` itself is advertised —
 * an unpaired `grok-code-fast-1` stays a standalone row.
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
      // First declared variant wins when a base advertises several.
      if (base.length > 0 && all.has(base) && fastVariantByBase[base] === undefined) {
        fastVariantByBase[base] = id;
        fastModels.push(base);
        variantIds.add(id);
      }
      break;
    }
  }
  return {
    models: modelIds.filter((id) => !variantIds.has(id)),
    fastModels,
    fastVariantByBase,
  };
}

/**
 * Deterministic base -> fast-variant spelling for wire paths that cannot see
 * the advertised catalog (launch `-m`, ACP `session/set_model`). Returns null
 * for families without a known fast convention — never fabricate an id for an
 * arbitrary model (a stale `fast:true` must degrade to the base id, not to
 * `k3-fast`). Kimi's HighSpeed tier is the only `-highspeed` naming today;
 * versioned Grok ids pair `grok-X` with `grok-X-fast`.
 */
export function fastVariantModelId(modelId: string): string | null {
  // Already a variant id (e.g. `grok-4-fast`) — nothing to rewrite.
  if (FAST_VARIANT_SUFFIXES.some((suffix) => modelId.endsWith(suffix))) return null;
  if (/(^|\/)kimi-for-coding$/.test(modelId)) return `${modelId}-highspeed`;
  if (/^grok-\d/.test(modelId)) return `${modelId}-fast`;
  return null;
}
