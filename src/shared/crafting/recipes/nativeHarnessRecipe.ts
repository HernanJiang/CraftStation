import { sha256Hex } from "../webCrypto";
import { CraftingError } from "../errors";
import type {
  CompatibilityStatus,
  CraftContext,
  CraftPlan,
  Item,
  ModelCapabilityComponent,
  Recipe,
  RecipeSlotRequirement,
} from "../types";

export interface NativeHarnessRecipeOptions {
  id: string;
  version?: string;
  name: string;
  description: string;
  harnessKind: string;
  harnessItemId: string;
  modelVendors: readonly string[];
  harnessVendors?: readonly string[];
  compatibilityStatus?: CompatibilityStatus;
}

/**
 * A deterministic recipe for one provider-native Model × Harness pairing.
 *
 * The recipe only composes Items into a CraftPlan. Provider protocol, auth,
 * permissions, tools, and session semantics remain behind the runtime adapter
 * seam.
 */
export class NativeHarnessRecipe implements Recipe {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly compatibilityStatus: CompatibilityStatus;
  readonly harnessKind: string;
  readonly harnessItemId: string;
  readonly modelVendors: readonly string[];
  readonly harnessVendors: readonly string[];
  readonly requirements: Record<string, RecipeSlotRequirement>;

  constructor(options: NativeHarnessRecipeOptions) {
    this.id = options.id;
    this.name = options.name;
    this.version = options.version ?? "1.0.0";
    this.description = options.description;
    this.compatibilityStatus = options.compatibilityStatus ?? "NATIVE";
    this.harnessKind = options.harnessKind;
    this.harnessItemId = options.harnessItemId;
    this.modelVendors = [...options.modelVendors];
    this.harnessVendors = [...(options.harnessVendors ?? options.modelVendors)];
    this.requirements = {
      model: {
        slot: "model",
        requiredKind: "model",
        description: `${this.name} model item`,
        allowedVendors: [...this.modelVendors],
      },
      harness: {
        slot: "harness",
        requiredKind: "harness",
        description: `${this.name} harness item`,
        allowedVendors: [...this.harnessVendors],
      },
    };
  }

  matches(ingredients: Record<string, Item>): boolean {
    const model = ingredients.model;
    const harness = ingredients.harness;
    if (!model || !harness) return false;
    if (model.kind !== "model" || !this.modelVendors.includes(model.metadata.vendor)) return false;
    if (harness.kind !== "harness" || harness.id !== this.harnessItemId) return false;
    return this.harnessVendors.includes(harness.metadata.vendor);
  }

  compile(ingredients: Record<string, Item>, context: CraftContext): CraftPlan {
    const model = ingredients.model;
    const harness = ingredients.harness;
    if (!model || !harness) {
      throw CraftingError.compilationError(
        `Cannot compile ${this.name}: missing required model or harness ingredient.`,
        { ingredients: Object.keys(ingredients) },
        "Select both a compatible model and native Harness Item before crafting.",
      );
    }
    if (!this.matches(ingredients)) {
      throw CraftingError.incompatibleCombination(
        `The selected ingredients do not match the ${this.name} requirements.`,
        { modelId: model.id, harnessId: harness.id },
        "Select the model family and native Harness Item registered for the same provider.",
      );
    }

    const modelCapability = model.components.find(
      (component): component is ModelCapabilityComponent =>
        component.kind === "model_capability",
    );
    const runtimeModelId =
      modelCapability?.modelId ??
      model.id.replace(new RegExp(`^${escapeRegExp(model.metadata.vendor)}:`), "");
    const contextFingerprint = JSON.stringify({
      workspace: context.workspace ?? null,
      threadId: context.threadId ?? null,
      profileRef: context.profileRef ?? null,
      environment: context.environment ?? null,
    });
    const hash = sha256Hex(
      `${this.id}:${model.id}:${harness.id}:${contextFingerprint}`,
    ).slice(0, 16);

    return {
      id: `plan:${this.id}:${hash}`,
      recipeId: this.id,
      resultItemId: `result:${model.id}+${harness.id}`,
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
        harnessKind: this.harnessKind,
        modelId: runtimeModelId,
        vendor: model.metadata.vendor,
        runtimeAdapterId: `native-harness:${this.harnessKind}`,
        ...(context.profileRef ? { profileRef: context.profileRef } : {}),
        ...(context.environment ? { environment: context.environment } : {}),
        ...(context.clientProperties ? { options: context.clientProperties } : {}),
      },
      ...(context.workspace ? { workspace: context.workspace } : {}),
      ...(context.sessionRef ? { sessionRef: context.sessionRef } : {}),
      ...(context.threadId ? { threadId: context.threadId } : {}),
      createdAt: new Date().toISOString(),
      ...(context.overrides ? { overrides: context.overrides } : {}),
    };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
