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
  } as never);
}

describe("ThreadRuntimeStatusBar", () => {
  beforeEach(() => {
    useAppStore.setState({
      threads: [],
      runtimeContextByThread: {},
      runtimeCompletedTurnsByThread: {},
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

  it("does not claim a token total when the runtime has not reported usage", () => {
    seed(makeThread({ status: "idle", attention: "none", activeTurnStartedAt: undefined }));
    render(<ThreadRuntimeStatusBar threadId="thread-1" />);

    fireEvent.mouseEnter(screen.getByTestId("thread-runtime-status"));
    expect(screen.getByTestId("thread-runtime-status-popover")).toHaveTextContent("本轮 Token");
    expect(screen.getByTestId("thread-runtime-status-popover")).toHaveTextContent("未提供");
  });
});
