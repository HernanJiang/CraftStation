import { describe, expect, it } from "vitest";
import {
  Crafter,
  getDefaultRegistry,
  BUILTIN_MODEL_ITEMS,
  AppStateProvenanceDriver,
  ProvenanceStore,
} from "./index";
import type {
  CraftPlan,
  CraftSession,
  Entity,
  HarnessRuntimeAdapter,
} from "./index";
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

    // 4. Spawning Entity via an inline stub of the adapter seam. (The legacy
    // CodexHarnessRuntimeAdapter over ThreadSessionManager was deleted: the
    // production Codex path is the Supervisor-owned native app-server
    // adapter. This test keeps proving the seam shape with a local stub.)
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

    const adapter: HarnessRuntimeAdapter = {
      id: "stub-codex-seam",
      harnessKind: "codex",
      supports: () => true,
      spawnEntity: async (entityPlan: CraftPlan): Promise<Entity> => ({
        id: `entity:codex:${entityPlan.id}`,
        resultItemId: entityPlan.resultItemId,
        craftPlan: entityPlan,
        status: "spawned",
        createdAt: new Date(0).toISOString(),
      }),
      createSession: async (entity: Entity): Promise<CraftSession> => {
        await mockThreadSessionManager.startThread({
          threadId,
          projectLocation: { kind: "posix", path: entity.craftPlan.workspace ?? process.cwd() },
          agentKind: "codex",
          config: { model: entity.craftPlan.runtimeBinding.modelId },
          prompt: "",
          initialSize: { cols: 100, rows: 30 },
        });
        entity.status = "running";
        let status: CraftSession["status"] = "active";
        const listeners = new Set<(event: RuntimeEvent) => void>();
        eventListener = (eventThreadId, event) => {
          if (eventThreadId === threadId) {
            for (const listener of listeners) listener(event);
          }
        };
        return {
          id: `sess:codex:${threadId}`,
          entityId: entity.id,
          get status() {
            return status;
          },
          startTurn: async () => ({ turnId: "turn-101", status: "completed", events: [] }),
          interrupt: async () => undefined,
          terminate: async () => {
            status = "terminated";
            eventListener = undefined;
          },
          getSnapshot: () => ({
            sessionId: `sess:codex:${threadId}`,
            entityId: entity.id,
            status,
            events: [],
          }),          subscribe: (listener) => {
            const wrapped = (event: RuntimeEvent) =>
              listener(event, {
                sessionId: `sess:codex:${threadId}`,
                entityId: entity.id,
                status,
                events: [],
              });
            listeners.add(wrapped);
            return () => {
              listeners.delete(wrapped);
            };
          },
          sendPrompt: async (prompt: string, onEvent) => {
            await mockThreadSessionManager.sendThreadInput({
              threadId,
              prompt,
              config: { model: entity.craftPlan.runtimeBinding.modelId },
            });
            return await new Promise((resolve) => {
              const events: RuntimeEvent[] = [];
              const wrapped = (event: RuntimeEvent) => {
                events.push(event);
                onEvent?.(event);
                if (event.type === "turn.completed") {
                  listeners.delete(wrapped);
                  resolve({ response: events.map((entry) => ("delta" in entry ? (entry.delta as string) : "")).join(""), events });
                }
              };
              listeners.add(wrapped);
            });
          },
        };
      },
      resumeSession: async (entity: Entity, sessionRef: string): Promise<CraftSession> =>
        adapter.createSession({ ...entity, id: `${entity.id}:resumed:${sessionRef}` }),
    };

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
