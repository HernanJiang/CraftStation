import { describe, expect, it } from "vitest";
import type { NativeHarnessDiagnostic } from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { SessionEventHistory } from "./sessionEventHistory";

const state = { sessionId: "session", entityId: "entity", status: "idle" as const };
const event: RuntimeEvent = {
  type: "session.started",
  threadId: "thread",
  nativeEnvelope: {
    harnessKind: "codex",
    source: "native",
    nativeType: "thread/started",
    sequence: 1,
    receivedAt: "2026-09-19T00:00:00.000Z",
  },
};
const diagnostic: NativeHarnessDiagnostic = {
  code: "NATIVE_EXECUTION_FAILED",
  harnessKind: "codex",
  phase: "turn",
  operation: "start",
  message: "probe",
  occurredAt: "2026-09-19T00:00:00.000Z",
};

describe("SessionEventHistory", () => {
  it("reads a very long history without exceeding the engine's argument limit", () => {
    const history = new SessionEventHistory();
    for (let index = 0; index < 131_201; index++) history.append(event);
    const snapshot = history.snapshot(state);
    expect(snapshot.events).toHaveLength(131_201);
    expect(snapshot.events[0]).toBe(event);
    expect(snapshot.events[131_200]).toBe(event);
  });
  it("retains exact prefixes and per-turn ranges across multiple history blocks", () => {
    const history = new SessionEventHistory();
    const input = Array.from(
      { length: 401 },
      (_, index): RuntimeEvent => ({ type: "warning", threadId: "thread", message: String(index) }),
    );
    for (const entry of input.slice(0, 129)) history.append(entry);
    const earlier = history.snapshot(state);
    for (const entry of input.slice(129)) history.append(entry);
    expect(earlier.events).toEqual(input.slice(0, 129));
    expect(history.snapshot(state).events).toEqual(input);
    expect(history.eventsSince(127)).toEqual(input.slice(127));
    expect(history.eventsSince(-3)).toEqual(input.slice(-3));
    expect(history.eventsSince(401)).toEqual([]);
    expect(history.eventsSince(1000)).toEqual([]);
  });
  it("preserves an unread snapshot across later events, diagnostics and lifecycle changes", () => {
    const history = new SessionEventHistory();
    const empty = history.snapshot(state);
    history.append(event);
    history.addDiagnostic(diagnostic);
    const earlier = history.snapshot(state);
    history.append({ type: "session.exited", threadId: "thread" });
    history.addDiagnostic({ ...diagnostic, message: "later" });
    const latest = history.snapshot({ ...state, status: "terminated" });
    expect(empty.events).toEqual([]);
    expect(empty.nativeEvents).toEqual([]);
    expect(empty.diagnostics).toEqual([]);
    expect(earlier.events).toEqual([event]);
    expect(earlier.nativeEvents).toEqual([event.nativeEnvelope]);
    expect(earlier.diagnostics).toEqual([diagnostic]);
    expect(earlier.status).toBe("idle");
    expect(latest.events).toHaveLength(2);
    expect(latest.diagnostics).toHaveLength(2);
  });

  it("keeps JSON, structuredClone and object spread complete and isolated", () => {
    const history = new SessionEventHistory();
    history.append(event);
    history.addDiagnostic(diagnostic);
    const snapshot = history.snapshot(state);
    const expected = {
      ...state,
      events: [event],
      nativeEvents: [event.nativeEnvelope],
      diagnostics: [diagnostic],
    };
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(expected);
    expect(structuredClone(snapshot)).toEqual(expected);
    expect({ ...snapshot }).toEqual(expected);
    // readonly 是调用者契约；即使旧调用方强转并修改数组，也不能改动内部历史。
    (snapshot.events as RuntimeEvent[]).pop();
    history.readDiagnostics().pop();
    expect(history.snapshot(state).events).toEqual([event]);
    expect(history.readDiagnostics()).toEqual([diagnostic]);
  });

  it("supports per-turn reads, native-less events and reentrant appends without truncation", () => {
    const history = new SessionEventHistory();
    history.append(event);
    const turnStart = history.eventCount;
    const broadcastSnapshot = history.snapshot(state);
    const terminal: RuntimeEvent = {
      type: "turn.completed",
      threadId: "thread",
      turnId: "turn",
      state: "completed",
    };
    history.append(terminal);
    expect(broadcastSnapshot.events).toEqual([event]);
    expect(history.eventsSince(turnStart)).toEqual([terminal]);
    expect(history.hasEvent((entry) => entry.type === "turn.completed")).toBe(true);
    expect(history.snapshot(state).nativeEvents).toEqual([event.nativeEnvelope]);
  });
});
