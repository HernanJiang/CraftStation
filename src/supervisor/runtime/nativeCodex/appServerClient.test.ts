import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { JsonRpcTransport } from "./jsonRpcTransport";
import { AppServerClient } from "./appServerClient";
import type { JsonRpcNotification, JsonRpcRequest } from "./types";

describe("v0.3/T02: Codex App-Server JSON-RPC Transport & Official V2 Schema", () => {
  it("correlates JSON-RPC initialize and initialized messages adhering to official schema", async () => {
    const clientToHost = new PassThrough();
    const hostToClient = new PassThrough();

    const transport = new JsonRpcTransport(hostToClient, clientToHost);
    const client = new AppServerClient(transport);

    let clientInitializedNotified = false;
    let receivedClientName: string | undefined;

    // Host handles initialize request
    clientToHost.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      const msg = JSON.parse(line);
      if (msg.method === "initialize") {
        receivedClientName = msg.params?.clientInfo?.name;
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            serverInfo: { name: "codex-app-server", version: "0.3.0" },
            capabilities: { streaming: true, tools: true },
            authStatus: { authenticated: true, account: "user@openai.com" },
          },
        };
        hostToClient.write(JSON.stringify(response) + "\n");
      } else if (msg.method === "initialized") {
        clientInitializedNotified = true;
      }
    });

    const initResult = await client.initialize();
    expect(receivedClientName).toBe("CraftStation");
    expect(initResult.serverInfo?.name).toBe("codex-app-server");
    expect(initResult.capabilities?.streaming).toBe(true);
    expect(client.isInitialized).toBe(true);
    expect(clientInitializedNotified).toBe(true);
  });

  it("handles official model/list result and capability snapshot", async () => {
    const clientToHost = new PassThrough();
    const hostToClient = new PassThrough();

    const transport = new JsonRpcTransport(hostToClient, clientToHost);
    const client = new AppServerClient(transport);

    clientToHost.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      const msg = JSON.parse(line);
      if (msg.method === "initialize") {
        hostToClient.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              serverInfo: { name: "codex-app-server", version: "1.0.0" },
              capabilities: {},
              authStatus: { authenticated: true, account: "test-user" },
            },
          }) + "\n",
        );
      } else if (msg.method === "model/list") {
        hostToClient.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              models: [
                { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex", contextWindow: 200000 },
                { id: "gpt-5-codex", displayName: "GPT-5 Codex", contextWindow: 128000 },
              ],
            },
          }) + "\n",
        );
      }
    });

    const snapshot = await client.getCapabilitySnapshot();
    expect(snapshot.serverInfo.version).toBe("1.0.0");
    expect(snapshot.models.length).toBe(2);
    expect(snapshot.models[0]?.id).toBe("gpt-5.3-codex");
  });

  it("F03: throws observable error on model/list failure instead of silent fallback", async () => {
    const clientToHost = new PassThrough();
    const hostToClient = new PassThrough();

    const transport = new JsonRpcTransport(hostToClient, clientToHost);
    const client = new AppServerClient(transport);

    clientToHost.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      const msg = JSON.parse(line);
      if (msg.method === "initialize") {
        hostToClient.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              serverInfo: { name: "codex-app-server", version: "1.0.0" },
            },
          }) + "\n",
        );
      } else if (msg.method === "model/list") {
        hostToClient.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: -32603,
              message: "Internal model provider unreachable",
            },
          }) + "\n",
        );
      }
    });

    await expect(client.listModels()).rejects.toThrow(/Failed to fetch official model list/);
  });

  it("handles server-initiated requests with client responses", async () => {
    const clientToHost = new PassThrough();
    const hostToClient = new PassThrough();

    const transport = new JsonRpcTransport(hostToClient, clientToHost);
    const client = new AppServerClient(transport);

    let clientResponded = false;
    client.setServerRequestHandler(async (req: JsonRpcRequest) => {
      if (req.method === "command/requestApproval") {
        return { decision: "accept" };
      }
      throw new Error("Unknown server request");
    });

    clientToHost.on("data", (chunk: Buffer) => {
      const msg = JSON.parse(chunk.toString("utf8").trim());
      if (msg.id === 999 && msg.result?.decision === "accept") {
        clientResponded = true;
      }
    });

    // Simulate server sending approval request
    hostToClient.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 999,
        method: "command/requestApproval",
        params: { command: "git status" },
      }) + "\n",
    );

    // Wait a tick for async processing
    await new Promise((r) => setTimeout(r, 20));
    expect(clientResponded).toBe(true);
  });

  it("dispatches server notifications to listeners", async () => {
    const clientToHost = new PassThrough();
    const hostToClient = new PassThrough();

    const transport = new JsonRpcTransport(hostToClient, clientToHost);
    const client = new AppServerClient(transport);

    const receivedNotifications: JsonRpcNotification[] = [];
    client.onNotification((notif) => {
      receivedNotifications.push(notif);
    });

    hostToClient.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/started",
        params: { threadId: "t-1", turn: { id: "turn-1" } },
      }) + "\n",
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(receivedNotifications.length).toBe(1);
    expect(receivedNotifications[0]?.method).toBe("turn/started");
  });
});
