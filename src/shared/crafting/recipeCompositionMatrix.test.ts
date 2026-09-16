import { describe, expect, it } from "vitest";
import { resolveExecutionRoute } from "./executionRoute";
import type { HarnessReference, SelectedModelEntry } from "./workbenchTypes";

/**
 * Live inventory of this user's APIs × installed Harnesses.
 * Subscriptions go CPA onto a foreign Harness; third-party APIs inject
 * BaseURL/key; native pairs stay native; Antigravity cannot take a custom URL.
 */

function model(overrides: Partial<SelectedModelEntry>): SelectedModelEntry {
  return {
    entryId: "agent:codex:gpt-5.6-sol",
    source: "agent",
    providerKind: "codex",
    providerSurfaceKey: "codex",
    providerLabel: "Codex",
    channelLabel: "Codex",
    modelId: "gpt-5.6-sol",
    displayName: "gpt-5.6-sol",
    ...overrides,
  };
}

function harness(kind: string, vendor: string): HarnessReference {
  return {
    harnessItemId: `harness:${kind}`,
    harnessKind: kind,
    descriptorId: `native-harness:${kind}`,
    vendor,
    displayName: kind,
    official: true,
    status: "ready",
  };
}

const HARNESSES = {
  codex: harness("codex", "openai"),
  grok: harness("grok", "xai"),
  kimi: harness("kimi", "moonshot"),
  antigravity: harness("antigravity", "google"),
  opencode: harness("opencode", "opencode"),
  deepseek: harness("deepseek", "deepseek"),
  muse: harness("muse", "muse"),
  devin: harness("devin", "cognition"),
} as const;

function route(
  entry: SelectedModelEntry,
  target: HarnessReference,
  extra?: { compatibilityBridgeReady?: boolean },
) {
  return resolveExecutionRoute({
    modelEntry: entry,
    harnessRef: target,
    harnessReady: true,
    openCodeRouteReady: true,
    compatibilityBridgeReady: extra?.compatibilityBridgeReady ?? true,
  }).routeType;
}

const chatgpt = model({});
const grokSub = model({
  entryId: "agent:grok:grok-4.6",
  providerKind: "grok",
  modelId: "grok-4.6",
});
const kimiSub = model({
  entryId: "agent:kimi:kimi-for-coding",
  providerKind: "kimi",
  modelId: "kimi-for-coding",
});
const dshSub = model({
  entryId: "agent:deepseek:deepseek-flash",
  providerKind: "deepseek",
  modelId: "deepseek-flash",
});
const agyGemini = model({
  entryId: "agent:antigravity:gemini-3.8-flash",
  providerKind: "antigravity",
  modelId: "gemini-3.8-flash",
});
const opencodeCatalog = model({
  entryId: "agent:opencode:opencode-go/muse-spark-1.3-contributor",
  providerKind: "opencode",
  modelId: "opencode-go/muse-spark-1.3-contributor",
});
const devinSub = model({
  entryId: "agent:devin:swe",
  providerKind: "devin",
  modelId: "swe",
});
const chiral = model({
  entryId: "custom:codex:openai-compatible:chiral:gpt-5.6-sol",
  source: "custom",
  providerKind: "codex",
  modelId: "gpt-5.6-sol",
  accountId: "openai-compatible:0e3e4cde-49b3-4299-abb7-4074013f0da9",
});
const ark = model({
  entryId: "custom:opencode:openai-compatible:ark:glm-5.3-flash",
  source: "custom",
  providerKind: "opencode",
  modelId: "glm-5.3-flash",
  accountId: "openai-compatible:cc25ffa2-f6ae-4059-81be-ed9192a32323",
});

describe("API × Harness composition matrix", () => {
  it("keeps each subscription on its native Harness", () => {
    expect(route(chatgpt, HARNESSES.codex)).toBe("native");
    expect(route(grokSub, HARNESSES.grok)).toBe("native");
    expect(route(kimiSub, HARNESSES.kimi)).toBe("native");
    expect(route(dshSub, HARNESSES.deepseek)).toBe("native");
    expect(route(agyGemini, HARNESSES.antigravity)).toBe("native");
    expect(route(opencodeCatalog, HARNESSES.opencode)).toBe("native");
    expect(route(devinSub, HARNESSES.devin)).toBe("native");
  });

  it("projects a subscription onto a foreign CLI through CLIProxyAPI", () => {
    expect(route(chatgpt, HARNESSES.grok)).toBe("compatibility");
    expect(route(agyGemini, HARNESSES.codex)).toBe("compatibility");
    expect(route(grokSub, HARNESSES.codex)).toBe("compatibility");
  });

  it("runs allowlisted vendors on OpenCode natively, even from a subscription catalog", () => {
    expect(route(chatgpt, HARNESSES.opencode, { compatibilityBridgeReady: false })).toBe("native");
    expect(route(agyGemini, HARNESSES.opencode, { compatibilityBridgeReady: false })).toBe(
      "native",
    );
    expect(route(kimiSub, HARNESSES.opencode, { compatibilityBridgeReady: false })).toBe("native");
    expect(route(dshSub, HARNESSES.opencode, { compatibilityBridgeReady: false })).toBe("native");
    expect(route(grokSub, HARNESSES.opencode, { compatibilityBridgeReady: false })).toBe("native");
  });

  it("injects third-party APIs directly into Harnesses that accept a custom Base URL", () => {
    expect(route(chiral, HARNESSES.codex)).toBe("native");
    expect(route(chiral, HARNESSES.opencode)).toBe("native");
    expect(route(chiral, HARNESSES.grok)).toBe("native");
    expect(route(chiral, HARNESSES.kimi)).toBe("native");
    expect(route(ark, HARNESSES.opencode)).toBe("native");
    expect(route(ark, HARNESSES.codex)).toBe("native");
  });

  it("refuses third-party APIs on Antigravity (no custom Base URL)", () => {
    expect(route(chiral, HARNESSES.antigravity)).toBe("fail-closed");
    expect(route(ark, HARNESSES.antigravity)).toBe("fail-closed");
  });

  it("binds Antigravity-catalog Gemini onto OpenCode without CLIProxyAPI", () => {
    expect(route(agyGemini, HARNESSES.opencode, { compatibilityBridgeReady: false })).toBe(
      "native",
    );
  });
});
