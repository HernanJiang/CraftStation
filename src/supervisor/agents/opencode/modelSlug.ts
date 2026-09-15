import { resolveCompatibilityFamily } from "@/shared/harnessCompatibility";
import {
  THIRD_PARTY_OPENCODE_PROVIDER_ID,
  normalizeThirdPartyModelId,
} from "@/shared/thirdPartyRouting";

export interface OpenCodeModelSlug {
  providerID: string;
  modelID: string;
}

/**
 * OpenCode addresses models as `{ providerID, modelID }` / `--model provider/id`.
 * A bare recipe id like `gemini-3.8-flash` used to parse as "no model" and
 * OpenCode then ran its session default (often a leftover Chiral/OpenAI pick).
 */
const FAMILY_PROVIDER: Record<string, string> = {
  gemini: "google",
  grok: "xai",
  openai: "openai",
  deepseek: "deepseek",
  kimi: "kimi-for-coding",
  muse: "opencode-go",
};

export function parseOpenCodeModelSlug(
  modelSlug: string | undefined,
  thirdPartyProvider?: string,
): OpenCodeModelSlug | undefined {
  if (!modelSlug?.trim()) return undefined;
  const normalized = normalizeThirdPartyModelId(modelSlug);
  if (!normalized) return undefined;
  const slash = normalized.indexOf("/");
  if (slash > 0 && slash < normalized.length - 1) {
    const providerID = normalized.slice(0, slash);
    const modelID = normalized.slice(slash + 1);
    if (providerID === THIRD_PARTY_OPENCODE_PROVIDER_ID && !thirdPartyProvider) {
      return undefined;
    }
    return { providerID, modelID };
  }
  if (thirdPartyProvider) {
    return { providerID: thirdPartyProvider, modelID: normalized };
  }
  const family = resolveCompatibilityFamily(normalized);
  const providerID = FAMILY_PROVIDER[family];
  if (!providerID) return undefined;
  return { providerID, modelID: normalized };
}

export function formatOpenCodeModelFlag(modelSlug: string | undefined): string | undefined {
  const parsed = parseOpenCodeModelSlug(modelSlug);
  if (parsed) return `${parsed.providerID}/${parsed.modelID}`;
  const trimmed = modelSlug?.trim();
  return trimmed || undefined;
}
