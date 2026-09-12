import { describe, expect, it } from "vitest";
import { BUILTIN_MODEL_ITEMS, NATIVE_HARNESS_RECIPES } from "./registry";

describe("deepseek v4.1 registry", () => {
  it("exposes native + api v4.1 flash model items", () => {
    const ids = new Set(BUILTIN_MODEL_ITEMS.map((item) => item.id));
    expect(ids.has("deepseek:deepseek-v4.1-flash")).toBe(true);
    expect(ids.has("deepseek:deepseek-v4.1-flash-api")).toBe(true);
  });

  it("deepseek-api recipe covers v4.1 flash without dropping older models", () => {
    const recipe = NATIVE_HARNESS_RECIPES.find((r) => r.id === "recipe:deepseek-api");
    expect(recipe).toBeDefined();
    const modelIds = (recipe as unknown as { modelIds?: string[] }).modelIds ?? [];
    const modelItemIds = (recipe as unknown as { modelItemIds?: string[] }).modelItemIds ?? [];
    for (const expected of [
      "deepseek-chat",
      "deepseek-reasoner",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-v4.1-flash",
    ]) {
      expect(modelIds).toContain(expected);
    }
    expect(modelItemIds).toContain("deepseek:deepseek-v4.1-flash-api");
  });

  it("deepseek native recipe still binds the deepseek vendor", () => {
    const recipe = NATIVE_HARNESS_RECIPES.find((r) => r.id === "recipe:deepseek-native");
    expect(recipe).toBeDefined();
    expect((recipe as unknown as { harnessKind: string }).harnessKind).toBe("deepseek");
  });
});
