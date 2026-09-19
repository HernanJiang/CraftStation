import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ProjectLocation } from "@/shared/contracts";
import type { CraftPlan } from "@/shared/crafting";
import type { OpenCodeNativeClient, OpenCodeNativeConnection } from "./transport";
import { OpenCodeNativeSession } from "./session";

const location: ProjectLocation = { kind: "windows", path: "C:/workspace" };
type ApiCall = (parameters?: Record<string, unknown>) => Promise<{ data?: unknown }>;
type EventCall = (options?: Record<string, unknown>) => Promise<{ stream: AsyncIterable<unknown> }>;

function plan(): CraftPlan {
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

function makeClient() {
  let listener: ((event: unknown) => void) | undefined;
  const client: OpenCodeNativeClient = {
    session: {
      update: vi.fn<ApiCall>().mockResolvedValue({ data: {} }),
      create: vi.fn<ApiCall>().mockResolvedValue({ data: { id: "ses_new" } }),
      get: vi.fn<ApiCall>().mockResolvedValue({ data: { id: "ses_resume" } }),
      promptAsync: vi.fn<ApiCall>().mockImplementation(async () => {
        queueMicrotask(() =>
          listener?.({
            type: "session.next.text.delta",
            properties: { sessionID: "ses_new", textID: "text_1", delta: "hello" },
          }),
        );
        queueMicrotask(() =>
          listener?.({
            type: "session.idle",
            properties: { sessionID: "ses_new" },
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

describe("OpenCodeNativeSession public lifecycle seam", () => {
  it("restores Ask permissions when resuming an existing session", async () => {
    const { client, connection } = makeClient();
    const craftPlan = plan();
    craftPlan.overrides = { permissionConfig: { approvalPolicy: "default" } };
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: craftPlan,
      sessionRef: "existing",
      transport: { connect: async () => connection, dispose: async () => {} } as never,
    });
    expect(client.session.create).not.toHaveBeenCalled();
    expect(client.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: [{ permission: "*", pattern: "*", action: "ask" }],
      }),
    );
    await session.terminate();
  });
  it("keeps the CraftStation provider namespace out of the remote model id", async () => {
    const { client, connection } = makeClient();
    const basePlan = plan();
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: {
        ...basePlan,
        runtimeBinding: { ...basePlan.runtimeBinding, modelId: "craftstation/glm-5.3-flash" },
      },
      transport: {
        connect: vi.fn<() => Promise<OpenCodeNativeConnection>>().mockResolvedValue(connection),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });

    expect(client.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { providerID: "openai", id: "glm-5.3-flash" },
      }),
    );
    await session.terminate();
  });

  it("applies Full at creation and Ask on the next turn", async () => {
    const { client, connection } = makeClient();
    const craftPlan = plan();
    craftPlan.overrides = { permissionConfig: { approvalPolicy: "yolo" } };
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: craftPlan,
      transport: { connect: async () => connection, dispose: async () => {} } as never,
    });
    expect(client.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      }),
    );
    await session.startTurn({
      prompt: "hello",
      overrides: { permissionConfig: { approvalPolicy: "default" } },
    });
    expect(client.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: [{ permission: "*", pattern: "*", action: "ask" }],
      }),
    );
    await session.terminate();
  });

  it("creates, prompts, summarizes and deletes through official session operations", async () => {
    const { client, connection } = makeClient();
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: plan(),
      transport: {
        connect: vi.fn<() => Promise<OpenCodeNativeConnection>>().mockResolvedValue(connection),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });
    const result = await session.startTurn({ prompt: "Say hello" });
    expect(result).toMatchObject({ status: "completed", response: "hello" });
    expect(client.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: "C:/workspace",
        model: { providerID: "openai", id: "gpt-4o" },
        metadata: expect.objectContaining({
          craftstation: expect.objectContaining({
            providerID: "openai",
            authConfigured: true,
            profileConfigured: true,
          }),
        }),
      }),
    );
    expect(JSON.stringify(vi.mocked(client.session.create).mock.calls[0]?.[0])).not.toContain(
      "auth:managed",
    );
    await session.summarize();
    expect(client.session.summarize).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "ses_new", providerID: "openai", modelID: "gpt-4o" }),
    );
    await session.terminate();
    expect(client.session.delete).toHaveBeenCalledWith({
      directory: "C:/workspace",
      sessionID: "ses_new",
    });
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it("resumes an existing session and aborts an in-flight turn", async () => {
    const { client, connection } = makeClient();
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: plan(),
      sessionRef: "ses_resume",
      transport: {
        connect: vi.fn<() => Promise<OpenCodeNativeConnection>>().mockResolvedValue(connection),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });
    expect(client.session.get).toHaveBeenCalledWith({
      directory: "C:/workspace",
      sessionID: "ses_resume",
    });
    await session.interrupt();
    expect(client.session.abort).toHaveBeenCalledWith({
      directory: "C:/workspace",
      sessionID: "ses_resume",
    });
    await session.terminate();
  });

  it("settles turn immediately on session.error or session.next.step.failed without hanging", async () => {
    const { client, connection, emitEvent } = makeClient();
    vi.mocked(client.session.promptAsync).mockImplementation(async () => {
      queueMicrotask(() => {
        emitEvent({
          type: "session.error",
          properties: { sessionID: "ses_new", code: "AUTH_FAILED", message: "API key is invalid" },
        });
      });
      return { data: {} };
    });

    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: plan(),
      transport: {
        connect: vi.fn<() => Promise<OpenCodeNativeConnection>>().mockResolvedValue(connection),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });

    await expect(session.startTurn({ prompt: "Fail me" })).rejects.toThrow("API key is invalid");
    expect(session.status).toBe("error");
    await session.terminate();
  });

  it("routes permission allow/deny to permission.reply", async () => {
    const { client, connection } = makeClient();
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: plan(),
      transport: {
        connect: vi.fn<() => Promise<OpenCodeNativeConnection>>().mockResolvedValue(connection),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });

    await session.respondToRequest("perm_123", {
      kind: "permission",
      response: "always",
    });
    expect(client.permission.reply).toHaveBeenCalledWith({
      directory: "C:/workspace",
      requestID: "perm_123",
      reply: "always",
    });
    await session.respondToRequest("perm_deny", { kind: "permission", response: "reject" });
    expect(client.permission.reply).toHaveBeenLastCalledWith({
      directory: "C:/workspace",
      requestID: "perm_deny",
      reply: "reject",
    });
    await session.terminate();
  });

  it("routes question answers and rejection through the independent question API", async () => {
    const { client, connection } = makeClient();
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: plan(),
      transport: {
        connect: vi.fn<() => Promise<OpenCodeNativeConnection>>().mockResolvedValue(connection),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });

    await session.respondToRequest("question_123", {
      kind: "question",
      action: "answer",
      answers: [["TypeScript", "Rust"], ["custom answer"]],
    });
    expect(client.question.reply).toHaveBeenCalledWith({
      directory: "C:/workspace",
      requestID: "question_123",
      answers: [["TypeScript", "Rust"], ["custom answer"]],
    });
    await session.respondToRequest("question_456", { kind: "question", action: "reject" });
    expect(client.question.reject).toHaveBeenCalledWith({
      directory: "C:/workspace",
      requestID: "question_456",
    });
    expect(client.permission.reply).not.toHaveBeenCalled();
    await session.terminate();
  });

  it("enforces session model stickiness and rejects per-turn model overrides", async () => {
    const { connection } = makeClient();
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: plan(),
      transport: {
        connect: vi.fn<() => Promise<OpenCodeNativeConnection>>().mockResolvedValue(connection),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });

    await expect(
      session.startTurn({
        prompt: "Switch model",
        overrides: { model: "gpt-4o-mini" },
      }),
    ).rejects.toThrow(/Cannot override model.*is sticky/i);
    await session.terminate();
  });

  it("rejects the admitted turn with the real exit info when the server dies mid-turn", async () => {
    const { client, connection } = makeClient();
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    };
    child.exitCode = null;
    child.signalCode = null;
    const connectionWithChild: OpenCodeNativeConnection = { ...connection, child: child as never };
    // promptAsync is accepted but the server dies before emitting anything.
    vi.mocked(client.session.promptAsync).mockImplementation(() => new Promise(() => {}));
    const session = await OpenCodeNativeSession.open({
      entityId: "entity:test",
      threadId: "thread:test",
      projectLocation: location,
      plan: plan(),
      transport: {
        connect: vi
          .fn<() => Promise<OpenCodeNativeConnection>>()
          .mockResolvedValue(connectionWithChild),
        dispose: vi.fn<() => Promise<void>>(),
      } as never,
    });

    const turnPromise = session.startTurn({ prompt: "Do work" });
    // Let promptAsync resolve and the turn admit before killing the server.
    await vi.waitFor(() => expect(client.session.promptAsync).toHaveBeenCalled());
    await Promise.resolve();
    child.emit("exit", 1, null);

    await expect(turnPromise).rejects.toThrow(/exited with code 1/);
    expect(session.status).toBe("error");
    await session.terminate();
  });
});
