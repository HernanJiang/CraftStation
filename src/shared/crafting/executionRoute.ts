import { z } from "zod";
import type { HarnessReference, SelectedModelEntry } from "./workbenchTypes";
import { canonicalModelVendor, isSameModelVendor } from "./vendors";
import {
  COMPATIBILITY_HARNESS_CAPABILITIES,
  resolveCompatibilityFamily,
  type CompatibilityHarnessId,
} from "@/shared/harnessCompatibility";
import { isThirdPartyAccountId } from "@/shared/thirdPartyRouting";

export const executionRouteTypeSchema = z.enum(["native", "compatibility", "fail-closed"]);
export type ExecutionRouteType = z.infer<typeof executionRouteTypeSchema>;

export const SUPPORTED_COMPATIBILITY_HARNESSES = [
  "opencode",
  "codex",
  "kimi",
  "grok",
  "antigravity",
  "muse",
  "deepseek",
] as const;

/**
 * Canonical model vendors the official OpenCode runtime can serve directly
 * through its own provider/model adapters. Mirrors the `*-opencode-native`
 * entries of `NATIVE_HARNESS_RECIPES` (registry.ts) — keep the two lists in
 * sync when a vendor route is added or removed there.
 */
export const OPENCODE_NATIVE_MODEL_VENDORS = [
  "openai",
  "xai",
  "google",
  "deepseek",
  "moonshot",
  "moonshot-openai-compatible",
  "muse",
] as const;

/**
 * Installed subscription CLIs. A model listed under one of these, composed
 * with a *different* Harness, is a subscription projection (CLIProxyAPI) —
 * never that Harness's own vendor adapter. OpenCode catalog rows use
 * `opencode` and stay on the official OpenCode runtime.
 */
export const SUBSCRIPTION_HARNESS_KINDS = new Set([
  "codex",
  "grok",
  "kimi",
  "antigravity",
  "gemini",
  "deepseek",
  "muse",
  "commandcode",
  "devin",
]);

function harnessSupportsCustomBaseUrl(harnessKind: string): boolean {
  const cap = COMPATIBILITY_HARNESS_CAPABILITIES.find(
    (entry) => entry.harnessId === (harnessKind as CompatibilityHarnessId),
  );
  return cap?.supportsCustomBaseUrl === true;
}

function sourceKind(modelEntry: SelectedModelEntry): string {
  return (modelEntry.providerKind ?? "").trim().toLowerCase();
}

/**
 * Canonical vendor OpenCode can bind through `parseOpenCodeModelSlug`.
 * Catalog source (Antigravity / Codex / Command Code / …) does not matter:
 * the official OpenCode runtime is the Harness, and the model id is bound
 * explicitly so it cannot fall through to a leftover session default.
 */
function openCodeNativeVendorFor(modelEntry: SelectedModelEntry): string {
  const fromKind = canonicalModelVendor(modelEntry.providerKind);
  if ((OPENCODE_NATIVE_MODEL_VENDORS as readonly string[]).includes(fromKind)) {
    return fromKind;
  }
  switch (resolveCompatibilityFamily(modelEntry.modelId)) {
    case "gemini":
      return "google";
    case "openai":
      return "openai";
    case "grok":
      return "xai";
    case "kimi":
      return "moonshot";
    case "deepseek":
      return "deepseek";
    case "muse":
      return "muse";
    default:
      return "";
  }
}

export interface ExecutionRouteResolutionInput {
  modelEntry: SelectedModelEntry | undefined;
  harnessRef: HarnessReference | undefined;
  harnessReady: boolean;
  openCodeRouteReady?: boolean | undefined;
  compatibilityBridgeReady?: boolean | undefined;
}

export interface ExecutionRouteDecision {
  routeType: ExecutionRouteType;
  reasonCode: ExecutionRouteReasonCode;
  reason?: string | undefined;
  isNative: boolean;
  isCompatibility: boolean;
}

/** 供 UI/编译/执行共享的原因契约；人类可读文案可调整，调用方不再解析英文子串。 */
export type ExecutionRouteReasonCode =
  | "MISSING_INGREDIENT"
  | "HARNESS_NOT_READY"
  | "OPENCODE_NOT_READY"
  | "THIRD_PARTY_UNSUPPORTED"
  | "THIRD_PARTY_DIRECT"
  | "OPENCODE_CATALOG"
  | "OPENCODE_NATIVE_VENDOR"
  | "OPENCODE_VENDOR_UNVERIFIED"
  | "NATIVE_PAIRING"
  | "BRIDGE_NOT_READY"
  | "BRIDGE_HARNESS_UNSUPPORTED"
  | "COMPATIBILITY_PAIRING";

function decision(
  routeType: ExecutionRouteType,
  reasonCode: ExecutionRouteReasonCode,
  reason: string,
): ExecutionRouteDecision {
  return {
    routeType,
    reasonCode,
    reason,
    isNative: routeType === "native",
    isCompatibility: routeType === "compatibility",
  };
}

export function resolveExecutionRoute(
  input: ExecutionRouteResolutionInput,
): ExecutionRouteDecision {
  const { modelEntry, harnessRef, harnessReady, openCodeRouteReady, compatibilityBridgeReady } =
    input;

  if (!modelEntry || !harnessRef) {
    return decision(
      "fail-closed",
      "MISSING_INGREDIENT",
      "Missing model entry or harness reference",
    );
  }

  if (!harnessReady) {
    return decision(
      "fail-closed",
      "HARNESS_NOT_READY",
      "Harness is not installed, authenticated, or runtime ready",
    );
  }

  if (harnessRef.harnessKind === "opencode" && openCodeRouteReady !== true) {
    return decision("fail-closed", "OPENCODE_NOT_READY", "OpenCode route is not ready");
  }

  // Third-party OpenAI-compatible accounts inject BaseURL/key into the target
  // Harness. They never go through CLIProxyAPI (that path is for subscriptions).
  if (isThirdPartyAccountId(modelEntry.accountId)) {
    if (!harnessSupportsCustomBaseUrl(harnessRef.harnessKind)) {
      return decision(
        "fail-closed",
        "THIRD_PARTY_UNSUPPORTED",
        `Harness '${harnessRef.harnessKind}' cannot consume a third-party OpenAI-compatible Base URL`,
      );
    }
    return decision(
      "native",
      "THIRD_PARTY_DIRECT",
      "Third-party OpenAI-compatible account launches directly on the selected Harness",
    );
  }

  // OpenCode is a universal native Harness for allowlisted vendors. Catalog
  // source (Antigravity Gemini, Codex ChatGPT, Command Code DeepSeek, …) does
  // not force CLIProxyAPI: `parseOpenCodeModelSlug` binds the exact model id
  // onto OpenCode's vendor adapter. CPA stays for true cross-CLI projection
  // (e.g. Gemini onto Codex) where OpenCode is not the target Harness.
  if (harnessRef.harnessKind === "opencode") {
    const kind = sourceKind(modelEntry);
    if (kind === "opencode" || kind.startsWith("opencode")) {
      return decision(
        "native",
        "OPENCODE_CATALOG",
        "OpenCode catalog model runs on the official OpenCode runtime",
      );
    }
    const modelVendor = openCodeNativeVendorFor(modelEntry);
    if (modelVendor) {
      return decision(
        "native",
        "OPENCODE_NATIVE_VENDOR",
        `OpenCode universal router serves '${modelVendor}' models through the official OpenCode runtime`,
      );
    }
    if (!SUBSCRIPTION_HARNESS_KINDS.has(kind)) {
      return decision(
        "fail-closed",
        "OPENCODE_VENDOR_UNVERIFIED",
        `Model vendor '${canonicalModelVendor(modelEntry.providerKind) || modelEntry.providerKind}' has no verified OpenCode native route`,
      );
    }
  }

  // Native pairing compares canonical model vendors: the inventory reports
  // models by agent kind (`codex`) while descriptors report the model vendor
  // (`openai`). Raw string comparison can never match those pairs.
  const isNativePairing = isSameModelVendor(modelEntry.providerKind, harnessRef.vendor);

  if (isNativePairing) {
    return decision(
      "native",
      "NATIVE_PAIRING",
      "Native model and harness pairing directly routes to official runtime",
    );
  }

  // Compatibility is an opt-in, verified runtime capability. An omitted
  // readiness value is unknown and must fail closed.
  if (compatibilityBridgeReady !== true) {
    return decision(
      "fail-closed",
      "BRIDGE_NOT_READY",
      "Compatibility bridge is unavailable or not ready",
    );
  }

  if (!SUPPORTED_COMPATIBILITY_HARNESSES.includes(harnessRef.harnessKind as any)) {
    return decision(
      "fail-closed",
      "BRIDGE_HARNESS_UNSUPPORTED",
      `Target harness ${harnessRef.harnessKind} does not support Compatibility Bridge projection`,
    );
  }

  return decision(
    "compatibility",
    "COMPATIBILITY_PAIRING",
    "Cross model and harness pairing routed through CLIProxyAPI Compatibility Bridge",
  );
}
