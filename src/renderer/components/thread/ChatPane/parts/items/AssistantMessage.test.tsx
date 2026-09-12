import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { AssistantMessage } from "./AssistantMessage";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("AssistantMessage", () => {
  it("renders embedded image content blocks inline alongside text", () => {
    const item: RuntimeChatItem = {
      id: "asst_1",
      type: "assistant_message",
      state: "completed",
      payload: {
        content: [
          { kind: "text", text: "Here is your image:" },
          {
            kind: "image",
            mimeType: "image/png",
            dataUrl: `data:image/png;base64,${PNG_BASE64}`,
            name: "result",
          },
        ],
      },
      streams: {},
    };

    render(
      <AppProvider>
        <AssistantMessage threadId="thread-1" item={item} isTurnActive={false} />
      </AppProvider>,
    );

    const img = screen.getByAltText("result") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(`data:image/png;base64,${PNG_BASE64}`);
    expect(screen.getByText("Here is your image:")).toBeTruthy();
  });

  it("ignores non-image content blocks", () => {
    const item: RuntimeChatItem = {
      id: "asst_2",
      type: "assistant_message",
      state: "completed",
      payload: { content: [{ kind: "text", text: "Just text." }] },
      streams: {},
    };

    render(
      <AppProvider>
        <AssistantMessage threadId="thread-1" item={item} isTurnActive={false} />
      </AppProvider>,
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Just text.")).toBeTruthy();
  });

  describe("copy action gating", () => {
    const answer: RuntimeChatItem = {
      id: "asst_answer",
      type: "assistant_message",
      state: "completed",
      payload: { content: [{ kind: "text", text: "All done." }] },
      streams: {},
    };

    function seed(items: RuntimeChatItem[]) {
      useAppStore.setState({
        runtimeItemIdsByThread: { "thread-1": items.map((entry) => entry.id) },
        runtimeItemsByIdByThread: {
          "thread-1": Object.fromEntries(items.map((entry) => [entry.id, entry])),
        },
      });
    }

    beforeEach(() => {
      useAppStore.setState({ runtimeItemIdsByThread: {}, runtimeItemsByIdByThread: {} });
    });

    it("shows the copy action when the message is the turn's last item", () => {
      seed([answer]);
      render(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={false} />
        </AppProvider>,
      );
      expect(screen.getByLabelText("Copy message")).toBeTruthy();
    });

    it("shows the copy action when the next top-level item is the next user message", () => {
      seed([
        answer,
        { id: "user_2", type: "user_message", state: "completed", payload: {}, streams: {} },
      ]);
      render(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={true} />
        </AppProvider>,
      );
      expect(screen.getByLabelText("Copy message")).toBeTruthy();
    });

    it("hides the copy action when tool calls follow the message in the same turn", () => {
      seed([
        answer,
        { id: "tool_1", type: "tool_call", state: "completed", payload: {}, streams: {} },
      ]);
      render(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={false} />
        </AppProvider>,
      );
      expect(screen.queryByLabelText("Copy message")).toBeNull();
    });

    it("ignores nested sub-agent items when locating the turn's last item", () => {
      seed([
        answer,
        {
          id: "child_1",
          type: "tool_call",
          state: "completed",
          payload: {},
          streams: {},
          parentItemId: "tool_parent",
        },
      ]);
      render(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={false} />
        </AppProvider>,
      );
      expect(screen.getByLabelText("Copy message")).toBeTruthy();
    });

    it("reserves the copy strip without exposing its action while the turn is active", () => {
      seed([answer]);
      const { container, rerender } = render(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={true} />
        </AppProvider>,
      );
      expect(screen.queryByLabelText("Copy message")).toBeNull();
      const reservedStrip = container.querySelector(".craftstation-message-action-strip");
      expect(reservedStrip).not.toBeNull();

      rerender(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={false} />
        </AppProvider>,
      );

      expect(screen.getByLabelText("Copy message")).toBeTruthy();
      expect(container.querySelector(".craftstation-message-action-strip")).toBe(reservedStrip);
    });
  });

  describe("fork and end time", () => {
    const answer: RuntimeChatItem = {
      id: "asst_answer",
      type: "assistant_message",
      state: "completed",
      payload: { content: [{ kind: "text", text: "All done." }] },
      streams: {},
    };
    const endedAt = new Date("2026-05-01T17:14:00.000Z").getTime();

    function seed(items: RuntimeChatItem[]) {
      useAppStore.setState({
        runtimeItemIdsByThread: { "thread-1": items.map((entry) => entry.id) },
        runtimeItemsByIdByThread: {
          "thread-1": Object.fromEntries(items.map((entry) => [entry.id, entry])),
        },
      });
    }

    function seedTurnRecord() {
      useAppStore.getState().hydrateThreadCompletedTurns("thread-1", [
        {
          startedAt: new Date("2026-05-01T17:11:31.000Z").getTime(),
          endedAt,
          anchorItemId: answer.id,
        },
      ]);
    }

    beforeEach(() => {
      useAppStore.setState({
        threads: [],
        runtimeItemIdsByThread: {},
        runtimeItemsByIdByThread: {},
        runtimeCompletedTurnsByThread: {},
      });
    });

    it("shows the fork action and end time on a settled turn's final answer", () => {
      seed([answer]);
      seedTurnRecord();
      render(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={false} />
        </AppProvider>,
      );
      expect(screen.getByLabelText("Fork from this turn")).toBeTruthy();
      const expectedClock = new Date(endedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      expect(screen.getByText(expectedClock)).toBeTruthy();
    });

    it("shows no end time when the turn record is missing", () => {
      seed([answer]);
      render(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={false} />
        </AppProvider>,
      );
      expect(screen.getByLabelText("Copy message")).toBeTruthy();
      expect(screen.getByLabelText("Fork from this turn")).toBeTruthy();
      expect(screen.queryByText(/\d{1,2}:\d{2}/u)).toBeNull();
    });

    it("hides the fork action while the turn is still active", () => {
      seed([answer]);
      seedTurnRecord();
      render(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={true} />
        </AppProvider>,
      );
      expect(screen.queryByLabelText("Fork from this turn")).toBeNull();
    });

    it("hides the fork action for intermediate answers but keeps copy gating", () => {
      seed([
        answer,
        { id: "tool_1", type: "tool_call", state: "completed", payload: {}, streams: {} },
      ]);
      seedTurnRecord();
      render(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={false} />
        </AppProvider>,
      );
      expect(screen.queryByLabelText("Copy message")).toBeNull();
      expect(screen.queryByLabelText("Fork from this turn")).toBeNull();
    });

    it("hides the fork action for remote threads while keeping copy", () => {
      seed([answer]);
      seedTurnRecord();
      useAppStore.setState({
        threads: [
          {
            id: "thread-1",
            remoteServerId: "desktop-1",
            remoteId: "remote-1",
          },
        ],
      } as never);
      render(
        <AppProvider>
          <AssistantMessage threadId="thread-1" item={answer} isTurnActive={false} />
        </AppProvider>,
      );
      expect(screen.getByLabelText("Copy message")).toBeTruthy();
      expect(screen.queryByLabelText("Fork from this turn")).toBeNull();
    });
  });
});
