/**
 * Auto Harness Resolver for third-party models.
 *
 * Single resolver answering: Model + Model Source + Model Name + Validated
 * Protocol + Base URL + Harness Selection + Harness Capability + Harness
 * Availability → Exact Execution Route.
 *
 * Rules:
 * - Model Name is only a preferred-harness HINT (family match). The verified
 *   protocol + harness capability decide the final harness.
 * - Explicit user harness always wins, but still needs compatibility
 *   validation (never silently swap it).
 * - Preferred incompatible → OpenCode fallback (when capable) → Unsupported.
 * - Third-party credentials NEVER enter the subscription Account Pool; the
 *   credential source stays sticky third-party for the session lifetime.
 */

import type { ThirdPartyProtocol } from "./thirdPartyValidation";

export type ThirdPartyHarnessId = "codex" | "kimi" | "grok" | "antigravity" | "opencode";

export type ModelFamily = "openai" | "kimi" | "grok" | "gemini" | "unknown";

export type ThirdPartyRouteKind = "third-party-native" | "third-party-fallback" | "unsupported";

export interface ThirdPartyHarnessCapability {
  harnessId: ThirdPartyHarnessId;
  protocols: ThirdPartyProtocol[];
  supportsCustomBaseUrl: boolean;
  modelFamilies?: ModelFamily[] | undefined;
}

/**
 * Capability registry — fill ONLY from the currently pinned runtime/version.
 * Antigravity deliberately lists NO OpenAI-compatible third-party protocol:
 * its custom-provider path needs Gemini-compatible protocol, so an
 * OpenAI-compatible endpoint must fall back to OpenCode rather than fake it.
 */
export const THIRD_PARTY_HARNESS_CAPABILITIES: readonly ThirdPartyHarnessCapability[] = [
  {
    harnessId: "codex",
    protocols: ["responses"],
    supportsCustomBaseUrl: true,
    modelFamilies: ["openai"],
  },
  {
    harnessId: "kimi",
    protocols: ["responses", "chat_completions"],
    supportsCustomBaseUrl: true,
    modelFamilies: ["kimi"],
  },
  {
    harnessId: "grok",
    protocols: ["responses", "chat_completions"],
    supportsCustomBaseUrl: true,
    modelFamilies: ["grok"],
  },
  {
    harnessId: "antigravity",
    protocols: [],
    supportsCustomBaseUrl: false,
    modelFamilies: ["gemini"],
  },
  {
    harnessId: "opencode",
    protocols: ["responses", "chat_completions"],
    supportsCustomBaseUrl: true,
  },
];

/** Model Name → family hint. Never equals the final harness by itself. */
export function resolveModelFamily(modelId: string): ModelFamily {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (
    normalized.startsWith("gpt-") ||
    normalized.startsWith("chatgpt-") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.startsWith("openai/")
  ) {
    return "openai";
  }
  if (
    normalized.startsWith("kimi-") ||
    normalized.startsWith("k2-") ||
    normalized.startsWith("k2_") ||
    normalized.startsWith("k3-") ||
    normalized.startsWith("k3_") ||
    normalized.startsWith("moonshot")
  ) {
    return "kimi";
  }
  if (normalized.startsWith("grok-") || normalized.startsWith("xai/")) return "grok";
  if (normalized.startsWith("gemini-") || normalized.startsWith("google/")) return "gemini";
  return "unknown";
}

export function preferredHarnessForFamily(family: ModelFamily): ThirdPartyHarnessId {
  switch (family) {
    case "openai":
      return "codex";
    case "kimi":
      return "kimi";
    case "grok":
      return "grok";
    case "gemini":
      return "antigravity";
    case "unknown":
      return "opencode";
  }
}

function capabilityFor(
  harnessId: ThirdPartyHarnessId,
  capabilities: readonly ThirdPartyHarnessCapability[] = THIRD_PARTY_HARNESS_CAPABILITIES,
): ThirdPartyHarnessCapability | undefined {
  return capabilities.find((entry) => entry.harnessId === harnessId);
}

export function isHarnessCompatibleWithThirdParty(
  harnessId: ThirdPartyHarnessId,
  protocol: ThirdPartyProtocol,
  capabilities: readonly ThirdPartyHarnessCapability[] = THIRD_PARTY_HARNESS_CAPABILITIES,
): boolean {
  const entry = capabilityFor(harnessId, capabilities);
  if (!entry || !entry.supportsCustomBaseUrl) return false;
  return entry.protocols.includes(protocol);
}

export interface AutoHarnessInput {
  modelId: string;
  validatedProtocol: ThirdPartyProtocol;
  /** Harness availability in the current environment (installed/authed/ready). */
  harnessAvailable?: Partial<Record<ThirdPartyHarnessId, boolean>> | undefined;
  capabilities?: readonly ThirdPartyHarnessCapability[] | undefined;
}

export interface AutoHarnessDecision {
  harnessId: ThirdPartyHarnessId;
  route: ThirdPartyRouteKind;
  reason: string;
  modelFamily: ModelFamily;
  /** Sticky credential source — always third-party, never subscription pool. */
  credentialSource: "third-party";
  /** True when this decision must NOT consult the subscription account pool. */
  bypassAccountPool: true;
}

const ALL_AVAILABLE: Record<ThirdPartyHarnessId, boolean> = {
  codex: true,
  kimi: true,
  grok: true,
  antigravity: true,
  opencode: true,
};

/**
 * Auto mode: family hint → preferred harness capability check → OpenCode
 * fallback → Unsupported. Explainable via `reason` for UI/logs/tests.
 */
export function resolveAutoHarness(input: AutoHarnessInput): AutoHarnessDecision {
  const family = resolveModelFamily(input.modelId);
  const capabilities = input.capabilities ?? THIRD_PARTY_HARNESS_CAPABILITIES;
  const available = { ...ALL_AVAILABLE, ...(input.harnessAvailable ?? {}) };
  const preferred = preferredHarnessForFamily(family);

  if (
    available[preferred] === true &&
    isHarnessCompatibleWithThirdParty(preferred, input.validatedProtocol, capabilities)
  ) {
    const route: ThirdPartyRouteKind = preferred === "opencode" ? "third-party-fallback" : "third-party-native";
    return {
      harnessId: preferred,
      route,
      reason:
        preferred === "opencode"
          ? `unknown-family + ${input.validatedProtocol} → opencode fallback`
          : `${family}-family + ${input.validatedProtocol}-compatible`,
      modelFamily: family,
      credentialSource: "third-party",
      bypassAccountPool: true,
    };
  }

  // Preferred incompatible/unavailable → OpenCode fallback.
  if (
    preferred !== "opencode" &&
    available.opencode === true &&
    isHarnessCompatibleWithThirdParty("opencode", input.validatedProtocol, capabilities)
  ) {
    return {
      harnessId: "opencode",
      route: "third-party-fallback",
      reason: `preferred ${preferred} does not support ${input.validatedProtocol}`,
      modelFamily: family,
      credentialSource: "third-party",
      bypassAccountPool: true,
    };
  }

  // Unknown family already prefers OpenCode; reaching here means even the
  // fallback is unavailable/incompatible.
  return {
    harnessId: "opencode",
    route: "unsupported",
    reason:
      preferred === "opencode"
        ? `opencode unavailable for ${input.validatedProtocol}`
        : `preferred ${preferred} does not support ${input.validatedProtocol}; opencode unavailable`,
    modelFamily: family,
    credentialSource: "third-party",
    bypassAccountPool: true,
  };
}

export interface ExplicitHarnessInput {
  harnessId: ThirdPartyHarnessId;
  modelId: string;
  validatedProtocol: ThirdPartyProtocol;
  harnessAvailable?: Partial<Record<ThirdPartyHarnessId, boolean>> | undefined;
  capabilities?: readonly ThirdPartyHarnessCapability[] | undefined;
}

export type ExplicitHarnessDecision =
  | (AutoHarnessDecision & { explicit: true })
  | {
      explicit: true;
      harnessId: ThirdPartyHarnessId;
      route: "unsupported";
      reason: string;
      modelFamily: ModelFamily;
      credentialSource: "third-party";
      bypassAccountPool: true;
    };

/**
 * Explicit user harness always wins over Auto, but is still compatibility
 * validated — never silently swapped. Incompatible → Unsupported with a clear
 * reason so the UI can suggest Auto/OpenCode.
 */
export function resolveExplicitHarness(input: ExplicitHarnessInput): ExplicitHarnessDecision {
  const family = resolveModelFamily(input.modelId);
  const capabilities = input.capabilities ?? THIRD_PARTY_HARNESS_CAPABILITIES;
  const available = { ...ALL_AVAILABLE, ...(input.harnessAvailable ?? {}) };
  if (available[input.harnessId] !== true) {
    return {
      explicit: true,
      harnessId: input.harnessId,
      route: "unsupported",
      reason: `Selected Harness ${input.harnessId} is not available.`,
      modelFamily: family,
      credentialSource: "third-party",
      bypassAccountPool: true,
    };
  }
  if (!isHarnessCompatibleWithThirdParty(input.harnessId, input.validatedProtocol, capabilities)) {
    return {
      explicit: true,
      harnessId: input.harnessId,
      route: "unsupported",
      reason: "Selected Harness does not support this provider/protocol.",
      modelFamily: family,
      credentialSource: "third-party",
      bypassAccountPool: true,
    };
  }
  return {
    explicit: true,
    harnessId: input.harnessId,
    route: input.harnessId === "opencode" ? "third-party-fallback" : "third-party-native",
    reason: `explicit ${input.harnessId} + ${input.validatedProtocol}-compatible`,
    modelFamily: family,
    credentialSource: "third-party",
    bypassAccountPool: true,
  };
}
