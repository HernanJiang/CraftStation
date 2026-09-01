import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ResolvedMcpServer } from "@/shared/contracts";
import { terminateProcessTree } from "@/shared/processTree";

type McpTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

export interface DeepSeekApiToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
  /** Local-only canonical identity; never sent in the provider request body. */
  mcpServerName?: string;
  /** Local-only native tool identity; never sent in the provider request body. */
  mcpToolName?: string;
}

export interface DeepSeekApiMcpCallResult {
  content: string;
  isError: boolean;
}

export interface DeepSeekApiMcpRuntime {
  listTools(signal?: AbortSignal): Promise<readonly DeepSeekApiToolDefinition[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<DeepSeekApiMcpCallResult>;
  close(): Promise<void>;
}

interface ConnectedServer {
  server: ResolvedMcpServer;
  client: Client;
  transport: McpTransport;
  pid: number | null;
}

interface ToolBinding {
  server: ConnectedServer;
  nativeName: string;
}

function createTransport(server: ResolvedMcpServer): McpTransport {
  const transport = server.transport;
  if (transport.type === "stdio") {
    return new StdioClientTransport({
      command: transport.command,
      args: transport.args,
      env: transport.env,
      ...(transport.cwd ? { cwd: transport.cwd } : {}),
      stderr: "ignore",
    });
  }
  if (transport.type === "http") {
    return new StreamableHTTPClientTransport(new URL(transport.url), {
      requestInit: { headers: transport.headers },
    });
  }
  return new SSEClientTransport(new URL(transport.url), {
    requestInit: { headers: transport.headers },
  });
}

function exposedToolName(serverName: string, toolName: string, duplicate: boolean): string {
  const raw = duplicate ? `${serverName}__${toolName}` : toolName;
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/gu, "_");
  return sanitized.slice(0, 64) || "mcp_tool";
}

function toolResultText(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return JSON.stringify(result);
  }
  const record = result as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : [];
  const parts = content.flatMap((entry): string[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const block = entry as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") return [block.text];
    if (block.type === "resource" && block.resource && typeof block.resource === "object") {
      const text = (block.resource as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    }
    return [];
  });
  const value =
    parts.length > 0
      ? parts.join("\n")
      : record.structuredContent !== undefined
        ? JSON.stringify(record.structuredContent)
        : JSON.stringify(record);
  return value.slice(0, 100_000);
}

export class DefaultDeepSeekApiMcpRuntime implements DeepSeekApiMcpRuntime {
  private readonly connected: ConnectedServer[] = [];
  private readonly bindings = new Map<string, ToolBinding>();
  private toolsPromise: Promise<readonly DeepSeekApiToolDefinition[]> | undefined;

  constructor(private readonly servers: readonly ResolvedMcpServer[]) {}

  listTools(signal?: AbortSignal): Promise<readonly DeepSeekApiToolDefinition[]> {
    this.toolsPromise ??= this.connectAndList(signal);
    return this.toolsPromise;
  }

  private async connectAndList(
    signal?: AbortSignal,
  ): Promise<readonly DeepSeekApiToolDefinition[]> {
    const discovered: Array<{
      connected: ConnectedServer;
      tool: {
        name: string;
        description?: string;
        inputSchema: Record<string, unknown>;
      };
    }> = [];
    try {
      for (const server of this.servers) {
        const client = new Client({ name: "craftstation-deepseek-api", version: "0.7.13" });
        const transport = createTransport(server);
        await client.connect(transport as Transport, {
          ...(signal ? { signal } : {}),
          timeout: server.timeoutMs,
          maxTotalTimeout: server.timeoutMs,
        });
        const connected = {
          server,
          client,
          transport,
          pid: transport instanceof StdioClientTransport ? transport.pid : null,
        };
        this.connected.push(connected);
        const listed = await client.listTools(undefined, {
          ...(signal ? { signal } : {}),
          timeout: server.timeoutMs,
        });
        for (const tool of listed.tools) {
          discovered.push({
            connected,
            tool: {
              name: tool.name,
              ...(tool.description ? { description: tool.description } : {}),
              inputSchema: tool.inputSchema,
            },
          });
        }
      }

      const counts = new Map<string, number>();
      for (const { tool } of discovered) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
      return discovered.map(({ connected, tool }) => {
        let exposed = exposedToolName(
          connected.server.name,
          tool.name,
          (counts.get(tool.name) ?? 0) > 1,
        );
        let suffix = 2;
        while (this.bindings.has(exposed)) {
          exposed = `${exposed.slice(0, 60)}_${suffix++}`;
        }
        this.bindings.set(exposed, { server: connected, nativeName: tool.name });
        return {
          type: "function" as const,
          function: {
            name: exposed,
            ...(tool.description ? { description: tool.description } : {}),
            parameters: tool.inputSchema,
          },
          mcpServerName: connected.server.name,
          mcpToolName: tool.name,
        };
      });
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<DeepSeekApiMcpCallResult> {
    await this.listTools(signal);
    const binding = this.bindings.get(name);
    if (!binding) throw new Error(`DeepSeek API requested unknown MCP tool '${name}'.`);
    const result = await binding.server.client.callTool(
      { name: binding.nativeName, arguments: args },
      undefined,
      {
        ...(signal ? { signal } : {}),
        timeout: binding.server.server.timeoutMs,
      },
    );
    const record = result as Record<string, unknown>;
    return {
      content: toolResultText(result),
      isError: record.isError === true,
    };
  }

  async close(): Promise<void> {
    const connected = this.connected.splice(0);
    this.bindings.clear();
    this.toolsPromise = undefined;
    await Promise.allSettled(connected.map(({ client }) => client.close()));
    for (const { pid } of connected) if (pid) terminateProcessTree(pid);
  }
}
