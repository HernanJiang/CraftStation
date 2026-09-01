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
  modelIds?: readonly string[];
  modelItemIds?: readonly string[];
  harnessVendors?: readonly string[];
  /** OpenCode provider identity, kept separate from the harness vendor. */
  providerID?: string;
  compatibilityStatus?: CompatibilityStatus;
}

const SENSITIVE_RUNTIME_KEY =
  /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|cookie|password|secret|credential|authorization)/iu;

/**
 * Keep runtime configuration in the CraftPlan only when it is safe to persist.
 * Authentication is represented by the separate opaque authRef/profileRef
 * fields; a provider credential accidentally placed in options is dropped at
 * the composition boundary instead of being copied into a plan or envelope.
 */
function sanitizeRuntimeValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_RUNTIME_KEY.test(key)) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 64).map((entry) => sanitizeRuntimeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 128)
        .flatMap(([name, entry]) => {
          const safe = sanitizeRuntimeValue(entry, name);
          return safe === undefined ? [] : [[name, safe]];
        }),
    );
  }
  if (typeof value === "string") return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  return value;
}

function sanitizeRuntimeRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const safe = sanitizeRuntimeValue(value);
  return safe && typeof safe === "object" && !Array.isArray(safe)
    ? (safe as Record<string, unknown>)
    : undefined;
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
  readonly modelIds: readonly string[];
  readonly modelItemIds: readonly string[];
  readonly harnessVendors: readonly string[];
  readonly providerID: string | undefined;
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
    this.modelIds = [...(options.modelIds ?? [])];
    this.modelItemIds = [...(options.modelItemIds ?? [])];
    this.harnessVendors = [...(options.harnessVendors ?? options.modelVendors)];
    this.providerID = options.providerID;
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
    if (this.modelItemIds.length > 0 && !this.modelItemIds.includes(model.id)) return false;
    if (this.modelIds.length > 0) {
      const modelCapability = model.components.find(
        (component) => component.kind === "model_capability",
      );
      if (
        !modelCapability ||
        typeof modelCapability.modelId !== "string" ||
        !this.modelIds.includes(modelCapability.modelId)
      ) {
        return false;
      }
    }
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
      (component): component is ModelCapabilityComponent => component.kind === "model_capability",
    );
    const runtimeModelId =
      modelCapability?.modelId ??
      model.id.replace(new RegExp(`^${escapeRegExp(model.metadata.vendor)}:`), "");
    const safeOptions = sanitizeRuntimeRecord(context.clientProperties);
    const safeOverrides = context.overrides
      ? {
          ...context.overrides,
          ...(context.overrides.customSettings
            ? { customSettings: sanitizeRuntimeRecord(context.overrides.customSettings) ?? {} }
            : {}),
        }
      : undefined;
    const contextFingerprint = JSON.stringify({
      workspace: context.workspace ?? null,
      sessionRef: context.sessionRef ?? null,
      threadId: context.threadId ?? null,
      authRef: context.authRef ?? null,
      profileRef: context.profileRef ?? null,
      environment: context.environment ?? null,
      options: safeOptions ?? null,
      overrides: safeOverrides ?? null,
    });
    const hash = sha256Hex(`${this.id}:${model.id}:${harness.id}:${contextFingerprint}`).slice(
      0,
      16,
    );

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
        ...(this.providerID ? { providerID: this.providerID } : {}),
        ...(context.authRef ? { authRef: context.authRef } : {}),
        ...(context.profileRef ? { profileRef: context.profileRef } : {}),
        ...(context.environment ? { environment: context.environment } : {}),
        ...(safeOptions ? { options: safeOptions } : {}),
      },
      ...(context.workspace ? { workspace: context.workspace } : {}),
      ...(context.sessionRef ? { sessionRef: context.sessionRef } : {}),
      ...(context.threadId ? { threadId: context.threadId } : {}),
      createdAt: new Date().toISOString(),
      ...(safeOverrides ? { overrides: safeOverrides } : {}),
    };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
