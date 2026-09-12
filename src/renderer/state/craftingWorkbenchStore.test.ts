import { beforeEach, describe, expect, it } from "vitest";
import { useCraftingWorkbenchStore } from "./craftingWorkbenchStore";
import type { CapabilityResolution } from "@/shared/crafting/workbenchTypes";

function resolution(status: "NATIVE" | "CRAFTABLE" | "IMPOSSIBLE"): CapabilityResolution {
  return {
    resolutionKey: "test-key",
    createdAt: new Date().toISOString(),
    status,
    source: status === "NATIVE" ? "native" : "compatibility-layer",
    modelEntryRef: "agent:codex:gpt-5.3",
    harnessRef: "harness:codex",
    capabilities: [],
    diagnostics: [],
  };
}

describe("craftingWorkbenchStore", () => {
  beforeEach(() => {
    // Reset to a clean persisted baseline between cases.
    useCraftingWorkbenchStore.setState({
      lastWorkbenchMode: "efficient",
      efficientDraft: { reservedSlot: true },
      creativeDraft: { slots: Array(9).fill(undefined) },
      recipes: [],
      selectedInspectorRef: undefined,
      pendingRecipeIntent: undefined,
      cpaHelper: { present: false, selected: false },
    });
  });

  it("invalidates the old resolution whenever a material changes", () => {
    useCraftingWorkbenchStore.getState().setEfficientModel("agent:codex:gpt-5.3");
    useCraftingWorkbenchStore.getState().setEfficientHarness("harness:codex");
    useCraftingWorkbenchStore.getState().attachResolution("efficient", resolution("NATIVE"));
    expect(useCraftingWorkbenchStore.getState().efficientDraft.resolution?.status).toBe("NATIVE");

    // Replacing the model must drop the stale resolution.
    useCraftingWorkbenchStore.getState().setEfficientModel("agent:codex:gpt-5.4");
    expect(useCraftingWorkbenchStore.getState().efficientDraft.resolution).toBeUndefined();
  });

  it("saves recipes with an auto system name and optional alias", () => {
    const { recipe } = useCraftingWorkbenchStore.getState().saveRecipe({
      modelEntryRef: "agent:codex:gpt-5.3",
      harnessRef: "harness:codex",
      modelName: "GPT-5.3",
      harnessName: "Codex Harness",
      resolution: resolution("NATIVE"),
    });
    expect(recipe.systemName).toBe("Codex Harness · GPT-5.3");
    expect(useCraftingWorkbenchStore.getState().recipes).toHaveLength(1);

    useCraftingWorkbenchStore.getState().updateRecipeAlias(recipe.id, "日常编码");
    expect(useCraftingWorkbenchStore.getState().recipes[0]?.alias).toBe("日常编码");
  });

  it("same material pair saves once but reports duplicates", () => {
    const first = useCraftingWorkbenchStore.getState().saveRecipe({
      modelEntryRef: "agent:codex:gpt-5.3",
      harnessRef: "harness:codex",
      modelName: "GPT-5.3",
      harnessName: "Codex Harness",
      resolution: resolution("NATIVE"),
    });
    expect(first.duplicateCount).toBe(0);

    const second = useCraftingWorkbenchStore.getState().saveRecipe({
      modelEntryRef: "agent:codex:gpt-5.3",
      harnessRef: "harness:codex",
      modelName: "GPT-5.3",
      harnessName: "Codex Harness",
      resolution: resolution("NATIVE"),
    });
    expect(second.duplicateCount).toBe(1);
    // Same component pair collapses to one stored recipe (replace, not append).
    expect(useCraftingWorkbenchStore.getState().recipes).toHaveLength(1);
  });

  it("toggles homepage visibility per recipe and preserves it across re-saves", () => {
    const { recipe } = useCraftingWorkbenchStore.getState().saveRecipe({
      modelEntryRef: "agent:codex:gpt-5.3",
      harnessRef: "harness:codex",
      modelName: "GPT-5.3",
      harnessName: "Codex Harness",
      resolution: resolution("NATIVE"),
    });
    expect(recipe.homepageVisible).toBeUndefined();

    useCraftingWorkbenchStore.getState().setRecipeHomepageVisible(recipe.id, true);
    expect(
      useCraftingWorkbenchStore.getState().recipes.find((r) => r.id === recipe.id)
        ?.homepageVisible,
    ).toBe(true);

    // Re-saving the same pair keeps the flag.
    useCraftingWorkbenchStore.getState().saveRecipe({
      modelEntryRef: "agent:codex:gpt-5.3",
      harnessRef: "harness:codex",
      modelName: "GPT-5.3",
      harnessName: "Codex Harness",
      resolution: resolution("NATIVE"),
    });
    expect(
      useCraftingWorkbenchStore.getState().recipes.find((r) => r.id === recipe.id)
        ?.homepageVisible,
    ).toBe(true);

    useCraftingWorkbenchStore.getState().setRecipeHomepageVisible(recipe.id, false);
    expect(
      useCraftingWorkbenchStore.getState().recipes.find((r) => r.id === recipe.id)
        ?.homepageVisible,
    ).toBeUndefined();
  });

  it("deleting a recipe never touches other state", () => {
    const { recipe } = useCraftingWorkbenchStore.getState().saveRecipe({
      modelEntryRef: "agent:codex:gpt-5.3",
      harnessRef: "harness:codex",
      modelName: "GPT-5.3",
      harnessName: "Codex Harness",
      resolution: resolution("NATIVE"),
    });
    useCraftingWorkbenchStore.getState().setEfficientModel("agent:codex:gpt-5.3");
    useCraftingWorkbenchStore.getState().deleteRecipe(recipe.id);
    const state = useCraftingWorkbenchStore.getState();
    expect(state.recipes).toHaveLength(0);
    // The draft/model material survives recipe deletion.
    expect(state.efficientDraft.modelEntryRef).toBe("agent:codex:gpt-5.3");
  });

  it("loading a recipe into the draft replaces the current materials", () => {
    const { recipe } = useCraftingWorkbenchStore.getState().saveRecipe({
      modelEntryRef: "agent:codex:gpt-5.3",
      harnessRef: "harness:codex",
      modelName: "GPT-5.3",
      harnessName: "Codex Harness",
      resolution: resolution("NATIVE"),
    });
    useCraftingWorkbenchStore.getState().setEfficientModel("agent:opencode:gemini");
    useCraftingWorkbenchStore.getState().loadRecipeToDraft(recipe, "efficient");
    expect(useCraftingWorkbenchStore.getState().efficientDraft.modelEntryRef).toBe(
      "agent:codex:gpt-5.3",
    );
    expect(useCraftingWorkbenchStore.getState().efficientDraft.harnessRef).toBe("harness:codex");
  });

  it("switching modes never clears the other draft", () => {
    useCraftingWorkbenchStore.getState().setEfficientModel("agent:codex:gpt-5.3");
    useCraftingWorkbenchStore.getState().setMode("creative");
    expect(useCraftingWorkbenchStore.getState().efficientDraft.modelEntryRef).toBe(
      "agent:codex:gpt-5.3",
    );
    useCraftingWorkbenchStore.getState().setMode("efficient");
    expect(useCraftingWorkbenchStore.getState().lastWorkbenchMode).toBe("efficient");
    expect(useCraftingWorkbenchStore.getState().efficientDraft.modelEntryRef).toBe(
      "agent:codex:gpt-5.3",
    );
  });

  it("ensureCliProxyApiItem is idempotent: reuse, never duplicate", () => {
    const store = () => useCraftingWorkbenchStore.getState();
    expect(store().cpaHelper).toEqual({ present: false, selected: false });

    store().ensureCliProxyApiItem();
    expect(store().cpaHelper).toEqual({ present: true, selected: true });

    // Second ensure reuses the same singleton entry (no duplicate state).
    store().ensureCliProxyApiItem();
    expect(store().cpaHelper).toEqual({ present: true, selected: true });
  });

  it("native routes clear the CPA selection without removing the helper", () => {
    const store = () => useCraftingWorkbenchStore.getState();
    store().ensureCliProxyApiItem();
    store().clearCliProxyApiSelection();
    expect(store().cpaHelper).toEqual({ present: true, selected: false });

    // Clearing twice stays a no-op.
    store().clearCliProxyApiSelection();
    expect(store().cpaHelper).toEqual({ present: true, selected: false });
  });
});
