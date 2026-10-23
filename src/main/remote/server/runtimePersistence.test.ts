import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";

const db = vi.hoisted(() => ({
  thread: undefined as Thread | undefined,
  applyEvents: vi.fn<(...args: unknown[]) => void>(),
  appendTurn: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock("../../db", () => ({
  dbApplyThreadRuntimeEvents: db.applyEvents,
  dbReplaceThreadRuntimeSnapshot: vi.fn<(...args: unknown[]) => void>(),
  dbGetThread: () => db.thread,
  dbGetThreads: () => (db.thread ? [db.thread] : []),
  dbUpsertThread: (thread: Thread) => {
    db.thread = thread;
  },
  dbGetLatestThreadRuntimeAnchorItemId: () => "answer",
  dbAppendThreadCompletedTurn: db.appendTurn,
}));
vi.mock("../../profile/usageLedger", () => ({
  recordUsageSpentFromRuntimeEvents: vi.fn<(...args: unknown[]) => void>(),
}));

import { persistSupervisorEvent } from "./runtimePersistence";

describe("runtime turn timing persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T09:00:00.000Z"));
    db.thread = {
      id: "thread-1",
      projectId: "project-1",
      title: "Timing fixture",
      agentKind: "codex",
      config: { model: "m" },
      status: "working",
      attention: "working",
      archived: false,
      done: false,
      starred: false,
      canResumeWithConfig: true,
      createdAt: "2026-10-21T10:58:18.458Z",
      updatedAt: "2026-10-21T10:58:18.458Z",
      activeTurnStartedAt: "2026-10-21T10:58:18.458Z",
    };
  });
  afterEach(() => vi.useRealTimers());

  it("does not turn an old thread update into an unknown completed start", () => {
    db.thread = { ...db.thread!, activeTurnStartedAt: undefined };
    persistSupervisorEvent({
      type: "thread-state",
      threadId: "thread-1",
      status: "idle",
      attention: "none",
      canResumeWithConfig: true,
    });
    expect(db.thread?.lastTurnStartedAt).toBeUndefined();
    expect(db.thread?.lastTurnEndedAt).toBe("2026-10-23T09:00:00.000Z");
    expect(db.appendTurn).not.toHaveBeenCalled();
  });

  it.each(["single", "batch", "multi"])(
    "starts a fresh durable clock from a %s runtime event",
    (shape) => {
      const event = { type: "turn.started" as const, threadId: "thread-1", turnId: "new-turn" };
      if (shape === "single")
        persistSupervisorEvent({ type: "thread-runtime-event", threadId: "thread-1", event });
      else if (shape === "batch")
        persistSupervisorEvent({
          type: "thread-runtime-events",
          threadId: "thread-1",
          events: [event],
        });
      else
        persistSupervisorEvent({
          type: "thread-runtime-events-multi",
          batches: [{ threadId: "thread-1", events: [event] }],
        });
      vi.advanceTimersByTime(60_000);
      persistSupervisorEvent({
        type: "thread-state",
        threadId: "thread-1",
        status: "idle",
        attention: "none",
        canResumeWithConfig: true,
      });
      expect(db.thread).toMatchObject({
        activeTurnStartedAt: undefined,
        lastTurnStartedAt: "2026-10-23T09:00:00.000Z",
        lastTurnEndedAt: "2026-10-23T09:01:00.000Z",
      });
      expect(db.appendTurn).toHaveBeenCalledWith("thread-1", {
        startedAt: "2026-10-23T09:00:00.000Z",
        endedAt: "2026-10-23T09:01:00.000Z",
        anchorItemId: "answer",
      });
    },
  );
});
