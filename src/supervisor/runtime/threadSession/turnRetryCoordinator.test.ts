import { describe, expect, it, vi } from "vitest";
import type { SupervisorEvent } from "@/shared/ipc";
import type { QueuedStructuredTurn, SessionRuntime } from "../sessionTypes";
import {
  TurnRetryCoordinator,
  type TurnRetryCoordinatorContext,
  type TurnRetryPolicy,
} from "./turnRetryCoordinator";

function guiSession(): SessionRuntime {
  return {
    threadId: "t-1",
    instanceId: "i-1",
    agentKind: "codex",
    presentationMode: "gui",
    status: "working",
  } as unknown as SessionRuntime;
}

function makeTurn(): QueuedStructuredTurn {
  return {
    prompt: "do the thing",
    config: {} as QueuedStructuredTurn["config"],
    turnId: "turn-1",
    userMessageItemId: "user-1",
  };
}

interface Harness {
  ctx: TurnRetryCoordinatorContext;
  coordinator: TurnRetryCoordinator;
  events: SupervisorEvent[];
  startTurn: ReturnType<typeof vi.fn>;
  restartTurn: ReturnType<typeof vi.fn>;
  attachHistoryPreface: ReturnType<typeof vi.fn>;
  sleeps: number[];
  setPolicy(policy: Partial<TurnRetryPolicy>): void;
  setCurrent(current: boolean): void;
}

function makeHarness(): Harness {
  const events: SupervisorEvent[] = [];
  const sleeps: number[] = [];
  const startTurn = vi.fn<() => void>();
  const restartTurn = vi.fn<() => Promise<void>>(async () => undefined);
  const attachHistoryPreface = vi.fn<(s: SessionRuntime, t: QueuedStructuredTurn) => void>();
  let policy: TurnRetryPolicy = { maxAttempts: 2, intervalMs: 5000 };
  let current = true;
  const ctx: TurnRetryCoordinatorContext = {
    isDisposed: () => false,
    isCurrentSession: () => current,
    readPolicy: () => policy,
    emit: (event) => {
      events.push(event);
    },
    attachHistoryPreface,
    startTurn,
    restartTurn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
  return {
    ctx,
    coordinator: new TurnRetryCoordinator(ctx),
    events,
    startTurn,
    restartTurn,
    attachHistoryPreface,
    sleeps,
    setPolicy(next) {
      policy = { ...policy, ...next };
    },
    setCurrent(next) {
      current = next;
    },
  };
}

const NETWORK_ERROR = new Error(
  "reqwest: error sending request for url (https://example.com/v1): ECONNRESET",
);
const TRANSPORT_ERROR = new Error("ACP connection closed unexpectedly.");

describe("TurnRetryCoordinator", () => {
  it("re-sends a turn-class network failure on the same session with a continuation note", async () => {
    const h = makeHarness();
    const session = guiSession();
    const turn = makeTurn();

    const tookOver = await h.coordinator.tryTurnRetry(session, turn, NETWORK_ERROR);

    expect(tookOver).toBe(true);
    expect(h.sleeps).toEqual([5000]);
    expect(h.startTurn).toHaveBeenCalledTimes(1);
    expect(h.restartTurn).not.toHaveBeenCalled();
    expect(h.attachHistoryPreface).not.toHaveBeenCalled();
    expect(turn.turnRetryAttempt).toBe(1);
    expect(turn.historyPreface).toContain("Craft-Harness auto-retry");
    const notice = h.events.find((event) => event.type === "thread-turn-retry");
    expect(notice).toMatchObject({
      type: "thread-turn-retry",
      threadId: "t-1",
      attempt: 1,
      maxAttempts: 2,
      delaySeconds: 5,
    });
  });

  it("rebuilds the session for a transport-class failure, preface attached before the note", async () => {
    const h = makeHarness();
    h.attachHistoryPreface.mockImplementation((_s: SessionRuntime, t: QueuedStructuredTurn) => {
      t.historyPreface = "transcript preface";
    });
    const session = guiSession();
    const turn = makeTurn();

    const tookOver = await h.coordinator.tryTurnRetry(session, turn, TRANSPORT_ERROR);

    expect(tookOver).toBe(true);
    expect(h.restartTurn).toHaveBeenCalledTimes(1);
    expect(h.startTurn).not.toHaveBeenCalled();
    expect(h.attachHistoryPreface).toHaveBeenCalledTimes(1);
    expect(turn.historyPreface).toBe(
      "[CraftStation Craft-Harness auto-retry] The previous attempt of this turn was " +
        "interrupted by a network/transport failure before completing. Continue the task " +
        "from where it stopped; if the previous attempt never actually started, simply " +
        "carry out the original request normally.\n\ntranscript preface",
    );
  });

  it("stops at the configured attempt cap carried on the turn", async () => {
    const h = makeHarness();
    const session = guiSession();
    const turn = { ...makeTurn(), turnRetryAttempt: 2 };

    const tookOver = await h.coordinator.tryTurnRetry(session, turn, NETWORK_ERROR);

    expect(tookOver).toBe(false);
    expect(h.startTurn).not.toHaveBeenCalled();
    expect(h.sleeps).toEqual([]);
  });

  it("does nothing when retries are disabled", async () => {
    const h = makeHarness();
    h.setPolicy({ maxAttempts: 0 });

    const tookOver = await h.coordinator.tryTurnRetry(guiSession(), makeTurn(), NETWORK_ERROR);

    expect(tookOver).toBe(false);
    expect(h.startTurn).not.toHaveBeenCalled();
  });

  it("never retries a user-requested interrupt", async () => {
    const h = makeHarness();
    const session = guiSession();
    session.structuredTurnInterruptRequested = true;

    const tookOver = await h.coordinator.tryTurnRetry(session, makeTurn(), TRANSPORT_ERROR);

    expect(tookOver).toBe(false);
  });

  it("never retries quota/auth outcomes (owned by failover / fail-closed)", async () => {
    const h = makeHarness();

    const tookOver = await h.coordinator.tryTurnRetry(
      guiSession(),
      makeTurn(),
      new Error("insufficient_quota: quota exceeded"),
    );

    expect(tookOver).toBe(false);
  });

  it("never retries capacity-throttle noise (provider-internal retry chatter)", async () => {
    const h = makeHarness();

    const tookOver = await h.coordinator.tryTurnRetry(
      guiSession(),
      makeTurn(),
      new Error("API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model"),
    );

    expect(tookOver).toBe(false);
  });

  it("never retries failures that are neither network nor transport", async () => {
    const h = makeHarness();

    const tookOver = await h.coordinator.tryTurnRetry(
      guiSession(),
      makeTurn(),
      new Error("model not found: no-such-model"),
    );

    expect(tookOver).toBe(false);
  });

  it("abandons the retry when the session was replaced during the wait", async () => {
    const h = makeHarness();
    h.setCurrent(false);

    const tookOver = await h.coordinator.tryTurnRetry(guiSession(), makeTurn(), NETWORK_ERROR);

    expect(tookOver).toBe(false);
    expect(h.sleeps).toEqual([5000]);
    expect(h.startTurn).not.toHaveBeenCalled();
  });

  it("falls through to the normal failure path when the retry itself throws", async () => {
    const h = makeHarness();
    h.startTurn.mockImplementation(() => {
      throw new Error("session gone");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const tookOver = await h.coordinator.tryTurnRetry(guiSession(), makeTurn(), NETWORK_ERROR);

    expect(tookOver).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
