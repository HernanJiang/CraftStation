import type { Item, ItemKind, Recipe, SlotSelection } from "./types";
import { OpenAICodexNativeRecipe } from "./recipes/openaiCodexRecipe";

export const BUILTIN_MODEL_ITEMS: Item[] = [
  {
    id: "openai:gpt-5.3-codex",
    kind: "model",
    metadata: {
      id: "openai:gpt-5.3-codex",
      name: "GPT-5.3 Codex",
      version: "2026-03",
      vendor: "openai",
      source: "builtin",
      description: "OpenAI flagship coding model optimized for deep development tasks.",
      tags: ["coding", "flagship", "openai"],
      compatibilityStatus: "NATIVE",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "openai",
        modelId: "gpt-5.3-codex",
        contextWindow: 200000,
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "openai:gpt-5-hybrid",
    kind: "model",
    metadata: {
      id: "openai:gpt-5-hybrid",
      name: "GPT-5 Hybrid",
      version: "2026-01",
      vendor: "openai",
      source: "builtin",
      description: "OpenAI hybrid reasoning model suitable for planning and coding.",
      tags: ["reasoning", "hybrid", "openai"],
      compatibilityStatus: "NATIVE",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "openai",
        modelId: "gpt-5-hybrid",
        contextWindow: 200000,
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "openai:gpt-4o",
    kind: "model",
    metadata: {
      id: "openai:gpt-4o",
      name: "GPT-4o",
      version: "2024-11",
      vendor: "openai",
      source: "builtin",
      description: "High-intelligence flagship model for general-purpose tasks.",
      tags: ["general", "fast", "openai"],
      compatibilityStatus: "SUPPORTED",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "openai",
        modelId: "gpt-4o",
        contextWindow: 128000,
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "openai:o3-mini",
    kind: "model",
    metadata: {
      id: "openai:o3-mini",
      name: "o3-mini",
      version: "2025-01",
      vendor: "openai",
      source: "builtin",
      description: "Fast, cost-efficient reasoning model for coding and STEM.",
      tags: ["reasoning", "fast", "openai"],
      compatibilityStatus: "SUPPORTED",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "openai",
        modelId: "o3-mini",
        contextWindow: 128000,
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
];

export const BUILTIN_CODEX_HARNESS_ITEM: Item = {
  id: "harness:codex",
  kind: "harness",
  metadata: {
    id: "harness:codex",
    name: "Codex Harness",
    version: "0.1.0",
    vendor: "codex",
    source: "builtin",
    description:
      "OpenAI Codex CLI & App-Server runtime harness for multi-turn structured coding sessions.",
    tags: ["harness", "codex", "official"],
    compatibilityStatus: "NATIVE",
  },
  components: [
    {
      kind: "harness_runtime",
      harnessKind: "codex",
      supportedVendors: ["openai", "codex"],
      executionMode: "structured_session",
    },
  ],
};

export class ItemRegistry {
  private items = new Map<string, Item>();
  private recipes = new Map<string, Recipe>();

  constructor() {
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    for (const model of BUILTIN_MODEL_ITEMS) {
      this.registerItem(model);
    }
    this.registerItem(BUILTIN_CODEX_HARNESS_ITEM);
    this.registerRecipe(new OpenAICodexNativeRecipe());
  }

  registerItem(item: Item): void {
    this.items.set(item.id, item);
  }

  getItem(id: string): Item | undefined {
    return this.items.get(id);
  }

  listItems(kind?: ItemKind): Item[] {
    const all = Array.from(this.items.values());
    if (!kind) return all;
    return all.filter((item) => item.kind === kind);
  }

  registerRecipe(recipe: Recipe): void {
    this.recipes.set(recipe.id, recipe);
  }

  getRecipe(id: string): Recipe | undefined {
    return this.recipes.get(id);
  }

  listRecipes(): Recipe[] {
    return Array.from(this.recipes.values());
  }

  findMatchingRecipe(ingredients: Record<string, Item>): Recipe | undefined {
    for (const recipe of this.recipes.values()) {
      if (recipe.matches(ingredients)) {
        return recipe;
      }
    }
    return undefined;
  }

  /**
   * Deterministically resolve slot selection.
   * "auto" for harness slot resolves to BUILTIN_CODEX_HARNESS_ITEM.
   */

  refreshCodexModels(models: Array<{ id: string; displayName?: string; contextWindow?: number; supportsStreaming?: boolean; supportsToolCalling?: boolean }>): void {
    for (const m of models) {
      const itemId = `openai:${m.id}`;
      const item: Item = {
        id: itemId,
        kind: "model",
        metadata: {
          id: itemId,
          name: m.displayName || m.id,
          version: "latest",
          vendor: "openai",
          source: "discovered",
          description: `Discovered model from official Codex App-Server (${m.id})`,
          tags: ["codex", "discovered", "openai"],
          compatibilityStatus: "NATIVE",
        },
        components: [
          {
            kind: "model_capability",
            vendor: "openai",
            modelId: m.id,
            contextWindow: m.contextWindow ?? 200000,
            supportsStreaming: m.supportsStreaming ?? true,
            supportsToolCalling: m.supportsToolCalling ?? true,
          },
        ],
      };
      this.registerItem(item);
    }
  }

  resolveSlot(slotName: string, selection: SlotSelection): Item | undefined {
    if (!selection) return undefined;
    if (selection === "auto") {
      if (slotName === "harness") {
        return this.getItem(BUILTIN_CODEX_HARNESS_ITEM.id);
      }
      return undefined;
    }
    return this.getItem(selection.id) ?? selection;
  }
}

let defaultRegistryInstance: ItemRegistry | undefined;

export function getDefaultRegistry(): ItemRegistry {
  if (!defaultRegistryInstance) {
    defaultRegistryInstance = new ItemRegistry();
  }
  return defaultRegistryInstance;
}
