import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { Crafter, BUILTIN_MODEL_ITEMS } from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { JsonRpcTransport } from "./jsonRpcTransport";
import { AppServerClient } from "./appServerClient";
import { NativeCodexRuntimeAdapter } from "./nativeCodexRuntimeAdapter";

describe("v0.3: NativeCodexRuntimeAdapter Official V2 Protocol Parity", () => {
  function setupMockClientTransport() {
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

    const tokenEvent = emittedEvents.find((e) => e.type === "usage.spent") as any;
    expect(tokenEvent?.inputTokens).toBe(42);
    expect(tokenEvent?.outputTokens).toBe(10);

    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe("idle");
    expect(snapshot.activeTurnStatus).toBe("completed");
    expect(snapshot.events.length).toBe(emittedEvents.length);
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
