import { describe, expect, it, vi } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import type { CraftPlan } from "@/shared/crafting";
import { OPENCODE_NATIVE_HARNESS_DESCRIPTOR } from "@/supervisor/runtime/nativeHarness/descriptors";
import { OpenCodeNativeRuntimeAdapter } from "./adapter";
import { mapOpenCodeNativeEvent, OpenCodeEventMapperState } from "./events";
import { OpenCodeNativeSession } from "./session";
import { safeMessage, type OpenCodeNativeClient, type OpenCodeNativeConnection } from "./transport";

const location: ProjectLocation = { kind: "windows", path: "C:/workspace" };
type ApiCall = (parameters?: Record<string, unknown>) => Promise<{ data?: unknown }>;
type EventCall = (options?: Record<string, unknown>) => Promise<{ stream: AsyncIterable<unknown> }>;

function testPlan(): CraftPlan {
  return {
    id: "plan:opencode:test",
    recipeId: "recipe:openai-opencode-native",
    resultItemId: "result:test",
    ingredients: {
      model: {
        slot: "model",
        itemId: "openai:gpt-4o",
        itemVersion: "test",
        vendor: "openai",
        kind: "model",
      },
      harness: {
        slot: "harness",
        itemId: "harness:opencode",
        itemVersion: "test",
        vendor: "opencode",
        kind: "harness",
      },
    },
    runtimeBinding: {
      harnessKind: "opencode",
      modelId: "gpt-4o",
      vendor: "openai",
      providerID: "openai",
      runtimeAdapterId: "native-harness:opencode",
      authRef: "auth:managed",
      profileRef: "profile:managed",
      options: {
        permission: [{ permission: "shell", pattern: "*", action: "ask" }],
      },
    },
    workspace: "C:/workspace",
    threadId: "thread:test",
    createdAt: new Date(0).toISOString(),
    overrides: { model: "gpt-4o", reasoningEffort: "high" },
  };
}

function makeMockClient() {
  let listener: ((event: unknown) => void) | undefined;
  const client: OpenCodeNativeClient = {
    session: {
      create: vi.fn<ApiCall>().mockResolvedValue({ data: { id: "ses_1" } }),
      get: vi.fn<ApiCall>().mockResolvedValue({ data: { id: "ses_1" } }),
      promptAsync: vi.fn<ApiCall>().mockImplementation(async () => {
        queueMicrotask(() =>
          listener?.({
            type: "session.idle",
            properties: { sessionID: "ses_1" },
          }),
        );
        return { data: {} };
      }),
      abort: vi.fn<ApiCall>().mockResolvedValue({ data: {} }),
      messages: vi.fn<ApiCall>().mockResolvedValue({ data: [] }),
      summarize: vi.fn<ApiCall>().mockResolvedValue({ data: {} }),
      delete: vi.fn<ApiCall>().mockResolvedValue({ data: {} }),
    },
    permission: { reply: vi.fn<ApiCall>().mockResolvedValue({ data: {} }) },
    question: {
      reply: vi.fn<ApiCall>().mockResolvedValue({ data: {} }),
      reject: vi.fn<ApiCall>().mockResolvedValue({ data: {} }),
    },
    provider: { list: vi.fn<ApiCall>(), auth: vi.fn<ApiCall>() },
    global: { event: vi.fn<EventCall>() },
  };
  const connection: OpenCodeNativeConnection = {
    client,
    baseUrl: "http://127.0.0.1:4096",
    correlationId: "corr:test",
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  return {
    client,
    connection,
    emitEvent: (evt: unknown) => listener?.(evt),
  };
}

describe("OpenCode Native Engineering Regression Suite (F38-F44)", () => {
  // F38: Readiness & availability gate
  it("F38: blocks spawning executable Entity when runtime descriptor is unavailable / unverified", async () => {
    const adapter = new OpenCodeNativeRuntimeAdapter({
      projectLocation: location,
      descriptor: OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
    });

    await expect(adapter.spawnEntity(testPlan())).rejects.toThrow(
      /OpenCode route 'openai:gpt-4o'.*unverified/i,
    );
  });

  // F39: Strict allowlist on native envelope payload & deduplication of full snapshots
  it("F39: strips raw provider payloads, full user prompts, and unknown secrets from native envelope", () => {
    const mapped = mapOpenCodeNativeEvent({
      raw: {
        type: "session.next.text.delta",
        properties: {
          sessionID: "ses_1",
          textID: "txt_1",
          delta: "hi",
          userPrompt: "sensitive full prompt",
          rawProviderPayload: { token: "secret", responseId: "resp_1" },
          opaqueSecret: "super_secret_value",
        },
      },
      sequence: 1,
    });

    const serializedEnvelope = JSON.stringify(mapped.envelope);
    expect(serializedEnvelope).not.toContain("sensitive full prompt");
    expect(serializedEnvelope).not.toContain("rawProviderPayload");
    expect(serializedEnvelope).not.toContain("opaqueSecret");
    expect(serializedEnvelope).not.toContain("super_secret_value");
    expect(mapped.envelope.payload).toEqual({
      sessionID: "ses_1",
      deltaLength: undefined,
    });
  });

  it("F39: deduplicates message.part.updated snapshot against incremental deltas without duplicate hellohello", () => {
    const state = new OpenCodeEventMapperState();
    state.setMessageRole("msg_1", "assistant");

    const delta = mapOpenCodeNativeEvent(
      {
        raw: {
          type: "message.part.delta",
          properties: { sessionID: "ses_1", messageID: "msg_1", partID: "p1", delta: "hello" },
        },
        sequence: 1,
      },
      state,
    );
    expect(delta.event).toMatchObject({ type: "content.delta", delta: "hello" });

    // Full snapshot carrying "hello" is deduplicated — no extra delta event
    const snapshotSame = mapOpenCodeNativeEvent(
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
    expect(snapshotSame.event).toBeUndefined();

    // Snapshot with appended text emits ONLY the difference
    const snapshotExtended = mapOpenCodeNativeEvent(
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
    expect(snapshotExtended.event).toMatchObject({ type: "content.delta", delta: " world" });
  });

  // F41: Immediate turn settlement on session.error / session.next.step.failed
  it("F41: immediately settles pending turn on session.error without hanging or waiting for idle", async () => {
    const { client, connection, emitEvent } = makeMockClient();
    vi.mocked(client.session.promptAsync).mockImplementation(async () => {
      queueMicrotask(() => {
        emitEvent({
          type: "session.error",
          properties: {
            sessionID: "ses_1",
            code: "RATE_LIMITED",
            message: "Provider rate limit exceeded",
          },
        });
      });
      return { data: {} };
    });

    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: testPlan(),
      transport: {
        connect: vi.fn<() => Promise<OpenCodeNativeConnection>>().mockResolvedValue(connection),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });

    const start = Date.now();
    await expect(session.startTurn({ prompt: "Test prompt" })).rejects.toThrow(
      "Provider rate limit exceeded",
    );
    expect(Date.now() - start).toBeLessThan(500);
    expect(session.status).toBe("error");
    await session.terminate();
  });

  // F42: Permission and question response closed loop
  it("F42: executes respondToRequest to complete permission/question closed loop", async () => {
    const { client, connection } = makeMockClient();
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: testPlan(),
      transport: {
        connect: vi.fn<() => Promise<OpenCodeNativeConnection>>().mockResolvedValue(connection),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });

    await session.respondToRequest("req_tool_perm", {
      kind: "permission",
      response: "once",
    });
    expect(client.permission.reply).toHaveBeenCalledWith({
      directory: "C:/workspace",
      requestID: "req_tool_perm",
      reply: "once",
    });
    await session.respondToRequest("req_question", {
      kind: "question",
      action: "answer",
      answers: [["choice-a", "choice-b"], ["custom"]],
    });
    expect(client.question.reply).toHaveBeenCalledWith({
      directory: "C:/workspace",
      requestID: "req_question",
      answers: [["choice-a", "choice-b"], ["custom"]],
    });
    await session.terminate();
  });

  // F43: Session model stickiness
  it("F43: enforces session model stickiness and rejects per-turn model mutation", async () => {
    const { connection } = makeMockClient();
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: testPlan(),
      transport: {
        connect: vi.fn<() => Promise<OpenCodeNativeConnection>>().mockResolvedValue(connection),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });

    await expect(
      session.startTurn({
        prompt: "Switch model",
        overrides: { model: "claude-3-5-sonnet" },
      }),
    ).rejects.toThrow(/Cannot override model.*is sticky/i);
    await session.terminate();
  });

  // F44: safeMessage sanitization
  it("F44: sanitizes secrets and query parameters without regex replacement corruption", () => {
    const result = safeMessage(
      "Failed to connect: api_key=sk-1234567890abcdef at http://example.com?token=xyz",
    );
    expect(result).not.toContain("sk-1234567890abcdef");
    expect(result).not.toContain("xyz");
    expect(result).toContain("api_key=[REDACTED]");
    expect(result).toContain("token=[REDACTED]");
    expect(result).not.toContain("$1");
  });
});
