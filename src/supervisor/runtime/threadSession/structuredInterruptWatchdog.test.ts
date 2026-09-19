import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRuntime } from "../sessionTypes";
import { StructuredInterruptWatchdog } from "./structuredInterruptWatchdog";

describe("StructuredInterruptWatchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function guiSession(): SessionRuntime {
    return {
      threadId: "t-1",
      instanceId: "i-1",
      presentationMode: "gui",
      status: "working",
      structuredSession: {
        interruptTurn: vi.fn<() => Promise<void>>(async () => undefined),
      },
    } as unknown as SessionRuntime;
  }

  it.each(["next-turn", "replacement", "removed"] as const)(
    "ignores a late Stop rejection after %s",
    async (change) => {
      const session = guiSession();
      const interrupted = Promise.withResolvers<void>();
      session.structuredSession!.interruptTurn = () => interrupted.promise;
      const sessions = new Map([[session.threadId, session]]);
      const completeForcedInterrupt = vi.fn<(value: SessionRuntime) => void>();
      const watchdog = new StructuredInterruptWatchdog({
        sessions,
        isDisposed: () => false,
        completeForcedInterrupt,
      });
      const pendingStop = watchdog.interruptStructuredTurn(session);
      const priorTimer = session.structuredInterruptWatchdog;
      if (change === "next-turn") session.structuredTurnGeneration!++;
      if (change === "replacement")
        sessions.set(session.threadId, { ...session, instanceId: "replacement" });
      if (change === "removed") sessions.delete(session.threadId);
      interrupted.reject(new Error("no active turn to interrupt"));
      await pendingStop;
      expect(completeForcedInterrupt).not.toHaveBeenCalled();
      expect(session.structuredInterruptWatchdog).toBe(priorTimer);
      watchdog.clearStructuredInterruptWatchdog(session);
    },
  );

  it("settles a failed turn with no active provider turn and invalidates its pending retry", async () => {
    const session = guiSession();
    session.structuredSession!.interruptTurn = async () => {
      throw new Error("no active turn to interrupt");
    };
    const completeForcedInterrupt = vi.fn<(value: SessionRuntime) => void>();
    const watchdog = new StructuredInterruptWatchdog({
      sessions: new Map([[session.threadId, session]]),
      isDisposed: () => false,
      completeForcedInterrupt,
    });
    await watchdog.interruptStructuredTurn(session);
    expect(completeForcedInterrupt).toHaveBeenCalledWith(session);
    expect(session.structuredTurnGeneration).toBe(1);
    expect(session.structuredInterruptWatchdog).toBeUndefined();
  });

  it("rearms the deadline on a repeated Stop instead of no-op'ing on a stale flag", async () => {
    vi.useFakeTimers();
    try {
      const session = guiSession();
      const sessions = new Map([[session.threadId, session]]);
      const watchdog = new StructuredInterruptWatchdog({
        sessions,
        isDisposed: () => false,
        completeForcedInterrupt: () => undefined,
      });

      session.structuredTurnInterruptRequested = true;
      await watchdog.interruptStructuredTurn(session);
      await watchdog.interruptStructuredTurn(session);

      const interrupt = session.structuredSession?.interruptTurn as
        | ReturnType<typeof vi.fn>
        | undefined;
      expect(interrupt).toHaveBeenCalledTimes(2);
      watchdog.clearStructuredInterruptWatchdog(session);
    } finally {
      vi.useRealTimers();
    }
  });
});
