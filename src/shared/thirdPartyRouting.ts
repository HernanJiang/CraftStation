import {
  applyAutoDeepseekHarnessLaunch,
  modelProviderPrefix,
  preferredHarnessForCompatibilityFamily,
  resolveCompatibilityFamily,
  stripModelProviderPrefix,
  type CompatibilityHarnessId,
} from "./harnessCompatibility";
import { baseAgentKind } from "./contracts";
import { resolveCommandCodeNativeModelId } from "./commandCodeModelIds";

/**
 * Third-party launch routing (chat lane).
 *
 * Pure helpers deciding which credential source a launch uses. Invariant:
 * `modelSource = "third-party"` NEVER enters the subscription Account Pool —
 * the credential source stays sticky third-party for the session lifetime
 * (initial spawn and every restart/resume reuses the recorded binding).
 */

export const THIRD_PARTY_ACCOUNT_PROVIDER = "openai-compatible";

/** Isolated OpenCode custom-provider id for third-party Base URL + key. */
export const THIRD_PARTY_OPENCODE_PROVIDER_ID = "craftstation";

/**
 * Keep the remote model id independent from CraftStation's OpenCode provider
 * namespace. OpenCode addresses a configured model as `provider/model`, but
 * that provider prefix is transport metadata, not part of the user's model
 * name. Strip only our reserved prefix so legitimate upstream ids containing
 * other slashes remain unchanged.
 */
export function normalizeThirdPartyModelId(modelId: string): string {
  const trimmed = modelId.trim();
  const prefix = `${THIRD_PARTY_OPENCODE_PROVIDER_ID}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : trimmed;
}

export function isThirdPartyAccountId(accountId: string | undefined | null): accountId is string {
  return typeof accountId === "string" && accountId.startsWith(`${THIRD_PARTY_ACCOUNT_PROVIDER}:`);
}

function harnessIsInstalled(kind: string, installed: readonly string[] | undefined): boolean {
  return installed === undefined || installed.includes(kind);
}

/**
 * Model-name → Harness for a third-party OpenAI-compatible channel.
 *
 * Prefer the model's native Harness when the user has it installed:
 * ChatGPT → Codex, Kimi → Kimi Code, Grok → Grok Build, DeepSeek → DeepSeek
 * Harness. Muse stays on OpenCode by default because Muse Code is WSL-only on
 * Windows. Gemini's native Antigravity cannot consume an
 * OpenAI-compatible Base URL, so it always falls through. Missing vendor or
 * missing install → OpenCode. The sticky openai-compatible account is always
 * the credential — never a subscription pool. Native catalog picks have no
 * third-party accountId and never go through this helper.
 */
export function resolveThirdPartyHarnessForModel(
  modelId: string,
  installed?: readonly string[],
): CompatibilityHarnessId {
  const family = resolveCompatibilityFamily(modelId);
  const preferred = preferredHarnessForCompatibilityFamily(family);
  if (preferred === "antigravity") return "opencode";
  if (harnessIsInstalled(preferred, installed)) return preferred;
  return harnessIsInstalled("opencode", installed) ? "opencode" : preferred;
}

export interface ThirdPartyPickerSelection {
  agentKind: string;
  model: string;
  presentationMode?: "terminal" | "gui";
  accountId?: string;
  /** Catalog/channel that listed the model. Set when harness ≠ provider. */
  sourceProviderKind?: string;
}

export interface AutoModelBinding {
  /** Process that will actually spawn. */
  harnessId: string;
  /** Catalog/channel that listed the model. */
  providerId: string;
  /** Exact catalog model id. Never rewritten to a harness default. */
  providerModelId: string;
}

/**
 * Picker / composer identity is the catalog channel, not the spawn Harness.
 * After Auto Mode remaps Command Code → DeepSeek Harness,
 * `sourceProviderKind` keeps the row the user actually picked.
 */
export function catalogProviderKind(input: {
  agentKind: string;
  sourceProviderKind?: string | undefined;
}): string {
  const source = input.sourceProviderKind?.trim();
  return source && source.length > 0 ? source : input.agentKind;
}

/**
 * Bottom-right composer identity.
 *
 * Auto remap (Command Code → DeepSeek) keeps the
 * catalog row the user picked. An explicit recipe / 合成台 composition
 * (Antigravity Gemini onto OpenCode) keeps the spawn Harness — that is the
 * process the user composed, not the catalog the model card came from.
 */
export function composerPickerAgentKind(input: {
  agentKind: string;
  model: string;
  sourceProviderKind?: string | undefined;
  installed?: readonly string[] | undefined;
}): string {
  const source = input.sourceProviderKind?.trim();
  if (!source || source === input.agentKind) return input.agentKind;
  const auto = applyThirdPartyPickerSelection(
    { agentKind: source, model: input.model },
    input.installed,
  );
  if (auto.agentKind === input.agentKind) return source;
  return input.agentKind;
}

/**
 * Model-catalog channel aliases: the channel prefix embedded in a catalog
 * model id does not always equal the serving Harness kind (`opencode-go/...`
 * rows are served by the `opencode` Harness).
 */
const MODEL_CATALOG_CHANNEL_ALIASES: Record<string, string> = {
  "opencode-go": "opencode",
  // `step/…` ids are Step Code's own built-in catalog channel, not a foreign
  // third-party projection — don't treat them as foreign on the stepcode lane.
  step: "stepcode",
};

/**
 * Catalog/channel embedded in a `provider/model` id, normalized to the
 * Harness kind that serves it. Bare model ids carry no channel provenance —
 * undefined.
 */
export function modelCatalogChannel(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  const prefix = modelProviderPrefix(modelId)?.trim().toLowerCase();
  if (!prefix) return undefined;
  return MODEL_CATALOG_CHANNEL_ALIASES[prefix] ?? prefix;
}

/**
 * Whether a persisted thread's model id names a catalog channel different
 * from its spawn Harness. Threads created before `sourceProviderKind` was
 * recorded (or via surfaces that never stamp it, e.g. App Controls MCP)
 * still carry their provenance in the id: `opencode-go/muse-spark-…` on the
 * `muse` Harness can only be served through the OpenCode channel, so the
 * Harness's own official login must never gate it.
 */
export function isForeignCatalogModelForHarness(
  model: string | undefined,
  agentKind: string | undefined,
): boolean {
  if (!model || !agentKind) return false;
  const channel = modelCatalogChannel(model);
  if (!channel) return false;
  return channel !== baseAgentKind(agentKind).trim().toLowerCase();
}

/**
 * Command Code native ids are `vendor/model` (e.g. `deepseek/deepseek-v4-flash`).
 * Catalog rows sometimes stamp the channel as `commandcode/<leaf>`, which the
 * Command Code API then rejects as `anthropic:commandcode/<leaf>`.
 * Lookup is exact against the known native set — never a guessed vendor.
 */
export function normalizeCommandCodeModelId(modelId: string): string {
  return resolveCommandCodeNativeModelId(modelId);
}

/**
 * dsh ACP model config values are JSON `[provider, model]` tuples.
 * Command Code catalog ids must ride the `commandcode` route, not
 * `deepseek-official`, or ACP falls back to api.deepseek.com.
 */
export function foreignAcpModelId(config: {
  model: string;
  sourceProviderKind?: string | undefined;
}): string {
  const model = config.model.trim();
  const source =
    config.sourceProviderKind?.trim().toLowerCase() || modelCatalogChannel(model) || "";
  if (source === "commandcode" && model) {
    return JSON.stringify(["commandcode", normalizeCommandCodeModelId(model)]);
  }
  return config.model;
}

/**
 * Split catalog identity from spawn identity. The picker keeps `providerId`;
 * launch uses `harnessId` + `providerModelId`.
 */
export function resolveAutoModelBinding(
  pick: ThirdPartyPickerSelection,
  installed?: readonly string[],
): AutoModelBinding {
  const remapped = applyThirdPartyPickerSelection(pick, installed);
  return {
    harnessId: remapped.agentKind,
    providerId: catalogProviderKind(pick),
    providerModelId: pick.model,
  };
}

/**
 * Picker onChange.
 *
 * - Third-party openai-compatible picks rewrite onto the model's native
 *   Harness when that Harness is installed (ChatGPT → Codex, Kimi/Grok/
 *   DeepSeek → their CLI, Muse → Muse, otherwise OpenCode).
 * - OpenCode catalog Muse Spark stays on OpenCode; Muse Code is an explicit Recipe.
 * - Command Code DeepSeek remaps onto DeepSeek Harness when installed.
 * 合成台 / explicit recipes skip this helper. The returned `agentKind` is
 * the process that will actually spawn. UI must display that Harness, never
 * a family-affinity label.
 */
export function applyThirdPartyPickerSelection(
  next: ThirdPartyPickerSelection,
  installed?: readonly string[],
): ThirdPartyPickerSelection {
  const nativeCommandCodeModel =
    next.agentKind === "commandcode" || modelCatalogChannel(next.model) === "commandcode"
      ? normalizeCommandCodeModelId(next.model)
      : next.model;
  const pick =
    nativeCommandCodeModel === next.model ? next : { ...next, model: nativeCommandCodeModel };
  if (isThirdPartyAccountId(pick.accountId)) {
    const harness = resolveThirdPartyHarnessForModel(pick.model, installed);
    if (harness === pick.agentKind) return pick;
    return {
      ...pick,
      agentKind: harness,
      sourceProviderKind: pick.sourceProviderKind ?? pick.agentKind,
      ...(harness === "muse" ? { presentationMode: "gui" as const } : {}),
    };
  }
  const deepseek = applyAutoDeepseekHarnessLaunch(
    { agentKind: pick.agentKind, model: pick.model },
    harnessIsInstalled("deepseek", installed),
  );
  if (deepseek.agentKind === pick.agentKind) return pick;
  return {
    ...pick,
    agentKind: deepseek.agentKind,
    model: deepseek.model,
    sourceProviderKind: pick.sourceProviderKind ?? pick.agentKind,
  };
}

/**
 * Native↔native account ids are pool-managed and must not count as a user
 * pick. Third-party account identity is sticky: switching onto or off of one
 * is a real provider change even when agentKind + model stay the same
 * (Chiral gpt-5.6-sol vs native Codex 5.6 Sol).
 */
export function sameComposerAccount(
  liveAccountId: string | undefined,
  nextAccountId: string | undefined,
): boolean {
  const liveThirdParty = isThirdPartyAccountId(liveAccountId);
  const nextThirdParty = isThirdPartyAccountId(nextAccountId);
  if (!liveThirdParty && !nextThirdParty) return true;
  return (liveAccountId ?? "") === (nextAccountId ?? "");
}

export interface ThirdPartyLaunchCandidate {
  /** Custom-model channel (agent kind the entry is filed under). */
  provider: string;
  /** Remote model id the user validated. */
  modelId: string;
  /** Third-party account this entry belongs to (absent = subscription model). */
  accountId?: string | undefined;
}

export interface ThirdPartyLaunchAccount {
  accountId: string;
  provider: string;
  enabled?: boolean | undefined;
}

/**
 * Find the third-party account bound to a launch (agentKind + model).
 * Returns the account id when the model is a validated third-party entry
 * filed under THIS channel, or undefined for subscription/native models
 * (legacy pool path unchanged).
 *
 * Channel-exactness is load-bearing, not pedantic: model ids collide across
 * channels (a native Codex model id can also exist as a custom entry filed
 * under another harness). Falling back to a different channel's account would
 * hijack a native launch into the third-party branch — where the unvalidated
 * gate then blocks a perfectly good official runtime. Same-channel ambiguity
 * (one model id validated twice for one channel) still resolves
 * deterministically by row order; the picker groups by account, but the
 * thread row only retains (agentKind, model).
 */
export function resolveThirdPartyAccountForLaunch(input: {
  agentKind: string;
  model: string;
  customModels?: readonly ThirdPartyLaunchCandidate[] | undefined;
  accounts?: readonly ThirdPartyLaunchAccount[] | undefined;
  /**
   * Main-side (agent-initiated `create_thread`) has no account roster — only
   * the persisted custom-model catalog. With this flag, an accountId-bearing
   * channel-exact entry resolves without the accounts cross-check. Safe: the
   * supervisor re-validates the record (deleted accounts fail closed with
   * ACCOUNT_NOT_FOUND) and native model ids never match custom entries.
   */
  trustAccountChannel?: boolean | undefined;
  /**
   * Explicit picker/session account. Wins when it is a third-party account so
   * a Chiral GPT pick cannot fall through to the Codex subscription pool just
   * because the custom-model row was filed under a different harness.
   */
  explicitAccountId?: string | undefined;
}): string | undefined {
  const byId = new Map((input.accounts ?? []).map((account) => [account.accountId, account]));
  const isThirdPartyAccount = (accountId: string | undefined) =>
    Boolean(
      accountId &&
      (isThirdPartyAccountId(accountId) ||
        input.trustAccountChannel === true ||
        byId.get(accountId)?.provider === THIRD_PARTY_ACCOUNT_PROVIDER),
    );
  const model = input.model.trim();
  const family = model ? resolveCompatibilityFamily(model) : "unknown";
  // Official ChatGPT ids collide with Chiral/custom GPT rows filed under Codex.
  // Only honor a third-party account when THIS pick named it — never because a
  // leftover next-session account or a catalog row happens to share the id.
  const officialCodexOpenAI = input.agentKind === "codex" && family === "openai";
  if (isThirdPartyAccount(input.explicitAccountId)) {
    if (!officialCodexOpenAI) return input.explicitAccountId;
    const explicit = input.explicitAccountId!;
    const belongs = (input.customModels ?? []).some(
      (entry) =>
        entry.accountId === explicit &&
        (entry.modelId.trim() === model ||
          stripModelProviderPrefix(entry.modelId) === stripModelProviderPrefix(model)),
    );
    // Explicit Chiral pick of this GPT id is real; leftover account without a
    // matching custom row must not steal a native ChatGPT subscription launch.
    if (belongs) return explicit;
  }
  if (!model) return undefined;
  if (officialCodexOpenAI) return undefined;
  const modelMatches = (entryModelId: string) =>
    entryModelId === model ||
    stripModelProviderPrefix(entryModelId) === stripModelProviderPrefix(model);
  const channelMatch = (input.customModels ?? []).find(
    (entry) =>
      modelMatches(entry.modelId) &&
      entry.provider === input.agentKind &&
      isThirdPartyAccount(entry.accountId),
  );
  if (channelMatch?.accountId) return channelMatch.accountId;
  // Custom-model rows are often filed under whatever channel added them
  // (historically "codex", briefly "opencode" for GLM). Match the model id
  // against any openai-compatible account so the launch keeps the same key.
  // Never do this for native GPT ids on Codex: they collide with ChatGPT.
  // Unknown ids (GLM, custom endpoints, …) exist only as custom
  // endpoints. A Devin/other harness row that still has that model id must
  // find the account; the picker then moves the launch onto OpenCode.
  // Known families stay channel-exact so a native ChatGPT id is never stolen.
  const familyUnknown = family === "unknown";
  const allowCrossChannel =
    familyUnknown ||
    input.agentKind === "muse" ||
    input.agentKind === "opencode" ||
    input.agentKind === "kimi" ||
    input.agentKind === "grok" ||
    input.agentKind === "deepseek" ||
    input.agentKind === "stepcode" ||
    (input.agentKind === "codex" && family !== "openai");
  if (allowCrossChannel) {
    const remapped = (input.customModels ?? []).find((entry) => {
      if (!modelMatches(entry.modelId) || !isThirdPartyAccount(entry.accountId)) return false;
      // Leftover OpenCode / Codex GLM rows (filed under either channel) still bind.
      if (input.agentKind === "opencode" || familyUnknown) return true;
      if (input.agentKind === "codex" && family !== "openai") return true;
      if (input.agentKind === "muse") return resolveCompatibilityFamily(entry.modelId) === "muse";
      return resolveThirdPartyHarnessForModel(entry.modelId) === input.agentKind;
    });
    return remapped?.accountId;
  }
  return undefined;
}
