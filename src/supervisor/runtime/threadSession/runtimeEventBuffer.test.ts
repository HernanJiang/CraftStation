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
});
