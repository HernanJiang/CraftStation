import { describe, expect, it } from "vitest";
import { mapOpenCodeNativeEvent, OpenCodeEventMapperState } from "./events";

describe("OpenCode native SSE canonicalizer", () => {
  it("projects SDK v2 nested session errors without exposing response metadata", () => {
    const result = mapOpenCodeNativeEvent({
      raw: {
        type: "session.error",
        properties: {
          sessionID: "ses_error",
          error: {
            name: "APIError",
            data: {
              message: "Provider rejected the request",
              responseBody: "sensitive-provider-body",
              responseHeaders: { authorization: "Bearer sensitive-token" },
            },
          },
        },
      },
      threadId: "thread-error",
      turnId: "turn-error",
      sequence: 0,
    });

    expect(result.event).toMatchObject({
      type: "error",
      message: "Provider rejected the request",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sensitive-provider-body");
    expect(serialized).not.toContain("sensitive-token");
  });

  it("maps streamed text and keeps a safe native envelope", () => {
    const result = mapOpenCodeNativeEvent({
      raw: {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_1",
          partID: "prt_1",
          field: "text",
          delta: "hello",
          token: "secret",
        },
      },
      threadId: "thread_1",
      turnId: "turn_1",
      sequence: 3,
    });
    expect(result.event).toMatchObject({
      type: "content.delta",
      delta: "hello",
      nativeEnvelope: { providerSessionId: "ses_1", sequence: 3 },
    });
    expect(JSON.stringify(result.envelope)).not.toContain("secret");
  });

  it("preserves unknown events as diagnostics instead of dropping them", () => {
    const result = mapOpenCodeNativeEvent({
      raw: { type: "future.event", properties: { sessionID: "ses_2" } },
      threadId: "thread_1",
      turnId: "turn_1",
      sequence: 4,
    });
    expect(result.diagnostic).toMatchObject({
      code: "PROTOCOL_MISMATCH",
      operation: "sse.unknown-event",
    });
    expect(result.event?.type).toBe("warning");
  });

  it("accepts the v2 global-event payload wrapper and maps modern text/tool events", () => {
    const text = mapOpenCodeNativeEvent({
      raw: {
        directory: "C:/workspace",
        payload: {
          id: "evt_1",
          type: "session.next.text.delta",
          properties: { sessionID: "ses_3", textID: "txt_1", delta: "world" },
        },
      },
      threadId: "thread_1",
      turnId: "turn_2",
      sequence: 5,
    });
    expect(text.event).toMatchObject({
      type: "content.delta",
      itemId: "txt_1",
      delta: "world",
    });

    const tool = mapOpenCodeNativeEvent({
      raw: {
        payload: {
          id: "evt_2",
          type: "session.next.tool.completed",
          properties: { sessionID: "ses_3", callID: "call_1", name: "test_tool" },
        },
      },
      threadId: "thread_1",
      turnId: "turn_2",
      sequence: 6,
    });
    expect(tool.event).toMatchObject({
      type: "item.completed",
      itemId: "call_1",
      payload: { name: "test_tool", status: "success" },
    });
  });

  it("deduplicates message.part.updated full snapshot against prior deltas without duplicate emission", () => {
    const state = new OpenCodeEventMapperState();
    state.setMessageRole("msg_1", "assistant");

    const delta1 = mapOpenCodeNativeEvent(
      {
        raw: {
          type: "message.part.delta",
          properties: { sessionID: "ses_1", messageID: "msg_1", partID: "p1", delta: "hello" },
        },
        sequence: 1,
      },
      state,
    );
    expect(delta1.event).toMatchObject({ type: "content.delta", delta: "hello" });

    // Same text received via full snapshot updated event: should not emit "hello" again
    const update1 = mapOpenCodeNativeEvent(
      {
        raw: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_1",
            messageID: "msg_1",
            part: { id: "p1", type: "text", text: "hello" },
          },
        },
        sequence: 2,
      },
      state,
    );
    expect(update1.event).toBeUndefined();

    // Incremental growth in snapshot: emits only the appended difference
    const update2 = mapOpenCodeNativeEvent(
      {
        raw: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_1",
            messageID: "msg_1",
            part: { id: "p1", type: "text", text: "hello world" },
          },
        },
        sequence: 3,
      },
      state,
    );
    expect(update2.event).toMatchObject({ type: "content.delta", delta: " world" });
  });

  it("does not emit assistant content deltas for user or system message roles", () => {
    const state = new OpenCodeEventMapperState();
    state.setMessageRole("msg_user", "user");

    const userDelta = mapOpenCodeNativeEvent(
      {
        raw: {
          type: "message.part.delta",
          properties: {
            sessionID: "ses_1",
            messageID: "msg_user",
            partID: "p_u",
            delta: "User prompt text",
          },
        },
        sequence: 1,
      },
      state,
    );
    expect(userDelta.event).toBeUndefined();
  });

  it("preserves safe question text, multiple/custom options and tool context", () => {
    const result = mapOpenCodeNativeEvent({
      raw: {
        type: "question.asked",
        properties: {
          id: "question_1",
          questions: [
            {
              header: "Languages",
              question: "Choose languages",
              multiple: true,
              custom: true,
              options: [
                { label: "TypeScript", description: "Web and desktop" },
                { label: "Rust", description: "Native core" },
              ],
            },
          ],
          tool: { messageID: "msg_1", callID: "call_1", token: "must-not-leak" },
          nestedSecret: { password: "must-not-leak" },
        },
      },
      threadId: "thread_1",
      turnId: "turn_1",
      sequence: 9,
    });

    expect(result.event).toMatchObject({
      type: "request.opened",
      requestId: "question_1",
      requestType: "tool_user_input",
      payload: {
        summary: "Languages",
        multiSelect: true,
        options: [
          { optionId: "q0.0", label: "TypeScript" },
          { optionId: "q0.1", label: "Rust" },
        ],
        details: {
          userInputForm: {
            questions: [expect.objectContaining({ multiSelect: true, custom: true })],
          },
          tool: { messageID: "msg_1", callID: "call_1" },
        },
      },
    });
    expect(JSON.stringify(result.envelope)).not.toContain("must-not-leak");
    expect(JSON.stringify(result.event)).not.toContain("must-not-leak");
  });

  it("maps official SDK v2 permission/question events from their data payload", () => {
    const permission = mapOpenCodeNativeEvent({
      raw: {
        id: "event_permission",
        type: "permission.v2.asked",
        data: {
          id: "permission_1",
          sessionID: "ses_v2",
          action: "bash",
          resources: ["npm test", "Bearer resource-secret"],
          source: { type: "tool", messageID: "msg_1", callID: "call_1" },
          metadata: { authorization: "Bearer must-not-leak" },
        },
      },
      threadId: "thread_v2",
      sequence: 10,
    });
    expect(permission.event).toMatchObject({
      type: "request.opened",
      requestId: "permission_1",
      requestType: "tool_call_approval",
      payload: {
        details: {
          permissionId: "permission_1",
          name: "bash",
          resources: ["npm test", "[REDACTED_AUTH]"],
          source: { messageID: "msg_1", callID: "call_1" },
        },
      },
    });

    const question = mapOpenCodeNativeEvent({
      raw: {
        id: "event_question",
        type: "question.v2.asked",
        data: {
          id: "question_v2",
          sessionID: "ses_v2",
          questions: [
            {
              header: "Targets",
              question: "Choose targets",
              options: [{ label: "Unit", description: "Unit tests" }],
              multiple: true,
              custom: true,
            },
          ],
          tool: { messageID: "msg_2", callID: "call_2" },
        },
      },
      threadId: "thread_v2",
      sequence: 11,
    });
    expect(question.event).toMatchObject({
      type: "request.opened",
      requestId: "question_v2",
      requestType: "tool_user_input",
      payload: {
        details: {
          userInputForm: {
            questions: [expect.objectContaining({ multiSelect: true, custom: true })],
          },
        },
      },
    });

    for (const [type, outcome] of [
      ["permission.v2.replied", "declined"],
      ["question.v2.replied", "answered"],
      ["question.v2.rejected", "declined"],
    ] as const) {
      const resolved = mapOpenCodeNativeEvent({
        raw: {
          type,
          data: {
            sessionID: "ses_v2",
            requestID: "request_v2",
            ...(type === "permission.v2.replied" ? { reply: "reject" } : {}),
          },
        },
        threadId: "thread_v2",
        sequence: 12,
      });
      expect(resolved.event).toMatchObject({
        type: "request.resolved",
        requestId: "request_v2",
        outcome,
      });
    }
    expect(JSON.stringify(permission)).not.toContain("must-not-leak");
  });
});
