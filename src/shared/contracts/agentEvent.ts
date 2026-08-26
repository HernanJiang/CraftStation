import { z } from "zod";
import { agentKindSchema, threadAttentionSchema, threadStatusSchema } from "./common";

/**
 * Wire protocol version for the CLI hook ingress (`HookIngress` / WSL bridge).
 *
 * Plugins POST `protocolVersion` in every event; the supervisor compares
 * against `MIN_PROTOCOL_VERSION` (oldest payload shape we still accept) and
 * `PROTOCOL_VERSION` (latest shape we know how to produce). Bump
 * `PROTOCOL_VERSION` whenever the envelope changes shape. Bump
 * `MIN_PROTOCOL_VERSION` only when removing support for an older shape.
 *
 * Adding fields under `extra` does NOT require a bump — `extra` is
 * `z.record(z.unknown())` precisely so plugins can ship richer diagnostics
 * without protocol churn.
 */
export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;

/**
 * Closed vocabulary of state-changing intents. Plugin forwarders translate
 * native agent events (Claude `UserPromptSubmit`, Codex `Turn.start`, …) into
 * one of these. The supervisor maps each to a `(ThreadStatus, ThreadAttention)`
 * pair — adding new state requires bumping `PROTOCOL_VERSION` so older
 * supervisors reject it with 422.
 *
 * `session.started` is bookkeeping only (proof-of-life for the install cache);
 * it does not transition status.
 */
export const agentEventIntentSchema = z.enum([
  "session.started",
  "session.turn_started",
  "session.needs_approval",
  "session.needs_reply",
  "session.turn_finished",
  "session.turn_errored",
]);
export type AgentEventIntent = z.infer<typeof agentEventIntentSchema>;

/**
 * Universal envelope POSTed to `/v1/agent-event`. The supervisor only acts on
 * `intent` for state transitions; everything else is metadata or telemetry.
 *
 * Routing precedence: `threadId` (primary, from PTY env) → `sessionId`
 * (fallback, agent-native id). At least one must be present or the supervisor
 * cannot route the event and replies 422.
 */
export const agentEventEnvelopeSchema = z
  .object({
    protocolVersion: z.number().int().min(1),
    agentKind: agentKindSchema,
    pluginVersion: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    threadId: z.string().min(1).optional(),
    ts: z.number().int().nonnegative(),
    intent: agentEventIntentSchema,
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => value.threadId !== undefined || value.sessionId !== undefined, {
    message: "agent-event requires threadId or sessionId for routing",
    path: ["threadId"],
  });
export type AgentEventEnvelope = z.infer<typeof agentEventEnvelopeSchema>;

/**
 * Result of mapping an `intent` onto our internal state model. Returned by
 * `intentToState` (centralised so plugins can never drift between agents).
 */
export interface AgentEventStateChange {
  status: import("./common").ThreadStatus;
  attention: import("./common").ThreadAttention;
}

const INTENT_STATE: Partial<Record<AgentEventIntent, AgentEventStateChange>> = {
  "session.turn_started": { status: "working", attention: "working" },
  "session.needs_approval": { status: "needs_approval", attention: "needs_approval" },
  "session.needs_reply": { status: "needs_reply", attention: "needs_reply" },
  "session.turn_finished": { status: "idle", attention: "none" },
  "session.turn_errored": { status: "error", attention: "error" },
};

export function intentToState(intent: AgentEventIntent): AgentEventStateChange | null {
  return INTENT_STATE[intent] ?? null;
}

// Re-export schemas the supervisor uses when responding.
export { threadAttentionSchema, threadStatusSchema };
