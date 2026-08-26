import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type AgentEventEnvelope } from "@/shared/contracts";
import { HookIngress, type HookIngressBootInfo } from "./hookIngress";

/**
 * Tests cover the production contract of `HookIngress`:
 *   - Bearer-token auth (no token = 401, wrong token = 401)
 *   - Method/path gating (GET/PUT 405, wrong path 404)
 *   - Payload size limits
 *   - JSON & schema validation (malformed = 400)
 *   - Protocol version negotiation (too old = 426; too new = 200 + downgraded)
 *   - Receiver invocation on accepted envelopes
 *   - Routing requirement (threadId or sessionId required)
 */
describe("HookIngress", () => {
  let ingress: HookIngress;
  let info: HookIngressBootInfo;
  let received: AgentEventEnvelope[];

  beforeEach(async () => {
    received = [];
    ingress = new HookIngress({
      onEvent: (event) => received.push(event),
      // Silence diagnostic warnings during the test run.
      onError: () => undefined,
    });
    ingress.start();
    info = await ingress.ready;
  });

  afterEach(async () => {
    await ingress.dispose();
  });

  function url(): string {
    return info.url;
  }

  function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${info.secret}`,
      ...extra,
    };
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

  it("binds 127.0.0.1 with an ephemeral port and exposes a stable secret", () => {
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/agent-event$/);
    expect(info.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(info.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("rejects requests without an Authorization header (401)", async () => {
    const response = await fetch(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope()),
    });
    expect(response.status).toBe(401);
    expect(received).toHaveLength(0);
  });

  it("rejects requests with the wrong bearer token (401)", async () => {
    const response = await fetch(url(), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer nope" },
      body: JSON.stringify(envelope()),
    });
    expect(response.status).toBe(401);
    expect(received).toHaveLength(0);
  });

  it("rejects non-POST methods with 405", async () => {
    const response = await fetch(url(), { method: "GET", headers: authHeaders() });
    expect(response.status).toBe(405);
  });

  it("rejects unknown paths with 404", async () => {
    const wrongPath = url().replace("/v1/agent-event", "/v2/wrong");
    const response = await fetch(wrongPath, {
      method: "POST",
      headers: authHeaders(),
      body: "{}",
    });
    expect(response.status).toBe(404);
  });

  it("rejects malformed JSON with 400", async () => {
    const response = await fetch(url(), {
      method: "POST",
      headers: authHeaders(),
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_json" });
  });

  it("rejects envelopes missing both threadId and sessionId", async () => {
    const noRouting: Record<string, unknown> = { ...envelope() };
    delete noRouting.threadId;
    const response = await fetch(url(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(noRouting),
    });
    expect(response.status).toBe(400);
    expect(received).toHaveLength(0);
  });

  it("returns 426 Upgrade Required for envelopes below MIN_PROTOCOL_VERSION", async () => {
    const response = await fetch(url(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...envelope(), protocolVersion: 0 }),
    });
    expect(response.status).toBe(426);
    const body = (await response.json()) as { error: string; supportedProtocol: number };
    expect(body.error).toBe("upgrade_required");
    expect(body.supportedProtocol).toBe(PROTOCOL_VERSION);
    expect(received).toHaveLength(0);
  });

  it("accepts but flags as downgraded when plugin protocol is newer than supervisor", async () => {
    const response = await fetch(url(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...envelope(), protocolVersion: PROTOCOL_VERSION + 1 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, downgraded: true });
    expect(received).toHaveLength(1);
  });

  it("accepts well-formed envelopes and forwards them to the receiver (202)", async () => {
    const env = envelope({ extra: { tool: "Read" } });
    const response = await fetch(url(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(env),
    });
    expect(response.status).toBe(202);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      threadId: "thread-1",
      intent: "session.turn_started",
      extra: { tool: "Read" },
    });
  });

  it("can route by sessionId when threadId is absent", async () => {
    const noThread: Record<string, unknown> = { ...envelope(), sessionId: "sess-9" };
    delete noThread.threadId;
    const response = await fetch(url(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(noThread),
    });
    expect(response.status).toBe(202);
    expect(received[0]?.sessionId).toBe("sess-9");
    expect(received[0]?.threadId).toBeUndefined();
  });

  it("rejects payloads larger than 64KiB with 413", async () => {
    const huge = "x".repeat(65 * 1024);
    const response = await fetch(url(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...envelope(), extra: { huge } }),
    });
    expect(response.status).toBe(413);
    expect(received).toHaveLength(0);
  });

  it("does not crash if the receiver throws", async () => {
    const throwing = new HookIngress({
      onEvent: () => {
        throw new Error("receiver boom");
      },
      onError: () => undefined,
    });
    throwing.start();
    const bootInfo = await throwing.ready;
    try {
      const response = await fetch(bootInfo.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bootInfo.secret}`,
        },
        body: JSON.stringify(envelope()),
      });
      expect(response.status).toBe(202);
    } finally {
      await throwing.dispose();
    }
  });
});
