import { describe, expect, it } from "vitest";
import { resolveCompatibility, resolutionKeyFor } from "@/shared/crafting/compatibility";
import type { SelectedModelEntry, HarnessReference } from "@/shared/crafting/workbenchTypes";
import {
  composeRecipeSystemName,
  storedRecipeId,
  storedRecipeSchema,
} from "@/shared/crafting/workbenchTypes";

function modelEntry(overrides: Partial<SelectedModelEntry> = {}): SelectedModelEntry {
  return {
    entryId: "agent:codex:terminal:gpt-5.3",
    source: "agent",
    providerKind: "codex",
    providerSurfaceKey: "codex",
    providerLabel: "Codex",
    channelLabel: "Codex",
    modelId: "gpt-5.3",
    displayName: "GPT-5.3",
    ...overrides,
  };
}

function harnessRef(overrides: Partial<HarnessReference> = {}): HarnessReference {
  return {
    harnessItemId: "harness:codex",
    harnessKind: "codex",
    descriptorId: "native-harness:codex",
    displayName: "Codex Harness",
    vendor: "codex",
    official: true,
    status: "ready",
    ...overrides,
  };
}

describe("workbench compatibility tiers", () => {
  it("native model on its ready native harness is NATIVE", () => {
    const resolution = resolveCompatibility({
      modelEntry: modelEntry({ providerKind: "codex" }),
      harnessRef: harnessRef({ vendor: "codex", status: "ready" }),
      harnessReady: true,
    });
    expect(resolution.status).toBe("NATIVE");
    expect(resolution.source).toBe("native");
  });

  it.each([
    ["muse", "muse"],
    ["deepseek", "deepseek"],
  ])(
    "foreign model on %s is CRAFTABLE when the compatibility bridge is ready",
    (harnessKind, vendor) => {
      const resolution = resolveCompatibility({
        modelEntry: modelEntry({ providerKind: "openai" }),
        harnessRef: harnessRef({
          vendor,
          harnessKind,
          harnessItemId: `harness:${harnessKind}`,
          displayName: `${harnessKind} Harness`,
          status: "ready",
        }),
        harnessReady: true,
        compatibilityBridgeReady: true,
      });
      expect(resolution.status).toBe("CRAFTABLE");
      expect(resolution.source).toBe("compatibility-layer");
    },
  );

  it("cross-vendor ready harness is CRAFTABLE", () => {
    const resolution = resolveCompatibility({
      modelEntry: modelEntry({ providerKind: "openai" }),
      harnessRef: harnessRef({
        vendor: "xai",
        harnessKind: "grok",
        harnessItemId: "harness:grok",
        displayName: "Grok Harness",
        status: "ready",
      }),
      harnessReady: true,
      compatibilityBridgeReady: true,
    });
    expect(resolution.status).toBe("CRAFTABLE");
    expect(resolution.source).toBe("compatibility-layer");
  });

  it("names a missing compatibility bridge so the workbench can install on craft", () => {
    const resolution = resolveCompatibility({
      modelEntry: modelEntry({ providerKind: "moonshot", modelId: "kimi-k3-256k" }),
      harnessRef: harnessRef({
        vendor: "openai",
        harnessKind: "codex",
        harnessItemId: "harness:codex",
        displayName: "Codex Native Harness",
        status: "ready",
      }),
      harnessReady: true,
      compatibilityBridgeReady: false,
    });
    expect(resolution.status).toBe("IMPOSSIBLE");
    expect(resolution.diagnostics[0]?.code).toBe("CPA_NOT_INSTALLED");
  });

  it("same-vendor agent kind and model vendor is NATIVE", () => {
    const resolution = resolveCompatibility({
      modelEntry: modelEntry({ providerKind: "codex" }),
      harnessRef: harnessRef({ vendor: "openai", status: "ready" }),
      harnessReady: true,
    });
    expect(resolution.status).toBe("NATIVE");
    expect(resolution.source).toBe("native");
  });

  it("missing material fails closed to IMPOSSIBLE", () => {
    const resolution = resolveCompatibility({
      modelEntry: undefined,
      harnessRef: harnessRef(),
      harnessReady: true,
    });
    expect(resolution.status).toBe("IMPOSSIBLE");
    expect(resolution.diagnostics.length).toBeGreaterThan(0);
  });

  it("unready harness is IMPOSSIBLE even for native pairs", () => {
    const resolution = resolveCompatibility({
      modelEntry: modelEntry({ providerKind: "codex" }),
      harnessRef: harnessRef({ vendor: "codex", status: "not-configured" }),
      harnessReady: false,
    });
    expect(resolution.status).toBe("IMPOSSIBLE");
    expect(resolution.diagnostics.length).toBeGreaterThan(0);
  });

  it("OpenCode route readiness must be verified — fail closed when unverified", () => {
    const resolution = resolveCompatibility({
      modelEntry: modelEntry({ providerKind: "deepseek" }),
      harnessRef: harnessRef({ harnessKind: "opencode", vendor: "opencode", status: "ready" }),
      harnessReady: true,
      openCodeRouteReady: false,
    });
    expect(resolution.status).toBe("IMPOSSIBLE");

    const verified = resolveCompatibility({
      modelEntry: modelEntry({ providerKind: "google" }),
      harnessRef: harnessRef({ harnessKind: "opencode", vendor: "opencode", status: "ready" }),
      harnessReady: true,
      openCodeRouteReady: true,
      compatibilityBridgeReady: false,
    });
    expect(verified.status).toBe("NATIVE");
    expect(verified.source).toBe("native");
  });

  it("does not infer compatibility readiness when the supervisor omits it", () => {
    const resolution = resolveCompatibility({
      modelEntry: modelEntry({ providerKind: "openai" }),
      harnessRef: harnessRef({
        vendor: "xai",
        harnessKind: "grok",
        harnessItemId: "harness:grok",
        displayName: "Grok Harness",
        status: "ready",
      }),
      harnessReady: true,
    });
    expect(resolution.status).toBe("IMPOSSIBLE");
  });

  it("resolution key changes when any slot identity changes", () => {
    const base = resolutionKeyFor("agent:codex:gpt-5.3", "harness:codex");
    expect(resolutionKeyFor("agent:codex:gpt-5.4", "harness:codex")).not.toBe(base);
    expect(resolutionKeyFor("agent:codex:gpt-5.3", "harness:opencode")).not.toBe(base);
    expect(resolutionKeyFor("agent:codex:gpt-5.3", "harness:codex", "account-1")).not.toBe(base);
  });

  it("does not alias provider/runtime slots or identifiers containing delimiters", () => {
    expect(resolutionKeyFor("model", "harness", "profile")).not.toBe(
      resolutionKeyFor("model", "harness", undefined, "profile"),
    );
    expect(resolutionKeyFor("model|harness", "other")).not.toBe(
      resolutionKeyFor("model", "harness|other"),
    );
    expect(resolutionKeyFor("model", "harness", "", "profile")).not.toBe(
      resolutionKeyFor("model", "harness", undefined, "profile"),
    );
  });
});

describe("recipe identity", () => {
  it("system name is Harness · Model without reasoning or context", () => {
    expect(composeRecipeSystemName("Codex Harness", "GPT-5.3")).toBe("Codex Harness · GPT-5.3");
  });

  it("same materials collapse to the same recipe id; different materials differ", () => {
    expect(storedRecipeId("agent:codex:gpt-5.3", "harness:codex")).toBe(
      storedRecipeId("agent:codex:gpt-5.3", "harness:codex"),
    );
    expect(storedRecipeId("agent:codex:gpt-5.3", "harness:codex")).not.toBe(
      storedRecipeId("agent:codex:gpt-5.3", "harness:opencode"),
    );
  });

  it("StoredRecipe DTO round-trips through its schema", () => {
    const recipe = {
      id: storedRecipeId("agent:codex:gpt-5.3", "harness:codex"),
      version: "1.0.0",
      systemName: "Codex Harness · GPT-5.3",
      modelEntryRef: "agent:codex:gpt-5.3",
      harnessRef: "harness:codex",
      compatibility: { uiStatus: "NATIVE" as const },
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    };
    expect(() => storedRecipeSchema.parse(recipe)).not.toThrow();
  });
});
