import { describe, expect, it } from "vitest";
import {
  Crafter,
  getDefaultRegistry,
  BUILTIN_MODEL_ITEMS,
  AppStateProvenanceDriver,
  ProvenanceStore,
} from "./index";
import { CodexHarnessRuntimeAdapter } from "@/supervisor/runtime/codexRuntimeAdapter";
import type {
  RuntimeEvent,
  StartThreadPayload,
  StartThreadResult,
  SendThreadInputPayload,
} from "@/shared/contracts";

describe("Crafting runtime adapter seam", () => {
  it("runs the synthetic adapter seam: Model+Harness -> Recipe -> Crafter -> CraftPlan -> Adapter -> Entity -> Session", async () => {
    // 1. Selecting OpenAI Model & Auto Harness
    const registry = getDefaultRegistry();
    const crafter = new Crafter(registry);
    const modelItem = BUILTIN_MODEL_ITEMS.find((m) => m.id === "openai:gpt-5.3-codex")!;

    // 2. Crafter.compile -> CraftPlan + ResultItem
    const threadId = "thread-craft-roundtrip-live";
    const craftResult = crafter.compile(
      {
        slots: {
          model: modelItem,
          harness: "auto",
        },
      },
      { workspace: process.cwd(), threadId },
    );

    expect(craftResult.success).toBe(true);
    const plan = craftResult.craftPlan!;
    const resultItem = craftResult.resultItem!;

    expect(plan.id).toContain("plan:recipe:openai-codex-native:");
    expect(plan.runtimeBinding.modelId).toBe("gpt-5.3-codex");

    // 3. Initializing SQLite AppState Driver & ProvenanceStore
    const mockAppState = new Map<string, string>();
    const dbDriver = new AppStateProvenanceDriver(
      (k) => mockAppState.get(k) ?? null,
      (k, v) => {
        mockAppState.set(k, v);
      },
    );
    const provenanceStore = new ProvenanceStore(registry, dbDriver);
    provenanceStore.saveProvenance(threadId, resultItem.provenance);

    // 4. Spawning Entity via CodexHarnessRuntimeAdapter
    let eventListener: ((threadId: string, event: RuntimeEvent) => void) | undefined;
    const mockThreadSessionManager = {
      startThread: async (payload: StartThreadPayload): Promise<StartThreadResult> => ({
        threadId: payload.threadId ?? threadId,
      }),
      sendThreadInput: async (_payload: SendThreadInputPayload): Promise<void> => {
        // Synthetic event source: production evidence must come from craftAgent.
        setTimeout(() => {
          eventListener?.(threadId, {
            type: "content.delta",
            threadId,
            itemId: "item-101",
            stream: "assistant_text",
            delta: "CraftStation Minecraft Composition Model: Hello from GPT-5.3 Codex Entity!",
          });
          eventListener?.(threadId, {
            type: "turn.completed",
            threadId,
            turnId: "turn-101",
            state: "completed",
          });
        }, 50);
      },
      closeThread: async () => {},
    };

    const adapter = new CodexHarnessRuntimeAdapter({
      threadSessionManager: mockThreadSessionManager as any,
      subscribeRuntimeEvents: (listener) => {
        eventListener = listener;
        return () => {
          eventListener = undefined;
        };
      },
    });

    const entity = await adapter.spawnEntity(plan);
    expect(entity.id).toContain("entity:codex:");
    expect(entity.status).toBe("spawned");

    // 5. Creating Session & Sending Prompt
    const session = await adapter.createSession(entity);
    expect(session.id).toContain("sess:codex:");
    expect(entity.status).toBe("running");

    const promptResult = await session.sendPrompt("Hello CraftStation Codex Adapter!");
    expect(promptResult.response).toBe(
      "CraftStation Minecraft Composition Model: Hello from GPT-5.3 Codex Entity!",
    );
    expect(promptResult.events.length).toBe(2);

    // 6. Terminating Session
    await session.terminate();
    expect(session.status).toBe("terminated");

    // 7. Reconstructing & Recovering Session from Saved Provenance
    const { recoveredState, session: recoveredSession } = await provenanceStore.recoverSession(
      threadId,
      adapter,
      { workspace: process.cwd(), sessionRef: "rollout-saved-101" },
    );
    expect(recoveredState.modelId).toBe("gpt-5.3-codex");
    expect(recoveredSession.id).toContain("sess:codex:");

    // This test intentionally has no Feature PASS verdict or repository-side
    // evidence output: all runtime events above are synthetic.
  });
});
