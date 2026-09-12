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
