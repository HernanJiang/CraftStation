import { describe, expect, it, vi } from "vitest";
import type { SupervisorEvent } from "@/shared/ipc";
import type { QueuedStructuredTurn, SessionRuntime } from "../sessionTypes";
import { StructuredTurnQueue } from "./structuredTurnQueue";

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
  });
  return { queue, sessions, failStructuredSession, tryPoolFailover };
}

describe("StructuredTurnQueue pool failover", () => {
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
