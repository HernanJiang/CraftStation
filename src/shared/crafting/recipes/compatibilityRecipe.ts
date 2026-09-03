import { sha256Hex } from "../webCrypto";
import { CraftingError } from "../errors";
import type {
  CraftContext,
  CraftPlan,
  Item,
  ModelCapabilityComponent,
  HarnessRuntimeComponent,
  Recipe,
  RecipeSlotRequirement,
} from "../types";
import { SUPPORTED_COMPATIBILITY_HARNESSES } from "../executionRoute";

export const COMPATIBILITY_RECIPE_ID = "recipe:compatibility-bridge";
export const COMPATIBILITY_RECIPE_VERSION = "1.0.0";

export class CompatibilityBridgeRecipe implements Recipe {
  readonly id = COMPATIBILITY_RECIPE_ID;
  readonly name = "Compatibility Bridge Cross-Harness Recipe";
  readonly version = COMPATIBILITY_RECIPE_VERSION;
  readonly description =
    "Cross-pairing Model and Harness execution routed through the CLIProxyAPI Compatibility Bridge.";
  readonly compatibilityStatus = "SUPPORTED" as const;

  readonly requirements: Record<string, RecipeSlotRequirement> = {
    model: {
      slot: "model",
      requiredKind: "model",
      description: "Any registered Model Item",
    },
    harness: {
      slot: "harness",
      requiredKind: "harness",
      description: "Any registered Harness Item",
    },
  };

  matches(ingredients: Record<string, Item>): boolean {
    const model = ingredients.model;
    const harness = ingredients.harness;
    if (!model || !harness) return false;
    if (model.kind !== "model" || harness.kind !== "harness") return false;
    if (model.metadata.compatibilityStatus === "INCOMPATIBLE") return false;
    if (harness.metadata.compatibilityStatus === "INCOMPATIBLE") return false;

    const harnessComp = harness.components.find(
      (c): c is HarnessRuntimeComponent => c.kind === "harness_runtime",
    );
    const harnessKind = harnessComp?.harnessKind ?? harness.metadata.id.replace(/^harness:/, "");

    if (!SUPPORTED_COMPATIBILITY_HARNESSES.includes(harnessKind as any)) {
      return false;
    }

    // Direct Native OpenAI -> Codex pairing is handled by OpenAICodexNativeRecipe
    if (
      model.metadata.vendor === "openai" &&
      (harness.metadata.vendor === "openai" || harness.metadata.vendor === "codex")
    ) {
      return false;
    }

    // Direct OpenCode native pairings (where model is specifically configured for opencode native)
    if (model.metadata.tags?.includes("opencode") && harness.metadata.vendor === "opencode") {
      return false;
    }

    return true;
  }

  compile(ingredients: Record<string, Item>, context: CraftContext): CraftPlan {
    const model = ingredients.model;
    const harness = ingredients.harness;
    if (!model || !harness) {
      throw CraftingError.compilationError(
        "Cannot compile compatibility recipe: missing model or harness ingredient",
      );
    }

    const modelCap = model.components.find(
      (c): c is ModelCapabilityComponent => c.kind === "model_capability",
    );
    const harnessComp = harness.components.find(
      (c): c is HarnessRuntimeComponent => c.kind === "harness_runtime",
    );

    const harnessKind = harnessComp?.harnessKind ?? harness.metadata.id.replace(/^harness:/, "");
    const modelId = modelCap?.modelId ?? model.metadata.id.replace(/^[^:]+:/, "");

    let compatibilityProtocol = "openai-compatible";
    if (harnessKind === "codex") {
      compatibilityProtocol = "responses";
    } else if (harnessKind === "kimi") {
      compatibilityProtocol = "openai_responses";
    } else if (harnessKind === "grok") {
      compatibilityProtocol = "openai-compatible-chat";
    } else if (harnessKind === "antigravity") {
      compatibilityProtocol = "gemini-compatible";
    }

    const runtimeBinding = {
      harnessKind,
      modelId,
      vendor: model.metadata.vendor,
      runtimeAdapterId: harnessKind,
      routeType: "compatibility" as const,
      compatibilityProtocol,
      compatibilityBridgeEndpoint: "http://127.0.0.1:8317",
      options: {
        compatibilityBridge: true,
        protocol: compatibilityProtocol,
        ...(context.clientProperties ?? {}),
      },
      ...(context.profileRef ? { profileRef: context.profileRef } : {}),
      ...(context.environment ? { environment: context.environment } : {}),
    };

    const hash = sha256Hex(
      `${this.id}:${model.id}:${harness.id}:${context.workspace ?? ""}:${context.threadId ?? ""}:${context.profileRef ?? ""}:${JSON.stringify(context.environment ?? null)}`,
    ).slice(0, 16);
    const planId = `plan:${this.id}:${hash}`;
    const resultItemId = `result:${model.metadata.id}+${harness.metadata.id}`;
    const now = new Date().toISOString();

    return {
      id: planId,
      recipeId: this.id,
      resultItemId,
      ingredients: {
        model: {
          slot: "model",
          itemId: model.id,
          itemVersion: model.metadata.version,
          vendor: model.metadata.vendor,
          kind: model.kind,
        },
        harness: {
          slot: "harness",
          itemId: harness.id,
          itemVersion: harness.metadata.version,
          vendor: harness.metadata.vendor,
          kind: harness.kind,
        },
      },
      runtimeBinding,
      ...(context.workspace ? { workspace: context.workspace } : {}),
      ...(context.sessionRef ? { sessionRef: context.sessionRef } : {}),
      ...(context.threadId ? { threadId: context.threadId } : {}),
      createdAt: now,
      ...(context.overrides ? { overrides: context.overrides } : {}),
    };
  }
}
