import { describe, expect, it } from "vitest";
import { Crafter, getDefaultCrafter } from "./crafter";
import {
  BUILTIN_CODEX_HARNESS_ITEM,
  BUILTIN_MODEL_ITEMS,
  ItemRegistry,
  getDefaultRegistry,
} from "./registry";
import { OPENAI_CODEX_RECIPE_ID, OpenAICodexNativeRecipe } from "./recipes/openaiCodexRecipe";
import type {
  CraftPlan,
  CraftSession,
  Entity,
  HarnessRuntimeAdapter,
  Item,
  PromptResult,
} from "./index";
import type { RuntimeEvent } from "../contracts/runtimeEvent";

class FakeHarnessRuntimeAdapter implements HarnessRuntimeAdapter {
  readonly id = "fake-runtime";
  readonly harnessKind = "codex";
  public spawnedEntities = new Map<string, Entity>();
  public activeSessions = new Map<string, FakeCraftSession>();

  supports(craftPlan: CraftPlan): boolean {
    return craftPlan.runtimeBinding.harnessKind === "codex";
  }

  async spawnEntity(craftPlan: CraftPlan): Promise<Entity> {
    const entity: Entity = {
      id: `entity-${craftPlan.id}`,
      resultItemId: craftPlan.resultItemId,
      craftPlan,
      status: "spawned",
      createdAt: new Date().toISOString(),
    };
    this.spawnedEntities.set(entity.id, entity);
    return entity;
  }

  async createSession(entity: Entity): Promise<CraftSession> {
    const session = new FakeCraftSession(`sess-${entity.id}`, entity.id);
    this.activeSessions.set(session.id, session);
    entity.status = "running";
    return session;
  }

  async resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession> {
    const session = new FakeCraftSession(`sess-${entity.id}`, entity.id, sessionRef);
    this.activeSessions.set(session.id, session);
    entity.status = "running";
    return session;
  }
}

class FakeCraftSession implements CraftSession {
  getSnapshot(): any {
    return {
      sessionId: this.id,
      entityId: this.entityId,
      status: this.status,
      events: [],
    };
  }
  subscribe(_listener: any): () => void {
    return () => {};
  }
  async interrupt(): Promise<void> {}
  async startTurn(command: any): Promise<any> {
    const res = await this.sendPrompt(command.prompt);
    return {
      turnId: "turn-test",
      status: "completed",
      events: res.events,
      response: res.response,
    };
  }

  public status: "active" | "busy" | "idle" | "terminated" = "active";
  readonly sessionRef?: string | undefined;

  constructor(
    readonly id: string,
    readonly entityId: string,
    sessionRef?: string | undefined,
  ) {
    if (sessionRef !== undefined) {
      this.sessionRef = sessionRef;
    }
  }

  async sendPrompt(prompt: string, onEvent?: (event: RuntimeEvent) => void): Promise<PromptResult> {
    this.status = "busy";
    const deltaEvent: RuntimeEvent = {
      type: "content.delta",
      threadId: this.id,
      itemId: "item-turn-1",
      stream: "assistant_text",
      delta: `Echo: ${prompt}`,
    };
    onEvent?.(deltaEvent);

    this.status = "idle";
    return {
      response: `Echo: ${prompt}`,
      events: [deltaEvent],
    };
  }

  async terminate(): Promise<void> {
    this.status = "terminated";
  }
}

describe("Crafting Registry", () => {
  it("starts without selectable OpenAI models until official discovery succeeds", () => {
    const registry = new ItemRegistry();
    const models = registry.listItems("model");
    const harnesses = registry.listItems("harness");

    expect(models.length).toBeGreaterThanOrEqual(4);
    expect(harnesses.length).toBe(6);
    expect(registry.getItem(BUILTIN_CODEX_HARNESS_ITEM.id)).toBeDefined();
    expect(registry.getItem("openai:gpt-5.3-codex")).toBeUndefined();
    expect(models.some((item) => item.metadata.vendor === "openai")).toBe(false);
  });

  it("does not register 'auto' as a standalone Item in registry", () => {
    const registry = new ItemRegistry();
    expect(registry.getItem("auto")).toBeUndefined();
    expect(registry.listItems().find((i) => i.id === "auto")).toBeUndefined();
  });

  it("resolves slot 'auto' deterministically to Codex Harness Item", () => {
    const registry = new ItemRegistry();
    const resolved = registry.resolveSlot("harness", "auto");
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe("harness:codex");
    expect(resolved?.metadata.vendor).toBe("codex");
  });

  it("replaces stale OpenAI builtins with the official Codex model inventory", () => {
    const registry = new ItemRegistry();

    registry.refreshCodexModels([
      {
        id: "gpt-official-live",
        displayName: "GPT Official Live",
        contextWindow: 196_000,
      },
    ]);

    const models = registry.listItems("model");
    expect(models.filter((item) => item.metadata.vendor === "openai")).toEqual([
      expect.objectContaining({
        id: "openai:gpt-official-live",
        metadata: expect.objectContaining({ source: "discovered" }),
      }),
    ]);
    expect(registry.getItem("openai:gpt-4o")).toBeUndefined();
    expect(registry.getItem("openai:gpt-5-hybrid")).toBeUndefined();
    expect(registry.getItem("openai:gpt-5.3-codex")).toBeUndefined();
    expect(registry.getItem("openai:o3-mini")).toBeUndefined();
    expect(registry.getItem("xai:grok-4.6")).toBeDefined();
    expect(registry.getItem("deepseek:deepseek-chat")).toBeDefined();
  });
});

describe("OpenAI Codex Native Recipe", () => {
  it("matches OpenAI model item with Codex harness item", () => {
    const recipe = new OpenAICodexNativeRecipe();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;
    const harness = BUILTIN_CODEX_HARNESS_ITEM;

    expect(recipe.matches({ model: gptModel, harness })).toBe(true);
  });

  it("rejects non-OpenAI model or non-Codex harness", () => {
    const recipe = new OpenAICodexNativeRecipe();
    const anthropicModel: Item = {
      id: "claude-3-5-sonnet",
      kind: "model",
      metadata: {
        id: "claude-3-5-sonnet",
        name: "Claude",
        version: "1.0",
        vendor: "anthropic",
        source: "custom",
        description: "",
        compatibilityStatus: "SUPPORTED",
      },
      components: [],
    };
    const harness = BUILTIN_CODEX_HARNESS_ITEM;
    expect(recipe.matches({ model: anthropicModel, harness })).toBe(false);
  });

  it("compiles into a valid CraftPlan with provenance and capability modelId", () => {
    const recipe = new OpenAICodexNativeRecipe();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;
    const harness = BUILTIN_CODEX_HARNESS_ITEM;

    const plan = recipe.compile(
      { model: gptModel, harness },
      { workspace: "/test/ws", sessionRef: "thread-123" },
    );

    expect(plan.recipeId).toBe(OPENAI_CODEX_RECIPE_ID);
    expect(plan.ingredients.model!.itemId).toBe(gptModel.id);
    expect(plan.ingredients.harness!.itemId).toBe(harness.id);
    expect(plan.runtimeBinding.harnessKind).toBe("codex");
    expect(plan.runtimeBinding.modelId).toBe("gpt-5.3-codex");
    expect(plan.workspace).toBe("/test/ws");
    expect(plan.sessionRef).toBe("thread-123");
    expect(plan.id).toContain("plan:recipe:openai-codex-native:");
  });
});

describe("Crafter", () => {
  it("resolves and validates auto harness slot correctly", () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const validation = crafter.validate({
      slots: {
        model: gptModel,
        harness: "auto",
      },
    });

    expect(validation.valid).toBe(true);
    expect(validation.matchedRecipe?.id).toBe(OPENAI_CODEX_RECIPE_ID);
    expect(validation.resolvedIngredients?.harness?.id).toBe("harness:codex");
  });

  it("resolves and validates explicit Codex harness slot with identical recipe", () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const validation = crafter.validate({
      slots: {
        model: gptModel,
        harness: BUILTIN_CODEX_HARNESS_ITEM,
      },
    });

    expect(validation.valid).toBe(true);
    expect(validation.matchedRecipe?.id).toBe(OPENAI_CODEX_RECIPE_ID);
  });

  it("returns UNRESOLVED_SLOT error with remediation when slot is empty or undefined", () => {
    const crafter = new Crafter();
    const validation = crafter.validate({
      slots: {
        model: undefined,
        harness: "auto",
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors[0]?.code).toBe("UNRESOLVED_SLOT");
    expect(validation.errors[0]?.remediation).toBeDefined();
  });

  it("returns RUNTIME_UNAVAILABLE error when runtime is not installed", () => {
    const crafter = new Crafter(getDefaultRegistry(), {
      checkRuntimeAvailable: (kind) => kind !== "codex",
    });
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const validation = crafter.validate({
      slots: {
        model: gptModel,
        harness: "auto",
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors[0]?.code).toBe("RUNTIME_UNAVAILABLE");
    expect(validation.errors[0]?.message).toContain("not installed");
  });

  it("returns RECIPE_NOT_FOUND error when combination is unsupported", () => {
    const crafter = new Crafter();
    const invalidModel: Item = {
      id: "unknown:model",
      kind: "model",
      metadata: {
        id: "unknown:model",
        name: "Unknown",
        version: "1.0",
        vendor: "unknown",
        source: "custom",
        description: "",
        compatibilityStatus: "INCOMPATIBLE",
      },
      components: [],
    };

    const validation = crafter.validate({
      slots: {
        model: invalidModel,
        harness: BUILTIN_CODEX_HARNESS_ITEM,
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors[0]?.code).toBe("RECIPE_NOT_FOUND");
  });

  it("compiles CraftingGrid into ResultItem and CraftPlan", () => {
    const crafter = getDefaultCrafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const result = crafter.compile(
      {
        slots: {
          model: gptModel,
          harness: "auto",
        },
      },
      { workspace: "D:\\test\\ws" },
    );

    expect(result.success).toBe(true);
    expect(result.resultItem).toBeDefined();
    expect(result.craftPlan).toBeDefined();
    expect(result.resultItem?.kind).toBe("result");
    expect(result.resultItem?.provenance.recipeId).toBe(OPENAI_CODEX_RECIPE_ID);
    expect(result.resultItem?.provenance.ingredients.model!.itemId).toBe(gptModel.id);
    expect(result.resultItem?.provenance.ingredients.harness!.itemId).toBe("harness:codex");
    expect(result.craftPlan?.workspace).toBe("D:\\test\\ws");
  });
});

describe("Harness Runtime Seam with Fake Adapter", () => {
  it("completes full lifecycle: CraftPlan -> spawn Entity -> create Session -> prompt -> terminate", async () => {
    const crafter = getDefaultCrafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const craftResult = crafter.compile({
      slots: {
        model: gptModel,
        harness: "auto",
      },
    });

    expect(craftResult.success).toBe(true);
    const plan = craftResult.craftPlan!;

    const runtimeAdapter = new FakeHarnessRuntimeAdapter();
    expect(runtimeAdapter.supports(plan)).toBe(true);

    const entity = await runtimeAdapter.spawnEntity(plan);
    expect(entity.id).toBeDefined();
    expect(entity.resultItemId).toBe(plan.resultItemId);
    expect(entity.status).toBe("spawned");

    const session = await runtimeAdapter.createSession(entity);
    expect(session.id).toBeDefined();
    expect(entity.status).toBe("running");

    const events: RuntimeEvent[] = [];
    const promptResult = await session.sendPrompt("Hello Codex", (ev) => {
      events.push(ev);
    });

    expect(promptResult.response).toBe("Echo: Hello Codex");
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("content.delta");

    await session.terminate();
    expect(session.status).toBe("terminated");
  });
});
