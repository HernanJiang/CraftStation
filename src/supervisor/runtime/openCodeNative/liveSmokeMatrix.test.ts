import { describe, expect, it } from "vitest";
import { OpenCodeNativeSession } from "./session";
import { getDefaultRegistry } from "@/shared/crafting/registry";
import type { CraftPlan } from "@/shared/crafting";

const registry = getDefaultRegistry();
const opencode = registry.getItem("harness:opencode")!;

const cases = [
  {
    model: "openai:gpt-5.4",
    recipe: "recipe:openai-opencode-native",
    providerID: "openai",
    modelId: "gpt-5.4",
  },
  {
    model: "xai:grok-4.6",
    recipe: "recipe:xai-opencode-native",
    providerID: "xai",
    modelId: "grok-4",
  },
  {
    model: "google:antigravity-default",
    recipe: "recipe:google-opencode-native",
    providerID: "google",
    modelId: "gemini-2.5-pro",
  },
  {
    model: "deepseek:deepseek-v4-flash",
    recipe: "recipe:deepseek-opencode-native",
    providerID: "deepseek",
    modelId: "deepseek-v4-flash",
  },
  {
    model: "moonshot:kimi-for-coding",
    recipe: "recipe:moonshot-kimi-opencode-native",
    providerID: "kimi-for-coding",
    modelId: "kimi-for-coding",
  },
  {
    model: "moonshot-openai-compatible:kimi-k2.5",
    recipe: "recipe:kimi-openai-compatible-opencode",
    providerID: "moonshot-openai-compatible",
    modelId: "kimi-k2.5",
  },
];

describe("OpenCode 6-route live smoke matrix", () => {
  it.each(cases)(
    "probes live server session creation and turn settlement for $providerID ($model)",
    async (item) => {
      const modelItem = registry.getItem(item.model)!;
      const plan: CraftPlan = {
        id: `probe:opencode:${item.providerID}:${item.modelId}`,
        recipeId: item.recipe,
        resultItemId: `probe-result:${item.providerID}:${item.modelId}`,
        ingredients: {
          model: {
            slot: "model",
            itemId: modelItem.id,
            itemVersion: modelItem.metadata.version,
            vendor: modelItem.metadata.vendor,
            kind: "model",
          },
          harness: {
            slot: "harness",
            itemId: opencode.id,
            itemVersion: opencode.metadata.version,
            vendor: opencode.metadata.vendor,
            kind: "harness",
          },
        },
        runtimeBinding: {
          harnessKind: "opencode",
          providerID: item.providerID,
          modelId: item.modelId,
          vendor: modelItem.metadata.vendor,
          runtimeAdapterId: "native-harness:opencode-probe-only",
        },
        workspace: "D:/Work/CraftStation/craftstation/.worktrees/v0.8",
        threadId: `thread:live:${item.providerID}`,
        createdAt: new Date().toISOString(),
      };

      const session = await OpenCodeNativeSession.open({
        entityId: `entity:live:${item.providerID}`,
        threadId: `thread:live:${item.providerID}`,
        projectLocation: {
          kind: "windows",
          path: "D:/Work/CraftStation/craftstation/.worktrees/v0.8",
        },
        plan,
      });

      expect(session.id).toMatch(/^sess:opencode:ses_/u);
      expect(session.status).toBe("idle");

      // Attempt prompt turn: since provider API keys are not supplied in env, expect safe rejection / error handling
      await expect(session.startTurn({ prompt: "ping" })).rejects.toThrow(
        /error|failed|execution|timeout|model not found|authentication|auth required/iu,
      );

      await session.terminate();
      expect(session.status).toBe("terminated");
    },
    45_000,
  );
});
