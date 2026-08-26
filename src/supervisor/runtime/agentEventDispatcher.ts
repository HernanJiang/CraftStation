import {
  type AgentEventEnvelope,
  type AgentEventStateChange,
  intentToState,
} from "@/shared/contracts";
import { hookDebugRouted } from "./hookDebug";
import type { SessionRuntime } from "./sessionTypes";

export type SessionLookup = (input: {
  threadId?: string;
  sessionId?: string;
}) => SessionRuntime | undefined;

export interface AgentEventApplyHooks {
  /**
   * Look up the live `SessionRuntime` matching the envelope's routing keys.
   * `threadId` (from PTY env) is the primary key; `sessionId` (agent-native
   * id) is the fallback. Return `undefined` if neither matches a live thread.
   */
  lookupSession: SessionLookup;
  /**
   * Apply a state transition for the given session. Implementation lives in
   * `ThreadOutputPipeline` so hook-driven updates share the same emit/timer
   * plumbing as terminal-driven updates (when L2 is active).
   */
  applyCliHookPluginState(session: SessionRuntime, change: AgentEventStateChange): void;
  /**
   * Optional callback for telemetry / cache freshness — fired after every
   * routed envelope, including bookkeeping intents.
   */
  onRoutedEvent?(session: SessionRuntime, envelope: AgentEventEnvelope): void;
  /** Fired when an envelope has no matching session — used for diagnostics. */
  onUnroutable?(envelope: AgentEventEnvelope): void;
}

/**
 * Provider-agnostic dispatcher: every accepted envelope from `HookIngress`
 * goes through here, gets resolved to a `SessionRuntime` by routing key, and
 * the universal `intent` is mapped to `(ThreadStatus, ThreadAttention)`. The
 * map lives in `@/shared/contracts/agentEvent` so plugins can never disagree
 * about what `session.turn_started` means across agents.
 */
export function dispatchAgentEvent(
  envelope: AgentEventEnvelope,
  hooks: AgentEventApplyHooks,
): void {
  const session = hooks.lookupSession({
    ...(envelope.threadId !== undefined ? { threadId: envelope.threadId } : {}),
    ...(envelope.sessionId !== undefined ? { sessionId: envelope.sessionId } : {}),
  });
  if (!session) {
    hooks.onUnroutable?.(envelope);
    return;
  }

  // Tag every routed envelope as CLI hook plugin activity, even bookkeeping
  // intents like `session.started`. Terminal parsing (L2) is disabled while
  // this stays true so hooks remain the sole source of status.
  session.hasCliHookPluginActivity = true;
  session.lastCliHookPluginActivityAt = envelope.ts || Date.now();

  const change = intentToState(envelope.intent);
  if (!change) {
    hookDebugRouted(session.threadId, envelope.intent, null);
    hooks.onRoutedEvent?.(session, envelope);
    return;
  }
  hookDebugRouted(session.threadId, envelope.intent, {
    status: change.status,
    attention: change.attention,
  });
  hooks.applyCliHookPluginState(session, change);
  hooks.onRoutedEvent?.(session, envelope);
}
