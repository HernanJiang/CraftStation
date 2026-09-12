import { describe, expect, it } from "vitest";
import type { ProviderModelMenuProvider } from "@/renderer/components/common/ProviderModelMenu/parts/buildItems";
import type { CustomModel } from "@/renderer/components/thread/customModelCatalog";
import type { StoredRecipe } from "@/shared/crafting/workbenchTypes";
import { resolveRecipePickerTarget } from "./recipePickerTarget";

function provider(
  overrides: Partial<ProviderModelMenuProvider> & { kind: string },
): ProviderModelMenuProvider {
  return {
    label: overrides.kind,
    modelPickerKey: `${overrides.kind}:gui`,
    hiddenModelsKey: overrides.kind,
    presentationMode: "gui",
    capabilities: {
      models: [],
      efforts: [],
      modelEfforts: {},
      modes: ["agent"],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: false,
      supportsDirectInput: true,
      liveInputMode: "server",
      presentationMode: "gui",
      settingDefs: [],
    },
    ...overrides,
  } as ProviderModelMenuProvider;
}

function recipe(modelEntryRef: string): StoredRecipe {
  return {
    id: `recipe:harness:codex:${modelEntryRef}`,
    version: "1.0.0",
    systemName: "Codex · Test",
    modelEntryRef,
    harnessRef: "harness:codex",
    compatibility: { uiStatus: "NATIVE" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("resolveRecipePickerTarget", () => {
  it("resolves an agent-surface recipe by exact entry id", () => {
    const providers = [
      provider({
        kind: "codex",
        label: "Codex",
        accountId: "account-1",
        capabilities: {
          models: [{ id: "gpt-5.6-sol", label: "ChatGPT-5.6-Sol" }],
          efforts: [],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: false,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      }),
    ];
    const target = resolveRecipePickerTarget(
      recipe("agent:codex:gui:gpt-5.6-sol"),
      providers,
      [],
    );
    expect(target).toEqual({
      agentKind: "codex",
      model: "gpt-5.6-sol",
      accountId: "account-1",
      presentationMode: "gui",
    });
  });

  it("resolves a custom-model recipe through the serving provider", () => {
    const custom: CustomModel = {
      id: "custom:account-9:gpt-5.6-sol",
      provider: "codex",
      accountId: "account-9",
      modelId: "gpt-5.6-sol",
      displayName: "Sol",
      contextSize: "",
    };
    const providers = [
      provider({
        kind: "codex",
        label: "Codex",
        accountId: "account-9",
        capabilities: {
          models: [{ id: "gpt-5.6-sol", label: "Sol" }],
          efforts: [],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: false,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      }),
    ];
    expect(
      resolveRecipePickerTarget(recipe("custom:account-9:gpt-5.6-sol"), providers, [custom]),
    ).toEqual({
      agentKind: "codex",
      model: "gpt-5.6-sol",
      accountId: "account-9",
      presentationMode: "gui",
    });
  });

  it("falls back to base-kind + model id when the surface key changed", () => {
    // Bench saved `agent:opencode:gui:gemini-3.8-flash`; the composer surface
    // key differs (account rebound) — the recipe must still resolve.
    const providers = [
      provider({
        kind: "opencode",
        label: "OpenCode",
        modelPickerKey: "openai-compatible:account-7",
        hiddenModelsKey: "openai-compatible:account-7",
        capabilities: {
          models: [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }],
          efforts: [],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: false,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      }),
    ];
    expect(
      resolveRecipePickerTarget(
        recipe("agent:opencode:gui:gemini-3.8-flash"),
        providers,
        [],
      ),
    ).toEqual({
      agentKind: "opencode",
      model: "gemini-3.8-flash",
      presentationMode: "gui",
    });
  });

  it("never hijacks a same-named model from another vendor", () => {
    // Recipe is opencode's Gemini; antigravity also serves gemini-3.8-flash.
    // The opencode surface exists but no longer lists it: resolve undefined
    // instead of silently selecting Antigravity's copy.
    const providers = [
      provider({
        kind: "opencode",
        label: "OpenCode",
        capabilities: {
          models: [{ id: "some-other-model", label: "Other" }],
          efforts: [],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: false,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      }),
      provider({
        kind: "antigravity",
        label: "Antigravity",
        capabilities: {
          models: [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }],
          efforts: [],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: false,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      }),
    ];
    expect(
      resolveRecipePickerTarget(
        recipe("agent:opencode:gui:gemini-3.8-flash"),
        providers,
        [],
      ),
    ).toBeUndefined();
  });

  it("keeps an account-bound OpenCode custom model away from Antigravity", () => {
    const custom: CustomModel = {
      id: "custom:opencode:openai-compatible:gemini-3.8-flash",
      provider: "opencode",
      accountId: "openai-compatible:gemini",
      modelId: "gemini-3.8-flash",
      displayName: "Gemini 3.8 Flash",
      contextSize: "",
    };
    const providers = [
      provider({
        kind: "antigravity",
        label: "Antigravity",
        capabilities: {
          models: [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }],
          efforts: [],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: false,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      }),
      provider({
        kind: "opencode",
        label: "OpenCode",
        accountId: "openai-compatible:gemini",
        capabilities: {
          models: [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }],
          efforts: [],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: false,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      }),
    ];

    expect(
      resolveRecipePickerTarget(
        recipe("custom:opencode:openai-compatible:gemini-3.8-flash"),
        providers,
        [custom],
      ),
    ).toEqual({
      agentKind: "opencode",
      model: "gemini-3.8-flash",
      accountId: "openai-compatible:gemini",
      presentationMode: "gui",
    });
  });

  it("matches namespaced ids within the same vendor", () => {
    const providers = [
      provider({
        kind: "opencode",
        label: "OpenCode",
        capabilities: {
          models: [{ id: "opencode/gemini-3.8-flash", label: "Gemini 3.8 Flash" }],
          efforts: [],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: false,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      }),
    ];
    expect(
      resolveRecipePickerTarget(
        recipe("agent:opencode:gui:gemini-3.8-flash"),
        providers,
        [],
      ),
    ).toEqual({
      agentKind: "opencode",
      model: "opencode/gemini-3.8-flash",
      presentationMode: "gui",
    });
  });

  it("returns undefined when the underlying model is gone", () => {
    const providers = [provider({ kind: "codex" })];
    expect(resolveRecipePickerTarget(recipe("agent:codex:gui:gone"), providers, [])).toBeUndefined();
    expect(resolveRecipePickerTarget(recipe("custom:nope"), providers, [])).toBeUndefined();
  });
});
