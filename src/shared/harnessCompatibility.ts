/**
 * Model ↔ Harness Compatibility Layer — pure decision seam.
 *
 * Priority (highest first):
 *   1. native          — vendor account/subscription + vendor Harness run the
 *                        existing CraftStation native flow. No Gateway, no CPA,
 *                        no protocol probing. This module only *reports*
 *                        native; it never alters the native launch path.
 *   2. gateway-direct  — Harness cannot consume the Provider natively but both
 *                        sides speak the same protocol. CPA acts as a
 *                        compatibility gateway (BaseURL/Auth/Model/Discovery)
 *                        with NO protocol translation.
 *   3. cpa-translate   — protocols differ; CPA translates
 *                        (Responses ↔ Chat Completions, streaming, tool calls).
 *   4. unsupported     — CPA cannot bridge reliably. Fail closed.
 *
 * Deliberately additive: existing `autoHarnessResolver` (third-party auto),
 * `executionRoute` (workbench native|compatibility|fail-closed) and the
 * native launch pipeline are untouched. Callers consult this module only for
 * NON-native combinations; native traffic must resolve before reaching it
 * (see `resolveAutoCompatibilityRoute`).
 */

import { resolveModelFamily as resolveThirdPartyFamily } from "./autoHarnessResolver";
import type { ThirdPartyProtocol } from "./thirdPartyValidation";

export type RouteMode = "native" | "gateway-direct" | "cpa-translate" | "unsupported";

/** Wire protocol spoken on either side of the CPA boundary. */
export type CompatibilityProtocol = "responses" | "chat-completions";

/** Model family drives Preferred-Harness affinity — by model, not provider. */
export type CompatibilityModelFamily =
  | "openai"
  | "kimi"
  | "grok"
  | "gemini"
  | "deepseek"
  | "muse"
  | "unknown";

export type CompatibilityHarnessId =
  | "codex"
  | "kimi"
  | "grok"
  | "antigravity"
  | "opencode"
  | "deepseek"
  | "muse";

export interface HarnessCompatibilityResult {
  providerId: string;
  modelId: string;
  harnessId: string;

  nativeCompatible: boolean;

  downstreamProtocol?: CompatibilityProtocol | undefined;
  upstreamProtocol?: CompatibilityProtocol | undefined;

  route: RouteMode;

  requiresCPA: boolean;
  /** True only for cpa-translate: bytes cross a protocol boundary. */
  translation: boolean;
  /** Stable, human-readable reason for UI/logs/tests. */
  reason: string;
}

/**
 * Catalog ids are often `provider/model` (e.g. `opencode-go/muse-spark-1.3-contributor`).
 * Family affinity must look at the model, never the channel prefix.
 */
export function stripModelProviderPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return trimmed;
  return trimmed.slice(slash + 1);
}

export function modelProviderPrefix(modelId: string): string | undefined {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return undefined;
  return trimmed.slice(0, slash);
}

/** Model id → family. Muse-family first (by model, never by provider). */
export function resolveCompatibilityFamily(modelId: string): CompatibilityModelFamily {
  const raw = modelId.trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw.startsWith("muse/") || raw.startsWith("meta/")) return "muse";
  if (raw.startsWith("deepseek/") || raw.startsWith("deepseek:") || raw === "deepseek") {
    return "deepseek";
  }
  const normalized = stripModelProviderPrefix(raw);
  if (normalized.startsWith("muse-") || normalized.startsWith("muse-spark-")) {
    return "muse";
  }
  if (
    normalized.startsWith("deepseek-") ||
    normalized.startsWith("deepseek_") ||
    normalized === "deepseek"
  ) {
    return "deepseek";
  }
  // Delegate: openai/kimi/grok/gemini/unknown prefix rules already verified.
  return resolveThirdPartyFamily(normalized);
}

function isForeignMuseChannel(providerId: string): boolean {
  const kind = providerId.trim().toLowerCase();
  return (
    kind === "opencode" ||
    kind === "opencode-go" ||
    kind === "openai-compatible" ||
    kind.startsWith("opencode:")
  );
}

/**
 * Auto mode: Muse Spark (and other Muse-family models) run on Muse Code even
 * when the catalog/key comes from OpenCode Go or a third-party OpenAI-compatible
 * channel. Native `muse` launches are left alone.
 */
export function shouldAutoRemapToMuseHarness(input: {
  agentKind: string;
  modelId: string;
}): boolean {
  if (resolveCompatibilityFamily(input.modelId) !== "muse") return false;
  const kind = input.agentKind.trim().toLowerCase();
  if (!kind || kind === "muse" || kind.startsWith("muse:")) return false;
  return isForeignMuseChannel(kind);
}

export function applyAutoMuseHarnessLaunch(
  input: { agentKind: string; model: string },
  museInstalled: boolean,
): { agentKind: string; model: string } {
  if (!museInstalled) return input;
  if (!shouldAutoRemapToMuseHarness({ agentKind: input.agentKind, modelId: input.model })) {
    return input;
  }
  return { agentKind: "muse", model: input.model };
}

export function preferredHarnessForCompatibilityFamily(
  family: CompatibilityModelFamily,
): CompatibilityHarnessId {
  switch (family) {
    case "openai":
      return "codex";
    case "kimi":
      return "kimi";
    case "grok":
      return "grok";
    case "gemini":
      return "antigravity";
    case "deepseek":
      return "deepseek";
    case "muse":
      return "muse";
    case "unknown":
      return "opencode";
  }
}

export const COMPATIBILITY_HARNESS_LABELS: Record<CompatibilityHarnessId, string> = {
  codex: "Codex",
  kimi: "Kimi Code",
  grok: "Grok Build",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  deepseek: "DeepSeek Harness",
  muse: "Muse",
};

export const COMPATIBILITY_FAMILY_LABELS: Record<CompatibilityModelFamily, string> = {
  openai: "OpenAI",
  kimi: "Kimi",
  grok: "Grok",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  muse: "Muse",
  unknown: "Unknown",
};

/**
 * Provider kinds that natively feed each Harness. `openai-compatible`
 * (third-party BaseURL/key) is NEVER native for any Harness.
 */
export const NATIVE_PROVIDER_KINDS: Record<CompatibilityHarnessId, readonly string[]> = {
  codex: ["codex"],
  kimi: ["kimi"],
  grok: ["grok"],
  antigravity: ["antigravity", "gemini"],
  opencode: ["opencode"],
  deepseek: ["deepseek"],
  muse: ["muse"],
};

export function isNativeModelHarnessPair(input: {
  providerId: string;
  harnessId: CompatibilityHarnessId;
}): boolean {
  const provider = input.providerId.trim().toLowerCase();
  if (!provider || provider === "openai-compatible") return false;
  return (NATIVE_PROVIDER_KINDS[input.harnessId] ?? []).some(
    (kind) => provider === kind || provider.startsWith(`${kind}:`),
  );
}

interface HarnessProtocolCapability {
  harnessId: CompatibilityHarnessId;
  /** Protocols the Harness natively speaks downstream. Empty = cannot be bridged. */
  downstreamProtocols: readonly CompatibilityProtocol[];
  /** Whether CPA/Gateway can point this Harness at a foreign BaseURL. */
  supportsCustomBaseUrl: boolean;
}

/**
 * Capability registry — fill ONLY from the pinned runtime/version.
 * Antigravity lists no third-party protocol (its custom-provider path needs
 * Gemini-compatible protocol); DeepSeek Harness is native-only for the
 * DeepSeek vendor (official DSH JSON-RPC stdio runtime; foreign providers
 * must fail closed, never bridge through it); Muse speaks Responses.
 */
export const COMPATIBILITY_HARNESS_CAPABILITIES: readonly HarnessProtocolCapability[] = [
  { harnessId: "codex", downstreamProtocols: ["responses"], supportsCustomBaseUrl: true },
  {
    harnessId: "kimi",
    downstreamProtocols: ["responses", "chat-completions"],
    supportsCustomBaseUrl: true,
  },
  {
    harnessId: "grok",
    downstreamProtocols: ["responses", "chat-completions"],
    supportsCustomBaseUrl: true,
  },
  { harnessId: "antigravity", downstreamProtocols: [], supportsCustomBaseUrl: false },
  {
    harnessId: "opencode",
    downstreamProtocols: ["responses", "chat-completions"],
    supportsCustomBaseUrl: true,
  },
  { harnessId: "deepseek", downstreamProtocols: [], supportsCustomBaseUrl: false },
  { harnessId: "muse", downstreamProtocols: ["responses"], supportsCustomBaseUrl: true },
];

/** Validated third-party protocol → compatibility protocol. */
export function toCompatibilityProtocol(protocol: ThirdPartyProtocol): CompatibilityProtocol {
  return protocol === "responses" ? "responses" : "chat-completions";
}

export interface HarnessCompatibilityInput {
  providerId: string;
  modelId: string;
  harnessId: string;
  /**
   * Pre-computed by the caller from existing native signals
   * (same-vendor pairing, subscription account pool, harness registry).
   * True short-circuits to `native` before any CPA/protocol logic runs.
   */
  nativeCompatible: boolean;
  downstreamProtocol?: CompatibilityProtocol | undefined;
  upstreamProtocol?: CompatibilityProtocol | undefined;
  /** CPA/Gateway binary + runtime reachable. Omitted/false fails closed. */
  cpaAvailable?: boolean | undefined;
}

function capabilityFor(harnessId: string): HarnessProtocolCapability | undefined {
  return COMPATIBILITY_HARNESS_CAPABILITIES.find((entry) => entry.harnessId === harnessId);
}

function baseResult(
  input: HarnessCompatibilityInput,
  patch: Partial<HarnessCompatibilityResult> & Pick<HarnessCompatibilityResult, "route" | "reason">,
): HarnessCompatibilityResult {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    harnessId: input.harnessId,
    nativeCompatible: input.nativeCompatible,
    ...(input.downstreamProtocol ? { downstreamProtocol: input.downstreamProtocol } : {}),
    ...(input.upstreamProtocol ? { upstreamProtocol: input.upstreamProtocol } : {}),
    requiresCPA: false,
    translation: false,
    ...patch,
  };
}

/**
 * RoutePlanner core. Pure and total: every input yields exactly one RouteMode.
 * Native bypass happens FIRST — native traffic never reaches protocol/CPA
 * logic and `requiresCPA` stays false.
 */
export function resolveHarnessCompatibility(
  input: HarnessCompatibilityInput,
): HarnessCompatibilityResult {
  // ── 1. Native: keep the existing native flow untouched ──────────────
  if (input.nativeCompatible) {
    return baseResult(input, {
      route: "native",
      reason: "native provider + native harness: existing native flow, CPA never starts",
    });
  }

  const capability = capabilityFor(input.harnessId);
  if (!capability || !capability.supportsCustomBaseUrl) {
    return baseResult(input, {
      route: "unsupported",
      reason: `harness ${input.harnessId} cannot consume foreign providers`,
    });
  }
  if (input.cpaAvailable !== true) {
    return baseResult(input, {
      route: "unsupported",
      reason: "CPA gateway unavailable: non-native combination fails closed",
    });
  }
  if (!input.upstreamProtocol) {
    return baseResult(input, {
      route: "unsupported",
      reason: "unknown upstream protocol: refusing to guess a translation boundary",
    });
  }

  const downstream =
    input.downstreamProtocol ??
    (capability.downstreamProtocols.includes(input.upstreamProtocol)
      ? input.upstreamProtocol
      : capability.downstreamProtocols[0]);
  if (!downstream) {
    return baseResult(input, {
      route: "unsupported",
      reason: `harness ${input.harnessId} declares no bridgeable downstream protocol`,
    });
  }

  // ── 2/3. Protocol quadrant: same → passthrough, different → translate ──
  if (downstream === input.upstreamProtocol) {
    return baseResult(input, {
      downstreamProtocol: downstream,
      route: "gateway-direct",
      requiresCPA: true,
      reason: `${downstream} → ${input.upstreamProtocol}: gateway passthrough, no translation`,
    });
  }
  return baseResult(input, {
    downstreamProtocol: downstream,
    route: "cpa-translate",
    requiresCPA: true,
    translation: true,
    reason: `${downstream} → ${input.upstreamProtocol}: CPA protocol translation`,
  });
}

export interface AutoCompatibilityInput {
  providerId: string;
  modelId: string;
  /** Explicit user harness wins; omitted → family affinity. */
  harnessId?: string | undefined;
  nativeCompatible: boolean;
  upstreamProtocol?: CompatibilityProtocol | undefined;
  cpaAvailable?: boolean | undefined;
}

export interface AutoCompatibilityDecision extends HarnessCompatibilityResult {
  modelFamily: CompatibilityModelFamily;
  /** Affinity-picked harness, for UI display even when explicit differs. */
  affinityHarness: CompatibilityHarnessId;
}

/**
 * Auto Mode entry. Native combinations return `native` BEFORE affinity or
 * CPA logic runs — native vendor traffic never loops through the gateway.
 * Non-native combinations resolve family → affinity Harness → route quadrant.
 */
export function resolveAutoCompatibilityRoute(
  input: AutoCompatibilityInput,
): AutoCompatibilityDecision {
  const family = resolveCompatibilityFamily(input.modelId);
  const affinityHarness = preferredHarnessForCompatibilityFamily(family);
  const harnessId = input.harnessId ?? affinityHarness;
  const resolved = resolveHarnessCompatibility({
    providerId: input.providerId,
    modelId: input.modelId,
    harnessId,
    nativeCompatible: input.nativeCompatible,
    upstreamProtocol: input.upstreamProtocol,
    cpaAvailable: input.cpaAvailable,
  });
  return { ...resolved, modelFamily: family, affinityHarness };
}
