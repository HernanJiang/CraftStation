import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type AgentEventEnvelope } from "@/shared/contracts";
import { dispatchAgentEvent, type SessionLookup } from "./agentEventDispatcher";
import type { SessionRuntime } from "./sessionTypes";

/**
 * Tests cover the routing & state-derivation layer that sits between
 * `HookIngress` and `ThreadOutputPipeline`. The dispatcher must:
 *   - Route by threadId first, sessionId second (no fall-through to "all live")
 *   - Tag the resolved session as CLI-hook-active so L2 terminal parsing is off
 *   - Map the universal `intent` to (status, attention) consistently across
 *     agents (the same intent from claude / codex / cursor produces the same
 *     state change)
 *   - Skip applyCliHookPluginState for bookkeeping intents (e.g. session.started)
 *   - Surface unroutable envelopes via onUnroutable for diagnostics
 */
function makeSession(threadId: string): SessionRuntime {
  // We only exercise the CLI hook plugin fields; everything else is a placeholder
  // that the dispatcher must NOT touch.
  return {
    threadId,
    instanceId: `inst-${threadId}`,
    agentKind: "claude",
    status: "launching",
    attention: "none",
  } as unknown as SessionRuntime;
}

function envelope(overrides: Partial<AgentEventEnvelope> = {}): AgentEventEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    agentKind: "claude",
    pluginVersion: "1.0.0",
    threadId: "thread-1",
    ts: Date.now(),
    intent: "session.turn_started",
    ...overrides,
  };
}

describe("dispatchAgentEvent", () => {
  it("routes by threadId when present (primary key)", () => {
    const session = makeSession("thread-1");
    const lookup: SessionLookup = vi.fn<SessionLookup>(() => session);
    const applyCliHookPluginState =
      vi.fn<(session: SessionRuntime, change: { status: string; attention: string }) => void>();

    dispatchAgentEvent(envelope({ threadId: "thread-1", sessionId: "sess-x" }), {
      lookupSession: lookup,
      applyCliHookPluginState,
    });

    expect(lookup).toHaveBeenCalledWith({ threadId: "thread-1", sessionId: "sess-x" });
    expect(session.hasCliHookPluginActivity).toBe(true);
    expect(applyCliHookPluginState).toHaveBeenCalledWith(session, {
      status: "working",
      attention: "working",
    });
  });

  it("falls back to sessionId routing when threadId is absent", () => {
    const session = makeSession("thread-2");
    const lookup: SessionLookup = vi.fn<SessionLookup>(() => session);
    const applyCliHookPluginState =
      vi.fn<(session: SessionRuntime, change: { status: string; attention: string }) => void>();

    const env: AgentEventEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      agentKind: "codex",
      pluginVersion: "1.0.0",
      sessionId: "sess-2",
      ts: Date.now(),
      intent: "session.needs_approval",
    };
    dispatchAgentEvent(env, { lookupSession: lookup, applyCliHookPluginState });

    expect(lookup).toHaveBeenCalledWith({ sessionId: "sess-2" });
    expect(applyCliHookPluginState).toHaveBeenCalledWith(session, {
      status: "needs_approval",
      attention: "needs_approval",
    });
  });

  it("invokes onUnroutable when no session matches and skips applyCliHookPluginState", () => {
    const lookup: SessionLookup = vi.fn<SessionLookup>(() => undefined);
    const applyCliHookPluginState =
      vi.fn<(session: SessionRuntime, change: { status: string; attention: string }) => void>();
    const onUnroutable = vi.fn<(env: AgentEventEnvelope) => void>();

    const env = envelope({ threadId: "missing" });
    dispatchAgentEvent(env, { lookupSession: lookup, applyCliHookPluginState, onUnroutable });

    expect(onUnroutable).toHaveBeenCalledWith(env);
    expect(applyCliHookPluginState).not.toHaveBeenCalled();
  });

  it("tags CLI hook activity even for bookkeeping intents but skips applyCliHookPluginState", () => {
    const session = makeSession("thread-3");
    const applyCliHookPluginState =
      vi.fn<(session: SessionRuntime, change: { status: string; attention: string }) => void>();

    dispatchAgentEvent(envelope({ threadId: "thread-3", intent: "session.started" }), {
      lookupSession: () => session,
      applyCliHookPluginState,
    });

    // Bookkeeping: activity flag turns off L2 even when no state is applied.
    expect(session.hasCliHookPluginActivity).toBe(true);
    expect(applyCliHookPluginState).not.toHaveBeenCalled();
  });

  it("derives identical state from identical intents across agents", () => {
    // Cross-agent equivalence: same intent, different agentKind → same state.
    // This is the headline value of the universal envelope. If you find
    // yourself wanting to special-case an agent here, the right fix is to
    // make the agent's plugin emit a different intent — not branch on kind.
    const claudeSession = makeSession("claude-thread");
    const codexSession = makeSession("codex-thread");
    const applied: Array<{ session: SessionRuntime; status: string }> = [];

    const apply = (session: SessionRuntime, change: { status: string; attention: string }) => {
      applied.push({ session, status: change.status });
    };

    dispatchAgentEvent(
      envelope({ threadId: "claude-thread", agentKind: "claude", intent: "session.turn_finished" }),
      {
        lookupSession: ({ threadId }) => (threadId === "claude-thread" ? claudeSession : undefined),
        applyCliHookPluginState: apply,
      },
    );
    dispatchAgentEvent(
      envelope({ threadId: "codex-thread", agentKind: "codex", intent: "session.turn_finished" }),
      {
        lookupSession: ({ threadId }) => (threadId === "codex-thread" ? codexSession : undefined),
        applyCliHookPluginState: apply,
      },
    );

    expect(applied).toEqual([
      { session: claudeSession, status: "idle" },
      { session: codexSession, status: "idle" },
    ]);
  });

  it("uses envelope.ts for lastCliHookPluginActivityAt when provided, falling back to Date.now", () => {
    const session = makeSession("thread-4");

    const fixedTs = 1_700_000_000_000;
    dispatchAgentEvent(envelope({ threadId: "thread-4", ts: fixedTs }), {
      lookupSession: () => session,
      applyCliHookPluginState: () => undefined,
    });
    expect(session.lastCliHookPluginActivityAt).toBe(fixedTs);

    // ts=0 (envelope-provided) is treated as "no timestamp" so we stamp now.
    const before = Date.now();
    dispatchAgentEvent(envelope({ threadId: "thread-4", ts: 0 }), {
      lookupSession: () => session,
      applyCliHookPluginState: () => undefined,
    });
    expect(session.lastCliHookPluginActivityAt).toBeGreaterThanOrEqual(before);
  });
});
