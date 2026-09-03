import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { Crafter, BUILTIN_MODEL_ITEMS } from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { JsonRpcTransport } from "./jsonRpcTransport";
import { AppServerClient } from "./appServerClient";
import { AppServerProcessHost } from "./appServerProcessHost";
import { NativeCodexRuntimeAdapter } from "./nativeCodexRuntimeAdapter";

describe("v0.3: NativeCodexRuntimeAdapter Official V2 Protocol Parity", () => {
  it("projects Supervisor-resolved MCP configuration into the official app-server host", async () => {
    const adapter = new NativeCodexRuntimeAdapter({
      codexHome: "C:\\managed-codex-home",
      mcpServers: [
        {
          id: "probe",
          name: "probe",
          timeoutMs: 30_000,
          transport: {
            type: "stdio",
            command: "node",
            args: ["probe.mjs"],
            env: {},
          },
        },
      ],
    });

    await expect(
      adapter.spawnEntity(
        new Crafter().compile(
          { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
          { workspace: "D:\\test\\workspace" },
        ).craftPlan!,
      ),
    ).resolves.toBeDefined();

    const ensureClient = Reflect.get(adapter, "ensureClient") as () => Promise<AppServerClient>;
    const start = vi
      .spyOn(AppServerProcessHost.prototype, "start")
      .mockRejectedValueOnce(new Error("stop after host construction"));
    await expect(ensureClient.call(adapter)).rejects.toThrow("stop after host construction");
    const host = adapter.host!;
    expect(Reflect.get(host, "options")).toMatchObject({
      codexHome: "C:\\managed-codex-home",
      args: expect.arrayContaining([
        "-c",
        'mcp_servers.probe.command="node"',
        'mcp_servers.probe.args=["probe.mjs"]',
      ]),
    });
    start.mockRestore();
  });
  function setupMockClientTransport(
    options: {
      turnStartError?: string;
      interruptError?: string;
      accountIdentity?: string | null;
      accountReadError?: string;
      rateLimitsIdentity?: string;
      rateLimitsError?: string;
    } = {},
  ) {
    const clientToHost = new PassThrough();
    const hostToClient = new PassThrough();
    const transport = new JsonRpcTransport(hostToClient, clientToHost);
    const client = new AppServerClient(transport);

    const receivedRequests: Array<{ method: string; params: any }> = [];

    clientToHost.on("data", (chunk: Buffer) => {
      const lines = chunk
        .toString("utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const msg = JSON.parse(line);
        if ("method" in msg && "id" in msg) {
          receivedRequests.push({ method: msg.method, params: msg.params });
          if (msg.method === "initialize") {
            hostToClient.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  serverInfo: { name: "official-codex", version: "0.3.0" },
                  capabilities: { streaming: true },
                },
              }) + "\n",
            );
          } else if (msg.method === "account/read") {
            hostToClient.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                ...(options.accountReadError
                  ? { error: { code: -32010, message: options.accountReadError } }
                  : {
                      result: {
                        account: {
                          accountId:
                            options.accountIdentity === undefined
                              ? "codex:work"
                              : options.accountIdentity,
                        },
                      },
                    }),
              }) + "\n",
            );
          } else if (msg.method === "account/rateLimits/read") {
            hostToClient.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                ...(options.rateLimitsError
                  ? { error: { code: -32011, message: options.rateLimitsError } }
                  : {
                      result: {
                        limits: {},
                        ...(options.rateLimitsIdentity
                          ? { account: { accountId: options.rateLimitsIdentity } }
                          : {}),
                      },
                    }),
              }) + "\n",
            );
          } else if (msg.method === "thread/start" || msg.method === "thread/resume") {
            const threadId = msg.params?.threadId ?? "thread-official-123";
            hostToClient.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  thread: {
                    id: threadId,
                    createdAt: Date.now(),
                    cwd: msg.params?.cwd,
                  },
                },
              }) + "\n",
            );
          } else if (msg.method === "turn/start" && options.turnStartError) {
            hostToClient.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                error: { code: -32001, message: options.turnStartError },
              }) + "\n",
            );
          } else if (msg.method === "turn/start") {
            const threadId = msg.params.threadId;
            const turnId = msg.params.turnId ?? "turn-official-1";

            // Respond to turn/start with official TurnStartResponse shape
            hostToClient.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  turn: {
                    id: turnId,
                    status: "inProgress",
                  },
                },
              }) + "\n",
            );

            // Stream official V2 notifications
            setTimeout(() => {
              // 1. turn/started
              hostToClient.write(
                JSON.stringify({
                  jsonrpc: "2.0",
                  method: "turn/started",
                  params: { threadId, turn: { id: turnId, status: "inProgress" } },
                }) + "\n",
              );

              // 2. item/started (assistant message)
              hostToClient.write(
                JSON.stringify({
                  jsonrpc: "2.0",
                  method: "item/started",
                  params: {
                    threadId,
                    item: { id: "item-agent-1", type: "agentMessage" },
                  },
                }) + "\n",
              );

              // 3. agentMessage/delta (streaming chunks)
              hostToClient.write(
                JSON.stringify({
                  jsonrpc: "2.0",
                  method: "item/agentMessage/delta",
                  params: { threadId, itemId: "item-agent-1", delta: "Hello " },
                }) + "\n",
              );
              hostToClient.write(
                JSON.stringify({
                  jsonrpc: "2.0",
                  method: "item/agentMessage/delta",
                  params: { threadId, itemId: "item-agent-1", delta: "Official Codex!" },
                }) + "\n",
              );

              // 4. thread/tokenUsage/updated
              hostToClient.write(
                JSON.stringify({
                  jsonrpc: "2.0",
                  method: "thread/tokenUsage/updated",
                  params: {
                    threadId,
                    tokenUsage: {
                      last: { inputTokens: 42, outputTokens: 10 },
                      total: { inputTokens: 42, outputTokens: 10 },
                    },
                  },
                }) + "\n",
              );

              // 5. item/completed
              hostToClient.write(
                JSON.stringify({
                  jsonrpc: "2.0",
                  method: "item/completed",
                  params: { threadId, item: { id: "item-agent-1", type: "agentMessage" } },
                }) + "\n",
              );

              // 6. turn/completed
              hostToClient.write(
                JSON.stringify({
                  jsonrpc: "2.0",
                  method: "turn/completed",
                  params: {
                    threadId,
                    turn: { id: turnId, status: "completed" },
                  },
                }) + "\n",
              );
            }, 10);
          } else if (msg.method === "turn/interrupt" && options.interruptError) {
            hostToClient.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                error: { code: -32002, message: options.interruptError },
              }) + "\n",
            );
          } else {
            // Default response for turn/interrupt, turn/steer, approval/respond, etc.
            hostToClient.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: null,
              }) + "\n",
            );
          }
        }
      }
    });

    return { client, receivedRequests, hostToClient };
  }

  it("spawns Entity and starts Thread passing official V2 params to official app-server", async () => {
    const { client, receivedRequests } = setupMockClientTransport();
    const adapter = new NativeCodexRuntimeAdapter({ client });

    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;
    const plan = crafter.compile(
      { slots: { model: gptModel, harness: "auto" } },
      {
        workspace: "D:\\test\\workspace",
        threadId: "thread-v2-1",
        overrides: {
          model: "gpt-5.3-codex",
          reasoningEffort: "high",
          serviceTier: "fast",
          approvalPolicy: "never",
        },
      },
    ).craftPlan!;

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);

    expect(session.id).toBe("sess:codex:thread-official-123");
    expect(session.status).toBe("idle");

    const startThreadReq = receivedRequests.find((r) => r.method === "thread/start");
    expect(startThreadReq).toBeDefined();
    expect(startThreadReq?.params).toMatchObject({
      cwd: "D:\\test\\workspace",
      model: "gpt-5.3-codex",
      serviceTier: "fast",
      approvalPolicy: "never",
    });
  });

  function managedCodexBinding() {
    return {
      accountId: "codex:work",
      provider: "codex" as const,
      credentialScopeRef: "managed:codex:work",
      reason: "selected" as const,
      boundAt: 1,
      providerAccountId: "codex:work",
    };
  }

  function managedCodexPlan() {
    return new Crafter().compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { workspace: "D:\\test\\workspace", threadId: "thread-managed-gate" },
    ).craftPlan!;
  }

  it("requires native account identity before exposing a managed Entity", async () => {
    const { client } = setupMockClientTransport({ accountIdentity: null });
    const adapter = new NativeCodexRuntimeAdapter({
      client,
      accountBinding: managedCodexBinding(),
    });

    await expect(adapter.spawnEntity(managedCodexPlan())).rejects.toMatchObject({
      code: "ACCOUNT_IDENTITY_UNAVAILABLE",
    });
  });

  it("requires a selected provider identity before managed verification", async () => {
    const { client } = setupMockClientTransport();
    const adapter = new NativeCodexRuntimeAdapter({
      client,
      accountBinding: {
        ...managedCodexBinding(),
        providerAccountId: undefined,
      },
    });

    await expect(adapter.spawnEntity(managedCodexPlan())).rejects.toMatchObject({
      code: "ACCOUNT_IDENTITY_UNAVAILABLE",
    });
  });

  it("fails closed when account/read returns an RPC error", async () => {
    const { client } = setupMockClientTransport({ accountReadError: "not authenticated" });
    const adapter = new NativeCodexRuntimeAdapter({
      client,
      accountBinding: managedCodexBinding(),
    });

    await expect(adapter.spawnEntity(managedCodexPlan())).rejects.toMatchObject({
      code: "ACCOUNT_IDENTITY_UNAVAILABLE",
    });
  });

  it("fails closed when account/read identity mismatches the selected account", async () => {
    const { client } = setupMockClientTransport({ accountIdentity: "codex:other" });
    const adapter = new NativeCodexRuntimeAdapter({
      client,
      accountBinding: managedCodexBinding(),
    });

    await expect(adapter.spawnEntity(managedCodexPlan())).rejects.toMatchObject({
      code: "PROFILE_IDENTITY_MISMATCH",
    });
  });

  it("fails closed when account/rateLimits/read returns an RPC error", async () => {
    const { client } = setupMockClientTransport({ rateLimitsError: "rate limits unavailable" });
    const adapter = new NativeCodexRuntimeAdapter({
      client,
      accountBinding: managedCodexBinding(),
    });

    await expect(adapter.spawnEntity(managedCodexPlan())).rejects.toMatchObject({
      code: "ACCOUNT_IDENTITY_UNAVAILABLE",
    });
  });

  it("calls account/read and account/rateLimits/read for a managed injected transport", async () => {
    const { client, receivedRequests } = setupMockClientTransport();
    const adapter = new NativeCodexRuntimeAdapter({
      client,
      accountBinding: managedCodexBinding(),
    });

    await expect(adapter.spawnEntity(managedCodexPlan())).resolves.toMatchObject({
      status: "spawned",
    });
    expect(receivedRequests.map((request) => request.method)).toEqual(
      expect.arrayContaining(["initialize", "account/read", "account/rateLimits/read"]),
    );
  });

  it("rejects rate-limit context belonging to a different account", async () => {
    const { client } = setupMockClientTransport({ rateLimitsIdentity: "codex:other" });
    const adapter = new NativeCodexRuntimeAdapter({
      client,
      accountBinding: managedCodexBinding(),
    });

    await expect(adapter.spawnEntity(managedCodexPlan())).rejects.toMatchObject({
      code: "PROFILE_IDENTITY_MISMATCH",
    });
  });

  it("streams official V2 events and maps them to canonical RuntimeEvents and snapshots", async () => {
    const { client } = setupMockClientTransport();
    const adapter = new NativeCodexRuntimeAdapter({ client });

    const crafter = new Crafter();
    const plan = crafter.compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { threadId: "thread-v2-stream" },
    ).craftPlan!;

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);

    const emittedEvents: RuntimeEvent[] = [];
    session.subscribe((event) => {
      emittedEvents.push(event);
    });

    const turnResult = await session.startTurn({ prompt: "Say hello" });
    await new Promise((r) => setTimeout(r, 50));

    expect(turnResult.status).toBe("completed");
    expect(turnResult.response).toBe("Hello Official Codex!");

    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain("turn.started");
    expect(eventTypes).toContain("item.started");
    expect(eventTypes).toContain("content.delta");
    expect(eventTypes).toContain("usage.spent");
    expect(eventTypes).toContain("item.completed");
    expect(eventTypes).toContain("turn.completed");

    const tokenEvent = emittedEvents.find((e) => e.type === "usage.spent");
    expect(tokenEvent).toMatchObject({
      type: "usage.spent",
      nativeEnvelope: {
        harnessKind: "codex",
        source: "native",
        nativeType: "thread/tokenUsage/updated",
        providerSessionId: "thread-official-123",
      },
      usage: {
        counterKind: "cumulative",
        counter: 52,
        scopeId: "thread-official-123",
        epoch: 0,
        fresh: true,
      },
    });

    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe("idle");
    expect(snapshot.activeTurnStatus).toBe("completed");
    expect(snapshot.nativeSessionRef).toBe("thread-official-123");
    expect(snapshot.nativeEvents?.length).toBe(emittedEvents.length);
    expect(snapshot.events.length).toBe(emittedEvents.length);
  });

  it("forwards official child-thread activity with canonical subagent identity", async () => {
    const { client, hostToClient } = setupMockClientTransport();
    const adapter = new NativeCodexRuntimeAdapter({ client });
    const plan = new Crafter().compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { threadId: "thread-native-subagent" },
    ).craftPlan!;
    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);
    const events: RuntimeEvent[] = [];
    session.subscribe((event) => events.push(event));

    for (const notification of [
      {
        method: "item/started",
        params: {
          threadId: session.threadId,
          item: {
            id: "collab-native-1",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            status: "inProgress",
            receiverThreadIds: ["child-native-1"],
            prompt: "Inspect one thing",
          },
        },
      },
      {
        method: "item/started",
        params: {
          threadId: "child-native-1",
          item: { id: "child-message-1", type: "agentMessage" },
        },
      },
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "child-native-1",
          itemId: "child-message-1",
          delta: "native child result",
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "child-native-1",
          turn: { id: "child-turn-1", status: "completed" },
        },
      },
    ]) {
      hostToClient.write(`${JSON.stringify({ jsonrpc: "2.0", ...notification })}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 30));

    const parentStarted = events.find(
      (event): event is Extract<RuntimeEvent, { type: "item.started" }> =>
        event.type === "item.started" && event.itemId === "collab-native-1",
    );
    expect(parentStarted).toMatchObject({
      itemType: "tool_call",
      payload: { name: "spawnAgent", isSubAgent: true, status: "running" },
      nativeEnvelope: { source: "native", nativeType: "item/started" },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item.started",
        itemId: "child-message-1",
        itemType: "assistant_message",
        parentItemId: "collab-native-1",
      }),
    );
    const parentCompleted = events.find(
      (event) => event.type === "item.completed" && event.itemId === "collab-native-1",
    );
    expect(parentCompleted).toMatchObject({
      payload: expect.objectContaining({
        isSubAgent: true,
        status: "success",
        result: "native child result",
      }),
      nativeEnvelope: expect.objectContaining({
        source: "native",
        nativeType: "turn/completed",
      }),
    });
  });

  it("reports an app-server protocol failure as a stable native diagnostic", async () => {
    const { client } = setupMockClientTransport({
      turnStartError: "native protocol mismatch",
    });
    const adapter = new NativeCodexRuntimeAdapter({ client });
    const plan = new Crafter().compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { threadId: "thread-transport-close" },
    ).craftPlan!;

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);
    const turn = session.startTurn({ prompt: "close transport" });

    await expect(turn).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
    expect(session.getDiagnostics?.() ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PROTOCOL_MISMATCH",
          operation: "startTurn",
        }),
      ]),
    );
    expect(session.getSnapshot().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "turn.completed",
          state: "failed",
        }),
      ]),
    );
  });

  it("carries the launch account into native usage events before thread persistence catches up", async () => {
    const { client } = setupMockClientTransport();
    const adapter = new NativeCodexRuntimeAdapter({
      client,
      accountBinding: {
        accountId: "codex:work",
        provider: "codex",
        credentialScopeRef: "managed:codex:work",
        reason: "selected",
        boundAt: 1,
        providerAccountId: "codex:work",
      },
    });
    const plan = new Crafter().compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { threadId: "thread-account-usage" },
    ).craftPlan!;

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);
    const events: RuntimeEvent[] = [];
    session.subscribe((event) => events.push(event));
    await session.startTurn({ prompt: "account usage" });

    expect(events.find((event) => event.type === "usage.spent")).toMatchObject({
      usage: { accountId: "codex:work" },
    });
  });

  it("supports continuous multi-turn conversations on the same native Session", async () => {
    const { client, receivedRequests } = setupMockClientTransport();
    const adapter = new NativeCodexRuntimeAdapter({ client });

    const crafter = new Crafter();
    const plan = crafter.compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { threadId: "thread-multiturn" },
    ).craftPlan!;

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);

    // Turn 1
    const turn1Promise = session.startTurn({ prompt: "First Turn" });
    const turn1 = await turn1Promise;
    expect(turn1.status).toBe("completed");

    // Turn 2
    const turn2Promise = session.startTurn({ prompt: "Second Turn" });
    const turn2 = await turn2Promise;
    expect(turn2.status).toBe("completed");

    const turnRequests = receivedRequests.filter((r) => r.method === "turn/start");
    expect(turnRequests.length).toBe(2);
    expect(turnRequests[0]?.params?.input[0]?.text).toBe("First Turn");
    expect(turnRequests[1]?.params?.input[0]?.text).toBe("Second Turn");
    expect(turnRequests[0]?.params?.collaborationMode).toMatchObject({
      mode: "default",
      settings: {
        model: plan.runtimeBinding.modelId,
        reasoning_effort: "medium",
      },
    });
  });

  it("supports steer and interrupt commands during an active turn", async () => {
    const { client, receivedRequests } = setupMockClientTransport();
    const adapter = new NativeCodexRuntimeAdapter({ client });

    const crafter = new Crafter();
    const plan = crafter.compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { threadId: "thread-steer" },
    ).craftPlan!;

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);

    // Start turn
    const turnPromise = session.startTurn({ prompt: "Long work" });

    // Steer
    await session.steer?.("Focus on types only");
    const steerReq = receivedRequests.find((r) => r.method === "turn/steer");
    expect(steerReq).toBeDefined();
    expect(steerReq?.params?.input?.[0]?.text).toBe("Focus on types only");

    // Interrupt
    await session.interrupt();
    const interruptReq = receivedRequests.find((r) => r.method === "turn/interrupt");
    expect(interruptReq).toBeDefined();

    const turnRes = await turnPromise;
    expect(turnRes.status).toBe("interrupted");
  });

  it("propagates interrupt failures instead of faking a local turn completion", async () => {
    const { client, receivedRequests } = setupMockClientTransport({
      interruptError: "app-server rejected interrupt",
    });
    const adapter = new NativeCodexRuntimeAdapter({ client });

    const crafter = new Crafter();
    const plan = crafter.compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { threadId: "thread-interrupt-fail" },
    ).craftPlan!;

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);
    const events: Array<{ type: string; state?: string }> = [];
    session.subscribe((event) => {
      events.push({
        type: event.type,
        ...((event as { state?: string }).state
          ? { state: (event as { state?: string }).state }
          : {}),
      });
    });

    const turnPromise = session.startTurn({ prompt: "Long work" });
    await expect(session.interrupt()).rejects.toThrow("app-server rejected interrupt");
    expect(receivedRequests.some((r) => r.method === "turn/interrupt")).toBe(true);
    // The failure must NOT emit a fake turn.completed: the supervisor's
    // interrupt watchdog owns the local force-close decision. (The mock host
    // may still deliver its own scripted turn/completed later; only the local
    // optimistic emission is forbidden here.)
    expect(events.some((e) => e.type === "turn.completed")).toBe(false);
    void turnPromise.catch(() => undefined);
  });

  it("integrates Approval and Permission control plane requests from official app-server", async () => {
    const { client, hostToClient } = setupMockClientTransport();

    let handledApproval = false;
    const adapter = new NativeCodexRuntimeAdapter({
      client,
      approvalHandler: async (req) => {
        if (req.method === "command/requestApproval") {
          handledApproval = true;
          return { decision: "accept", feedback: "Approved by CraftStation user" };
        }
        return { decision: "decline" };
      },
    });

    const crafter = new Crafter();
    const plan = crafter.compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { threadId: "thread-approval" },
    ).craftPlan!;

    const entity = await adapter.spawnEntity(plan);
    await adapter.createSession(entity);

    // Simulate server sending approval request
    hostToClient.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 777,
        method: "command/requestApproval",
        params: { command: "pnpm test" },
      }) + "\n",
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(handledApproval).toBe(true);
  });
});
