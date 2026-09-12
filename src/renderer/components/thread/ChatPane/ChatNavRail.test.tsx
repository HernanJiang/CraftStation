import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ChatNavRail, tickWidthClassByDistance } from "./ChatNavRail";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";

function userItem(threadId: string, itemId: string, text: string): RuntimeChatItem {
  return {
    id: itemId,
    threadId,
    type: "user_message",
    state: "completed",
    payload: { content: [{ kind: "text", text }] },
    streams: {},
  } as unknown as RuntimeChatItem;
}

function assistantItem(
  threadId: string,
  itemId: string,
  text: string,
  state: RuntimeChatItem["state"] = "completed",
): RuntimeChatItem {
  return {
    id: itemId,
    threadId,
    type: "assistant_message",
    state,
    payload: { content: [{ kind: "text", text }] },
    streams: {},
  } as unknown as RuntimeChatItem;
}

function seedItems(threadId: string, items: RuntimeChatItem[], order?: readonly string[]) {
  const itemsById: Record<string, RuntimeChatItem> = {};
  for (const item of items) itemsById[item.id] = item;
  useAppStore.setState({
    runtimeItemIdsByThread: {
      ...useAppStore.getState().runtimeItemIdsByThread,
      [threadId]: order ?? items.map((item) => item.id),
    },
    runtimeItemsByIdByThread: {
      ...useAppStore.getState().runtimeItemsByIdByThread,
      [threadId]: itemsById,
    },
  } as never);
}

function entriesFor(ids: readonly string[]) {
  return ids.map((id) => ({ kind: "item", id }) as { kind: "item"; id: string });
}

describe("ChatNavRail", () => {
  const scrollToIndex = vi.fn<() => void>();

  beforeEach(() => {
    scrollToIndex.mockClear();
  });

  it("renders one node per user message and scrolls on click", () => {
    seedItems("thread-nav", [
      userItem("thread-nav", "user-1", "第一段需求说明"),
      userItem("thread-nav", "user-2", "继续修复登录问题"),
      userItem("thread-nav", "user-3", "最后跑一下测试"),
    ]);
    const entries = entriesFor(["user-1", "assistant-1", "user-2", "assistant-2", "user-3"]);

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
    // Clicking a node pops its preview card instead of expanding a sidebar.
    expect(screen.getByTestId("chat-nav-card")).toHaveTextContent("继续修复登录问题");
  });

  it("marks the current node from scroll progress", () => {
    seedItems("thread-nav-2", [
      userItem("thread-nav-2", "u1", "prompt one"),
      userItem("thread-nav-2", "u2", "prompt two"),
    ]);
    const entries = entriesFor(["u1", "u2"]);

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
    seedItems("thread-nav-3", []);
    const { container } = render(
      <ChatNavRail threadId="thread-nav-3" entries={[]} scrollToIndex={scrollToIndex} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("stays a narrow grey tick column at rest — no wide sidebar, no accent wash", () => {
    seedItems("thread-nav-4", [
      userItem("thread-nav-4", "u1", "prompt one"),
      userItem("thread-nav-4", "u2", "prompt two"),
    ]);

    const { container } = render(
      <ChatNavRail
        threadId="thread-nav-4"
        entries={entriesFor(["u1", "u2"]) as never}
        scrollToIndex={scrollToIndex}
        scrollProgress={0}
      />,
    );

    const rail = screen.getByTestId("chat-nav-rail");
    expect(rail.className).toContain("w-10");
    expect(rail.className).not.toContain("w-52");
    expect(screen.queryByTestId("chat-nav-card")).toBeNull();
    // Restrained greys only — never the theme accent fill.
    expect(container.innerHTML).not.toContain("bg-accent");
    expect(container.innerHTML).not.toContain("text-accent");
    for (const node of screen.getAllByTestId(/chat-nav-node-/u)) {
      expect(node.querySelector("span")?.className).toContain("w-1.5");
    }
  });

  it("elongates only the hovered tick with stair-step falloff and a preview card", () => {
    const threadId = "thread-nav-5";
    seedItems(
      threadId,
      [
        userItem(threadId, "u1", "first prompt"),
        assistantItem(threadId, "a1", "first reply summary text"),
        userItem(threadId, "u2", "second prompt"),
        assistantItem(threadId, "a2", "second reply summary text"),
        userItem(threadId, "u3", "third prompt"),
        assistantItem(threadId, "a3", "third reply summary text"),
        userItem(threadId, "u4", "fourth prompt"),
        assistantItem(threadId, "a4", "fourth reply summary text"),
        userItem(threadId, "u5", "fifth prompt"),
        assistantItem(threadId, "a5", "fifth reply summary text"),
      ],
      ["u1", "a1", "u2", "a2", "u3", "a3", "u4", "a4", "u5", "a5"],
    );

    render(
      <ChatNavRail
        threadId={threadId}
        entries={entriesFor(["u1", "a1", "u2", "a2", "u3", "a3", "u4", "a4", "u5", "a5"]) as never}
        scrollToIndex={scrollToIndex}
        scrollProgress={0}
      />,
    );

    fireEvent.mouseEnter(screen.getByTestId("chat-nav-node-2"));

    const widths = [0, 1, 2, 3, 4].map(
      (index) => screen.getByTestId(`chat-nav-node-${index}`).querySelector("span")?.className,
    );
    expect(widths[2]).toContain("w-8");
    expect(widths[1]).toContain("w-5");
    expect(widths[3]).toContain("w-5");
    expect(widths[0]).toContain("w-3");
    expect(widths[4]).toContain("w-3");

    const card = screen.getByTestId("chat-nav-card");
    expect(card).toHaveTextContent("third prompt");
    expect(card).toHaveTextContent("third reply summary text");
    expect(card).toHaveTextContent("3/5");

    // The card follows the focused node.
    fireEvent.mouseEnter(screen.getByTestId("chat-nav-node-4"));
    expect(screen.getByTestId("chat-nav-card")).toHaveTextContent("fifth prompt");

    // Leaving the rail collapses back to bare ticks.
    fireEvent.mouseLeave(screen.getByTestId("chat-nav-rail"));
    expect(screen.queryByTestId("chat-nav-card")).toBeNull();
  });

  it("defines the stair-step widths as longest → shorter → short → base", () => {
    expect(tickWidthClassByDistance(0)).toBe("w-8");
    expect(tickWidthClassByDistance(1)).toBe("w-5");
    expect(tickWidthClassByDistance(2)).toBe("w-3");
    expect(tickWidthClassByDistance(3)).toBe("w-1.5");
    expect(tickWidthClassByDistance(99)).toBe("w-1.5");
  });

  it("shows the assistant reply preview only, truncated", () => {
    const threadId = "thread-nav-6";
    const longReply = `r${"eply ".repeat(60)}`;
    seedItems(
      threadId,
      [userItem(threadId, "u1", "prompt here"), assistantItem(threadId, "a1", longReply)],
      ["u1", "a1"],
    );

    render(
      <ChatNavRail
        threadId={threadId}
        entries={entriesFor(["u1", "a1"]) as never}
        scrollToIndex={scrollToIndex}
        scrollProgress={0}
      />,
    );

    fireEvent.mouseEnter(screen.getByTestId("chat-nav-node-0"));
    const card = screen.getByTestId("chat-nav-card");
    expect(card).toHaveTextContent("prompt here");
    // Full long text is clipped to a short preview, not rendered in full.
    expect(card.textContent!.length).toBeLessThan(longReply.length);
    expect(within(card).getByText(/Done|Working/u)).toBeTruthy();
  });
});
