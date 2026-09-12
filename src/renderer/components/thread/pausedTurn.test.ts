import { describe, expect, it } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import { isThreadTaskPaused } from "./pausedTurn";

describe("isThreadTaskPaused", () => {
  it("treats a user-stopped latest turn as paused", () => {
    const startedAt = Date.parse("2026-05-01T12:00:00.000Z");
    useAppStore.setState({
      threads: [
        {
          id: "t-paused",
          status: "idle",
        },
      ],
      userCancelledTurnStartsByThread: { "t-paused": [startedAt] },
      runtimeCompletedTurnsByThread: {
        "t-paused": [
          {
            startedAt,
            endedAt: startedAt + 42_000,
            anchorItemId: "asst-1",
          },
        ],
      },
    } as never);
    expect(isThreadTaskPaused(useAppStore.getState(), "t-paused")).toBe(true);
  });

  it("treats an error thread as paused so the user can continue", () => {
    useAppStore.setState({
      threads: [{ id: "t-error", status: "error" }],
      userCancelledTurnStartsByThread: {},
      runtimeCompletedTurnsByThread: {},
    } as never);
    expect(isThreadTaskPaused(useAppStore.getState(), "t-error")).toBe(true);
  });

  it("does not pause a working or clean idle thread", () => {
    useAppStore.setState({
      threads: [{ id: "t-work", status: "working" }],
      userCancelledTurnStartsByThread: {},
      runtimeCompletedTurnsByThread: {},
    } as never);
    expect(isThreadTaskPaused(useAppStore.getState(), "t-work")).toBe(false);

    useAppStore.setState({
      threads: [{ id: "t-idle", status: "idle" }],
      userCancelledTurnStartsByThread: {},
      runtimeCompletedTurnsByThread: {
        "t-idle": [
          {
            startedAt: 1_000,
            endedAt: 8_000,
            anchorItemId: "asst-1",
          },
        ],
      },
    } as never);
    expect(isThreadTaskPaused(useAppStore.getState(), "t-idle")).toBe(false);
  });
});
