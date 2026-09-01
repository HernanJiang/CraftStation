import { describe, expect, it } from "vitest";
import {
  BUILTIN_ANTIGRAVITY_HARNESS_ITEM,
  BUILTIN_NATIVE_HARNESS_MODEL_ITEMS,
  NATIVE_HARNESS_RECIPES,
} from "./registry";
import { nativeRuntimeExecutionConfigForPlan } from "./nativeHarness";
import type { CraftPlan, Item } from "./types";

function deepSeekPlan(): CraftPlan {
  const recipe = NATIVE_HARNESS_RECIPES.find((candidate) => candidate.harnessKind === "deepseek")!;
  const model = BUILTIN_NATIVE_HARNESS_MODEL_ITEMS.find(
    (candidate) => candidate.metadata.vendor === "deepseek",
  )!;
  const harness = { ...BUILTIN_ANTIGRAVITY_HARNESS_ITEM } as Item;
  harness.id = "harness:deepseek";
  harness.metadata = { ...harness.metadata, id: harness.id, vendor: "deepseek" };
  const plan = recipe.compile(
    { model, harness },
    {
      workspace: "C:\\repo",
      profileRef: "profile:deepseek",
      threadId: "thread:config",
      overrides: {
        model: "deepseek-v4-pro",
        reasoningEffort: "high",
        serviceTier: "priority",
        approvalPolicy: "auto",
        permissionProfile: "coding",
        mcpServerIds: ["filesystem"],
        skills: ["repo-review"],
        context: { strategy: "native", nested: { cookie: "do-not-copy", keep: true } },
        compaction: { enabled: true, token: "do-not-copy" },
        customSettings: { fromOverride: "yes", credentials: { apiKey: "do-not-copy" } },
      },
      clientProperties: {
        accountId: "account:deepseek",
        context: { fromBinding: true },
        compaction: { fromBinding: true },
        reasoningEffort: "low",
        skills: ["bound-skill"],
        secret: "do-not-copy",
        nested: { authorization: "do-not-copy", keep: "binding" },
      },
    },
  );
  return plan;
}

describe("Native runtime CraftPlan contract", () => {
  it("projects complete execution settings with override precedence and no credential-like keys", () => {
    const config = nativeRuntimeExecutionConfigForPlan(deepSeekPlan());

    expect(config).toMatchObject({
      workspace: "C:\\repo",
      model: "deepseek-v4-pro",
      reasoningEffort: "high",
      serviceTier: "priority",
      approvalPolicy: "auto",
      permissionProfile: "coding",
      profileRef: "profile:deepseek",
      accountId: "account:deepseek",
      mcpServerIds: ["filesystem"],
      skills: ["repo-review"],
      context: { strategy: "native", nested: { keep: true } },
      compaction: { enabled: true },
      customSettings: { fromOverride: "yes" },
    });

    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("do-not-copy");
    expect(serialized).not.toContain("credentials");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("configPath");
  });

  it("keeps model and Harness vendors independent while rejecting the wrong pair", () => {
    const recipe = NATIVE_HARNESS_RECIPES.find(
      (candidate) => candidate.harnessKind === "antigravity",
    )!;
    const model = BUILTIN_NATIVE_HARNESS_MODEL_ITEMS.find(
      (candidate) => candidate.metadata.vendor === "google",
    )!;
    const validHarness = {
      ...BUILTIN_ANTIGRAVITY_HARNESS_ITEM,
      metadata: { ...BUILTIN_ANTIGRAVITY_HARNESS_ITEM.metadata, vendor: "native-runtime" },
    };
    const wrongModel = { ...model, metadata: { ...model.metadata, vendor: "deepseek" } };

    expect(recipe.matches({ model, harness: validHarness })).toBe(false);
    expect(recipe.matches({ model: wrongModel, harness: BUILTIN_ANTIGRAVITY_HARNESS_ITEM })).toBe(
      false,
    );
  });
});
