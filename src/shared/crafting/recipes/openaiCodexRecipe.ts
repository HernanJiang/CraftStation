import { sha256Hex } from "../webCrypto";
import { CraftingError } from "../errors";
import type {
  CraftContext,
  CraftPlan,
  Item,
  ModelCapabilityComponent,
  Recipe,
  RecipeSlotRequirement,
} from "../types";

export const OPENAI_CODEX_RECIPE_ID = "recipe:openai-codex-native";
export const OPENAI_CODEX_RECIPE_VERSION = "1.0.0";

export class OpenAICodexNativeRecipe implements Recipe {
  readonly id = OPENAI_CODEX_RECIPE_ID;
  readonly name = "OpenAI Codex Native Recipe";
  readonly version = OPENAI_CODEX_RECIPE_VERSION;
  readonly description =
    "Native composition running OpenAI Models through the Codex Harness runtime.";
  readonly compatibilityStatus = "NATIVE" as const;

  readonly requirements: Record<string, RecipeSlotRequirement> = {
    model: {
      slot: "model",
      requiredKind: "model",
      description: "Supported OpenAI Model Item",
      allowedVendors: ["openai"],
    },
    harness: {
      slot: "harness",
      requiredKind: "harness",
      description: "Codex Harness Item",
      allowedVendors: ["openai", "codex"],
    },
  };

  matches(ingredients: Record<string, Item>): boolean {
    const model = ingredients.model;
    const harness = ingredients.harness;
    if (!model || !harness) return false;
    if (model.kind !== "model" || model.metadata.vendor !== "openai") return false;
    if (harness.kind !== "harness") return false;
    if (harness.metadata.vendor !== "openai" && harness.metadata.vendor !== "codex") return false;
    return true;
  }

  compile(ingredients: Record<string, Item>, context: CraftContext): CraftPlan {
    const model = ingredients.model;
    const harness = ingredients.harness;
    if (!model || !harness) {
      throw CraftingError.compilationError(
        "Cannot compile recipe: missing required model or harness ingredient",
        { ingredients: Object.keys(ingredients) },
        "Select both an OpenAI model and a Codex harness before crafting.",
      );
    }

    if (!this.matches(ingredients)) {
      throw CraftingError.incompatibleCombination(
        "The selected ingredients do not match the OpenAI Codex Native Recipe requirements.",
        { modelId: model.id, harnessId: harness.id },
        "Ensure the model is an OpenAI model and the harness is Codex.",
      );
    }

    // Extract runtime modelId from model capability component if present
    const modelCapability = model.components.find(
      (c): c is ModelCapabilityComponent => c.kind === "model_capability",
    );
    const runtimeModelId = modelCapability?.modelId ?? model.metadata.id.replace(/^openai:/, "");

    // Deterministic plan ID based on recipe, ingredients and context
    const hash = sha256Hex(
      `${this.id}:${model.id}:${harness.id}:${context.workspace ?? ""}:${context.threadId ?? ""}:${context.profileRef ?? ""}:${JSON.stringify(context.environment ?? null)}`,
    ).slice(0, 16);
    const planId = `plan:${this.id}:${hash}`;
    const resultItemId = `result:${model.metadata.id}+${harness.metadata.id}`;
    const now = new Date().toISOString();

    const craftPlan: CraftPlan = {
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
      runtimeBinding: {
        harnessKind: "codex",
        modelId: runtimeModelId,
        vendor: model.metadata.vendor,
        runtimeAdapterId: "codex-structured",
        ...(context.profileRef ? { profileRef: context.profileRef } : {}),
        ...(context.environment ? { environment: context.environment } : {}),
        ...(context.clientProperties ? { options: context.clientProperties } : {}),
      },
      ...(context.workspace ? { workspace: context.workspace } : {}),
      ...(context.sessionRef ? { sessionRef: context.sessionRef } : {}),
      ...(context.threadId ? { threadId: context.threadId } : {}),
      createdAt: now,
      ...(context.overrides ? { overrides: context.overrides } : {}),
    };

    return craftPlan;
  }
}
