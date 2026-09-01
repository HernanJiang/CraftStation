import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { mapCodexNotificationToRuntimeEvents } from "./eventMapping";
import { NativeCodexSubAgentRouter } from "./subAgentMapping";

describe("Native Codex provider-native subagent mapping", () => {
  it("marks only official spawnAgent collaboration items as subagents", () => {
    const context = { threadId: "parent-thread", activeItemIds: new Set<string>() };
    const spawned = mapCodexNotificationToRuntimeEvents(
      {
        method: "item/started",
        params: {
          threadId: "parent-thread",
          item: {
            id: "collab-1",
            type: "collabAgentToolCall",
            tool: "spawn_agent",
            status: "inProgress",
            receiverThreadIds: ["child-thread"],
            prompt: "Inspect one thing",
            model: "gpt-5.6-sol",
            reasoningEffort: "high",
          },
        },
      },
      context,
    );
    const coordination = mapCodexNotificationToRuntimeEvents(
      {
        method: "item/started",
        params: {
          threadId: "parent-thread",
          item: {
            id: "wait-1",
            type: "collabAgentToolCall",
            tool: "wait",
            status: "inProgress",
            receiverThreadIds: ["child-thread"],
          },
        },
      },
      context,
    );

    expect(spawned[0]).toMatchObject({
      type: "item.started",
      itemId: "collab-1",
      itemType: "tool_call",
      payload: {
        name: "spawn_agent",
        isSubAgent: true,
        args: {
          description: "Inspect one thing",
          receiverThreadIds: ["child-thread"],
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
        },
      },
    });
    expect(coordination[0]).toMatchObject({
      type: "item.started",
      payload: { name: "wait", status: "running" },
    });
    expect((coordination[0] as { payload?: unknown }).payload).not.toHaveProperty("isSubAgent");
  });

  it("routes official child-thread output under its provider-issued parent identity", () => {
    const router = new NativeCodexSubAgentRouter("parent-thread");
    const parentEvents = mapCodexNotificationToRuntimeEvents(
      {
        method: "item/started",
        params: {
          threadId: "parent-thread",
          item: {
            id: "collab-1",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            receiverThreadIds: ["child-thread"],
          },
        },
      },
      { threadId: "parent-thread" },
    );
    router.observeMainEvents(parentEvents, {
      item: {
        id: "collab-1",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        receiverThreadIds: ["child-thread"],
      },
    });

    const childStarted = router.routeChildNotification("item/started", {
      threadId: "child-thread",
      item: { id: "child-message", type: "agentMessage" },
    });
    expect(childStarted).toEqual([
      expect.objectContaining({
        type: "item.started",
        itemId: "child-message",
        itemType: "assistant_message",
        parentItemId: "collab-1",
      }),
    ]);
    expect(childStarted).toHaveLength(1);
    expect(
      router.routeChildNotification("item/agentMessage/delta", {
        threadId: "child-thread",
        itemId: "child-message",
        delta: "native child result",
      }),
    ).toEqual([
      expect.objectContaining({
        type: "content.delta",
        itemId: "child-message",
        delta: "native child result",
      }),
    ]);
    const childCompleted = router.routeChildNotification("turn/completed", {
      threadId: "child-thread",
      turn: { id: "child-turn", status: "completed" },
    });
    expect(childCompleted).toEqual([
      expect.objectContaining({
        type: "item.completed",
        itemId: "collab-1",
        payload: expect.objectContaining({
          isSubAgent: true,
          status: "success",
          result: "native child result",
        }),
      }),
    ]);
    expect(childCompleted).toHaveLength(1);

    const duplicateParentCompletion = router.observeMainEvents(
      [
        {
          type: "item.completed",
          threadId: "parent-thread",
          itemId: "collab-1",
          payload: { status: "success" },
        },
      ],
      {
        item: {
          id: "collab-1",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "completed",
        },
      },
    );
    expect(duplicateParentCompletion).toEqual([]);
    expect(
      router.routeChildNotification("turn/completed", {
        threadId: "child-thread",
        turn: { id: "child-turn", status: "completed" },
      }),
    ).toEqual([]);
  });

  it("defers an official parent completion while its child thread is active", () => {
    const router = new NativeCodexSubAgentRouter("parent-thread");
    const parentStarted: RuntimeEvent[] = [
      {
        type: "item.started",
        threadId: "parent-thread",
        itemId: "collab-active",
        itemType: "tool_call",
        payload: { name: "spawnAgent", status: "running", isSubAgent: true },
      },
    ];
    router.observeMainEvents(parentStarted, {
      item: {
        id: "collab-active",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        receiverThreadIds: ["child-active"],
      },
    });

    const events = router.observeMainEvents(
      [
        {
          type: "item.completed",
          threadId: "parent-thread",
          itemId: "collab-active",
          payload: { status: "success" },
        },
      ],
      {
        item: {
          id: "collab-active",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "completed",
        },
      },
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: "item.updated",
        itemId: "collab-active",
        payload: expect.objectContaining({ isSubAgent: true, status: "running" }),
      }),
    ]);
  });

  it("finishes the provider parent exactly once from official wait state", () => {
    const router = new NativeCodexSubAgentRouter("parent-thread");
    router.observeMainEvents(
      [
        {
          type: "item.started",
          threadId: "parent-thread",
          itemId: "collab-parent",
          itemType: "tool_call",
          payload: { name: "spawn_agent", status: "running", isSubAgent: true },
        },
      ],
      {
        item: {
          id: "collab-parent",
          type: "collabAgentToolCall",
          tool: "spawn_agent",
        },
      },
    );

    const spawnCompleted = router.observeMainEvents(
      [
        {
          type: "item.completed",
          threadId: "parent-thread",
          itemId: "collab-parent",
        },
      ],
      {
        item: {
          id: "collab-parent",
          type: "collabAgentToolCall",
          tool: "spawn_agent",
          receiverThreadIds: ["official-child"],
          agentsStates: { "official-child": "pending_init" },
        },
      },
    );
    expect(spawnCompleted).toEqual([
      expect.objectContaining({
        type: "item.updated",
        itemId: "collab-parent",
        payload: expect.objectContaining({
          isSubAgent: true,
          args: { receiverThreadIds: ["official-child"] },
        }),
      }),
    ]);

    const waitCompleted = router.observeMainEvents(
      [
        {
          type: "item.completed",
          threadId: "parent-thread",
          itemId: "wait-call",
        },
      ],
      {
        item: {
          id: "wait-call",
          type: "collabAgentToolCall",
          tool: "wait",
          receiverThreadIds: ["official-child"],
          agentsStates: {
            "official-child": { completed: "provider child result" },
          },
        },
      },
    );
    expect(waitCompleted).toEqual([
      expect.objectContaining({ type: "item.completed", itemId: "wait-call" }),
      expect.objectContaining({
        type: "item.completed",
        itemId: "collab-parent",
        payload: expect.objectContaining({
          isSubAgent: true,
          status: "success",
          result: "provider child result",
          args: { receiverThreadIds: ["official-child"] },
        }),
      }),
    ]);

    expect(
      router.observeMainEvents(
        [
          {
            type: "item.completed",
            threadId: "parent-thread",
            itemId: "wait-call-duplicate",
          },
        ],
        {
          item: {
            id: "wait-call-duplicate",
            type: "collabAgentToolCall",
            tool: "wait",
            receiverThreadIds: ["official-child"],
            agentsStates: {
              "official-child": { completed: "provider child result" },
            },
          },
        },
      ),
    ).toEqual([expect.objectContaining({ type: "item.completed", itemId: "wait-call-duplicate" })]);
  });

  it("does not leak unrelated app-server thread events into the parent session", () => {
    const router = new NativeCodexSubAgentRouter("parent-thread");
    const routed = router.routeChildNotification("item/started", {
      threadId: "unrelated-thread",
      item: { id: "foreign-message", type: "agentMessage" },
    });
    expect(routed).toEqual([]);
  });

  it("creates identity from official subAgentActivity without inventing a child", () => {
    const router = new NativeCodexSubAgentRouter("parent-thread");
    const sourceEvents: RuntimeEvent[] = [
      {
        type: "item.completed",
        threadId: "parent-thread",
        itemId: "activity-1",
      },
    ];
    const events = router.observeMainEvents(sourceEvents, {
      item: {
        id: "activity-1",
        type: "subAgentActivity",
        kind: "started",
        agentThreadId: "official-child-thread",
        agentPath: "review/protocol_guard",
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "item.started",
        itemId: "activity-1",
        itemType: "tool_call",
        payload: expect.objectContaining({
          name: "spawnAgent",
          isSubAgent: true,
          args: {
            description: "protocol guard",
            receiverThreadIds: ["official-child-thread"],
          },
        }),
      }),
    ]);
  });
});
