import { z } from "zod";
import type { HarnessReference, SelectedModelEntry } from "./workbenchTypes";

export const executionRouteTypeSchema = z.enum(["native", "compatibility", "fail-closed"]);
export type ExecutionRouteType = z.infer<typeof executionRouteTypeSchema>;

export const SUPPORTED_COMPATIBILITY_HARNESSES = [
  "opencode",
  "codex",
  "kimi",
  "grok",
  "antigravity",
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

  const isNativePairing = modelEntry.providerKind === harnessRef.vendor;

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
