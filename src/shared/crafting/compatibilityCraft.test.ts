import { describe, expect, it } from "vitest";
import { buildCompatibilityCraftResult } from "./compatibilityCraft";

describe("buildCompatibilityCraftResult", () => {
  it("compiles an Antigravity Gemini × OpenCode plan onto the compatibility bridge", () => {
    const result = buildCompatibilityCraftResult({
      modelId: "gemini-3.8-flash",
      modelEntryRef: "agent:antigravity:gemini-3.8-flash",
      modelProviderKind: "antigravity",
      harnessKind: "opencode",
      harnessRef: "harness:opencode",
    });
    expect(result.success).toBe(true);
    expect(result.craftPlan?.runtimeBinding).toMatchObject({
      harnessKind: "opencode",
      modelId: "gemini-3.8-flash",
      routeType: "compatibility",
    });
    expect(result.resultItem?.provenance.recipeId).toBe("recipe:compatibility-bridge");
  });
});
