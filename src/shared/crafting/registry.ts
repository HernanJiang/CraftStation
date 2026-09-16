import type { Item, ItemKind, Recipe, SlotSelection } from "./types";
import { NativeHarnessRecipe } from "./recipes/nativeHarnessRecipe";
import { OpenAICodexNativeRecipe } from "./recipes/openaiCodexRecipe";
import { CompatibilityBridgeRecipe } from "./recipes/compatibilityRecipe";

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
  {
    id: "openai:gpt-5.4",
    kind: "model",
    metadata: {
      id: "openai:gpt-5.4",
      name: "GPT-5.4",
      version: "opencode-1.18.25-catalog",
      vendor: "openai",
      source: "builtin",
      description: "OpenAI model listed by the official OpenCode 1.18.25 catalog.",
      tags: ["general", "coding", "openai", "opencode"],
      compatibilityStatus: "EXPERIMENTAL",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "openai",
        modelId: "gpt-5.4",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
];

export const BUILTIN_NATIVE_HARNESS_MODEL_ITEMS: Item[] = [
  {
    id: "moonshot-openai-compatible:kimi-k2.5",
    kind: "model",
    metadata: {
      id: "moonshot-openai-compatible:kimi-k2.5",
      name: "Kimi K2.5 (OpenAI-compatible)",
      version: "audit-2026-08",
      vendor: "moonshot-openai-compatible",
      source: "builtin",
      description: "Kimi model through OpenCode's separately configured OpenAI-compatible route.",
      tags: ["coding", "kimi", "openai-compatible"],
      compatibilityStatus: "EXPERIMENTAL",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "moonshot-openai-compatible",
        modelId: "kimi-k2.5",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "xai:grok-4.6",
    kind: "model",
    metadata: {
      id: "xai:grok-4.6",
      name: "Grok 4.6",
      version: "audit-2026-08",
      vendor: "xai",
      source: "builtin",
      description: "xAI model family paired with the official Grok Build Harness.",
      tags: ["coding", "xai", "grok"],
      compatibilityStatus: "NATIVE",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "xai",
        modelId: "grok-4.6",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "moonshot:kimi-for-coding",
    kind: "model",
    metadata: {
      id: "moonshot:kimi-for-coding",
      name: "Kimi for Coding",
      version: "audit-2026-08",
      vendor: "moonshot",
      source: "builtin",
      description: "Moonshot coding model paired with the official Kimi Code Harness.",
      tags: ["coding", "moonshot", "kimi"],
      compatibilityStatus: "NATIVE",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "moonshot",
        modelId: "kimi-for-coding",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "google:antigravity-default",
    kind: "model",
    metadata: {
      id: "google:antigravity-default",
      name: "Antigravity Default Model",
      version: "audit-2026-08",
      vendor: "google",
      source: "builtin",
      description: "Google-side model family paired with the official Antigravity Harness.",
      tags: ["coding", "google", "antigravity"],
      compatibilityStatus: "NATIVE",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "google",
        modelId: "Gemini 3.5 Flash",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "muse:muse-spark-1.2",
    kind: "model",
    metadata: {
      id: "muse:muse-spark-1.2",
      name: "Muse Spark 1.2",
      version: "audit-2026-09",
      vendor: "muse",
      source: "builtin",
      description:
        "Meta Muse Spark model family using OpenCode by default, with Muse Code available as an explicit Recipe.",
      tags: ["coding", "muse", "meta"],
      compatibilityStatus: "NATIVE",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "muse",
        modelId: "muse-spark-1.2",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "cognition:swe",
    kind: "model",
    metadata: {
      id: "cognition:swe",
      name: "SWE-1.6",
      version: "audit-2026-09",
      vendor: "cognition",
      source: "builtin",
      description: "Cognition SWE model family paired with the official Devin Native Harness.",
      tags: ["coding", "cognition", "devin"],
      compatibilityStatus: "NATIVE",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "cognition",
        modelId: "swe",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "deepseek:deepseek-v4-flash",
    kind: "model",
    metadata: {
      id: "deepseek:deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      version: "opencode-1.18.25-catalog",
      vendor: "deepseek",
      source: "builtin",
      description: "Reserved model family for the official DeepSeek / DSH Harness.",
      tags: ["coding", "deepseek", "reserved"],
      compatibilityStatus: "EXPERIMENTAL",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "deepseek",
        modelId: "deepseek-v4-flash",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "deepseek:deepseek-chat-api",
    kind: "model",
    metadata: {
      id: "deepseek:deepseek-chat-api",
      name: "DeepSeek Chat API",
      version: "api-2026-08",
      vendor: "deepseek",
      source: "builtin",
      description: "DeepSeek Chat through an explicitly configured OpenAI-compatible API.",
      tags: ["coding", "deepseek", "api"],
      compatibilityStatus: "SUPPORTED",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "deepseek",
        modelId: "deepseek-chat",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "deepseek:deepseek-reasoner-api",
    kind: "model",
    metadata: {
      id: "deepseek:deepseek-reasoner-api",
      name: "DeepSeek Reasoner API",
      version: "api-2026-08",
      vendor: "deepseek",
      source: "builtin",
      description: "DeepSeek Reasoner through an explicitly configured OpenAI-compatible API.",
      tags: ["reasoning", "deepseek", "api"],
      compatibilityStatus: "SUPPORTED",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "deepseek",
        modelId: "deepseek-reasoner",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "deepseek:deepseek-v4.1-flash",
    kind: "model",
    metadata: {
      id: "deepseek:deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      version: "opencode-1.18.25-catalog",
      vendor: "deepseek",
      source: "builtin",
      description: "Reserved model family for the official DeepSeek / DSH Harness.",
      tags: ["coding", "deepseek", "reserved"],
      compatibilityStatus: "EXPERIMENTAL",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "deepseek",
        modelId: "deepseek-v4.1-flash",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "deepseek:deepseek-v4-flash-api",
    kind: "model",
    metadata: {
      id: "deepseek:deepseek-v4-flash-api",
      name: "DeepSeek V4 Flash API",
      version: "api-2026-08",
      vendor: "deepseek",
      source: "builtin",
      description: "DeepSeek V4 Flash through an explicitly configured OpenAI-compatible API.",
      tags: ["coding", "deepseek", "api"],
      compatibilityStatus: "SUPPORTED",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "deepseek",
        modelId: "deepseek-v4-flash",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "deepseek:deepseek-v4.1-flash-api",
    kind: "model",
    metadata: {
      id: "deepseek:deepseek-v4.1-flash-api",
      name: "DeepSeek V4.1 Flash API",
      version: "api-2026-08",
      vendor: "deepseek",
      source: "builtin",
      description: "DeepSeek V4.1 Flash through an explicitly configured OpenAI-compatible API.",
      tags: ["coding", "deepseek", "api"],
      compatibilityStatus: "SUPPORTED",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "deepseek",
        modelId: "deepseek-v4.1-flash",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
  {
    id: "deepseek:deepseek-v4-pro-api",
    kind: "model",
    metadata: {
      id: "deepseek:deepseek-v4-pro-api",
      name: "DeepSeek V4 Pro API",
      version: "api-2026-08",
      vendor: "deepseek",
      source: "builtin",
      description: "DeepSeek V4 Pro through an explicitly configured OpenAI-compatible API.",
      tags: ["coding", "deepseek", "api"],
      compatibilityStatus: "SUPPORTED",
    },
    components: [
      {
        kind: "model_capability",
        vendor: "deepseek",
        modelId: "deepseek-v4-pro",
        supportsStreaming: true,
        supportsToolCalling: true,
      },
    ],
  },
];

BUILTIN_MODEL_ITEMS.push(...BUILTIN_NATIVE_HARNESS_MODEL_ITEMS);

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

export const BUILTIN_OPENCODE_HARNESS_ITEM: Item = {
  id: "harness:opencode",
  kind: "harness",
  metadata: {
    id: "harness:opencode",
    name: "OpenCode Native Harness",
    version: "0.8.0",
    vendor: "opencode",
    source: "builtin",
    description: "Official OpenCode server runtime through HTTP/OpenAPI and server-wide SSE.",
    tags: ["harness", "opencode", "official", "http", "sse"],
    compatibilityStatus: "NATIVE",
  },
  components: [
    {
      kind: "harness_runtime",
      harnessKind: "opencode",
      supportedVendors: [
        "openai",
        "xai",
        "google",
        "deepseek",
        "moonshot",
        "moonshot-openai-compatible",
      ],
      executionMode: "structured_session",
    },
  ],
};

function createNativeHarnessItem(input: {
  id: string;
  name: string;
  vendor: string;
  description: string;
  compatibilityStatus?: "NATIVE" | "SUPPORTED" | "EXPERIMENTAL" | "INCOMPATIBLE";
  executionMode: "structured_session" | "terminal_pty";
}): Item {
  return {
    id: input.id,
    kind: "harness",
    metadata: {
      id: input.id,
      name: input.name,
      version: "0.4.0",
      vendor: input.vendor,
      source: "builtin",
      description: input.description,
      tags: ["harness", input.vendor, "official", "native"],
      compatibilityStatus: input.compatibilityStatus ?? "NATIVE",
    },
    components: [
      {
        kind: "harness_runtime",
        harnessKind: input.id.replace(/^harness:/, ""),
        supportedVendors: [input.vendor],
        executionMode: input.executionMode,
      },
    ],
  };
}

export const BUILTIN_GROK_HARNESS_ITEM = createNativeHarnessItem({
  id: "harness:grok",
  name: "Grok Build Harness",
  vendor: "xai",
  description: "Official Grok Build agent runtime through its ACP stdio boundary.",
  executionMode: "structured_session",
});

export const BUILTIN_KIMI_HARNESS_ITEM = createNativeHarnessItem({
  id: "harness:kimi",
  name: "Kimi Code Harness",
  vendor: "moonshot",
  description: "Official Kimi Code agent runtime through its ACP boundary.",
  executionMode: "structured_session",
});

export const BUILTIN_ANTIGRAVITY_HARNESS_ITEM = createNativeHarnessItem({
  id: "harness:antigravity",
  name: "Antigravity Harness",
  vendor: "google",
  description: "Official Antigravity agent runtime through its stream-json machine boundary.",
  executionMode: "structured_session",
});

export const BUILTIN_DEEPSEEK_HARNESS_ITEM = createNativeHarnessItem({
  id: "harness:deepseek",
  name: "DeepSeek / DSH Harness",
  vendor: "deepseek",
  description: "Reserved official DeepSeek / DSH native runtime binding.",
  compatibilityStatus: "EXPERIMENTAL",
  executionMode: "structured_session",
});

export const BUILTIN_DEEPSEEK_API_HARNESS_ITEM = createNativeHarnessItem({
  id: "harness:deepseek-api",
  name: "DeepSeek API Runtime",
  vendor: "deepseek",
  description: "OpenAI-compatible DeepSeek API runtime; independent from the DSH Harness.",
  executionMode: "structured_session",
});

export const BUILTIN_MUSE_HARNESS_ITEM = createNativeHarnessItem({
  id: "harness:muse",
  name: "Muse Code Harness",
  vendor: "muse",
  description:
    "Official Muse Code agent runtime through muse serve (MSP). On Windows it runs via WSL.",
  executionMode: "structured_session",
});

export const BUILTIN_DEVIN_HARNESS_ITEM = createNativeHarnessItem({
  id: "harness:devin",
  name: "Devin Native Harness",
  vendor: "cognition",
  description: "Official Devin CLI agent runtime through its ACP stdio boundary.",
  executionMode: "structured_session",
});

export const BUILTIN_NATIVE_HARNESS_ITEMS: Item[] = [
  BUILTIN_GROK_HARNESS_ITEM,
  BUILTIN_KIMI_HARNESS_ITEM,
  BUILTIN_ANTIGRAVITY_HARNESS_ITEM,
  BUILTIN_DEEPSEEK_HARNESS_ITEM,
  BUILTIN_DEEPSEEK_API_HARNESS_ITEM,
  BUILTIN_MUSE_HARNESS_ITEM,
  BUILTIN_DEVIN_HARNESS_ITEM,
];

export const NATIVE_HARNESS_RECIPES = [
  new NativeHarnessRecipe({
    id: "recipe:openai-opencode-native",
    name: "OpenAI OpenCode Native Recipe",
    description: "OpenAI Model Item through the official OpenCode server Harness.",
    harnessKind: "opencode",
    harnessItemId: BUILTIN_OPENCODE_HARNESS_ITEM.id,
    modelVendors: ["openai"],
    harnessVendors: ["opencode"],
    providerID: "openai",
    compatibilityStatus: "EXPERIMENTAL",
  }),
  new NativeHarnessRecipe({
    id: "recipe:xai-opencode-native",
    name: "xAI OpenCode Native Recipe",
    description: "xAI/Grok Model Item through OpenCode's provider/model adapter.",
    harnessKind: "opencode",
    harnessItemId: BUILTIN_OPENCODE_HARNESS_ITEM.id,
    modelVendors: ["xai"],
    harnessVendors: ["opencode"],
    providerID: "xai",
    compatibilityStatus: "EXPERIMENTAL",
  }),
  new NativeHarnessRecipe({
    id: "recipe:google-opencode-native",
    name: "Google Gemini OpenCode Native Recipe",
    description: "Google/Gemini Model Item through OpenCode's provider/model adapter.",
    harnessKind: "opencode",
    harnessItemId: BUILTIN_OPENCODE_HARNESS_ITEM.id,
    modelVendors: ["google"],
    harnessVendors: ["opencode"],
    providerID: "google",
    compatibilityStatus: "EXPERIMENTAL",
  }),
  new NativeHarnessRecipe({
    id: "recipe:deepseek-opencode-native",
    name: "DeepSeek OpenCode Native Recipe",
    description: "DeepSeek Model Item through OpenCode; this is not the DSH Harness.",
    harnessKind: "opencode",
    harnessItemId: BUILTIN_OPENCODE_HARNESS_ITEM.id,
    modelVendors: ["deepseek"],
    harnessVendors: ["opencode"],
    providerID: "deepseek",
    compatibilityStatus: "EXPERIMENTAL",
  }),
  new NativeHarnessRecipe({
    id: "recipe:moonshot-kimi-opencode-native",
    name: "Moonshot Kimi OpenCode Native Recipe",
    description: "Kimi through the native Moonshot provider in OpenCode.",
    harnessKind: "opencode",
    harnessItemId: BUILTIN_OPENCODE_HARNESS_ITEM.id,
    modelVendors: ["moonshot"],
    harnessVendors: ["opencode"],
    providerID: "kimi-for-coding",
    compatibilityStatus: "EXPERIMENTAL",
  }),
  new NativeHarnessRecipe({
    id: "recipe:kimi-openai-compatible-opencode",
    name: "Kimi OpenAI-compatible OpenCode Recipe",
    description: "Kimi through a separately configured OpenAI-compatible provider in OpenCode.",
    harnessKind: "opencode",
    harnessItemId: BUILTIN_OPENCODE_HARNESS_ITEM.id,
    modelVendors: ["moonshot-openai-compatible"],
    harnessVendors: ["opencode"],
    providerID: "moonshot-openai-compatible",
    compatibilityStatus: "EXPERIMENTAL",
  }),
  new NativeHarnessRecipe({
    id: "recipe:xai-grok-native",
    name: "xAI Grok Build Native Recipe",
    description: "Native xAI model composition through the official Grok Build Harness.",
    harnessKind: "grok",
    harnessItemId: BUILTIN_GROK_HARNESS_ITEM.id,
    modelVendors: ["xai"],
  }),
  new NativeHarnessRecipe({
    id: "recipe:moonshot-kimi-native",
    name: "Moonshot Kimi Code Native Recipe",
    description: "Native Moonshot model composition through the official Kimi Code Harness.",
    harnessKind: "kimi",
    harnessItemId: BUILTIN_KIMI_HARNESS_ITEM.id,
    modelVendors: ["moonshot"],
  }),
  new NativeHarnessRecipe({
    id: "recipe:google-antigravity-native",
    name: "Google Antigravity Native Recipe",
    description: "Native Google-side composition through the official Antigravity Harness.",
    harnessKind: "antigravity",
    harnessItemId: BUILTIN_ANTIGRAVITY_HARNESS_ITEM.id,
    modelVendors: ["google"],
  }),
  new NativeHarnessRecipe({
    id: "recipe:meta-muse-native",
    name: "Meta Muse Code Native Recipe",
    description:
      "Native Muse Spark composition through the official Muse Code Harness (WSL on Windows).",
    harnessKind: "muse",
    harnessItemId: BUILTIN_MUSE_HARNESS_ITEM.id,
    modelVendors: ["muse"],
  }),
  new NativeHarnessRecipe({
    id: "recipe:cognition-devin-native",
    name: "Cognition Devin Native Recipe",
    description: "Native Cognition model composition through the official Devin CLI Harness.",
    harnessKind: "devin",
    harnessItemId: BUILTIN_DEVIN_HARNESS_ITEM.id,
    modelVendors: ["cognition"],
  }),
  new NativeHarnessRecipe({
    id: "recipe:deepseek-native",
    name: "DeepSeek / DSH Native Recipe",
    description: "Reserved native DeepSeek composition; unavailable until DSH is installed.",
    harnessKind: "deepseek",
    harnessItemId: BUILTIN_DEEPSEEK_HARNESS_ITEM.id,
    modelVendors: ["deepseek"],
    compatibilityStatus: "EXPERIMENTAL",
  }),
  new NativeHarnessRecipe({
    id: "recipe:deepseek-api",
    name: "DeepSeek API Recipe",
    description: "DeepSeek Model through an explicitly configured OpenAI-compatible API.",
    harnessKind: "deepseek-api",
    harnessItemId: BUILTIN_DEEPSEEK_API_HARNESS_ITEM.id,
    modelVendors: ["deepseek"],
    modelIds: [
      "deepseek-chat",
      "deepseek-reasoner",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-v4.1-flash",
    ],
    modelItemIds: [
      "deepseek:deepseek-chat-api",
      "deepseek:deepseek-reasoner-api",
      "deepseek:deepseek-v4-flash-api",
      "deepseek:deepseek-v4-pro-api",
      "deepseek:deepseek-v4.1-flash-api",
    ],
    compatibilityStatus: "SUPPORTED",
  }),
] as const;

export const BUILTIN_HARNESS_ITEMS: Item[] = [
  BUILTIN_CODEX_HARNESS_ITEM,
  BUILTIN_OPENCODE_HARNESS_ITEM,
  ...BUILTIN_NATIVE_HARNESS_ITEMS,
];

export class ItemRegistry {
  private items = new Map<string, Item>();
  private recipes = new Map<string, Recipe>();

  constructor() {
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    // Codex model availability is owned by the official app-server `model/list`
    // response. Keep only OpenAI models that belong to another explicit
    // Harness catalog (currently OpenCode); legacy Codex builtins stay hidden.
    for (const model of BUILTIN_MODEL_ITEMS.filter(
      (item) => item.metadata.vendor !== "openai" || item.metadata.tags?.includes("opencode"),
    )) {
      this.registerItem(model);
    }
    for (const harness of BUILTIN_NATIVE_HARNESS_ITEMS) this.registerItem(harness);
    this.registerItem(BUILTIN_CODEX_HARNESS_ITEM);
    this.registerItem(BUILTIN_OPENCODE_HARNESS_ITEM);
    this.registerRecipe(new OpenAICodexNativeRecipe());
    for (const recipe of NATIVE_HARNESS_RECIPES) this.registerRecipe(recipe);
    this.registerRecipe(new CompatibilityBridgeRecipe());
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

  refreshCodexModels(
    models: Array<{
      id: string;
      displayName?: string | undefined;
      contextWindow?: number | undefined;
      supportsStreaming?: boolean | undefined;
      supportsToolCalling?: boolean | undefined;
    }>,
  ): void {
    // `model/list` is an authoritative snapshot. Rebuild the item map with
    // discovered OpenAI models first (the default Codex composition), while
    // retaining every non-Codex Native Item in its original order. OpenCode's
    // explicit catalog entry is independent from the Codex inventory.
    const retainedItems = [...this.items.values()].filter(
      (item) =>
        item.kind !== "model" ||
        item.metadata.vendor !== "openai" ||
        item.metadata.tags?.includes("opencode") === true,
    );
    const discoveredItems: Item[] = [];
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
      discoveredItems.push(item);
    }
    this.items.clear();
    for (const item of [...discoveredItems, ...retainedItems]) this.registerItem(item);
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
