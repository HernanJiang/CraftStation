import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@/shared/contracts";
import { MAX_RUNTIME_OUTPUT_CHARS, RUNTIME_OUTPUT_TRUNCATION_MARKER } from "@/shared/runtimeStream";
import type { SupervisorEvent } from "@/shared/ipc";
import { RuntimeEventBuffer } from "./runtimeEventBuffer";

describe("RuntimeEventBuffer", () => {
  it("coalesces adjacent command output deltas before publishing", () => {
    const published: SupervisorEvent[] = [];
    const buffer = new RuntimeEventBuffer((event) => published.push(event));
    const append = (event: RuntimeEvent) => buffer.append("thread-1", event);

    append({
      type: "item.started",
      threadId: "thread-1",
      itemId: "command-1",
      itemType: "command_execution",
    });
    append({
      type: "content.delta",
      threadId: "thread-1",
      itemId: "command-1",
      stream: "command_output",
      delta: "one",
    });
    append({
      type: "content.delta",
      threadId: "thread-1",
      itemId: "command-1",
      stream: "command_output",
      delta: " two",
    });
    buffer.flush();

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "thread-runtime-events",
      threadId: "thread-1",
      events: [{ type: "item.started" }, { type: "content.delta", delta: "one two" }],
    });
  });

  it("stamps emission time on deltas and keeps the latest stamp when coalescing", () => {
    const published: SupervisorEvent[] = [];
    const buffer = new RuntimeEventBuffer((event) => published.push(event));

    buffer.append("thread-1", {
      type: "content.delta",
      threadId: "thread-1",
      itemId: "msg-1",
      stream: "assistant_text",
      delta: "a",
      at: 1_000,
    });
    buffer.append("thread-1", {
      type: "content.delta",
      threadId: "thread-1",
      itemId: "msg-1",
      stream: "assistant_text",
      delta: "b",
      at: 1_400,
    });
    buffer.flush();

    const merged = published[0]?.type === "thread-runtime-event" ? published[0].event : undefined;
    expect(merged).toMatchObject({ type: "content.delta", delta: "ab", at: 1_400 });
  });

  it("stamps Date.now() when the producer did not provide one", () => {
    const published: SupervisorEvent[] = [];
    const buffer = new RuntimeEventBuffer((event) => published.push(event));
    const before = Date.now();
    buffer.append("thread-1", {
      type: "content.delta",
      threadId: "thread-1",
      itemId: "msg-1",
      stream: "assistant_text",
      delta: "a",
    });
    buffer.flush();

    const merged = published[0]?.type === "thread-runtime-event" ? published[0].event : undefined;
    if (merged?.type !== "content.delta") {
      throw new Error("expected a single content.delta event");
    }
    expect(merged.at).toBeGreaterThanOrEqual(before);
  });

  it("bounds a single oversized output delta before it reaches IPC", () => {
    const published: SupervisorEvent[] = [];
    const buffer = new RuntimeEventBuffer((event) => published.push(event));
    buffer.append("thread-1", {
      type: "content.delta",
      threadId: "thread-1",
      itemId: "command-1",
      stream: "command_output",
      delta: "x".repeat(MAX_RUNTIME_OUTPUT_CHARS + 1),
    });
    buffer.flush();

    const event = published[0];
    const output =
      event?.type === "thread-runtime-event"
        ? event.event.type === "content.delta"
          ? event.event.delta
          : undefined
        : event?.type === "thread-runtime-events" && event.events[0]?.type === "content.delta"
          ? event.events[0].delta
          : undefined;
    expect(output).toHaveLength(MAX_RUNTIME_OUTPUT_CHARS);
    expect(output?.startsWith(RUNTIME_OUTPUT_TRUNCATION_MARKER)).toBe(true);
  });

  it("a content.set supersedes queued deltas and later deltas append to it", () => {
    const published: SupervisorEvent[] = [];
    const buffer = new RuntimeEventBuffer((event) => published.push(event));

    buffer.append("thread-1", {
      type: "content.delta",
      threadId: "thread-1",
      itemId: "msg-1",
      stream: "assistant_text",
      delta: "stale",
    });
    buffer.append("thread-1", {
      type: "content.delta",
      threadId: "thread-1",
      itemId: "msg-1",
      stream: "assistant_text",
      delta: " regen",
    });
    buffer.append("thread-1", {
      type: "content.set",
      threadId: "thread-1",
      itemId: "msg-1",
      stream: "assistant_text",
      text: "authoritative",
    });
    buffer.append("thread-1", {
      type: "content.delta",
      threadId: "thread-1",
      itemId: "msg-1",
      stream: "assistant_text",
      delta: " tail",
    });
    buffer.flush();

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "thread-runtime-event",
      threadId: "thread-1",
      event: { type: "content.set", text: "authoritative tail" },
    });
  });
});
