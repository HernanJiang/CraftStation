import { describe, expect, it, vi } from "vitest";
import { Crafter } from "./crafter";
import { BUILTIN_MODEL_ITEMS } from "./registry";
import { AppStateProvenanceDriver, ProvenanceStore } from "./provenanceStore";
import { OPENAI_CODEX_RECIPE_ID } from "./recipes/openaiCodexRecipe";
import type { HarnessRuntimeAdapter, Entity, CraftSession, CraftPlan, PromptResult } from "./index";
import type { RuntimeEvent } from "../contracts/runtimeEvent";

describe("ProvenanceStore & Session Recovery", () => {
  it("saves and retrieves composition provenance in memory", () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const craftResult = crafter.compile({
      slots: {
        model: gptModel,
        harness: "auto",
      },
    });

    const provenance = craftResult.resultItem!.provenance;
    const store = new ProvenanceStore();
    const threadId = "thread-persisted-1";

    store.saveProvenance(threadId, provenance);
    const retrieved = store.getProvenance(threadId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.recipeId).toBe(OPENAI_CODEX_RECIPE_ID);
    expect(retrieved?.ingredients.model!.itemId).toBe(gptModel.id);
  });

  it("persists and recovers provenance across store restart via AppStateProvenanceDriver", () => {
    const dbState = new Map<string, string>();
    const driver = new AppStateProvenanceDriver(
      (k) => dbState.get(k) ?? null,
      (k, v) => {
        dbState.set(k, v);
      },
    );

    const store1 = new ProvenanceStore(undefined, driver);
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const craftResult = crafter.compile({
      slots: {
        model: gptModel,
        harness: "auto",
      },
    });
    const provenance = craftResult.resultItem!.provenance;
    const threadId = "thread-reopen-sqlite";

    // Write in first app session
    store1.saveProvenance(threadId, provenance);
    expect(dbState.has(`craftstation:provenance:${threadId}`)).toBe(true);

    // Simulate new store instance (app restart / new window) reading from same DB driver
    const store2 = new ProvenanceStore(undefined, driver);
    const retrieved = store2.getProvenance(threadId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.recipeId).toBe(OPENAI_CODEX_RECIPE_ID);

    const recovered = store2.reconstructCraftPlan(threadId, retrieved!, {
      workspace: "D:\\reopened\\ws",
      sessionRef: "rollout-saved-sqlite-1",
    });

    expect(recovered.craftPlan.recipeId).toBe(OPENAI_CODEX_RECIPE_ID);
    expect(recovered.craftPlan.workspace).toBe("D:\\reopened\\ws");
    expect(recovered.craftPlan.sessionRef).toBe("rollout-saved-sqlite-1");
    expect(recovered.craftPlan.runtimeBinding.modelId).toBe("gpt-5.3-codex");
  });

  it("preserves Native Harness profile and environment binding across recovery", () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;
    const craftResult = crafter.compile(
      {
        slots: {
          model: gptModel,
          harness: "auto",
        },
      },
      {
        workspace: "C:\\repo",
        threadId: "thread-native-binding",
        profileRef: "profile:work",
        environment: { kind: "windows" },
      },
    );
    const provenance = craftResult.resultItem!.provenance;

    expect(provenance.runtimeBinding).toMatchObject({
      harnessKind: "codex",
      profileRef: "profile:work",
      environment: { kind: "windows" },
    });

    const store = new ProvenanceStore();
    const recovered = store.reconstructCraftPlan("thread-native-binding", provenance, {
      workspace: "C:\\reopened",
      sessionRef: "codex-thread-saved",
    });

    expect(recovered.craftPlan.runtimeBinding).toMatchObject({
      harnessKind: "codex",
      runtimeAdapterId: "codex-structured",
      profileRef: "profile:work",
      environment: { kind: "windows" },
    });
    expect(recovered.craftPlan.workspace).toBe("C:\\reopened");
    expect(recovered.craftPlan.sessionRef).toBe("codex-thread-saved");
  });

  it("rejects a recovered binding whose harness identity disagrees with provenance", () => {
    const store = new ProvenanceStore();
    const provenance = {
      recipeId: OPENAI_CODEX_RECIPE_ID,
      recipeVersion: "1.0.0",
      craftedAt: new Date().toISOString(),
      ingredients: {
        model: {
          slot: "model",
          itemId: "openai:gpt-5.3-codex",
          itemVersion: "1.0",
          vendor: "openai",
          kind: "model" as const,
        },
        harness: {
          slot: "harness",
          itemId: "harness:codex",
          itemVersion: "1.0",
          vendor: "codex",
          kind: "harness" as const,
        },
      },
      runtimeBinding: {
        harnessKind: "grok",
        modelId: "grok-4.6",
        vendor: "xai",
        runtimeAdapterId: "native-harness:grok",
      },
    };

    expect(() => store.reconstructCraftPlan("thread-mismatched-binding", provenance)).toThrow(
      /does not match ingredient harness/,
    );
  });

  it("throws RECOVERY_FAILED when recovering with an unregistered recipe", () => {
    const store = new ProvenanceStore();
    const threadId = "thread-invalid-recipe";

    const corruptedProvenance = {
      recipeId: "nonexistent-recipe",
      recipeVersion: "1.0.0",
      craftedAt: new Date().toISOString(),
      ingredients: {
        model: {
          slot: "model",
          itemId: "openai:gpt-5.3-codex",
          itemVersion: "1.0",
          vendor: "openai",
          kind: "model" as const,
        },
        harness: {
          slot: "harness",
          itemId: "harness:codex",
          itemVersion: "1.0",
          vendor: "codex",
          kind: "harness" as const,
        },
      },
    };

    expect(() => store.reconstructCraftPlan(threadId, corruptedProvenance)).toThrowError(
      /Recipe 'nonexistent-recipe' not found/,
    );
  });

  it("recovers active session through runtime adapter with sessionRef", async () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const craftResult = crafter.compile({
      slots: {
        model: gptModel,
        harness: "auto",
      },
    });

    const provenance = craftResult.resultItem!.provenance;
    const store = new ProvenanceStore();
    const threadId = "thread-active-recovery";
    store.saveProvenance(threadId, provenance);

    const spawnEntityMock = vi.fn<(plan: CraftPlan) => Promise<Entity>>().mockImplementation(
      async (plan: CraftPlan): Promise<Entity> => ({
        id: `entity-${plan.id}`,
        resultItemId: plan.resultItemId,
        craftPlan: plan,
        status: "spawned",
        createdAt: new Date().toISOString(),
      }),
    );

    const resumeSessionMock = vi
      .fn<(entity: Entity, sessionRef: string) => Promise<CraftSession>>()
      .mockImplementation(
        async (entity: Entity, sessionRef: string): Promise<CraftSession> => ({
          id: `sess-${sessionRef}`,
          entityId: entity.id,
          sessionRef,
          status: "active",
          sendPrompt:
            vi.fn<
              (prompt: string, onEvent?: (event: RuntimeEvent) => void) => Promise<PromptResult>
            >(),
          terminate: vi.fn<() => Promise<void>>(),
          startTurn: vi
            .fn<(command: any) => Promise<any>>()
            .mockResolvedValue({ turnId: "turn-1", status: "completed" as const, events: [] }),
          interrupt: vi.fn<() => Promise<void>>(),
          getSnapshot: vi.fn<() => any>().mockReturnValue({
            sessionId: `sess-${sessionRef}`,
            entityId: entity.id,
            status: "active" as const,
            events: [],
          }),
          subscribe: vi.fn<(listener: any) => () => void>().mockReturnValue(() => {}),
        }),
      );

    const fakeAdapter: HarnessRuntimeAdapter = {
      id: "fake-recovery-adapter",
      harnessKind: "codex",
      supports: () => true,
      spawnEntity: spawnEntityMock,
      createSession: vi.fn<(entity: Entity) => Promise<CraftSession>>(),
      resumeSession: resumeSessionMock,
    };

    const { entity, session, recoveredState } = await store.recoverSession(threadId, fakeAdapter, {
      sessionRef: "saved-rollout-ref-888",
    });

    expect(entity.id).toBeDefined();
    expect(session.sessionRef).toBe("saved-rollout-ref-888");
    expect(recoveredState.modelId).toBe("gpt-5.3-codex");
    expect(resumeSessionMock).toHaveBeenCalledWith(entity, "saved-rollout-ref-888");
  });
});
