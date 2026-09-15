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
    expect(events.some((event) => event.type === "content.delta" && event.stream === "assistant_text")).toBe(
      false,
    );
  });

  it("does not paint Gemini 503 capacity retries as assistant text or errors", () => {
    const noise =
      "API error (attempt 2) UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server";
    expect(
      agyEvent("step_update", {
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: noise },
      }),
    ).toEqual([]);
    expect(agyEvent("error", { message: noise })).toEqual([]);
  });
});
