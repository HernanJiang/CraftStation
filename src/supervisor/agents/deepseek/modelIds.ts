/**
 * DeepSeek Harness model-id resolution — the single place that decides which
 * model id the official `dsh` runtime is asked to serve.
 *
 * Two wire shapes exist:
 *
 * - ACP (`dsh --profile acp`): the model config option advertises JSON
 *   `[provider, model]` tuple wire values, e.g. `["deepseek-official",
 *   "deepseek-flash"]`. Passing a bare catalog id makes ACP fall back to the
 *   runtime default model, so CraftStation must always send the exact
 *   advertised wire value.
 * - Native JSON-RPC (`dsh --profile sdk` / `dsh-jsonrpc-agent`): the
 *   `initialize` request takes separate `provider` + `model` fields.
 *
 * The official-id table below was verified live against `dsh 0.1.5-rc.1`
 * (2026-09-15): the runtime advertised `deepseek-flash` (display name
 * "DeepSeek-V41-Flash"), `deepseek-v4-flash`, `deepseek-v4-pro` and
 * `deepseek-v4-flash-vision-exp`. Ids outside the explicit table are
 * fail-closed: never forward an unverified id for the runtime to reject
 * against api.deepseek.com (or a custom base URL) as an opaque provider
 * error.
 */

/** pi-ai provider id of the official DeepSeek route inside dsh. */
export const DSH_OFFICIAL_PROVIDER_ID = "deepseek-official";

export interface DshAcpModelWireId {
  provider: string;
  model: string;
}

/**
 * Parse a dsh ACP model wire value of the form `["provider","model"]`.
 * Returns undefined for bare ids and malformed tuples.
 */
export function parseDshAcpModelWireValue(value: string | undefined): DshAcpModelWireId | undefined {
  const trimmed = value?.trim();
  if (!trimmed?.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      parsed[0].trim().length > 0 &&
      parsed[1].trim().length > 0
    ) {
      return { provider: parsed[0], model: parsed[1] };
    }
  } catch {
    // Not JSON — a bare catalog id.
  }
  return undefined;
}

/** Build the exact ACP wire value dsh expects for a provider + model pair. */
export function buildDshAcpModelWireValue(provider: string, model: string): string {
  return JSON.stringify([provider, model.trim()]);
}

/**
 * Official model ids verified against the live dsh advertisement
 * (dsh 0.1.5-rc.1, 2026-09-15).
 */
const OFFICIAL_DSH_MODEL_IDS: ReadonlySet<string> = new Set([
  "deepseek-flash",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "deepseek-v4-flash-vision-exp",
]);

/**
 * CraftStation catalog id → official dsh model id. `deepseek-v4.1-flash` is
 * the catalog spelling of the bare official id `deepseek-flash` (dsh labels
 * it "DeepSeek-V41-Flash").
 */
const CATALOG_TO_OFFICIAL_DSH_MODEL_ID: ReadonlyMap<string, string> = new Map([
  ["deepseek-flash", "deepseek-flash"],
  ["deepseek-v4-flash", "deepseek-v4-flash"],
  ["deepseek-v4-pro", "deepseek-v4-pro"],
  ["deepseek-v4.1-flash", "deepseek-flash"],
]);

/**
 * Resolve a CraftStation catalog model id to an official dsh model id.
 * Returns undefined when the id is not explicitly known — callers must
 * fail closed instead of forwarding an unverified id to the runtime.
 */
export function resolveOfficialDshModelId(modelId: string | undefined): string | undefined {
  const normalized = modelId?.trim() ?? "";
  if (!normalized) return undefined;
  if (OFFICIAL_DSH_MODEL_IDS.has(normalized)) return normalized;
  return CATALOG_TO_OFFICIAL_DSH_MODEL_ID.get(normalized);
}
