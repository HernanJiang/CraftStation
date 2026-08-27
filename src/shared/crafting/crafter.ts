import { randomUUID } from "./webCrypto";
import { CraftingError } from "./errors";
import { logCraftingEvent } from "./logging";
import { getDefaultRegistry, ItemRegistry } from "./registry";
import type {
  CraftContext,
  CraftingGrid,
  CraftResult,
  CraftValidationResult,
  Item,
  ResolvedGrid,
  ResultItem,
} from "./types";

export interface CrafterOptions {
  checkRuntimeAvailable?: ((harnessKind: string) => boolean) | undefined;
}

export class Crafter {
  constructor(
    private readonly registry: ItemRegistry = getDefaultRegistry(),
    private readonly options?: CrafterOptions | undefined,
  ) {}

  /**
   * Deterministically resolve slot selections in the crafting grid.
   */
  resolve(grid: CraftingGrid, correlationId?: string | undefined): ResolvedGrid {
    logCraftingEvent({
      phase: "resolve",
      operation: "resolveGrid",
      status: "started",
      ...(correlationId !== undefined ? { correlationId } : {}),
      details: { slots: Object.keys(grid.slots) },
    });

    const ingredients: Record<string, Item> = {};
    const unresolvedSlots: string[] = [];

    for (const [slot, selection] of Object.entries(grid.slots)) {
      if (!selection) {
        unresolvedSlots.push(slot);
        continue;
      }
      const resolved = this.registry.resolveSlot(slot, selection);
      if (!resolved) {
        unresolvedSlots.push(slot);
      } else {
        ingredients[slot] = resolved;
      }
    }

    const hasUnresolved = unresolvedSlots.length > 0;
    logCraftingEvent({
      phase: "resolve",
      operation: "resolveGrid",
      status: hasUnresolved ? "degraded" : "success",
      ...(correlationId !== undefined ? { correlationId } : {}),
      details: {
        resolvedCount: Object.keys(ingredients).length,
        unresolvedSlots,
      },
    });

    return { ingredients, unresolvedSlots };
  }

  /**
   * Validate resolved ingredients against registered recipes.
   */
  validate(grid: CraftingGrid, correlationId?: string | undefined): CraftValidationResult {
    const { ingredients, unresolvedSlots } = this.resolve(grid, correlationId);

    logCraftingEvent({
      phase: "validate",
      operation: "validateGrid",
      status: "started",
      ...(correlationId !== undefined ? { correlationId } : {}),
    });

    if (unresolvedSlots.length > 0) {
      const errors = unresolvedSlots.map((slot) =>
        CraftingError.unresolvedSlot(
          slot,
          `No item selected or failed to resolve for slot '${slot}'`,
          `Please select a valid item for slot '${slot}' in the Crafting Table.`,
        ).toDetail(),
      );

      const firstError = errors[0];
      logCraftingEvent({
        phase: "validate",
        operation: "validateGrid",
        status: "failed",
        ...(correlationId !== undefined ? { correlationId } : {}),
        ...(firstError ? { error: firstError } : {}),
      });

      return {
        valid: false,
        resolvedIngredients: ingredients,
        errors,
      };
    }

    const matchedRecipe = this.registry.findMatchingRecipe(ingredients);
    if (!matchedRecipe) {
      const error = CraftingError.recipeNotFound(
        {
          ingredients: Object.keys(ingredients).reduce<Record<string, string>>((acc, key) => {
            const item = ingredients[key];
            if (item) acc[key] = item.id;
            return acc;
          }, {}),
        },
        "Check selected model and harness compatibility in the registry.",
      ).toDetail();

      logCraftingEvent({
        phase: "validate",
        operation: "validateGrid",
        status: "failed",
        ...(correlationId !== undefined ? { correlationId } : {}),
        error,
      });

      return {
        valid: false,
        resolvedIngredients: ingredients,
        errors: [error],
      };
    }

    // Check runtime availability if validator provided
    const harnessIngredient = ingredients.harness;
    if (this.options?.checkRuntimeAvailable && harnessIngredient) {
      const harnessKind = harnessIngredient.id.replace(/^harness:/, "");
      const isAvailable = this.options.checkRuntimeAvailable(harnessKind);
      if (!isAvailable) {
        const error = CraftingError.runtimeUnavailable(
          harnessKind,
          `Runtime harness '${harnessKind}' is not installed or available on this system.`,
          `Verify that ${harnessKind} binary is installed and executable in PATH.`,
        ).toDetail();

        logCraftingEvent({
          phase: "validate",
          operation: "validateGrid",
          status: "failed",
          ...(correlationId !== undefined ? { correlationId } : {}),
          error,
        });

        return {
          valid: false,
          resolvedIngredients: ingredients,
          matchedRecipe,
          errors: [error],
        };
      }
    }

    logCraftingEvent({
      phase: "validate",
      operation: "validateGrid",
      status: "success",
      ...(correlationId !== undefined ? { correlationId } : {}),
      recipeId: matchedRecipe.id,
    });

    return {
      valid: true,
      resolvedIngredients: ingredients,
      matchedRecipe,
      errors: [],
    };
  }

  /**
   * Compile crafting grid into CraftPlan and ResultItem.
   */
  compile(grid: CraftingGrid, context: CraftContext = {}): CraftResult {
    const correlationId = randomUUID();

    logCraftingEvent({
      phase: "compile",
      operation: "compileGrid",
      status: "started",
      correlationId,
      ...(context.threadId !== undefined ? { threadId: context.threadId } : {}),
    });

    const validation = this.validate(grid, correlationId);
    if (!validation.valid || !validation.matchedRecipe || !validation.resolvedIngredients) {
      const firstError = validation.errors[0];
      logCraftingEvent({
        phase: "compile",
        operation: "compileGrid",
        status: "failed",
        correlationId,
        ...(firstError ? { error: firstError } : {}),
      });
      return {
        success: false,
        errors: validation.errors,
      };
    }

    try {
      const recipe = validation.matchedRecipe;
      const ingredients = validation.resolvedIngredients;
      const craftPlan = recipe.compile(ingredients, context);

      const modelItem = ingredients.model;
      const harnessItem = ingredients.harness;
      const modelName = modelItem?.metadata.name ?? "Model";
      const harnessName = harnessItem?.metadata.name ?? "Harness";

      const resultItem: ResultItem = {
        id: craftPlan.resultItemId,
        kind: "result",
        metadata: {
          id: craftPlan.resultItemId,
          name: `${modelName} + ${harnessName}`,
          version: "1.0.0",
          vendor: "craftstation",
          source: "crafted",
          description: `Crafted result executing ${modelName} via ${harnessName}`,
          tags: [
            "crafted",
            "agent",
            modelItem?.metadata.vendor ?? "",
            harnessItem?.metadata.vendor ?? "",
          ].filter(Boolean),
          compatibilityStatus: recipe.compatibilityStatus,
        },
        components: [...(modelItem?.components ?? []), ...(harnessItem?.components ?? [])],
        provenance: {
          recipeId: recipe.id,
          recipeVersion: recipe.version,
          craftedAt: craftPlan.createdAt,
          ingredients: craftPlan.ingredients,
          runtimeBinding: craftPlan.runtimeBinding,
        },
        craftPlan,
      };

      logCraftingEvent({
        phase: "compile",
        operation: "compileGrid",
        status: "success",
        correlationId,
        recipeId: recipe.id,
        modelId: craftPlan.runtimeBinding.modelId,
        harnessKind: craftPlan.runtimeBinding.harnessKind,
        ...(context.threadId !== undefined ? { threadId: context.threadId } : {}),
      });

      return {
        success: true,
        resultItem,
        craftPlan,
        recipe,
      };
    } catch (err) {
      const errorDetail =
        err instanceof CraftingError
          ? err.toDetail()
          : CraftingError.compilationError(
              err instanceof Error ? err.message : String(err),
              { originalError: String(err) },
              "Check ingredient compatibility and try again.",
            ).toDetail();

      logCraftingEvent({
        phase: "compile",
        operation: "compileGrid",
        status: "failed",
        correlationId,
        error: errorDetail,
      });

      return {
        success: false,
        errors: [errorDetail],
      };
    }
  }
}

let defaultCrafterInstance: Crafter | undefined;

export function getDefaultCrafter(): Crafter {
  if (!defaultCrafterInstance) {
    defaultCrafterInstance = new Crafter();
  }
  return defaultCrafterInstance;
}
