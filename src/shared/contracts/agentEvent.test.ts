import { describe, expect, it } from "vitest";
import {
  agentEventEnvelopeSchema,
  intentToState,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from "./agentEvent";

describe("agentEvent contract", () => {
  describe("intentToState", () => {
    it("maps state-changing intents to (status, attention) pairs", () => {
      expect(intentToState("session.turn_started")).toEqual({
        status: "working",
        attention: "working",
      });
      expect(intentToState("session.needs_approval")).toEqual({
        status: "needs_approval",
        attention: "needs_approval",
      });
      expect(intentToState("session.needs_reply")).toEqual({
        status: "needs_reply",
        attention: "needs_reply",
      });
      expect(intentToState("session.turn_finished")).toEqual({
        status: "idle",
        attention: "none",
      });
      expect(intentToState("session.turn_errored")).toEqual({
        status: "error",
        attention: "error",
      });
    });

    it("returns null for bookkeeping intents", () => {
      // session.started is proof-of-life only; it must NOT flip status
      // (otherwise a brand-new thread would briefly read as `idle` instead
      // of `launching`).
      expect(intentToState("session.started")).toBeNull();
    });
  });

  describe("agentEventEnvelopeSchema", () => {
    const baseEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      agentKind: "claude" as const,
      pluginVersion: "1.0.0",
      ts: Date.now(),
      intent: "session.turn_started" as const,
    };

    it("accepts a minimal valid envelope with threadId only", () => {
      const result = agentEventEnvelopeSchema.safeParse({
        ...baseEnvelope,
        threadId: "thread-abc",
      });
      expect(result.success).toBe(true);
    });

    it("accepts an envelope with sessionId only (fallback routing)", () => {
      const result = agentEventEnvelopeSchema.safeParse({
        ...baseEnvelope,
        sessionId: "session-xyz",
      });
      expect(result.success).toBe(true);
    });

    it("rejects envelopes with no routing key", () => {
      const result = agentEventEnvelopeSchema.safeParse(baseEnvelope);
      expect(result.success).toBe(false);
    });

    it("preserves arbitrary extras for cross-agent telemetry", () => {
      const result = agentEventEnvelopeSchema.safeParse({
        ...baseEnvelope,
        threadId: "t1",
        extra: { tool: "Read", customDiag: { foo: 1 } },
      });
      expect(result.success).toBe(true);
      // Assert on the parsed data unconditionally — safeParse guarantees
      // `data` is defined exactly when `success` is true, and the previous
      // line already proved that. Using non-null assertion keeps the
      // assertion flat (no-conditional-expect).
      const parsedExtra = result.success ? result.data.extra : undefined;
      expect(parsedExtra).toEqual({
        tool: "Read",
        customDiag: { foo: 1 },
      });
    });

    it("rejects empty agentKind values", () => {
      // agentKindSchema is z.string().min(1) — any non-empty kind is allowed
      // so future agents can register without a contract change. Empty
      // strings still fail because they would short-circuit dispatcher
      // routing & cache keys.
      const result = agentEventEnvelopeSchema.safeParse({
        ...baseEnvelope,
        threadId: "t1",
        agentKind: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown intents (closed enum guards forwards-compat)", () => {
      const result = agentEventEnvelopeSchema.safeParse({
        ...baseEnvelope,
        threadId: "t1",
        intent: "session.exploded",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("protocol version constants", () => {
    it("MIN_PROTOCOL_VERSION must never exceed PROTOCOL_VERSION", () => {
      // This invariant is what lets the supervisor accept any envelope between
      // [MIN_PROTOCOL_VERSION, PROTOCOL_VERSION] without 426ing the plugin.
      expect(MIN_PROTOCOL_VERSION).toBeLessThanOrEqual(PROTOCOL_VERSION);
    });
  });
});
