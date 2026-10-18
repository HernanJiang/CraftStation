import { describe, expect, it } from "vitest";
import { Crafter } from "./crafter";
import { CraftingError } from "./errors";
import { buildCompatibilityCraftResult } from "./compatibilityCraft";
import {
  assertHarnessContract,
  COMPATIBILITY_REQUIRED_CONTRACT,
  declaredHarnessContract,
  requiredContractFor,
} from "./harnessContract";
import { CompatibilityBridgeRecipe } from "./recipes/compatibilityRecipe";
import { NativeHarnessRecipe } from "./recipes/nativeHarnessRecipe";
import { getDefaultRegistry } from "./registry";
import type { Item } from "./types";

function model(vendor = "example"): Item {
  return {
    id: `${vendor}:demo`,
    kind: "model",
    metadata: {
      id: `${vendor}:demo`,
      name: "Demo",
      version: "1.0.0",
      vendor,
      source: "test",
      description: "demo",
      compatibilityStatus: "SUPPORTED",
    },
    components: [
      {
        kind: "model_capability",
        vendor,
        modelId: "demo",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  };
}

function harness(input: {
  kind: string;
  contract?: Record<string, unknown>;
  omitContract?: boolean;
}): Item {
  const components: Item["components"] = [
    {
      kind: "harness_runtime",
      harnessKind: input.kind,
      supportedVendors: ["example"],
      executionMode: input.kind === "zcode" ? "terminal_pty" : "structured_session",
    },
  ];
  if (input.contract) components.push({ kind: "harness_contract", ...input.contract });
  return {
    id: `harness:${input.kind}`,
    kind: "harness",
    metadata: {
      id: `harness:${input.kind}`,
      name: input.kind,
      version: "1.0.0",
      vendor: input.kind,
      source: "test",
      description: input.kind,
      compatibilityStatus: "SUPPORTED",
    },
    components,
  };
}

describe("harness contract", () => {
  it("requires only the axes a harness actually declares", () => {
    expect(requiredContractFor("codex")).toEqual({
      approval: "ui",
      resume: "native",
      instructions: "delivered",
    });
    expect(requiredContractFor("deepseek")).toEqual({ instructions: "delivered" });
    expect(requiredContractFor("zcode")).toEqual({ approval: "terminal", resume: "native" });
    expect(requiredContractFor("missing")).toEqual({});
  });

  it("lets an explicit component override the builtin table", () => {
    const item = harness({
      kind: "opencode",
      contract: { approval: "none", resume: "none", instructions: "not-delivered" },
    });
    expect(declaredHarnessContract(item)).toEqual({
      approval: "none",
      resume: "none",
      instructions: "not-delivered",
    });
  });

  it("falls back to the builtin table when the item has no contract component", () => {
    expect(declaredHarnessContract(harness({ kind: "opencode" }))?.approval).toBe("ui");
  });

  it("refuses a compatibility compile when the target declaration is weaker", () => {
    const recipe = new CompatibilityBridgeRecipe();
    expect(() =>
      recipe.compile(
        {
          model: model(),
          harness: harness({
            kind: "opencode",
            contract: { approval: "none", resume: "native", instructions: "delivered" },
          }),
        },
        {},
      ),
    ).toThrow(CraftingError);
    expect(() =>
      recipe.compile({ model: model(), harness: harness({ kind: "not-a-harness" }) }, {}),
    ).toThrow(/拒绝编译/);
  });

  it("still compiles a compatibility plan onto OpenCode through the builtin table", () => {
    const plan = new CompatibilityBridgeRecipe().compile(
      { model: model(), harness: harness({ kind: "opencode" }) },
      {},
    );
    expect(plan.runtimeBinding.harnessKind).toBe("opencode");
    expect(plan.runtimeBinding.routeType).toBe("compatibility");
  });

  it("keeps a native recipe compiling against its own declaration", () => {
    const registry = getDefaultRegistry();
    const recipe = new NativeHarnessRecipe({
      id: "recipe:test-zcode",
      name: "ZCode",
      description: "test",
      harnessKind: "zcode",
      harnessItemId: "harness:zcode",
      modelVendors: ["zai"],
      harnessVendors: ["zai"],
      policy: { maxToolCalls: 3 },
    });
    const zai = registry.getItem("zai:GLM-5.3");
    const zcode = registry.getItem("harness:zcode");
    expect(zai).toBeDefined();
    expect(zcode).toBeDefined();
    const plan = recipe.compile({ model: zai!, harness: zcode! }, {});
    expect(plan.runtimeBinding.harnessKind).toBe("zcode");
    expect(plan.policy).toEqual({ maxToolCalls: 3 });
  });

  it("refuses the Crafter path when a compatibility swap drops approval or resume", () => {
    const result = new Crafter().compile({
      slots: {
        model: model("google"),
        harness: harness({ kind: "deepseek" }),
      },
    });
    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.code).toBe("COMPILATION_ERROR");
    expect(result.errors?.[0]?.message).toContain("拒绝编译");
  });

  it("refuses buildCompatibilityCraftResult for DeepSeek", () => {
    expect(() =>
      buildCompatibilityCraftResult({
        modelId: "gemini-3.8-flash",
        modelEntryRef: "agent:antigravity:gemini-3.8-flash",
        modelProviderKind: "antigravity",
        harnessKind: "deepseek",
        harnessRef: "harness:deepseek",
      }),
    ).toThrow(/拒绝编译/);
  });

  it("does not treat terminal approval as a UI approval", () => {
    expect(() =>
      assertHarnessContract(harness({ kind: "zcode" }), COMPATIBILITY_REQUIRED_CONTRACT),
    ).toThrow(CraftingError);
  });
});
