import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  cliEventToOpenAiChunks,
  commandCodeUsesCliGateway,
  openaiMessagesToCliParams,
  parseCliStreamEventLine,
  startCommandCodeAlphaGateway,
} from "./alphaGateway";

const closers: Array<() => void> = [];
afterEach(() => {
  while (closers.length > 0) closers.pop()?.();
});

describe("commandCode alpha gateway", () => {
  it("treats CLI user_ tokens as the /alpha/generate surface", () => {
    expect(commandCodeUsesCliGateway("user_2abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(commandCodeUsesCliGateway("sk-studio-provider-key")).toBe(false);
  });

  it("folds OpenAI chat messages into the CLI generate envelope", () => {
    const converted = openaiMessagesToCliParams({
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: "hi",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "bash", arguments: "{\"cmd\":\"ls\"}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "ok" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "bash",
            description: "run",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });
    expect(converted.system).toBe("be terse");
    expect(converted.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "hi" },
          { type: "tool-call", toolCallId: "call_1", toolName: "bash", input: { cmd: "ls" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "unknown",
            output: { type: "text", value: "ok" },
          },
        ],
      },
    ]);
    expect(converted.tools).toEqual([
      {
        type: "function",
        name: "bash",
        description: "run",
        input_schema: { type: "object", properties: {} },
      },
    ]);
  });

  it("maps CLI stream events onto OpenAI chat chunks", () => {
    const text = cliEventToOpenAiChunks({ type: "text-delta", text: "hi" }, "deepseek/flash");
    expect(text[0]).toMatchObject({
      object: "chat.completion.chunk",
      choices: [{ delta: { content: "hi" }, finish_reason: null }],
    });
    const finish = cliEventToOpenAiChunks({ type: "finish", reason: "tool-calls" }, "deepseek/flash");
    expect(finish[0]).toMatchObject({
      choices: [{ finish_reason: "tool_calls" }],
    });
    expect(parseCliStreamEventLine("data: {\"type\":\"text-delta\",\"text\":\"x\"}")).toEqual({
      type: "text-delta",
      text: "x",
    });
  });

  it("translates /v1/chat/completions into /alpha/generate", async () => {
    const seen: unknown[] = [];
    const upstream = createServer((req, res) => {
      if (req.url === "/alpha/generate") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on("end", () => {
          seen.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write('data: {"type":"text-delta","text":"pong"}\n\n');
          res.write('data: {"type":"finish","reason":"stop"}\n\n');
          res.end();
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    closers.push(() => upstream.close());
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("upstream bind failed");
    const gateway = await startCommandCodeAlphaGateway({
      apiKey: "user_2test",
      apiBase: `http://127.0.0.1:${address.port}`,
    });
    closers.push(gateway.close);
    const response = await fetch(`${gateway.origin}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4.1-flash",
        messages: [{ role: "user", content: "ping" }],
        stream: true,
      }),
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("pong");
    expect(body).toContain("[DONE]");
    expect(seen[0]).toMatchObject({
      params: {
        model: "deepseek/deepseek-v4.1-flash",
        messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      },
    });
  });
});
