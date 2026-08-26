import { describe, expect, it, vi } from "vitest";
import { Crafter } from "@/shared/crafting/crafter";
import { BUILTIN_MODEL_ITEMS } from "@/shared/crafting/registry";
import { CodexHarnessRuntimeAdapter } from "./codexRuntimeAdapter";
import type { ThreadSessionManager } from "./threadSessionManager";
import type {
  CloseThreadPayload,
  RuntimeEvent,
  SendThreadInputPayload,
  StartThreadPayload,
  StartThreadResult,
} from "@/shared/contracts";

describe("CodexHarnessRuntimeAdapter", () => {
  it("spawns Entity and creates session via ThreadSessionManager with real event bus", async () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const craftResult = crafter.compile({
      slots: {
        model: gptModel,
        harness: "auto",
      },
    }, { workspace: "D:\\test\\repo", threadId: "thread-fixed-1" });

    expect(craftResult.success).toBe(true);
    const plan = craftResult.craftPlan!;

    const startThreadMock = vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>().mockResolvedValue({ threadId: "thread-fixed-1" });
    const sendThreadInputMock = vi.fn<(payload: SendThreadInputPayload) => Promise<void>>().mockResolvedValue(undefined);
    const closeThreadMock = vi.fn<(payload: CloseThreadPayload) => Promise<void>>().mockResolvedValue(undefined);

    const mockManager = {
      startThread: startThreadMock,
      sendThreadInput: sendThreadInputMock,
      closeThread: closeThreadMock,
    } as unknown as ThreadSessionManager;

    let eventListener: ((threadId: string, event: RuntimeEvent) => void) | undefined;
    const subscribeMock = vi.fn<(listener: (threadId: string, event: RuntimeEvent) => void) => () => void>((listener) => {
      eventListener = listener;
      return () => {
        eventListener = undefined;
      };
    });

    const adapter = new CodexHarnessRuntimeAdapter({
      threadSessionManager: mockManager,
      subscribeRuntimeEvents: subscribeMock,
    });

    expect(adapter.supports(plan)).toBe(true);

    const entity = await adapter.spawnEntity(plan);
    expect(entity.id).toContain("entity:codex:");
    expect(entity.resultItemId).toBe(plan.resultItemId);
    expect(entity.status).toBe("spawned");

    const session = await adapter.createSession(entity);
    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKind: "codex",
        config: expect.objectContaining({ model: "gpt-5.3-codex" }),
        presentationMode: "gui",
      }),
    );
    expect(session.id).toContain("sess:codex:");
    expect(entity.status).toBe("running");

    // Send prompt and simulate real event streaming from supervisor
    const promptPromise = session.sendPrompt("test prompt", undefined, 5000);

    // Simulate event streaming on the bus for the exact threadId
    const activeThreadId = entity.craftPlan.threadId!;
    expect(eventListener).toBeDefined();
    eventListener?.(activeThreadId, {
      type: "content.delta",
      threadId: activeThreadId,
      itemId: "item-1",
      stream: "assistant_text",
      delta: "Hello from ",
    });
    eventListener?.(activeThreadId, {
      type: "content.delta",
      threadId: activeThreadId,
      itemId: "item-1",
      stream: "assistant_text",
      delta: "Codex Runtime!",
    });
    eventListener?.(activeThreadId, {
      type: "turn.completed",
      threadId: activeThreadId,
      turnId: "turn-1",
      state: "completed",
    });

    const result = await promptPromise;
    expect(result.response).toBe("Hello from Codex Runtime!");
    expect(result.events.length).toBe(3);
    expect(session.status).toBe("idle");

    await session.terminate();
    expect(closeThreadMock).toHaveBeenCalled();
    expect(session.status).toBe("terminated");
  });

  it("fails sendPrompt when no event bus subscription is provided", async () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;
    const plan = crafter.compile({ slots: { model: gptModel, harness: "auto" } }).craftPlan!;

    const mockManager = {
      startThread: vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>().mockResolvedValue({ threadId: "thread-no-bus" }),
      sendThreadInput: vi.fn<(payload: SendThreadInputPayload) => Promise<void>>(),
      closeThread: vi.fn<(payload: CloseThreadPayload) => Promise<void>>(),
    } as unknown as ThreadSessionManager;

    const adapter = new CodexHarnessRuntimeAdapter({
      threadSessionManager: mockManager,
    });

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);

    await expect(session.sendPrompt("test")).rejects.toThrow("No runtime event bus connected");
  });

  it("rejects sendPrompt when turn completes with failure status", async () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;
    const plan = crafter.compile({ slots: { model: gptModel, harness: "auto" } }, { threadId: "thread-fail-1" }).craftPlan!;

    const mockManager = {
      startThread: vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>().mockResolvedValue({ threadId: "thread-fail-1" }),
      sendThreadInput: vi.fn<(payload: SendThreadInputPayload) => Promise<void>>().mockResolvedValue(undefined),
      closeThread: vi.fn<(payload: CloseThreadPayload) => Promise<void>>(),
    } as unknown as ThreadSessionManager;

    let eventListener: ((threadId: string, event: RuntimeEvent) => void) | undefined;
    const adapter = new CodexHarnessRuntimeAdapter({
      threadSessionManager: mockManager,
      subscribeRuntimeEvents: (listener) => {
        eventListener = listener;
        return () => {};
      },
    });

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);

    const promptPromise = session.sendPrompt("test", undefined, 5000);
    eventListener?.("thread-fail-1", {
      type: "turn.completed",
      threadId: "thread-fail-1",
      turnId: "turn-fail-1",
      state: "failed",
    });

    await expect(promptPromise).rejects.toThrow("Agent turn completed with failure status");
  });

  it("handles session resume with sessionRef", async () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const craftResult = crafter.compile({
      slots: {
        model: gptModel,
        harness: "auto",
      },
    });

    const plan = craftResult.craftPlan!;
    const startThreadMock = vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>().mockResolvedValue({ threadId: "thread-resume-1" });

    const mockManager = {
      startThread: startThreadMock,
      sendThreadInput: vi.fn<(payload: SendThreadInputPayload) => Promise<void>>(),
      closeThread: vi.fn<(payload: CloseThreadPayload) => Promise<void>>(),
    } as unknown as ThreadSessionManager;

    const adapter = new CodexHarnessRuntimeAdapter({
      threadSessionManager: mockManager,
      subscribeRuntimeEvents: () => () => {},
    });

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.resumeSession(entity, "session-rollout-ref-999");

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionRef: expect.objectContaining({ providerSessionId: "session-rollout-ref-999" }),
      }),
    );
    expect(session.sessionRef).toBe("session-rollout-ref-999");
  });

  it("propagates authentication and startup errors with correct CraftingError codes", async () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;
    const plan = crafter.compile({ slots: { model: gptModel, harness: "auto" } }).craftPlan!;

    const authMockManager = {
      startThread: vi.fn<(payload: StartThreadPayload) => Promise<StartThreadResult>>().mockRejectedValue(new Error("Unauthorized: login required")),
    } as unknown as ThreadSessionManager;

    const adapter = new CodexHarnessRuntimeAdapter({
      threadSessionManager: authMockManager,
    });

    const entity = await adapter.spawnEntity(plan);
    await expect(adapter.createSession(entity)).rejects.toThrow("Authentication is required");
  });
});
