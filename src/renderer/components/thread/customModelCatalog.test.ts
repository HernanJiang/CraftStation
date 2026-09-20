import { describe, expect, it } from "vitest";
import type { AgentCapability } from "@/shared/contracts";
import {
  collectCustomModelEfforts,
  CONTEXT_SIZE_PRESETS,
  customModelId,
  effortPresetForProvider,
  mergeCustomModelsIntoCapabilities,
  parseContextSizeTokens,
  parseEffortTiers,
} from "./customModelCatalog";

function baseCapabilities(): AgentCapability {
  return {
    models: [
      { id: "builtin-1", label: "Builtin One" },
      { id: "builtin-2", label: "Builtin Two" },
    ],
    efforts: ["high"],
    modelEfforts: {},
    modes: [],
    approvalPolicies: [],
    sandboxModes: [],
    presentationMode: "gui",
    supportsResume: false,
    supportsDirectInput: true,
    liveInputMode: "server",
    settingDefs: [],
  } as AgentCapability;
}

describe("parseContextSizeTokens", () => {
  it("parses K/M presets and raw token counts", () => {
    expect(parseContextSizeTokens("128K")).toBe(128 * 1024);
    expect(parseContextSizeTokens("1M")).toBe(1_048_576);
    expect(parseContextSizeTokens("300000")).toBe(300000);
    expect(parseContextSizeTokens("200k")).toBe(200 * 1024);
  });

  it("returns undefined for the default-max empty value or garbage", () => {
    expect(parseContextSizeTokens("")).toBeUndefined();
    expect(parseContextSizeTokens(undefined)).toBeUndefined();
    expect(parseContextSizeTokens("auto")).toBeUndefined();
  });

  it("exposes the default-max preset first with an empty value", () => {
    expect(CONTEXT_SIZE_PRESETS[0]).toEqual({ value: "", label: "默认最高" });
  });
});

describe("mergeCustomModelsIntoCapabilities", () => {
  const custom = [
    {
      id: customModelId("codex", "custom-a"),
      provider: "codex",
      modelId: "custom-a",
      displayName: "Custom A",
      contextSize: "128K",
    },
    {
      id: customModelId("codex", "builtin-1"),
      provider: "codex",
      modelId: "builtin-1",
      displayName: "Dup Builtin",
      contextSize: "",
    },
    {
      id: customModelId("grok", "other-channel"),
      provider: "grok",
      modelId: "other-channel",
      displayName: "Other",
      contextSize: "",
    },
  ];

  it("appends models of the matching kind, skipping builtin-id collisions and other kinds", () => {
    const merged = mergeCustomModelsIntoCapabilities("codex", baseCapabilities(), custom);
    expect(merged.models.map((model) => model.id)).toEqual(["builtin-1", "builtin-2", "custom-a"]);
    expect(merged.models[2]).toEqual({ id: "custom-a", label: "Custom A" });
  });

  it("wires the custom context size into contextSizes and modelContextSizes", () => {
    const merged = mergeCustomModelsIntoCapabilities("codex", baseCapabilities(), custom);
    expect(merged.contextSizes).toEqual([{ id: "128K", label: "128K" }]);
    expect(merged.modelContextSizes?.["custom-a"]).toEqual(["128K"]);
    expect(merged.modelContextSizes?.["builtin-1"]).toBeUndefined();
  });

  it("returns capabilities untouched when no custom models match the kind", () => {
    const capabilities = baseCapabilities();
    expect(mergeCustomModelsIntoCapabilities("gemini", capabilities, custom)).toBe(capabilities);
  });

  it("reuses an existing contextSize entry instead of duplicating it", () => {
    const capabilities = {
      ...baseCapabilities(),
      contextSizes: [{ id: "128K", label: "128K" }],
    } as AgentCapability;
    const merged = mergeCustomModelsIntoCapabilities("codex", capabilities, custom);
    expect(merged.contextSizes).toHaveLength(1);
  });

  it("merges hand-written effort tiers without touching builtin entries", () => {
    const customEfforts = [
      {
        id: "custom:codex::my-model",
        provider: "codex",
        modelId: "my-model",
        displayName: "My Model",
        contextSize: "",
        efforts: ["low", "high"],
        defaultEffort: "low",
      },
    ];
    const merged = mergeCustomModelsIntoCapabilities("codex", baseCapabilities(), customEfforts);
    expect(merged.modelEfforts?.["my-model"]).toEqual(["low", "high"]);
    expect(merged.modelDefaultEfforts?.["my-model"]).toBe("low");
    expect(merged.modelEfforts?.["builtin-1"]).toBeUndefined();
  });

  it("merges effort tiers from channel-bound entries without listing them", () => {
    // Channel models (accountId set) never join the shared models list, but
    // their hand-written tiers must still reach the picker — otherwise a
    // channel model shows no effort control at all.
    const channelBound = [
      {
        id: "custom:kimi:openai-compatible:chan:kimi-k2.8-preview",
        provider: "kimi",
        accountId: "openai-compatible:chan",
        modelId: "kimi-k2.8-preview",
        displayName: "kimi-k2.8-preview",
        contextSize: "",
        efforts: ["low", "high", "max"],
        defaultEffort: "high",
      },
    ];
    const merged = mergeCustomModelsIntoCapabilities("kimi", baseCapabilities(), channelBound);
    expect(merged.models.map((model) => model.id)).toEqual(["builtin-1", "builtin-2"]);
    expect(merged.modelEfforts?.["kimi-k2.8-preview"]).toEqual(["low", "high", "max"]);
    expect(merged.modelDefaultEfforts?.["kimi-k2.8-preview"]).toBe("high");
  });
});

describe("effort presets", () => {
  it("parses comma-separated tiers and resolves provider presets", () => {
    expect(parseEffortTiers("low, medium,, high  low")).toEqual(["low", "medium", "high"]);
    expect(parseEffortTiers("")).toEqual([]);
    expect(effortPresetForProvider("codex").tiers).toContain("xhigh");
    expect(effortPresetForProvider("unknown-kind").tiers).toEqual(["low", "medium", "high"]);
  });

  it("collects only entries with tiers, keeping valid defaults", () => {
    expect(
      collectCustomModelEfforts([
        {
          id: "a",
          provider: "codex",
          modelId: "m1",
          displayName: "M1",
          contextSize: "",
          efforts: ["low"],
          defaultEffort: "medium",
        },
        {
          id: "b",
          provider: "codex",
          modelId: "m2",
          displayName: "M2",
          contextSize: "",
        },
      ]),
    ).toEqual({ modelEfforts: { m1: ["low"] } });
  });
});
