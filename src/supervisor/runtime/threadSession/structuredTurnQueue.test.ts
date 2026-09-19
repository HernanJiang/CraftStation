import { describe, expect, it, vi } from "vitest";
import type { SupervisorEvent } from "@/shared/ipc";
import type { QueuedStructuredTurn, SessionRuntime } from "../sessionTypes";
import { StructuredTurnQueue, type StructuredTurnQueueContext } from "./structuredTurnQueue";
import { StructuredInterruptWatchdog } from "./structuredInterruptWatchdog";

function quotaError(): Error {
  return Object.assign(new Error("Internal error"), {
    code: -32603,
    data: {
      message: "API error (status 402 Payment Required): Grok Build usage balance exhausted",
      http_status: 402,
    },
  });
}

function makeSession(startTurn: (prompt: string) => Promise<void>): SessionRuntime {
  return {
    instanceId: "instance-1",
    threadId: "thread-1",
    agentKind: "grok",
    adapter: {},
    projectLocation: { kind: "windows", path: "C:\\repo" },
    config: { model: "grok-4.6" },
    mcpLaunchSnapshot: { mcpServers: [], disabledBuiltInMcpServerIds: [] },
    status: "working",
    attention: "none",
    canResumeWithConfig: false,
    terminalSize: { cols: 120, rows: 30 },
    launchPrompt: "",
    structuredSession: { startTurn },
    presentationMode: "gui",
    prevChunk: "",
    lastStrippedPtyChunk: "",
    ptyOscCarry: "",
  } as unknown as SessionRuntime;
}

function makeQueue(
  overrides: {
    tryTurnRetry?: StructuredTurnQueueContext["tryTurnRetry"];
    tryPoolFailover?: (
      session: SessionRuntime,
      turn: QueuedStructuredTurn,
      error: unknown,
    ) => Promise<boolean>;
  } = {},
) {
  const sessions = new Map<string, SessionRuntime>();
  const failStructuredSession = vi.fn<(session: SessionRuntime, error: unknown) => void>();
  const tryPoolFailover = vi.fn<
    (session: SessionRuntime, turn: QueuedStructuredTurn, error: unknown) => Promise<boolean>
  >(overrides.tryPoolFailover ?? (async () => false));
  const queue = new StructuredTurnQueue({
    emit: vi.fn<(event: SupervisorEvent) => void>(),
    sessions,
    beginFailureEpisode: vi.fn<(session: SessionRuntime) => void>(),
    failStructuredSession,
    tryPoolFailover,
    ...(overrides.tryTurnRetry ? { tryTurnRetry: overrides.tryTurnRetry } : {}),
  });
  return { queue, sessions, failStructuredSession, tryPoolFailover };
}

describe("StructuredTurnQueue pool failover", () => {
  it.each(["start", "launch"])(
    "ignores a stale %s failure after Stop is acknowledged",
    async (entry) => {
      const retry = Promise.withResolvers<boolean>();
      const tryTurnRetry = vi.fn<NonNullable<StructuredTurnQueueContext["tryTurnRetry"]>>(
        () => retry.promise,
      );
      const session = makeSession(async () => {
        throw new Error("ECONNRESET");
      });
      const { queue, sessions, failStructuredSession } = makeQueue({ tryTurnRetry });
      sessions.set(session.threadId, session);
      if (entry === "launch") {
        session.pendingLaunchPrompt = "hello";
        queue.startQueuedLaunchPrompt(session);
      } else {
        queue.start(session, { prompt: "hello", config: session.config });
      }
      await vi.waitFor(() => expect(tryTurnRetry).toHaveBeenCalledOnce());
      const watchdog = new StructuredInterruptWatchdog({
        sessions,
        isDisposed: () => false,
        completeForcedInterrupt: () => undefined,
      });
      await watchdog.interruptStructuredTurn(session);
      session.structuredTurnInterruptRequested = false;
      retry.resolve(false);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(failStructuredSession).not.toHaveBeenCalled();
    },
  );

  it("does not let a delayed recovery failure overwrite a newer turn on the same session", async () => {
    const recovery = Promise.withResolvers<boolean>();
    const session = makeSession(
      vi
        .fn<(prompt: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValue(undefined),
    );
    const { queue, sessions, failStructuredSession, tryPoolFailover } = makeQueue({
      tryPoolFailover: () => recovery.promise,
    });
    sessions.set(session.threadId, session);
    queue.start(session, { prompt: "old", config: session.config });
    await vi.waitFor(() => expect(tryPoolFailover).toHaveBeenCalledOnce());
    queue.start(session, { prompt: "new", config: session.config });
    recovery.resolve(false);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(failStructuredSession).not.toHaveBeenCalled();
  });

  it("retains the launch goal context when replaying a failed launch turn", async () => {
    const session = makeSession(async () => {
      throw quotaError();
    });
    session.pendingLaunchPrompt = "continue";
    session.pendingLaunchGoalContext = "finish the requested goal";
    const { queue, sessions, tryPoolFailover } = makeQueue({ tryPoolFailover: async () => true });
    sessions.set(session.threadId, session);
    queue.startQueuedLaunchPrompt(session);
    await vi.waitFor(() => expect(tryPoolFailover).toHaveBeenCalledOnce());
    expect(tryPoolFailover.mock.calls[0]?.[1]).toMatchObject({
      prompt: "continue",
      goalContext: "finish the requested goal",
    });
  });

  it("sends goal and retry context on replay without painting a second user message", async () => {
    const start = vi.fn<(prompt: string) => Promise<void>>(async () => undefined);
    const session = makeSession(start);
    const emit = vi.fn<(event: SupervisorEvent) => void>();
    const queue = new StructuredTurnQueue({
      sessions: new Map([[session.threadId, session]]),
      emit,
      beginFailureEpisode: () => undefined,
      failStructuredSession: () => undefined,
    });
    queue.start(
      session,
      {
        prompt: "user",
        config: session.config,
        goalContext: "goal",
        retryContext: "retry",
        historyPreface: "history",
        userMessageItemId: "painted",
      },
      { reusePaintedMessage: true },
    );
    expect(start.mock.calls[0]?.[0]).toBe("goal\n\nretry\n\nhistory\n\nuser");
    expect(emit).not.toHaveBeenCalled();
  });

  it("still recovers a transport whose lifecycle already marked ignoreExit", async () => {
    const session = makeSession(async () => {
      throw new Error("ACP connection closed unexpectedly.");
    });
    session.ignoreExit = true;
    const tryTurnRetry = vi.fn<NonNullable<StructuredTurnQueueContext["tryTurnRetry"]>>(
      async () => true,
    );
    const { queue, sessions, failStructuredSession } = makeQueue({ tryTurnRetry });
    sessions.set(session.threadId, session);
    queue.start(session, { prompt: "recover", config: session.config });
    await vi.waitFor(() => expect(tryTurnRetry).toHaveBeenCalledOnce());
    expect(failStructuredSession).not.toHaveBeenCalled();
  });

  it("reports the original failure when recovery throws instead of leaking a rejection", async () => {
    const original = quotaError();
    const session = makeSession(async () => {
      throw original;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { queue, sessions, failStructuredSession } = makeQueue({
        tryPoolFailover: async () => {
          throw new Error("private prompt sk-fixture-secret");
        },
      });
      sessions.set(session.threadId, session);
      queue.start(session, { prompt: "hello", config: session.config });
      await vi.waitFor(() => expect(failStructuredSession).toHaveBeenCalledWith(session, original));
      expect(warn).toHaveBeenCalledOnce();
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private prompt|sk-fixture-secret/);
    } finally {
      warn.mockRestore();
    }
  });
  it("hands a quota-failed turn to pool failover instead of failing the session", async () => {
    const error = quotaError();
    const session = makeSession(async () => {
      throw error;
    });
    const { queue, sessions, failStructuredSession, tryPoolFailover } = makeQueue({
      tryPoolFailover: async () => true,
    });
    sessions.set(session.threadId, session);

    queue.start(session, { prompt: "hi", config: session.config });
    await vi.waitFor(() => expect(tryPoolFailover).toHaveBeenCalledTimes(1));
    expect(failStructuredSession).not.toHaveBeenCalled();
  });

  it("fails the session when pool failover declines", async () => {
    const error = quotaError();
    const session = makeSession(async () => {
      throw error;
    });
    const { queue, sessions, failStructuredSession } = makeQueue({
      tryPoolFailover: async () => false,
    });
    sessions.set(session.threadId, session);

    queue.start(session, { prompt: "hi", config: session.config });
    await vi.waitFor(() => expect(failStructuredSession).toHaveBeenCalledTimes(1));
    expect(failStructuredSession).toHaveBeenCalledWith(session, error);
  });

  it("replays with the already-painted turn and user-message ids", async () => {
    const session = makeSession(async () => {
      throw quotaError();
    });
    let capturedTurn: QueuedStructuredTurn | undefined;
    let capturedOptions: { userMessageItemId?: string } | undefined;
    (
      session.structuredSession as unknown as {
        startTurn: (
          prompt: string,
          config: unknown,
          segments: unknown,
          options?: { userMessageItemId?: string },
        ) => Promise<void>;
      }
    ).startTurn = async (_prompt, _config, _segments, options) => {
      capturedOptions = options;
      throw quotaError();
    };
    const { queue, sessions, tryPoolFailover } = makeQueue({
      tryPoolFailover: async (_session, turn) => {
        capturedTurn = turn;
        return true;
      },
    });
    sessions.set(session.threadId, session);

    queue.start(session, { prompt: "hi", config: session.config });
    await vi.waitFor(() => expect(tryPoolFailover).toHaveBeenCalledTimes(1));
    // The replay turn reuses the painted ids so restartThread cannot duplicate
    // the user message.
    expect(capturedTurn?.userMessageItemId).toBeDefined();
    expect(capturedTurn?.userMessageItemId).toBe(capturedOptions?.userMessageItemId);
    expect(capturedTurn?.turnId).toBeDefined();
  });
});
