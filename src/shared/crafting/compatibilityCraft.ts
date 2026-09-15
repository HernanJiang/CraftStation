import { CompatibilityBridgeRecipe } from "./recipes/compatibilityRecipe";
import type { CraftResult, Item, ResultItem } from "./types";
import { canonicalModelVendor } from "./vendors";

/**
 * Build a CraftResult for a saved workbench recipe that must run through the
 * CLIProxyAPI Compatibility Bridge (subscription model × foreign Harness).
 * Homepage recipe launches have no Crafting Grid; this synthesizes the same
 * plan CompatibilityBridgeRecipe would compile from inventory materials.
 */
export function buildCompatibilityCraftResult(input: {
  modelId: string;
  modelEntryRef: string;
  modelProviderKind: string;
  harnessKind: string;
  harnessRef: string;
  harnessVendor?: string;
}): CraftResult {
  const modelVendor = canonicalModelVendor(input.modelProviderKind) || input.modelProviderKind;
  const harnessVendor = input.harnessVendor || canonicalModelVendor(input.harnessKind) || input.harnessKind;
  const modelItem: Item = {
    id: input.modelEntryRef,
    kind: "model",
    metadata: {
      id: input.modelEntryRef,
      name: input.modelId,
      version: "1.0.0",
      vendor: modelVendor,
      source: "workbench",
      description: input.modelId,
      compatibilityStatus: "SUPPORTED",
    },
    components: [
      {
        kind: "model_capability",
        vendor: modelVendor,
        modelId: input.modelId,
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  };
  const harnessItem: Item = {
    id: input.harnessRef.startsWith("harness:") ? input.harnessRef : `harness:${input.harnessKind}`,
    kind: "harness",
    metadata: {
      id: input.harnessRef.startsWith("harness:") ? input.harnessRef : `harness:${input.harnessKind}`,
      name: input.harnessKind,
      version: "1.0.0",
      vendor: harnessVendor,
      source: "workbench",
      description: input.harnessKind,
      compatibilityStatus: "SUPPORTED",
    },
    components: [
      {
        kind: "harness_runtime",
        harnessKind: input.harnessKind,
        supportedVendors: [modelVendor, harnessVendor],
        executionMode: "structured_session",
      },
    ],
  };
  const recipe = new CompatibilityBridgeRecipe();
  const craftPlan = recipe.compile({ model: modelItem, harness: harnessItem }, {});
  const now = new Date().toISOString();
  const resultItem: ResultItem = {
    id: craftPlan.resultItemId,
    kind: "result",
    metadata: {
      id: craftPlan.resultItemId,
      name: `${input.harnessKind} · ${input.modelId}`,
      version: recipe.version,
      vendor: harnessVendor,
      source: "workbench",
      description: recipe.description,
      compatibilityStatus: "SUPPORTED",
    },
    components: [],
    provenance: {
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      craftedAt: now,
      ingredients: craftPlan.ingredients,
      runtimeBinding: craftPlan.runtimeBinding,
    },
    craftPlan,
  };
  return { success: true, resultItem, craftPlan, recipe };
}
