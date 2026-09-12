import { describe, expect, it } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { selectLastUserMessageId, turnRangeHasError } from "./chatPaneSelectors";

function seedItems(threadId: string, items: RuntimeChatItem[]) {
  useAppStore.setState({
    runtimeItemIdsByThread: { [threadId]: items.map((entry) => entry.id) },
    runtimeItemsByIdByThread: {
      [threadId]: Object.fromEntries(items.map((entry) => [entry.id, entry])),
    },
  } as never);
}

function makeItem(id: string, type: RuntimeChatItem["type"]): RuntimeChatItem {
  return { id, type, state: "completed", payload: {}, streams: {} } as RuntimeChatItem;
}

describe("selectLastUserMessageId", () => {
  it("returns the newest user message id", () => {
    seedItems("t-last-user", [makeItem("u1", "user_message"), makeItem("a1", "assistant_message")]);
    expect(selectLastUserMessageId(useAppStore.getState(), "t-last-user")).toBe("u1");
  });

  it("returns null without user messages", () => {
    seedItems("t-no-user", [makeItem("a1", "assistant_message")]);
    expect(selectLastUserMessageId(useAppStore.getState(), "t-no-user")).toBeNull();
  });
});

describe("turnRangeHasError", () => {
  it("finds error items appended right after the anchor", () => {
    seedItems("t-trailing-error", [
      makeItem("user-1", "user_message"),
      makeItem("asst-1", "assistant_message"),
      makeItem("err-1", "error"),
    ]);
    expect(turnRangeHasError(useAppStore.getState(), "t-trailing-error", "user-1", "asst-1")).toBe(
      true,
    );
  });

  it("ignores errors from later turns", () => {
    seedItems("t-later-error", [
      makeItem("user-1", "user_message"),
      makeItem("asst-1", "assistant_message"),
      makeItem("user-2", "user_message"),
      makeItem("err-2", "error"),
    ]);
    expect(turnRangeHasError(useAppStore.getState(), "t-later-error", "user-1", "asst-1")).toBe(
      false,
    );
    expect(turnRangeHasError(useAppStore.getState(), "t-later-error", "user-2", "asst-1")).toBe(
      false,
    );
  });

  it("returns false for clean ranges and unknown ids", () => {
    seedItems("t-clean", [
      makeItem("user-1", "user_message"),
      makeItem("asst-1", "assistant_message"),
    ]);
    const state = useAppStore.getState();
    expect(turnRangeHasError(state, "t-clean", "user-1", "asst-1")).toBe(false);
    expect(turnRangeHasError(state, "t-clean", "missing", "asst-1")).toBe(false);
  });
});
