import {
  preferredHarnessForCompatibilityFamily,
  resolveCompatibilityFamily,
  stripModelProviderPrefix,
  type CompatibilityHarnessId,
} from "./harnessCompatibility";

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

export function isThirdPartyAccountId(accountId: string | undefined | null): boolean {
  return typeof accountId === "string" && accountId.startsWith(`${THIRD_PARTY_ACCOUNT_PROVIDER}:`);
}

function harnessIsInstalled(
  kind: string,
  installed: readonly string[] | undefined,
): boolean {
  return installed === undefined || installed.includes(kind);
}

/**
 * Model-name → Harness for a third-party OpenAI-compatible channel.
 *
 * Prefer the model's native Harness when the user has it installed:
 * ChatGPT → Codex, Kimi → Kimi Code, Grok → Grok Build, DeepSeek → DeepSeek
 * Harness, Muse → Muse. Gemini's native Antigravity cannot consume an
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
}

/**
 * Picker onChange: a third-party openai-compatible pick is rewritten onto
 * the model-name Harness when that Harness is installed (ChatGPT → Codex,
 * Kimi/Grok/DeepSeek → their CLI, otherwise OpenCode). Native subscription
 * / OpenCode catalog picks pass through unchanged.
 */
export function applyThirdPartyPickerSelection(
  next: ThirdPartyPickerSelection,
  installed?: readonly string[],
): ThirdPartyPickerSelection {
  if (!isThirdPartyAccountId(next.accountId)) return next;
  const harness = resolveThirdPartyHarnessForModel(next.model, installed);
  if (harness === next.agentKind) return next;
  return { ...next, agentKind: harness };
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
  if (isThirdPartyAccount(input.explicitAccountId)) return input.explicitAccountId;
  const model = input.model.trim();
  if (!model) return undefined;
  const modelMatches = (entryModelId: string) =>
    entryModelId === model || stripModelProviderPrefix(entryModelId) === stripModelProviderPrefix(model);
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
  const family = resolveCompatibilityFamily(model);
  const allowCrossChannel =
    input.agentKind === "muse" ||
    input.agentKind === "opencode" ||
    input.agentKind === "kimi" ||
    input.agentKind === "grok" ||
    input.agentKind === "deepseek" ||
    (input.agentKind === "codex" && family !== "openai");
  if (allowCrossChannel) {
    const remapped = (input.customModels ?? []).find((entry) => {
      if (!modelMatches(entry.modelId) || !isThirdPartyAccount(entry.accountId)) return false;
      // Leftover OpenCode / Codex GLM rows (filed under either channel) still bind.
      if (input.agentKind === "opencode") return true;
      if (input.agentKind === "codex" && family !== "openai") return true;
      return resolveThirdPartyHarnessForModel(entry.modelId) === input.agentKind;
    });
    return remapped?.accountId;
  }
  return undefined;
}
