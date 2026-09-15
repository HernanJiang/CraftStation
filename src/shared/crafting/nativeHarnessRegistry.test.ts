import { describe, expect, it } from "vitest";
import {
  BUILTIN_NATIVE_HARNESS_ITEMS,
  BUILTIN_NATIVE_HARNESS_MODEL_ITEMS,
  ItemRegistry,
  NATIVE_HARNESS_RECIPES,
} from "./registry";
import type { CraftContext } from "./types";

const context: CraftContext = {
  workspace: "C:\\repo",
  threadId: "thread-native-recipe",
  profileRef: "profile:work",
  environment: { kind: "windows" },
};

describe("Native Harness registry", () => {
  it("registers native Harness Items and matching native model families", () => {
    const registry = new ItemRegistry();

    expect(registry.listItems("harness").map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "harness:codex",
        "harness:grok",
        "harness:kimi",
        "harness:antigravity",
        "harness:deepseek",
        "harness:deepseek-api",
        "harness:muse",
      ]),
    );
    expect(BUILTIN_NATIVE_HARNESS_ITEMS).toHaveLength(6);
    expect(BUILTIN_NATIVE_HARNESS_MODEL_ITEMS.map((item) => item.metadata.vendor)).toEqual(
      expect.arrayContaining(["xai", "moonshot", "google", "deepseek", "muse"]),
    );
    expect(NATIVE_HARNESS_RECIPES.map((recipe) => recipe.id)).toEqual(
      expect.arrayContaining([
        "recipe:xai-grok-native",
        "recipe:moonshot-kimi-native",
        "recipe:google-antigravity-native",
        "recipe:deepseek-native",
        "recipe:deepseek-api",
        "recipe:meta-muse-native",
      ]),
    );
  });

  it("compiles each peer pairing with sticky profile/environment input", () => {
    const registry = new ItemRegistry();

    for (const recipe of NATIVE_HARNESS_RECIPES) {
      const model = registry
        .listItems("model")
        .find((item) =>
          recipe.matches({ model: item, harness: registry.getItem(recipe.harnessItemId)! }),
        );
      const harness = registry.getItem(recipe.harnessItemId);

      expect(model, `${recipe.id} model`).toBeDefined();
      expect(harness, `${recipe.id} harness`).toBeDefined();

      const plan = recipe.compile({ model: model!, harness: harness! }, context);
      expect(plan.runtimeBinding).toMatchObject({
        harnessKind: recipe.harnessKind,
        profileRef: "profile:work",
        environment: { kind: "windows" },
      });
      expect(plan.workspace).toBe("C:\\repo");
      expect(plan.threadId).toBe("thread-native-recipe");
      expect(plan.id).toContain(`plan:${recipe.id}:`);
    }

    const apiRecipe = NATIVE_HARNESS_RECIPES.find(
      (recipe) => recipe.harnessKind === "deepseek-api",
    )!;
    expect(
      apiRecipe.matches({
        model: registry.getItem("deepseek:deepseek-chat")!,
        harness: registry.getItem("harness:deepseek-api")!,
      }),
    ).toBe(false);
    expect(
      apiRecipe.matches({
        model: registry.getItem("deepseek:deepseek-chat-api")!,
        harness: registry.getItem("harness:deepseek-api")!,
      }),
    ).toBe(true);
  });
});
