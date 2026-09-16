import { describe, expect, it } from "vitest";
import { canonicalizeNativeEvent } from "./nativeEventCanonicalizer";
import { ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR } from "./descriptors";

function agyEvent(type: string, payload: Record<string, unknown>, sequence = 1) {
  return canonicalizeNativeEvent({
    descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
    threadId: "t1",
    turnId: "turn-1",
    correlationId: "c1",
    event: { type, payload, sequence },
  });
}

describe("canonicalizeNativeEvent Antigravity thinking and retry noise", () => {
  it("maps thinking_delta on agent_response onto a reasoning item", () => {
    const events = agyEvent("step_update", {
      step_update: {
        conversation_id: "agy-1",
        step_index: 3,
        step_type: "agent_response",
        state: "ACTIVE",
        thinking_delta: "consider the file layout",
        text_delta: "I will read README.md",
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.started",
          itemId: "thought:agy-1:3",
          itemType: "reasoning",
        }),
        expect.objectContaining({
          type: "content.delta",
          itemId: "thought:agy-1:3",
          stream: "reasoning_text",
          delta: "consider the file layout",
        }),
        expect.objectContaining({
          type: "content.delta",
          stream: "assistant_text",
          delta: "I will read README.md",
        }),
      ]),
    );
  });

  it("maps a dedicated thinking step onto reasoning_text", () => {
    const events = agyEvent("step_update", {
      step_update: {
        conversation_id: "agy-1",
        step_index: 2,
        step_type: "thinking",
        state: "ACTIVE",
        text_delta: "internal plan",
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "content.delta",
          itemId: "thought:agy-1:2",
          stream: "reasoning_text",
          delta: "internal plan",
        }),
      ]),
    );
    expect(
      events.some((event) => event.type === "content.delta" && event.stream === "assistant_text"),
    ).toBe(false);
  });

  it("does not paint Gemini 503 capacity retries as assistant text or errors", () => {
    const noise =
      "API error (attempt 2) UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server";
    const attempt1 =
      "API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server";
    expect(
      agyEvent("step_update", {
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: noise },
      }),
    ).toEqual([]);
    expect(agyEvent("error", { message: noise })).toEqual([]);
    expect(agyEvent("error", { message: attempt1 })).toEqual([]);
    expect(
      agyEvent("assistant/chunk", {
        chunk: { type: "text-delta", text: attempt1 },
      }),
    ).toEqual([]);
  });

  it("does not paint Gemini async-task receipts as assistant text", () => {
    const dump = `Wait for background browser audit execution to complete.Task id "task-135" finished with result:

The command exited with code 0.
Output:
Launching Chrome...
Log: file:///tmp/task-135.log
<system_information>
An async task has completed. Review the task result and proceed accordingly.
</system_information>`;
    expect(
      agyEvent("step_update", {
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: dump },
      }),
    ).toEqual([]);
    expect(
      agyEvent("step_update", {
        step_update: {
          step_type: "agent_response",
          state: "DONE",
          text_delta: "",
          response: `修复图表高度。\n\n${dump}`,
        },
      }).some((event) => event.type === "content.delta"),
    ).toBe(false);
  });

  it("completes a thinking step so wrap-up does not leave Thinking expanded", () => {
    const events = agyEvent("step_update", {
      step_update: {
        conversation_id: "agy-1",
        step_index: 2,
        step_type: "thinking",
        state: "DONE",
        text_delta: "internal plan",
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "content.delta",
          itemId: "thought:agy-1:2",
          stream: "reasoning_text",
          delta: "internal plan",
        }),
        expect.objectContaining({ type: "item.completed", itemId: "thought:agy-1:2" }),
      ]),
    );
  });
});
