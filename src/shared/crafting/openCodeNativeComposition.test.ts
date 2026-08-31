import { describe, expect, it } from "vitest";
import { Crafter } from "./crafter";
import { getDefaultRegistry } from "./registry";
import { craftPlanSchema } from "./types";

const registry = getDefaultRegistry();
const opencode = registry.getItem("harness:opencode")!;

function executableCrafter(): Crafter {
  return new Crafter(registry, {
    checkExecutableReadiness: ({ authRef, profileRef }) =>
      authRef || profileRef
        ? { status: "ready", reason: "Verified test binding." }
        : { status: "auth-required", reason: "No opaque auth/profile binding was selected." },
  });
}

const cases = [
  { model: "openai:gpt-5.4", recipe: "recipe:openai-opencode-native", providerID: "openai" },
  { model: "xai:grok-4.6", recipe: "recipe:xai-opencode-native", providerID: "xai" },
  {
    model: "google:antigravity-default",
    recipe: "recipe:google-opencode-native",
    providerID: "google",
  },
  {
    model: "deepseek:deepseek-v4-flash",
    recipe: "recipe:deepseek-opencode-native",
    providerID: "deepseek",
  },
  {
    model: "moonshot:kimi-for-coding",
    recipe: "recipe:moonshot-kimi-opencode-native",
    providerID: "kimi-for-coding",
  },
  {
    model: "moonshot-openai-compatible:kimi-k2.5",
    recipe: "recipe:kimi-openai-compatible-opencode",
    providerID: "moonshot-openai-compatible",
  },
] as const;

describe("OpenCode native composition contract", () => {
  it.each(cases)(
    "compiles $model through the expected OpenCode provider route",
    ({ model, recipe, providerID }) => {
      const crafter = executableCrafter();
      const result = crafter.compile(
        { slots: { model: registry.getItem(model)!, harness: opencode } },
        {
          workspace: "C:/repo",
          sessionRef: "ses_resume",
          threadId: "thread-opencode",
          authRef: "auth:managed",
          profileRef: "profile:work",
          environment: { kind: "windows" },
          clientProperties: {
            permission: [{ permission: "shell", pattern: "*", action: "ask" }],
            mcpServerIds: ["browser"],
            skillIds: ["repo-guidance"],
            context: { compaction: "native" },
            apiKey: "must-not-be-persisted",
            nested: { accessToken: "must-not-be-persisted" },
          },
          overrides: {
            model: "model-override",
            reasoningEffort: "high",
            approvalPolicy: "on-demand",
            customSettings: { temperature: 0.2, token: "must-not-be-persisted" },
          },
        },
      );

      expect(result.success).toBe(true);
      const plan = result.craftPlan!;
      expect(plan.recipeId).toBe(recipe);
      expect(plan.runtimeBinding).toMatchObject({
        harnessKind: "opencode",
        providerID,
        authRef: "auth:managed",
        profileRef: "profile:work",
        environment: { kind: "windows" },
        options: {
          permission: [{ permission: "shell", pattern: "*", action: "ask" }],
          mcpServerIds: ["browser"],
          skillIds: ["repo-guidance"],
          context: { compaction: "native" },
        },
      });
      expect(plan.overrides).toMatchObject({
        model: "model-override",
        reasoningEffort: "high",
        approvalPolicy: "on-demand",
        customSettings: { temperature: 0.2 },
      });
      expect(plan.runtimeBinding.options).not.toHaveProperty("apiKey");
      expect(plan.runtimeBinding.options).not.toHaveProperty("nested.accessToken");
      expect(plan.overrides?.customSettings).not.toHaveProperty("token");
      expect(JSON.stringify(plan)).not.toContain("must-not-be-persisted");
      expect(craftPlanSchema.parse(plan)).toEqual(plan);
    },
  );

  it("keeps DeepSeek Model + OpenCode separate from the DSH Harness", () => {
    const deepseek = registry.getItem("deepseek:deepseek-v4-flash")!;
    const result = executableCrafter().compile(
      { slots: { model: deepseek, harness: opencode } },
      { authRef: "auth:deepseek:test" },
    );

    expect(result.success).toBe(true);
    expect(result.craftPlan?.recipeId).toBe("recipe:deepseek-opencode-native");
    expect(result.craftPlan?.runtimeBinding).toMatchObject({
      harnessKind: "opencode",
      providerID: "deepseek",
      runtimeAdapterId: "native-harness:opencode",
    });
    expect(result.resultItem?.metadata.compatibilityStatus).toBe("EXPERIMENTAL");
    expect(result.craftPlan?.runtimeBinding.harnessKind).not.toBe("deepseek");
  });

  it("keeps Moonshot-native Kimi and OpenAI-compatible Kimi on distinct routes", () => {
    const native = executableCrafter().compile(
      {
        slots: { model: registry.getItem("moonshot:kimi-for-coding")!, harness: opencode },
      },
      { authRef: "auth:moonshot:test" },
    );
    const compatible = executableCrafter().compile(
      {
        slots: {
          model: registry.getItem("moonshot-openai-compatible:kimi-k2.5")!,
          harness: opencode,
        },
      },
      { authRef: "auth:moonshot-compatible:test" },
    );

    expect(native.craftPlan?.runtimeBinding.providerID).toBe("kimi-for-coding");
    expect(compatible.craftPlan?.runtimeBinding.providerID).toBe("moonshot-openai-compatible");
    expect(native.craftPlan?.recipeId).not.toBe(compatible.craftPlan?.recipeId);
  });

  it.each(cases)(
    "fails closed for $providerID:$model when route readiness is not verified",
    ({ model, providerID }) => {
      const result = new Crafter(registry, {
        checkExecutableReadiness: ({ providerID: actualProviderID }) => ({
          status: actualProviderID === providerID ? "unverified" : "unavailable",
          reason: "Provider assistant response has not been verified.",
        }),
      }).compile(
        { slots: { model: registry.getItem(model)!, harness: opencode } },
        { authRef: `auth:${providerID}:opaque` },
      );

      expect(result.success).toBe(false);
      expect(result.craftPlan).toBeUndefined();
      expect(result.resultItem).toBeUndefined();
      expect(result.errors?.[0]).toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
      expect(result.errors?.[0]?.message).toContain(`${providerID}:`);
      expect(result.errors?.[0]?.message).toContain("unverified");
    },
  );

  it("requires an explicit readiness provider for OpenCode executable compilation", () => {
    const result = new Crafter(registry).compile(
      { slots: { model: registry.getItem("openai:gpt-4o")!, harness: opencode } },
      { authRef: "auth:openai:opaque" },
    );

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    expect(result.errors?.[0]?.message).toContain("No route-specific");
  });
});
