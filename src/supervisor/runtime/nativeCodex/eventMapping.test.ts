import { describe, expect, it } from "vitest";
import { mapCodexNotificationToRuntimeEvents, type EventMappingContext } from "./eventMapping";

describe("mapCodexNotificationToRuntimeEvents", () => {
  it("synthesizes item.started before the first assistant delta", () => {
    const context: EventMappingContext = {
      threadId: "thread-1",
      activeItemIds: new Set(),
    };
    const events = mapCodexNotificationToRuntimeEvents(
      {
        method: "item/agentMessage/delta",
        params: { itemId: "item-1", delta: "Hello" },
      },
      context,
    );
    expect(events).toEqual([
      {
        type: "item.started",
        threadId: "thread-1",
        itemId: "item-1",
        itemType: "assistant_message",
      },
      {
        type: "content.delta",
        threadId: "thread-1",
        itemId: "item-1",
        stream: "assistant_text",
        delta: "Hello",
      },
    ]);
    const second = mapCodexNotificationToRuntimeEvents(
      {
        method: "item/agentMessage/delta",
        params: { itemId: "item-1", delta: " world" },
      },
      context,
    );
    expect(second).toEqual([
      {
        type: "content.delta",
        threadId: "thread-1",
        itemId: "item-1",
        stream: "assistant_text",
        delta: " world",
      },
    ]);
  });

  it("maps reasoning summary deltas", () => {
    const context: EventMappingContext = {
      threadId: "thread-1",
      activeItemIds: new Set(),
    };
    const events = mapCodexNotificationToRuntimeEvents(
      {
        method: "item/reasoning/summaryTextDelta",
        params: { itemId: "think-1", delta: { text: "planning" } },
      },
      context,
    );
    expect(events[0]).toMatchObject({ type: "item.started", itemType: "reasoning" });
    expect(events[1]).toMatchObject({
      type: "content.delta",
      stream: "reasoning_text",
      delta: "planning",
    });
  });
});
