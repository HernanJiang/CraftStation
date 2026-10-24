import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { writeFileAtomic } from "@/shared/atomicFile";
import { resolveKimiManagedHomeToken } from "./kimiCredentials";

const OFFICIAL_BASES = new Set(["https://api.kimi.com/coding/v1", "https://api.kimi.ai/coding/v1"]);
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Official /models metadata, also used by kimi-code's managed provider refresh. */
export function kimiCatalogAliases(payload: unknown, providerId: string): RecordValue {
  const data = record(payload).data;
  if (!Array.isArray(data) || data.length === 0) throw new Error("KIMI_MODEL_CATALOG_EMPTY");
  const aliases: RecordValue = {};
  for (const item of data) {
    const model = record(item);
    const context = record(model.limit).context;
    if (
      typeof model.id !== "string" ||
      !model.id.trim() ||
      !Number.isSafeInteger(context) ||
      Number(context) <= 0
    ) {
      throw new Error("KIMI_MODEL_CATALOG_INVALID");
    }
    const reasoning = record(model.reasoning);
    const effort = record(reasoning.effort);
    const legacyEffort = record(model.think_efforts);
    const levels = strings(effort.valid ?? legacyEffort.valid_efforts ?? model.support_efforts);
    const defaultEffort = effort.default ?? legacyEffort.default_effort ?? model.default_effort;
    const modalities = strings(record(model.modalities).input);
    const capabilities = [
      ...(reasoning.type === "only" || reasoning.type === "both" ? ["thinking"] : []),
      ...(reasoning.type === "only" ? ["always_thinking"] : []),
      ...modalities
        .filter((type) => ["image", "video", "audio"].includes(type))
        .map((type) => `${type}_in`),
      ...(model.supports_tool_use !== false ? ["tool_use"] : []),
    ];
    aliases[`kimi-code/${model.id}`] = {
      provider: providerId,
      model: model.id,
      max_context_size: context,
      display_name: typeof model.display_name === "string" ? model.display_name : model.id,
      capabilities,
      ...(levels.length ? { support_efforts: levels } : {}),
      ...(typeof defaultEffort === "string" && levels.includes(defaultEffort)
        ? { default_effort: defaultEffort }
        : {}),
      ...(typeof model.protocol === "string" ? { protocol: model.protocol } : {}),
    };
  }
  return aliases;
}

const pending = new Map<string, Promise<boolean>>();

/** Refresh before ACP session/new, which otherwise reads the old config snapshot. */
export function refreshKimiModelCatalog(home: string, signal?: AbortSignal): Promise<boolean> {
  const existing = pending.get(home);
  if (existing) return existing;
  const task = refresh(home, signal).finally(() => pending.delete(home));
  pending.set(home, task);
  return task;
}

async function refresh(home: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const configPath = join(home, "config.toml");
    const original = parse(await readFile(configPath, "utf8"));
    const entry = Object.entries(record(original.providers)).find(
      ([id, value]) =>
        ["kimi-code", "managed:kimi-code"].includes(id) && record(value).type === "kimi",
    );
    if (!entry) return false;
    const [providerId, value] = entry;
    const provider = record(value);
    const base = typeof provider.base_url === "string" ? provider.base_url.replace(/\/+$/, "") : "";
    // Never forward a managed OAuth token to a user-supplied gateway.
    if (!OFFICIAL_BASES.has(base)) return false;
    const token =
      typeof provider.api_key === "string" && provider.api_key && !provider.oauth
        ? { accessToken: provider.api_key }
        : await resolveKimiManagedHomeToken(home);
    if (!token) return false;
    const timeout = AbortSignal.timeout(12_000);
    const response = await fetch(`${base}/models`, {
      headers: {
        ...(record(record(token).raw).identityHeaders as Record<string, string>),
        Authorization: `Bearer ${token.accessToken}`,
        Accept: "application/json",
      },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error(`KIMI_MODEL_CATALOG_HTTP_${response.status}`);
    const aliases = kimiCatalogAliases(await response.json(), providerId);
    signal?.throwIfAborted();
    // Re-read after the request so unrelated settings edited meanwhile survive.
    const current = parse(await readFile(configPath, "utf8"));
    if (JSON.stringify(record(current.providers)[providerId]) !== JSON.stringify(value))
      return false;
    const models = record(current.models);
    for (const [id, model] of Object.entries(models)) {
      if (
        id.startsWith("kimi-code/") &&
        record(model).provider === providerId &&
        !Object.hasOwn(aliases, id)
      )
        delete models[id];
    }
    for (const [id, model] of Object.entries(aliases)) {
      const previous = record(models[id]);
      // Explicit overrides and custom extension fields survive; upstream-owned
      // fields must also be removable when the provider changes capabilities.
      const {
        support_efforts: _efforts,
        default_effort: _default,
        protocol: _protocol,
        ...rest
      } = previous;
      models[id] = { ...rest, ...record(model) };
    }
    current.models = models as NonNullable<typeof current.models>;
    writeFileAtomic(configPath, stringify(current), { encoding: "utf8", mode: 0o600 });
    console.info(
      `[model-catalog] provider=kimi operation=refresh status=success count=${Object.keys(aliases).length}`,
    );
    return true;
  } catch (error) {
    // Do not log provider response bodies or config/credential values.
    const code =
      error instanceof Error && /^KIMI_MODEL_CATALOG_/.test(error.message)
        ? error.message
        : "KIMI_MODEL_CATALOG_UNAVAILABLE";
    console.warn(`[model-catalog] provider=kimi operation=refresh status=cached code=${code}`);
    return false;
  }
}
