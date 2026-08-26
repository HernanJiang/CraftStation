import { randomUUID } from "./webCrypto";
import { CraftingError } from "./errors";
import { logCraftingEvent } from "./logging";
import { getDefaultRegistry, ItemRegistry } from "./registry";
import { type CompositionProvenance, type CraftPlan, compositionProvenanceSchema } from "./types";
import type { CraftSession, Entity, HarnessRuntimeAdapter } from "./runtimeInterface";

export interface RecoveredCraftState {
  craftPlan: CraftPlan;
  provenance: CompositionProvenance;
  modelId: string;
  harnessKind: string;
}

export interface ProvenancePersistenceDriver {
  readProvenance(threadId: string): string | null | undefined | Promise<string | null | undefined>;
  writeProvenance(threadId: string, rawJson: string): void | Promise<void>;
  deleteProvenance(threadId: string): void | Promise<void>;
}

export class InMemoryProvenancePersistenceDriver implements ProvenancePersistenceDriver {
  private data = new Map<string, string>();
  readProvenance(threadId: string): string | null | undefined {
    return this.data.get(threadId);
  }
  writeProvenance(threadId: string, rawJson: string): void {
    this.data.set(threadId, rawJson);
  }
  deleteProvenance(threadId: string): void {
    this.data.delete(threadId);
  }
}

export class AppStateProvenanceDriver implements ProvenancePersistenceDriver {
  private readonly prefix = "craftstation:provenance:";

  constructor(
    private readonly getState: (
      key: string,
    ) => string | null | undefined | Promise<string | null | undefined>,
    private readonly setState: (key: string, value: string) => void | Promise<void>,
  ) {}

  readProvenance(threadId: string): string | null | undefined | Promise<string | null | undefined> {
    return this.getState(`${this.prefix}${threadId}`);
  }

  writeProvenance(threadId: string, rawJson: string): void | Promise<void> {
    return this.setState(`${this.prefix}${threadId}`, rawJson);
  }

  deleteProvenance(threadId: string): void | Promise<void> {
    return this.setState(`${this.prefix}${threadId}`, "");
  }
}

export function provenanceStateKey(threadId: string): string {
  return `craftstation:provenance:${threadId}`;
}

export class ProvenanceStore {
  private driver: ProvenancePersistenceDriver;
  private memoryCache = new Map<string, CompositionProvenance>();

  constructor(
    private readonly registry: ItemRegistry = getDefaultRegistry(),
    driver?: ProvenancePersistenceDriver,
  ) {
    this.driver = driver ?? new InMemoryProvenancePersistenceDriver();
  }

  setPersistenceDriver(driver: ProvenancePersistenceDriver): void {
    this.driver = driver;
  }

  getPersistenceDriver(): ProvenancePersistenceDriver {
    return this.driver;
  }

  saveProvenance(threadId: string, provenance: CompositionProvenance): void {
    const validation = this.validateProvenance(provenance);
    if (!validation.valid) {
      logCraftingEvent({
        phase: "compile",
        operation: "saveProvenance",
        status: "failed",
        threadId,
        error: { code: "COMPILATION_ERROR", message: validation.error ?? "Invalid provenance" },
      });
      throw CraftingError.compilationError(
        `Invalid composition provenance: ${validation.error}`,
        { threadId, error: validation.error },
        "Check that recipeId and ingredients schema meet provenance contract.",
      );
    }

    this.memoryCache.set(threadId, provenance);
    void Promise.resolve(this.driver.writeProvenance(threadId, JSON.stringify(provenance))).catch(
      (e) => {
        console.warn(`[crafting] Failed to persist provenance for thread ${threadId}:`, e);
      },
    );

    logCraftingEvent({
      phase: "compile",
      operation: "saveProvenance",
      status: "success",
      threadId,
      recipeId: provenance.recipeId,
    });
  }

  async saveProvenanceAsync(threadId: string, provenance: CompositionProvenance): Promise<void> {
    const validation = this.validateProvenance(provenance);
    if (!validation.valid) {
      throw CraftingError.compilationError(
        `Invalid composition provenance: ${validation.error}`,
        { threadId, error: validation.error },
        "Check that recipeId and ingredients schema meet provenance contract.",
      );
    }
    this.memoryCache.set(threadId, provenance);
    await this.driver.writeProvenance(threadId, JSON.stringify(provenance));
  }

  getProvenance(threadId: string): CompositionProvenance | undefined {
    const cached = this.memoryCache.get(threadId);
    if (cached) return cached;

    const raw = this.driver.readProvenance(threadId);
    if (typeof raw === "string" && raw.trim() !== "") {
      try {
        const parsed = JSON.parse(raw);
        if (this.validateProvenance(parsed).valid) {
          const validProv = parsed as CompositionProvenance;
          this.memoryCache.set(threadId, validProv);
          return validProv;
        }
      } catch {}
    }
    return undefined;
  }

  async loadProvenanceAsync(threadId: string): Promise<CompositionProvenance | undefined> {
    const cached = this.memoryCache.get(threadId);
    if (cached) return cached;

    const raw = await this.driver.readProvenance(threadId);
    if (!raw || raw.trim() === "") return undefined;

    try {
      const parsed = JSON.parse(raw);
      const validation = this.validateProvenance(parsed);
      if (!validation.valid) {
        logCraftingEvent({
          phase: "recovery",
          operation: "loadProvenanceAsync",
          status: "degraded",
          threadId,
          details: { error: validation.error },
        });
        return undefined;
      }
      const validProv = parsed as CompositionProvenance;
      this.memoryCache.set(threadId, validProv);
      return validProv;
    } catch {
      return undefined;
    }
  }

  deleteProvenance(threadId: string): void {
    this.memoryCache.delete(threadId);
    void Promise.resolve(this.driver.deleteProvenance(threadId)).catch(() => {});
  }

  validateProvenance(provenance: unknown): { valid: boolean; error?: string } {
    const parseResult = compositionProvenanceSchema.safeParse(provenance);
    if (!parseResult.success) {
      return {
        valid: false,
        error: parseResult.error.message,
      };
    }
    return { valid: true };
  }

  /**
   * Reconstruct a CraftPlan and runtime binding from saved Provenance.
   */
  reconstructCraftPlan(
    threadId: string,
    provenance: CompositionProvenance,
    options: { workspace?: string | undefined; sessionRef?: string | undefined } = {},
  ): RecoveredCraftState {
    const validation = this.validateProvenance(provenance);
    if (!validation.valid) {
      logCraftingEvent({
        phase: "recovery",
        operation: "reconstructCraftPlan",
        status: "failed",
        threadId,
        error: { code: "RECOVERY_FAILED", message: validation.error ?? "Corrupted provenance" },
      });
      throw CraftingError.recoveryFailed(
        `Corrupted provenance for thread '${threadId}': ${validation.error}`,
        { threadId, error: validation.error },
        "Recreate the thread using fresh Crafting parameters.",
      );
    }

    const recipe = this.registry.getRecipe(provenance.recipeId);
    if (!recipe) {
      logCraftingEvent({
        phase: "recovery",
        operation: "reconstructCraftPlan",
        status: "failed",
        threadId,
        recipeId: provenance.recipeId,
        error: {
          code: "RECOVERY_FAILED",
          message: `Recipe '${provenance.recipeId}' not found in registry.`,
        },
      });
      throw CraftingError.recoveryFailed(
        `Cannot recover session: Recipe '${provenance.recipeId}' not found in registry.`,
        { threadId, recipeId: provenance.recipeId },
        "Verify that required extensions or recipes are installed in the registry.",
      );
    }

    const modelProv = provenance.ingredients.model;
    const harnessProv = provenance.ingredients.harness;

    if (!modelProv || !harnessProv) {
      throw CraftingError.recoveryFailed(
        `Incomplete ingredients provenance in thread '${threadId}'.`,
        { threadId, ingredients: provenance.ingredients },
        "Reconstruct requires both model and harness ingredients.",
      );
    }

    const runtimeModelId = modelProv.itemId.replace(/^openai:/, "");
    const harnessKind = harnessProv.itemId.replace(/^harness:/, "");

    const planId = `plan:recovered:${randomUUID()}`;
    const resultItemId = `result:${modelProv.itemId}+${harnessProv.itemId}`;

    const craftPlan: CraftPlan = {
      id: planId,
      recipeId: recipe.id,
      resultItemId,
      ingredients: provenance.ingredients,
      runtimeBinding: {
        harnessKind,
        modelId: runtimeModelId,
        vendor: modelProv.vendor,
        runtimeAdapterId: "codex-structured",
      },
      ...(options.workspace !== undefined ? { workspace: options.workspace } : {}),
      ...(options.sessionRef !== undefined ? { sessionRef: options.sessionRef } : {}),
      threadId,
      createdAt: provenance.craftedAt,
    };

    logCraftingEvent({
      phase: "recovery",
      operation: "reconstructCraftPlan",
      status: "success",
      threadId,
      recipeId: recipe.id,
      modelId: runtimeModelId,
      harnessKind,
    });

    return {
      craftPlan,
      provenance,
      modelId: runtimeModelId,
      harnessKind,
    };
  }

  /**
   * Recreate / recover Entity and Session using reconstructed CraftPlan.
   */
  async recoverSession(
    threadId: string,
    runtimeAdapter: HarnessRuntimeAdapter,
    options: { workspace?: string | undefined; sessionRef?: string | undefined } = {},
  ): Promise<{ entity: Entity; session: CraftSession; recoveredState: RecoveredCraftState }> {
    let provenance = this.getProvenance(threadId);
    if (!provenance) {
      provenance = await this.loadProvenanceAsync(threadId);
    }

    if (!provenance) {
      logCraftingEvent({
        phase: "recovery",
        operation: "recoverSession",
        status: "failed",
        threadId,
        error: {
          code: "RECOVERY_FAILED",
          message: `No saved composition provenance found for thread '${threadId}'.`,
        },
      });
      throw CraftingError.recoveryFailed(
        `No saved composition provenance found for thread '${threadId}'.`,
        { threadId },
        "Ensure the session was created via CraftStation composition.",
      );
    }

    const recoveredState = this.reconstructCraftPlan(threadId, provenance, options);
    const entity = await runtimeAdapter.spawnEntity(recoveredState.craftPlan);

    let session: CraftSession;
    if (options.sessionRef) {
      session = await runtimeAdapter.resumeSession(entity, options.sessionRef);
    } else {
      session = await runtimeAdapter.createSession(entity);
    }

    logCraftingEvent({
      phase: "recovery",
      operation: "recoverSession",
      status: "success",
      threadId,
      entityId: entity.id,
      sessionId: session.id,
    });

    return {
      entity,
      session,
      recoveredState,
    };
  }
}

let defaultProvenanceStore: ProvenanceStore | undefined;

export function getDefaultProvenanceStore(): ProvenanceStore {
  if (!defaultProvenanceStore) {
    defaultProvenanceStore = new ProvenanceStore();
  }
  return defaultProvenanceStore;
}
