import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export const COMMANDCODE_CLI_API_BASE = "https://api.commandcode.ai";
export const COMMANDCODE_CLI_VERSION = "1.53.1";

export function commandCodeUsesCliGateway(apiKey: string): boolean {
  return /^user_/iu.test(apiKey.trim());
}

export interface CommandCodeAlphaGateway {
  origin: string;
  port: number;
  close: () => void;
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": data.length });
  res.end(data);
}

function writeSse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function projectSlugFromPath(pathName: string): string {
  const slug = pathName
    .toLowerCase()
    .replace(/^[a-z]:/iu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|(?<!-)-+$/gu, "");
  return slug || "project";
}

export function openaiMessagesToCliParams(body: Record<string, unknown>): {
  system: string;
  messages: unknown[];
  tools: unknown[];
} {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts: string[] = [];
  const messages: unknown[] = [];
  for (const entry of rawMessages) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const role = typeof rec.role === "string" ? rec.role : "";
    if (role === "system") {
      const text = openaiContentText(rec.content);
      if (text) systemParts.push(text);
      continue;
    }
    if (role === "tool") {
      const callId = typeof rec.tool_call_id === "string" ? rec.tool_call_id : "tool";
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: callId,
            toolName: typeof rec.name === "string" ? rec.name : "unknown",
            output: { type: "text", value: openaiContentText(rec.content) },
          },
        ],
      });
      continue;
    }
    if (role === "assistant") {
      const parts: unknown[] = [];
      const text = openaiContentText(rec.content);
      if (text) parts.push({ type: "text", text });
      if (typeof rec.reasoning_content === "string" && rec.reasoning_content) {
        parts.push({ type: "reasoning", text: rec.reasoning_content });
      }
      if (Array.isArray(rec.tool_calls)) {
        for (const call of rec.tool_calls) {
          const tool = asRecord(call);
          const fn = asRecord(tool?.function);
          if (!tool || !fn) continue;
          parts.push({
            type: "tool-call",
            toolCallId: typeof tool.id === "string" ? tool.id : randomUUID(),
            toolName: typeof fn.name === "string" ? fn.name : "unknown",
            input: parseToolArguments(fn.arguments),
          });
        }
      }
      if (parts.length > 0) messages.push({ role: "assistant", content: parts });
      continue;
    }
    const text = openaiContentText(rec.content);
    if (text) messages.push({ role: "user", content: [{ type: "text", text }] });
  }
  const tools = Array.isArray(body.tools)
    ? body.tools.flatMap((tool) => {
        const rec = asRecord(tool);
        const fn = asRecord(rec?.function) ?? rec;
        if (!fn || typeof fn.name !== "string") return [];
        return [
          {
            type: "function",
            name: fn.name,
            description: typeof fn.description === "string" ? fn.description : "",
            input_schema:
              asRecord(fn.parameters) ?? asRecord(fn.input_schema) ?? {
                type: "object",
                properties: {},
              },
          },
        ];
      })
    : [];
  return { system: systemParts.join("\n"), messages, tools };
}

function openaiContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const rec = asRecord(part);
      return rec && typeof rec.text === "string" ? rec.text : "";
    })
    .filter(Boolean)
    .join("");
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return asRecord(parsed) ?? {};
    } catch {
      return {};
    }
  }
  return asRecord(value) ?? {};
}

export function parseCliStreamEventLine(line: string): Record<string, unknown> | undefined {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) return undefined;
  if (trimmed.startsWith("data:")) trimmed = trimmed.slice(5).trim();
  if (!trimmed || trimmed === "[DONE]") return undefined;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

function openAiChunk(
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): Record<string, unknown> {
  return {
    id: `chatcmpl-cc-${randomUUID()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export function cliEventToOpenAiChunks(
  event: Record<string, unknown>,
  model: string,
): Record<string, unknown>[] {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "text-delta") {
    const text =
      (typeof event.text === "string" && event.text) ||
      (typeof event.delta === "string" && event.delta) ||
      "";
    return text ? [openAiChunk(model, { content: text })] : [];
  }
  if (type === "reasoning-delta" || type === "reasoning-start") {
    const text =
      (typeof event.text === "string" && event.text) ||
      (typeof event.delta === "string" && event.delta) ||
      "";
    return text ? [openAiChunk(model, { reasoning_content: text })] : [];
  }
  if (type === "tool-call") {
    const id =
      (typeof event.toolCallId === "string" && event.toolCallId) ||
      (typeof event.id === "string" && event.id) ||
      randomUUID();
    const name =
      (typeof event.toolName === "string" && event.toolName) ||
      (typeof event.name === "string" && event.name) ||
      "unknown";
    const args = event.input ?? event.arguments ?? {};
    return [
      openAiChunk(model, {
        tool_calls: [
          {
            index: 0,
            id,
            type: "function",
            function: {
              name,
              arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
            },
          },
        ],
      }),
    ];
  }
  if (type === "finish") {
    const reason = typeof event.reason === "string" ? event.reason : "";
    const finish =
      reason === "tool-calls" || reason === "tool_calls" ? "tool_calls" : "stop";
    return [openAiChunk(model, {}, finish)];
  }
  return [];
}

export async function startCommandCodeAlphaGateway(input: {
  apiKey: string;
  workingDir?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<CommandCodeAlphaGateway> {
  const apiBase = (input.apiBase ?? COMMANDCODE_CLI_API_BASE).replace(/\/+$/u, "");
  const apiKey = input.apiKey.trim();
  const workingDir = input.workingDir?.trim() || homedir();
  const fetchImpl = input.fetchImpl ?? fetch;
  const slug = projectSlugFromPath(workingDir);

  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      if (req.method === "GET" && (path === "/v1/models" || path.endsWith("/models"))) {
        const upstream = await fetchImpl(`${apiBase}/provider/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, {
          "Content-Type": upstream.headers.get("content-type") ?? "application/json",
          "Content-Length": body.length,
        });
        res.end(body);
        return;
      }
      if (req.method === "POST" && path.endsWith("/chat/completions")) {
        let payload: Record<string, unknown>;
        try {
          payload = asRecord(JSON.parse((await readRequestBody(req)).toString("utf8") || "{}")) ?? {};
        } catch {
          writeJson(res, 400, { error: { message: "bad request body" } });
          return;
        }
        const model = typeof payload.model === "string" ? payload.model : "deepseek/deepseek-v4.1-flash";
        const converted = openaiMessagesToCliParams(payload);
        const cliBody = {
          config: {
            workingDir,
            date: new Date().toISOString().slice(0, 10),
            environment: `${process.platform}-${process.arch}`,
            structure: [],
            isGitRepo: false,
            currentBranch: "",
            mainBranch: "",
            gitStatus: "",
            recentCommits: [],
          },
          memory: null,
          taste: null,
          skills: null,
          params: {
            model,
            messages: converted.messages,
            tools: converted.tools,
            system: converted.system,
            max_tokens:
              typeof payload.max_tokens === "number" ? payload.max_tokens : 64_000,
            temperature: typeof payload.temperature === "number" ? payload.temperature : 0.3,
            stream: true,
            ...(typeof payload.reasoning_effort === "string"
              ? { reasoning_effort: payload.reasoning_effort }
              : {}),
          },
          threadId: randomUUID(),
        };
        const upstream = await fetchImpl(`${apiBase}/alpha/generate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "x-command-code-version": COMMANDCODE_CLI_VERSION,
            "x-cli-environment": "production",
            "x-project-slug": slug,
          },
          body: JSON.stringify(cliBody),
        });
        if (!upstream.ok) {
          const errBody = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, {
            "Content-Type": upstream.headers.get("content-type") ?? "application/json",
            "Content-Length": errBody.length,
          });
          res.end(errBody);
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        writeSse(res, openAiChunk(model, { role: "assistant" }));
        if (!upstream.body) {
          writeSse(res, openAiChunk(model, {}, "stop"));
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/u);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const event = parseCliStreamEventLine(line);
              if (!event) continue;
              if (event.type === "error") {
                const message =
                  (typeof event.message === "string" && event.message) ||
                  (typeof event.error === "string" && event.error) ||
                  "Command Code generate failed";
                writeSse(res, { error: { message } });
                continue;
              }
              for (const chunk of cliEventToOpenAiChunks(event, model)) {
                writeSse(res, chunk);
              }
            }
          }
        } finally {
          res.write("data: [DONE]\n\n");
          res.end();
        }
        return;
      }
      writeJson(res, 404, { error: { message: "not found" } });
    })().catch((error) => {
      if (!res.headersSent) {
        writeJson(res, 502, {
          error: { message: error instanceof Error ? error.message : String(error) },
        });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("command code alpha gateway failed to bind");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () => {
      server.close();
    },
  };
}
