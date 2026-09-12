import { z } from "zod";
import type { HarnessReference, SelectedModelEntry } from "./workbenchTypes";
import { canonicalModelVendor, isSameModelVendor } from "./vendors";

export const executionRouteTypeSchema = z.enum(["native", "compatibility", "fail-closed"]);
export type ExecutionRouteType = z.infer<typeof executionRouteTypeSchema>;

export const SUPPORTED_COMPATIBILITY_HARNESSES = [
  "opencode",
  "codex",
  "kimi",
  "grok",
  "antigravity",
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
] as const;

export interface ExecutionRouteResolutionInput {
  modelEntry: SelectedModelEntry | undefined;
  harnessRef: HarnessReference | undefined;
  harnessReady: boolean;
  openCodeRouteReady?: boolean | undefined;
  compatibilityBridgeReady?: boolean | undefined;
}

export interface ExecutionRouteDecision {
  routeType: ExecutionRouteType;
  reason?: string | undefined;
  isNative: boolean;
  isCompatibility: boolean;
}

export function resolveExecutionRoute(
  input: ExecutionRouteResolutionInput,
): ExecutionRouteDecision {
  const { modelEntry, harnessRef, harnessReady, openCodeRouteReady, compatibilityBridgeReady } =
    input;

  if (!modelEntry || !harnessRef) {
    return {
      routeType: "fail-closed",
      reason: "Missing model entry or harness reference",
      isNative: false,
      isCompatibility: false,
    };
  }

  if (!harnessReady) {
    return {
      routeType: "fail-closed",
      reason: "Harness is not installed, authenticated, or runtime ready",
      isNative: false,
      isCompatibility: false,
    };
  }

  if (harnessRef.harnessKind === "opencode" && openCodeRouteReady !== true) {
    return {
      routeType: "fail-closed",
      reason: "OpenCode route is not ready",
      isNative: false,
      isCompatibility: false,
    };
  }

  // OpenCode is a universal router, not a single-vendor CLI: allowlisted model
  // vendors are served by its own provider/model adapters through the official
  // OpenCode runtime — never through the CLIProxyAPI Compatibility Bridge
  // (the bridge exists for single-vendor harnesses that cannot reach foreign
  // vendor endpoints on their own).
  if (harnessRef.harnessKind === "opencode") {
    const modelVendor = canonicalModelVendor(modelEntry.providerKind);
    if ((OPENCODE_NATIVE_MODEL_VENDORS as readonly string[]).includes(modelVendor)) {
      return {
        routeType: "native",
        reason: `OpenCode universal router serves '${modelVendor}' models through the official OpenCode runtime`,
        isNative: true,
        isCompatibility: false,
      };
    }
    return {
      routeType: "fail-closed",
      reason: `Model vendor '${modelVendor || modelEntry.providerKind}' has no verified OpenCode native route`,
      isNative: false,
      isCompatibility: false,
    };
  }

  // Native pairing compares canonical model vendors: the inventory reports
  // models by agent kind (`codex`) while descriptors report the model vendor
  // (`openai`). Raw string comparison can never match those pairs.
  const isNativePairing = isSameModelVendor(modelEntry.providerKind, harnessRef.vendor);

  if (isNativePairing) {
    return {
      routeType: "native",
      reason: "Native model and harness pairing directly routes to official runtime",
      isNative: true,
      isCompatibility: false,
    };
  }

  // Compatibility is an opt-in, verified runtime capability. An omitted
  // readiness value is unknown and must fail closed.
  if (compatibilityBridgeReady !== true) {
    return {
      routeType: "fail-closed",
      reason: "Compatibility bridge is unavailable or not ready",
      isNative: false,
      isCompatibility: false,
    };
  }

  if (!SUPPORTED_COMPATIBILITY_HARNESSES.includes(harnessRef.harnessKind as any)) {
    return {
      routeType: "fail-closed",
      reason: `Target harness ${harnessRef.harnessKind} does not support Compatibility Bridge projection`,
      isNative: false,
      isCompatibility: false,
    };
  }

  return {
    routeType: "compatibility",
    reason: "Cross model and harness pairing routed through CLIProxyAPI Compatibility Bridge",
    isNative: false,
    isCompatibility: true,
  };
}
