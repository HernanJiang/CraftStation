import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ThreadRuntimeStatusBar } from "./ThreadRuntimeStatusBar";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Thread 1",
    agentKind: "grok",
    config: { model: "grok-4.6" },
    status: "working",
    attention: "working",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-09-13T01:05:33.000Z",
    updatedAt: "2026-09-13T01:35:15.000Z",
    activeTurnStartedAt: "2026-09-13T01:05:33.000Z",
    ...overrides,
  };
}

function seed(thread: Thread, usage?: { usedTokens: number; maxTokens: number }) {
  useAppStore.setState({
    threads: [thread],
    runtimeContextByThread: usage
      ? {
          [thread.id]: {
            usedTokens: usage.usedTokens,
            maxTokens: usage.maxTokens,
            breakdown: [
              { id: "messages", label: "消息", tokens: usage.usedTokens },
              { id: "input", label: "Input Token", tokens: usage.usedTokens },
              { id: "output", label: "Output Token", tokens: 0 },
              { id: "reasoning", label: "Reasoning Token", tokens: 243 },
              { id: "cache-read", label: "Cache read Token", tokens: 209_000 },
            ],
          },
        }
      : {},
    runtimeCompletedTurnsByThread: {
      [thread.id]: [
        {
          startedAt: Date.parse("2026-09-13T00:35:00.000Z"),
          endedAt: Date.parse("2026-09-13T01:04:41.000Z"),
          anchorItemId: null,
        },
      ],
    },
    runtimeTurnOutputByThread: {},
  } as never);
}

describe("ThreadRuntimeStatusBar", () => {
  beforeEach(() => {
    useAppStore.setState({
      threads: [],
      runtimeContextByThread: {},
      runtimeCompletedTurnsByThread: {},
      runtimeTurnOutputByThread: {},
      runtimeItemIdsByThread: {},
      runtimeItemsByIdByThread: {},
    } as never);
  });

  it("shows turn status without context occupancy or a context bar", () => {
    seed(makeThread(), { usedTokens: 218_000, maxTokens: 262_000 });
    render(<ThreadRuntimeStatusBar threadId="thread-1" />);

    const chip = screen.getByTestId("thread-runtime-status");
    expect(chip).toHaveTextContent("Working");
    expect(chip).not.toHaveTextContent("FOC_t1");
    expect(chip).not.toHaveTextContent("84%");
    expect(chip).not.toHaveTextContent("上下文");
    expect(chip.textContent).not.toMatch(/218K/);
    expect(chip.querySelector("span.h-1")).toBeNull();
  });

  it("opens a portal popover with this-turn tokens only", () => {
    seed(
      makeThread({
        status: "finished",
        attention: "none",
        done: true,
        lastTurnEndedAt: "2026-09-13T01:35:15.000Z",
      }),
      {
        usedTokens: 218_000,
        maxTokens: 262_000,
      },
    );
    render(<ThreadRuntimeStatusBar threadId="thread-1" />);

    fireEvent.mouseEnter(screen.getByTestId("thread-runtime-status"));
    const popover = screen.getByTestId("thread-runtime-status-popover");
    expect(popover).toHaveTextContent("Completed");
    expect(popover).not.toHaveTextContent("FOC_t1");
    expect(popover).toHaveTextContent("本轮 Token");
    expect(popover).toHaveTextContent("218K");
    expect(popover).toHaveTextContent("本轮耗时");
    expect(popover).toHaveTextContent("上一轮耗时");
    expect(popover).not.toHaveTextContent("上下文");
    expect(popover).not.toHaveTextContent("消息");
    expect(popover).not.toHaveTextContent("Input Token");
    expect(popover).not.toHaveTextContent("Output Token");
    expect(popover).not.toHaveTextContent("Cache read");
    expect(popover).not.toHaveTextContent("上一轮 Token");
    expect(popover).not.toHaveTextContent("缓存命中率");
  });

  it("shows the average output rate only in the details popover", () => {
    seed(makeThread(), { usedTokens: 218_000, maxTokens: 262_000 });
    useAppStore.setState({
      runtimeTurnOutputByThread: {
        "thread-1": {
          finalizedTokens: 0,
          floatingReported: 0,
          decodeMs: 0,
          segment: {
            itemId: "i1",
            firstDeltaAt: Date.now() - 2_000,
            lastDeltaAt: Date.now(),
            estimatedTokens: 84,
            reportedTokens: 0,
            reportedBaseline: 0,
          },
        },
      },
    } as never);
    render(<ThreadRuntimeStatusBar threadId="thread-1" />);

    // 84 est. tokens over a 2s decode window → ~42 tok/s, shown only on hover.
    expect(screen.getByTestId("thread-runtime-status")).not.toHaveTextContent("tok/s");

    fireEvent.mouseEnter(screen.getByTestId("thread-runtime-status"));
    const popover = screen.getByTestId("thread-runtime-status-popover");
    expect(popover).toHaveTextContent("输出速度");
    expect(popover).toHaveTextContent("≈ 42 tok/s");
  });

  it("falls back to whole-turn elapsed for a single-delta turn", () => {
    // Providers delivering output in one chunk leave a zero-width decode
    // window — the rate must still render (whole-turn average, estimated).
    seed(
      makeThread({
        status: "finished",
        attention: "none",
        done: true,
        activeTurnStartedAt: undefined,
        lastTurnStartedAt: "2026-09-13T01:34:15.000Z",
        lastTurnEndedAt: "2026-09-13T01:35:15.000Z",
      }),
      { usedTokens: 218_000, maxTokens: 262_000 },
    );
    useAppStore.setState({
      runtimeTurnOutputByThread: {
        "thread-1": {
          finalizedTokens: 0,
          floatingReported: 0,
          decodeMs: 0,
          segment: {
            itemId: "i1",
            firstDeltaAt: Date.now(),
            lastDeltaAt: Date.now(),
            estimatedTokens: 120,
            reportedTokens: 0,
            reportedBaseline: 0,
          },
        },
      },
    } as never);
    render(<ThreadRuntimeStatusBar threadId="thread-1" />);

    fireEvent.mouseEnter(screen.getByTestId("thread-runtime-status"));
    const popover = screen.getByTestId("thread-runtime-status-popover");
    // 120 est. tokens over the 60s turn → ≈ 2 tok/s, flagged as estimated.
    expect(popover).toHaveTextContent("输出速度");
    expect(popover).toHaveTextContent("≈ 2 tok/s");
    expect(popover).toHaveTextContent("估算");
  });

  it("estimates output from persisted streams when no live turn output exists", () => {
    // Reopened threads never saw live deltas — persisted item text estimates
    // the numerator so the rate still shows for any provider.
    seed(
      makeThread({
        status: "finished",
        attention: "none",
        done: true,
        activeTurnStartedAt: undefined,
        lastTurnStartedAt: "2026-09-13T01:34:15.000Z",
        lastTurnEndedAt: "2026-09-13T01:35:15.000Z",
      }),
    );
    useAppStore.setState({
      runtimeItemIdsByThread: { "thread-1": ["u1", "a1"] },
      runtimeItemsByIdByThread: {
        "thread-1": {
          u1: {
            id: "u1",
            type: "user_message",
            state: "completed",
            payload: {},
            streams: {},
          },
          a1: {
            id: "a1",
            type: "assistant_message",
            state: "completed",
            payload: {},
            streams: { assistant_text: "x".repeat(240) },
          },
        },
      },
    } as never);
    render(<ThreadRuntimeStatusBar threadId="thread-1" />);

    fireEvent.mouseEnter(screen.getByTestId("thread-runtime-status"));
    const popover = screen.getByTestId("thread-runtime-status-popover");
    // 240 ASCII chars ≈ 60 est. tokens over the 60s turn → ≈ 1 tok/s.
    expect(popover).toHaveTextContent("输出速度");
    expect(popover).toHaveTextContent("≈ 1 tok/s");
    expect(popover).toHaveTextContent("估算");
  });

  it("does not claim a token total when the runtime has not reported usage", () => {
    seed(makeThread({ status: "idle", attention: "none", activeTurnStartedAt: undefined }));
    render(<ThreadRuntimeStatusBar threadId="thread-1" />);

    fireEvent.mouseEnter(screen.getByTestId("thread-runtime-status"));
    expect(screen.getByTestId("thread-runtime-status-popover")).toHaveTextContent("本轮 Token");
    expect(screen.getByTestId("thread-runtime-status-popover")).toHaveTextContent("未提供");
  });
});
