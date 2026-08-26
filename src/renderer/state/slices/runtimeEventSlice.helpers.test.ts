// @vitest-environment node

import { describe, expect, it } from "vitest";
import { getRuntimeItemPayload, type RuntimeChatItem } from "./runtimeEventSlice";

/**
 * The chat-part components rely on `getRuntimeItemPayload` returning
 * `undefined` for the wrong canonical type — that's the contract that lets
 * them skip the cast. Pin it so a refactor that "simplifies" the helper
 * back to a raw cast is caught.
 */
describe("getRuntimeItemPayload", () => {
  function makeItem(type: RuntimeChatItem["type"], payload: unknown): RuntimeChatItem {
    return { id: "i1", type, state: "started", payload, streams: {} };
  }

  it("returns the payload when the canonical type matches", () => {
    const item = makeItem("command_execution", { command: "ls", status: "running" });
    expect(getRuntimeItemPayload<{ command: string }>(item, "command_execution")).toEqual({
      command: "ls",
      status: "running",
    });
  });

  it("returns undefined when the type does not match", () => {
    const item = makeItem("command_execution", { command: "ls" });
    expect(getRuntimeItemPayload(item, "assistant_message")).toBeUndefined();
  });

  it("preserves `undefined` payloads unchanged", () => {
    const item = makeItem("user_message", undefined);
    expect(getRuntimeItemPayload(item, "user_message")).toBeUndefined();
  });
});
