import { describe, expect, it } from "vitest";
import type { NativeWireEvent } from "@/supervisor/runtime/nativeHarness/nativeTransport";
import {
  createCommandCodeMapperState,
  mapCommandCodeFrame,
  unwrapCommandCodeFrame,
} from "./canonicalMapping";

function wire(frame: Record<string, unknown>, sequence = 1): NativeWireEvent {
  const type =
    typeof frame.event === "string"
      ? frame.event
      : typeof frame.type === "string"
        ? frame.type
        : "unknown";
  return { type, payload: frame, sequence };
}

function mapAll(frames: Record<string, unknown>[]) {
  const state = createCommandCodeMapperState();
  const events = frames.flatMap(
    (frame, index) =>
      mapCommandCodeFrame({
        threadId: "thread-cc",
        turnId: "turn-1",
        event: wire(frame, index + 1),
        state,
      }).events,
  );
  return { events, state };
}

describe("unwrapCommandCodeFrame", () => {
  it("unwraps official event frames and leaves the result line intact", () => {
    expect(
      unwrapCommandCodeFrame(wire({ type: "event", event: { type: "text_delta", delta: "hi" } })),
    ).toEqual({ type: "text_delta", payload: { type: "text_delta", delta: "hi" } });
    expect(
      unwrapCommandCodeFrame(
        wire({ type: "result", subtype: "success", finalText: "done", sessionId: "abc" }),
      ),
    ).toMatchObject({ type: "result", payload: { subtype: "success", finalText: "done" } });
  });
});

describe("mapCommandCodeFrame", () => {
  it("maps a streamed assistant turn plus a tool call into canonical events", () => {
    const { events, state } = mapAll([
      { type: "event", event: { type: "run_start", sessionId: "sess-1" } },
      { type: "event", event: { type: "thinking_start" } },
      { type: "event", event: { type: "thinking_delta", delta: "plan" } },
      { type: "event", event: { type: "thinking_end", text: "plan" } },
      {
        type: "event",
        event: {
          type: "tool_queued",
          toolCallId: "t1",
          toolName: "read_file",
          input: { path: "README.md" },
        },
      },
      {
        type: "event",
        event: {
          type: "tool_running",
          toolCallId: "t1",
          toolName: "read_file",
          description: "Read README.md",
        },
      },
      {
        type: "event",
        event: {
          type: "tool_completed",
          toolCallId: "t1",
          toolName: "read_file",
          result: [{ type: "text", text: "file contents" }],
        },
      },
      { type: "event", event: { type: "text_delta", delta: "hello " } },
      { type: "event", event: { type: "text_delta", delta: "world" } },
      {
        type: "result",
        subtype: "success",
        sessionId: "sess-1",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0 },
        durationMs: 12,
        finalText: "hello world",
      },
    ]);

    expect(state.sessionId).toBe("sess-1");
    expect(state.receivedResult).toBe(true);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session.started" }),
        expect.objectContaining({ type: "item.started", itemType: "reasoning" }),
        expect.objectContaining({
          type: "content.delta",
          stream: "reasoning_text",
          delta: "plan",
        }),
        expect.objectContaining({
          type: "item.started",
          itemType: "tool_call",
          payload: expect.objectContaining({
            name: "read_file",
            status: "running",
            args: { path: "README.md" },
          }),
        }),
        expect.objectContaining({
          type: "item.completed",
          payload: expect.objectContaining({
            name: "read_file",
            status: "success",
            result: "file contents",
          }),
        }),
        expect.objectContaining({
          type: "item.started",
          itemType: "assistant_message",
        }),
        expect.objectContaining({
          type: "content.delta",
          stream: "assistant_text",
          delta: "hello ",
        }),
        expect.objectContaining({
          type: "content.delta",
          stream: "assistant_text",
          delta: "world",
        }),
        expect.objectContaining({
          type: "usage.spent",
          usage: expect.objectContaining({ counter: 14, counterKind: "per-call" }),
        }),
        expect.objectContaining({ type: "turn.completed", state: "completed" }),
      ]),
    );
    expect(
      events.filter((event) => event.type === "content.delta" && event.stream === "assistant_text"),
    ).toHaveLength(2);
  });

  it("maps the official rate-limit result line into a failed turn with the friendly error", () => {
    const { events } = mapAll([
      {
        type: "event",
        event: { type: "run_start", sessionId: "2a04eabe-8e60-437b-9666-9a5d6e59eb1f" },
      },
      {
        type: "event",
        event: {
          type: "run_error",
          error: {
            name: "TransportError",
            message: "POST /alpha/generate → 429 error: weekly usage limit",
          },
        },
      },
      {
        type: "result",
        subtype: "error",
        sessionId: "2a04eabe-8e60-437b-9666-9a5d6e59eb1f",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        durationMs: 2213,
        finalText: "",
        error:
          "Error: You've reached your weekly usage limit. Resets in 17h 40m (19:17). Run /upgrade for a higher plan or /extra for on-demand credits.",
      },
    ]);

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          message: expect.stringContaining("weekly usage limit"),
        }),
        expect.objectContaining({ type: "turn.completed", state: "failed" }),
      ]),
    );
    expect(events.filter((event) => event.type === "error")).toHaveLength(1);
  });

  it("appends only the unsstreamed tail of finalText", () => {
    const { events } = mapAll([
      { type: "event", event: { type: "text_delta", delta: "hello " } },
      {
        type: "result",
        subtype: "success",
        sessionId: "sess-2",
        usage: { inputTokens: 1, outputTokens: 2 },
        durationMs: 1,
        finalText: "hello world",
      },
    ]);
    expect(
      events
        .filter(
          (event): event is Extract<(typeof events)[number], { type: "content.delta" }> =>
            event.type === "content.delta" && event.stream === "assistant_text",
        )
        .map((event) => event.delta),
    ).toEqual(["hello ", "world"]);
  });
});
