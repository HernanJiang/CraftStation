import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ChatNavRail } from "./ChatNavRail";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";

function seedThread(
  threadId: string,
  userMessages: Array<{ itemId: string; text: string }>,
  entries: ReadonlyArray<{ kind: "item"; id: string }>,
) {
  const itemsById: Record<string, RuntimeChatItem> = {};
  for (const message of userMessages) {
    itemsById[message.itemId] = {
      id: message.itemId,
      threadId,
      type: "user_message",
      payload: { content: [{ kind: "text", text: message.text }] },
    } as unknown as RuntimeChatItem;
  }
  useAppStore.setState({
    runtimeItemIdsByThread: {
      ...useAppStore.getState().runtimeItemIdsByThread,
      [threadId]: userMessages.map((m) => m.itemId),
    },
    runtimeItemsByIdByThread: {
      ...useAppStore.getState().runtimeItemsByIdByThread,
      [threadId]: itemsById,
    },
  } as never);
  return entries;
}

describe("ChatNavRail", () => {
  const scrollToIndex = vi.fn<() => void>();

  beforeEach(() => {
    scrollToIndex.mockClear();
  });

  it("renders one node per user message and scrolls on click", () => {
    const entries = seedThread(
      "thread-nav",
      [
        { itemId: "user-1", text: "第一段需求说明" },
        { itemId: "user-2", text: "继续修复登录问题" },
        { itemId: "user-3", text: "最后跑一下测试" },
      ],
      [
        { kind: "item", id: "user-1" },
        { kind: "item", id: "assistant-1" },
        { kind: "item", id: "user-2" },
        { kind: "item", id: "assistant-2" },
        { kind: "item", id: "user-3" },
      ].map((e) => e as { kind: "item"; id: string }),
    );

    render(
      <ChatNavRail
        threadId="thread-nav"
        entries={entries as never}
        scrollToIndex={scrollToIndex}
        scrollProgress={0}
      />,
    );

    const nodes = screen.getAllByTestId(/chat-nav-node-/u);
    expect(nodes).toHaveLength(3);

    // The node title carries the prompt summary for the expanded state.
    expect(screen.getByTitle("第一段需求说明")).toBeTruthy();

    fireEvent.click(screen.getByTitle("继续修复登录问题"));
    expect(scrollToIndex).toHaveBeenCalledWith(2, { align: "start" });

    const rail = screen.getByTestId("chat-nav-rail");
    expect(rail.className).toContain("absolute");
    expect(rail.className).toContain("left-0");
    expect(rail.getAttribute("data-expanded")).toBe("true");
  });

  it("marks the current node from scroll progress", () => {
    const entries = seedThread(
      "thread-nav-2",
      [
        { itemId: "u1", text: "prompt one" },
        { itemId: "u2", text: "prompt two" },
      ],
      [
        { kind: "item", id: "u1" },
        { kind: "item", id: "u2" },
      ] as never,
    );

    const { rerender } = render(
      <ChatNavRail
        threadId="thread-nav-2"
        entries={entries as never}
        scrollToIndex={scrollToIndex}
        scrollProgress={1}
      />,
    );
    // Fully scrolled: the last prompt is current.
    expect(screen.getByTestId("chat-nav-node-1").getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("chat-nav-node-0").getAttribute("aria-current")).toBeNull();

    rerender(
      <ChatNavRail
        threadId="thread-nav-2"
        entries={entries as never}
        scrollToIndex={scrollToIndex}
        scrollProgress={0}
      />,
    );
    expect(screen.getByTestId("chat-nav-node-0").getAttribute("aria-current")).toBe("true");
  });

  it("renders nothing for a conversation without user messages", () => {
    const entries = seedThread("thread-nav-3", [], []);
    const { container } = render(
      <ChatNavRail
        threadId="thread-nav-3"
        entries={entries as never}
        scrollToIndex={scrollToIndex}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
