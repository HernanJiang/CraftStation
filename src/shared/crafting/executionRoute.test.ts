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

  it("resolves an allowlisted vendor on the OpenCode universal router to native without the bridge", () => {
    const decision = resolveExecutionRoute({
      modelEntry: openaiModel,
      harnessRef: opencodeHarness,
      harnessReady: true,
      openCodeRouteReady: true,
      compatibilityBridgeReady: false,
    });
    expect(decision.routeType).toBe("native");
    expect(decision.isNative).toBe(true);
    expect(decision.isCompatibility).toBe(false);
  });

  it.each([
    ["openai"],
    ["xai"],
    ["google"],
    ["moonshot"],
    ["moonshot-openai-compatible"],
  ])("resolves canonical vendor %s on OpenCode to native", (providerKind) => {
    const decision = resolveExecutionRoute({
      modelEntry: { ...openaiModel, providerKind },
      harnessRef: opencodeHarness,
      harnessReady: true,
      openCodeRouteReady: true,
    });
    expect(decision.routeType).toBe("native");
  });

  it("keeps OpenCode catalog models on the official OpenCode runtime", () => {
    const decision = resolveExecutionRoute({
      modelEntry: { ...openaiModel, providerKind: "opencode", modelId: "opencode-go/muse-spark-1.3-contributor" },
      harnessRef: opencodeHarness,
      harnessReady: true,
      openCodeRouteReady: true,
    });
    expect(decision.routeType).toBe("native");
  });

  it("runs Antigravity-catalog Gemini on OpenCode natively without the compatibility bridge", () => {
    const decision = resolveExecutionRoute({
      modelEntry: {
        ...openaiModel,
        providerKind: "antigravity",
        modelId: "gemini-3.8-flash",
        entryId: "agent:antigravity:gemini-3.8-flash",
      },
      harnessRef: opencodeHarness,
      harnessReady: true,
      openCodeRouteReady: true,
      compatibilityBridgeReady: false,
    });
    expect(decision.routeType).toBe("native");
    expect(decision.isNative).toBe(true);
    expect(decision.isCompatibility).toBe(false);
  });

  it("launches a third-party OpenAI-compatible account directly on OpenCode", () => {
    const decision = resolveExecutionRoute({
      modelEntry: {
        ...openaiModel,
        source: "custom",
        providerKind: "opencode",
        modelId: "glm-5.3-flash",
        accountId: "openai-compatible:ark",
      },
      harnessRef: opencodeHarness,
      harnessReady: true,
      openCodeRouteReady: true,
      compatibilityBridgeReady: false,
    });
    expect(decision.routeType).toBe("native");
    expect(decision.reason).toMatch(/Third-party/i);
  });

  it("fails closed when a third-party account targets Antigravity", () => {
    const decision = resolveExecutionRoute({
      modelEntry: {
        ...openaiModel,
        source: "custom",
        providerKind: "codex",
        modelId: "gpt-5.6-sol",
        accountId: "openai-compatible:chiral",
      },
      harnessRef: {
        harnessItemId: "harness:antigravity",
        harnessKind: "antigravity",
        descriptorId: "desc-antigravity",
        vendor: "google",
        displayName: "Antigravity",
        official: true,
        status: "ready",
      },
      harnessReady: true,
    });
    expect(decision.routeType).toBe("fail-closed");
    expect(decision.reason).toMatch(/third-party/i);
  });

  it("fails closed for a vendor with no verified OpenCode native route", () => {
    const decision = resolveExecutionRoute({
      modelEntry: {
        ...openaiModel,
        providerKind: "qwen",
        modelId: "qwen3.8-flash",
        entryId: "agent:qwen:qwen3.8-flash",
      },
      harnessRef: opencodeHarness,
      harnessReady: true,
      openCodeRouteReady: true,
      compatibilityBridgeReady: true,
    });
    expect(decision.routeType).toBe("fail-closed");
    expect(decision.reason).toContain("has no verified OpenCode native route");
  });

  it("keeps cross-vendor single-vendor pairs on the bridge, never native", () => {
    const kimiModel = { ...openaiModel, providerKind: "moonshot", modelId: "kimi-k3-256k" };
    const withoutBridge = resolveExecutionRoute({
      modelEntry: kimiModel,
      harnessRef: codexHarness,
      harnessReady: true,
      compatibilityBridgeReady: false,
    });
    expect(withoutBridge.routeType).toBe("fail-closed");
    expect(withoutBridge.reason).toContain("Compatibility bridge is unavailable");
    const withBridge = resolveExecutionRoute({
      modelEntry: kimiModel,
      harnessRef: codexHarness,
      harnessReady: true,
      compatibilityBridgeReady: true,
    });
    expect(withBridge.routeType).toBe("compatibility");
    expect(withBridge.isNative).toBe(false);
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

  it.each([
    ["codex", "openai"],
    ["grok", "xai"],
    ["kimi", "moonshot"],
    ["gemini", "google"],
    ["deepseek", "deepseek"],
  ])("resolves agent kind %s with vendor %s as native", (providerKind, vendor) => {
    const decision = resolveExecutionRoute({
      modelEntry: { ...openaiModel, providerKind },
      harnessRef: { ...codexHarness, vendor },
      harnessReady: true,
    });
    expect(decision.routeType).toBe("native");
    expect(decision.isNative).toBe(true);
  });

  it.each([
    ["muse", "muse"],
    ["deepseek", "deepseek"],
  ])("routes a foreign model onto %s through the compatibility bridge", (harnessKind, vendor) => {
    const decision = resolveExecutionRoute({
      modelEntry: openaiModel,
      harnessRef: {
        ...codexHarness,
        harnessItemId: `harness:${harnessKind}`,
        harnessKind,
        vendor,
        displayName: `${harnessKind} Harness`,
      },
      harnessReady: true,
      compatibilityBridgeReady: true,
    });
    expect(decision.routeType).toBe("compatibility");
    expect(decision.isNative).toBe(false);
  });

  it("keeps genuinely cross-vendor pairs out of native", () => {
    const decision = resolveExecutionRoute({
      modelEntry: { ...openaiModel, providerKind: "codex" },
      harnessRef: grokHarness,
      harnessReady: true,
      compatibilityBridgeReady: true,
    });
    expect(decision.routeType).toBe("compatibility");
    expect(decision.isNative).toBe(false);
  });
});
