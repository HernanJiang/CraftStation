import { describe, expect, it } from "vitest";
import { resolveExecutionRoute } from "./executionRoute";
import type { HarnessReference, SelectedModelEntry } from "./workbenchTypes";

describe("ExecutionRouteResolver", () => {
  const openaiModel: SelectedModelEntry = {
    entryId: "openai:gpt-5.3-codex",
    source: "agent",
    providerKind: "openai",
    providerSurfaceKey: "openai",
    providerLabel: "OpenAI",
    channelLabel: "Codex",
    modelId: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
  };

  const codexHarness: HarnessReference = {
    harnessItemId: "harness:codex",
    harnessKind: "codex",
    descriptorId: "desc-codex",
    vendor: "openai",
    displayName: "Codex Harness",
    official: true,
    status: "ready",
  };

  const opencodeHarness: HarnessReference = {
    harnessItemId: "harness:opencode",
    harnessKind: "opencode",
    descriptorId: "desc-opencode",
    vendor: "opencode",
    displayName: "OpenCode Harness",
    official: true,
    status: "ready",
  };

  const grokHarness: HarnessReference = {
    harnessItemId: "harness:grok",
    harnessKind: "grok",
    descriptorId: "desc-grok",
    vendor: "xai",
    displayName: "Grok Harness",
    official: true,
    status: "ready",
  };

  it("resolves native pairing to 100% native route", () => {
    const decision = resolveExecutionRoute({
      modelEntry: openaiModel,
      harnessRef: codexHarness,
      harnessReady: true,
    });
    expect(decision.routeType).toBe("native");
    expect(decision.isNative).toBe(true);
    expect(decision.isCompatibility).toBe(false);
  });

  it("resolves cross pairing to compatibility route when ready", () => {
    const decision = resolveExecutionRoute({
      modelEntry: openaiModel,
      harnessRef: opencodeHarness,
      harnessReady: true,
      openCodeRouteReady: true,
      compatibilityBridgeReady: true,
    });
    expect(decision.routeType).toBe("compatibility");
    expect(decision.isNative).toBe(false);
    expect(decision.isCompatibility).toBe(true);
  });

  it("fails closed when harness is not ready", () => {
    const decision = resolveExecutionRoute({
      modelEntry: openaiModel,
      harnessRef: codexHarness,
      harnessReady: false,
    });
    expect(decision.routeType).toBe("fail-closed");
    expect(decision.isNative).toBe(false);
  });

  it("fails closed when cross pairing bridge is not ready", () => {
    const decision = resolveExecutionRoute({
      modelEntry: openaiModel,
      harnessRef: grokHarness,
      harnessReady: true,
      compatibilityBridgeReady: false,
    });
    expect(decision.routeType).toBe("fail-closed");
    expect(decision.isCompatibility).toBe(false);
  });

  it("fails closed when compatibility readiness is unknown", () => {
    const decision = resolveExecutionRoute({
      modelEntry: openaiModel,
      harnessRef: grokHarness,
      harnessReady: true,
    });
    expect(decision.routeType).toBe("fail-closed");
  });

  it("fails closed when OpenCode route readiness is unknown", () => {
    const decision = resolveExecutionRoute({
      modelEntry: openaiModel,
      harnessRef: opencodeHarness,
      harnessReady: true,
    });
    expect(decision.routeType).toBe("fail-closed");
  });
});
