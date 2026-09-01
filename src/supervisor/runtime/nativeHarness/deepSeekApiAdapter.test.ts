import { afterEach, describe, expect, it, vi } from "vitest";
import type { CraftPlan } from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts";
import { DEEPSEEK_API_HARNESS_DESCRIPTOR } from "./descriptors";
import { DeepSeekApiRuntimeAdapter } from "./deepSeekApiAdapter";
import type { DeepSeekApiMcpRuntime, DeepSeekApiToolDefinition } from "./deepSeekApiMcp";

const apiKeyEnv = "CRAFTSTATION_DEEPSEEK_API_TEST_KEY";

function plan(): CraftPlan {
  return {
    id: "plan:deepseek-api:test",
    recipeId: "recipe:deepseek-api",
    resultItemId: "result:deepseek-api",
    ingredients: {
      model: {
        slot: "model",
        itemId: "deepseek:deepseek-chat-api",
        itemVersion: "1.0.0",
        vendor: "deepseek",
        kind: "model",
      },
      harness: {
        slot: "harness",
        itemId: "harness:deepseek-api",
        itemVersion: "1.0.0",
        vendor: "deepseek",
        kind: "harness",
      },
    },
    runtimeBinding: {
      harnessKind: "deepseek-api",
      modelId: "deepseek-chat",
      vendor: "deepseek",
      runtimeAdapterId: "native-harness:deepseek-api",
      options: { apiKeyEnv, apiBaseUrl: "https://deepseek.test/v1" },
    },
    workspace: "C:\\repo",
    threadId: "thread:deepseek-api:test",
    createdAt: new Date(0).toISOString(),
  };
}

function streamingResponse(content: string): Response {
  const payload = JSON.stringify({
    choices: [{ delta: { content } }],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
  });
  return new Response(`data: ${payload}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function toolCallResponse(): Response {
  const chunks = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-probe",
                type: "function",
                function: { name: "read_probe_marker", arguments: "{" },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: "}" },
              },
            ],
          },
        },
      ],
    },
  ];
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("data: [DONE]\n\n"),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function mcpRuntime(): DeepSeekApiMcpRuntime {
  const tool: DeepSeekApiToolDefinition = {
    type: "function",
    function: {
      name: "read_probe_marker",
      description: "Read the deterministic acceptance marker.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    mcpServerName: "craftstation-api-probe",
    mcpToolName: "read_probe_marker",
  };
  return {
    listTools: vi.fn<DeepSeekApiMcpRuntime["listTools"]>(async () => [tool]),
    callTool: vi.fn<DeepSeekApiMcpRuntime["callTool"]>(async () => ({
      content: "DEEPSEEK_API_MCP_OK",
      isError: false,
    })),
    close: vi.fn<DeepSeekApiMcpRuntime["close"]>(async () => undefined),
  };
}

async function createSession() {
  process.env[apiKeyEnv] = "test-only-key";
  const adapter = new DeepSeekApiRuntimeAdapter({
    descriptor: DEEPSEEK_API_HARNESS_DESCRIPTOR,
    projectLocation: { kind: "windows", path: "C:\\repo" },
  });
  const entity = await adapter.spawnEntity(plan());
  const session = await adapter.createSession(entity);
  return { adapter, session };
}

afterEach(() => {
  delete process.env[apiKeyEnv];
  vi.unstubAllGlobals();
});

describe("DeepSeek API native runtime adapter", () => {
  it("keeps successful turns in one session transcript without persisting failed prompts", async () => {
    const requestBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      if (requestBodies.length === 2) {
        return new Response(JSON.stringify({ error: { message: "temporary provider failure" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return streamingResponse(requestBodies.length === 1 ? "FIRST_OK" : "THIRD_OK");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { session } = await createSession();

    await expect(session.startTurn({ prompt: "first prompt" })).resolves.toMatchObject({
      status: "completed",
      response: "FIRST_OK",
    });
    await expect(session.startTurn({ prompt: "failed prompt" })).rejects.toMatchObject({
      code: "EXECUTION_FAILED",
    });
    await expect(session.startTurn({ prompt: "third prompt" })).resolves.toMatchObject({
      status: "completed",
      response: "THIRD_OK",
    });

    expect(requestBodies[0]?.messages).toEqual([{ role: "user", content: "first prompt" }]);
    expect(requestBodies[1]?.messages).toEqual([
      { role: "user", content: "first prompt" },
      { role: "assistant", content: "FIRST_OK" },
      { role: "user", content: "failed prompt" },
    ]);
    expect(requestBodies[2]?.messages).toEqual([
      { role: "user", content: "first prompt" },
      { role: "assistant", content: "FIRST_OK" },
      { role: "user", content: "third prompt" },
    ]);
    await session.terminate();
  });

  it("binds interrupt to the active request and emits one interrupted completion without a false error", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined;
          requestSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { adapter, session } = await createSession();
    const events: RuntimeEvent[] = [];
    session.subscribe((event) => events.push(event));

    const turn = session.startTurn({ prompt: "wait until interrupted" });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await session.interrupt();
    await expect(turn).resolves.toMatchObject({ status: "interrupted" });

    expect(events.filter((event) => event.type === "turn.completed")).toEqual([
      expect.objectContaining({ state: "interrupted" }),
    ]);
    expect(events.filter((event) => event.type === "error")).toHaveLength(0);
    expect(session.status).toBe("idle");
    expect(adapter.getActiveSessions()).toHaveLength(1);

    await session.terminate();
    await session.terminate();
    expect(events.filter((event) => event.type === "session.exited")).toHaveLength(1);
    expect(adapter.getActiveSessions()).toHaveLength(0);
  });

  it("executes streamed DeepSeek tool calls through the selected MCP runtime and sends tool results back", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const runtime = mcpRuntime();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestBodies.push(body);
      return requestBodies.length === 1
        ? toolCallResponse()
        : streamingResponse("DEEPSEEK_API_AGENTIC_OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    process.env[apiKeyEnv] = "test-only-key";
    const adapter = new DeepSeekApiRuntimeAdapter({
      descriptor: DEEPSEEK_API_HARNESS_DESCRIPTOR,
      projectLocation: { kind: "windows", path: "C:\\repo" },
      mcpServers: [
        {
          id: "probe",
          name: "probe",
          timeoutMs: 30_000,
          transport: { type: "stdio", command: "node", args: [], env: {} },
        },
      ],
      createMcpRuntime: () => runtime,
    });
    const entity = await adapter.spawnEntity(plan());
    const session = await adapter.createSession(entity);
    const events: RuntimeEvent[] = [];
    session.subscribe((event) => events.push(event));

    await expect(
      session.startTurn({ prompt: "Read the marker and report it." }),
    ).resolves.toMatchObject({
      status: "completed",
      response: "DEEPSEEK_API_AGENTIC_OK",
    });
    expect(runtime.listTools).toHaveBeenCalledTimes(1);
    expect(runtime.callTool).toHaveBeenCalledWith("read_probe_marker", {}, expect.any(AbortSignal));
    expect(requestBodies[0]?.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "read_probe_marker" }) }),
    ]);
    expect(JSON.stringify(requestBodies[0]?.tools)).not.toContain("mcpServerName");
    expect(JSON.stringify(requestBodies[0]?.tools)).not.toContain("mcpToolName");
    expect(requestBodies[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "tool", content: "DEEPSEEK_API_MCP_OK" }),
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.started",
          itemType: "mcp_tool_call",
          payload: expect.objectContaining({
            mcpServerName: "craftstation-api-probe",
            mcpToolName: "read_probe_marker",
          }),
        }),
        expect.objectContaining({
          type: "item.completed",
          payload: expect.objectContaining({
            mcpServerName: "craftstation-api-probe",
            mcpToolName: "read_probe_marker",
          }),
        }),
        expect.objectContaining({ type: "context.updated" }),
      ]),
    );
    await session.terminate();
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });
});
