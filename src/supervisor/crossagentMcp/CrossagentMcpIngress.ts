import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { LOCAL_MCP_BIND_HOST } from "@/shared/localMcpBind";
import { coerceStringifiedJsonArgs } from "@/shared/stringifiedJsonArgs";
import type { CrossagentMcpHttpConfig } from "@/supervisor/agents/crossagentMcp";
import type { CrossagentRoutingOverride } from "@/shared/settings";
import type { SubagentRunManager } from "./SubagentRunManager";
import { buildSubagentInstructions, dispatchTool, isKnownToolName, TOOLS } from "./toolRegistry";
import { errorResult } from "./toolResult";
import type { ExplicitSpawnAgentSelection, SpawnableAgent } from "./types";

export interface OwnSubagentsMcpIngressInfo {
  url: string;
  port: number;
}

export interface OwnSubagentsMcpIngressDeps {
  runManager: SubagentRunManager;
  /** Catalog of installed + authenticated agents the caller may spawn. */
  getSpawnableAgents: (tags?: readonly string[]) => Promise<SpawnableAgent[]>;
  /** Resolve a trusted provider-native session id to its live CraftStation parent. */
  resolveProviderSessionThreadId?: (sessionId: string) => string | undefined;
  /** Resolve the calling thread's harness kind for the native-harness lane. */
  resolveParentAgentKind?: (threadId: string) => string | undefined;
  /**
   * Resolve the calling thread's own entity (harness + model + effort) so
   * subagent dispatch without an explicit selection defaults to what the
   * user already picked, instead of ranked-best ("random") dispatch.
   */
  resolveParentEntity?:
    | ((
        threadId: string,
      ) =>
        | { agentKind: string; model?: string | undefined; effort?: string | undefined }
        | undefined)
    | undefined;
  /** User-ordered Own Subagents route (native lane + provider kinds). */
  getRouteOrder?: () => readonly string[];
  /** Optional user-provided routing guide appended to the MCP instructions (phase 3). */
  getRoutingGuide?: () => string | undefined;
  /** Report only caller-explicit selections; auto-ranked choices must not reinforce themselves. */
  recordExplicitSelections?: (selections: readonly ExplicitSpawnAgentSelection[]) => void;
  /** Read and mutate only user-explicit persistent task routing preferences. */
  listRoutingOverrides?: () => readonly CrossagentRoutingOverride[];
  setRoutingOverride?: (override: CrossagentRoutingOverride) => void | Promise<void>;
  removeRoutingOverride?: (tags: readonly string[]) => void | Promise<void>;
}

const MAX_BODY = 1024 * 1024;
const MCP_PROTOCOL_VERSION = "2025-03-26";
export const CROSSAGENT_PROVIDER_SESSION_ID_ARG = "__craftstation_provider_session_id";
const TOOL_PERMISSION_ALIASES = new Map([
  ["spawn_agents", "spawn_agent"],
  ["wait_for_agents", "wait_for_agent"],
  ["run_agent", "spawn_agent"],
]);

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponseOk {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

interface JsonRpcResponseErr {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcResponseOk | JsonRpcResponseErr;

type CrossagentAuthContext = { mode: "thread"; threadId: string } | { mode: "provider-session" };

/**
 * Single in-process MCP server hosted in the supervisor. Speaks Streamable-HTTP
 * MCP at `POST /mcp` (JSON-RPC body, single JSON response). Unlike the browser
 * ingress, direct provider processes use a per-thread 256-bit bearer token, so
 * `tools/call` can resolve the caller's parent from the credential alone.
 * Pooled provider runtimes instead share one in-memory credential and attach a
 * trusted provider session id to each call. The ingress resolves that id back
 * to a registered live thread at call time, so concurrent sessions never rely
 * on shared mutable "active thread" state.
 *
 * Bind address: loopback only. A Windows wildcard bind (`0.0.0.0`) raises the
 * "public and private networks" firewall dialog on every portable launch
 * (unpack path changes, so Allow never sticks). WSL mirrored networking still
 * reaches `127.0.0.1`; NAT-mode WSL does not get a wildcard host bind at
 * startup. The 256-bit bearer credential remains the call-level boundary.
 */
export class OwnSubagentsMcpIngress {
  private server: Server | null = null;
  private info: OwnSubagentsMcpIngressInfo | null = null;
  private readonly tokenToThread = new Map<string, string>();
  private readonly threadToToken = new Map<string, string>();
  private readonly providerSessionToken = randomBytes(32).toString("hex");
  private readonly providerSessionThreads = new Set<string>();
  private readonly disabledToolsByThread = new Map<string, Set<string>>();

  constructor(private readonly deps: OwnSubagentsMcpIngressDeps) {}

  async start(): Promise<OwnSubagentsMcpIngressInfo> {
    if (this.info) return this.info;
    return await new Promise<OwnSubagentsMcpIngressInfo>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res);
      });
      server.on("error", reject);
      server.listen(0, LOCAL_MCP_BIND_HOST, () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        this.server = server;
        this.info = { url: `http://127.0.0.1:${port}`, port };
        resolve(this.info);
      });
    });
  }

  getInfo(): OwnSubagentsMcpIngressInfo | null {
    return this.info;
  }

  /**
   * Register (or re-register) a parent thread. Mints a token on first call and
   * reuses it thereafter. Returns the ready-to-use MCP http config; returns
   * `undefined` before the server has bound a port.
   */
  registerThread(
    threadId: string,
    disabledTools: readonly string[] = [],
  ): CrossagentMcpHttpConfig | undefined {
    if (!this.info) return undefined;
    let token = this.threadToToken.get(threadId);
    if (!token) {
      token = randomBytes(32).toString("hex");
      this.threadToToken.set(threadId, token);
      this.tokenToThread.set(token, threadId);
    }
    this.disabledToolsByThread.set(threadId, new Set(disabledTools));
    return {
      url: `${this.info.url.replace(/\/$/, "")}/mcp`,
      token,
      headers: { Authorization: `Bearer ${token}` },
      disabledTools: [...disabledTools],
    };
  }

  /**
   * Register a thread whose provider runtime shares one MCP connection.
   * Authentication proves the caller is the CraftStation-launched provider
   * process; the trusted provider session id on each tools/call selects the
   * parent thread. The token is memory-only and shared by every such thread.
   */
  registerProviderSessionThread(
    threadId: string,
    disabledTools: readonly string[] = [],
  ): CrossagentMcpHttpConfig | undefined {
    if (!this.info) return undefined;
    this.providerSessionThreads.add(threadId);
    this.disabledToolsByThread.set(threadId, new Set(disabledTools));
    return {
      url: `${this.info.url.replace(/\/$/, "")}/mcp`,
      token: this.providerSessionToken,
      headers: { Authorization: `Bearer ${this.providerSessionToken}` },
      disabledTools: [...disabledTools],
    };
  }

  unregisterThread(threadId: string): void {
    const token = this.threadToToken.get(threadId);
    if (token) this.tokenToThread.delete(token);
    this.threadToToken.delete(threadId);
    this.providerSessionThreads.delete(threadId);
    this.disabledToolsByThread.delete(threadId);
  }

  dispose(): void {
    this.tokenToThread.clear();
    this.threadToToken.clear();
    this.providerSessionThreads.clear();
    this.disabledToolsByThread.clear();
    try {
      this.server?.closeAllConnections?.();
    } catch {}
    try {
      this.server?.close();
    } catch {}
    this.server = null;
  }

  private resolveAuth(req: IncomingMessage): CrossagentAuthContext | null {
    const auth = req.headers.authorization;
    let token: string | undefined;
    if (auth && auth.startsWith("Bearer ")) {
      token = auth.slice(7).trim();
    } else {
      const xToken = req.headers["x-craftstation-token"];
      if (typeof xToken === "string") token = xToken;
    }
    if (!token) return null;
    const threadId = this.tokenToThread.get(token);
    if (threadId) return { mode: "thread", threadId };
    if (token === this.providerSessionToken) return { mode: "provider-session" };
    return null;
  }

  private resolveProviderSessionThreadId(
    args: Record<string, unknown>,
    meta?: Record<string, unknown>,
  ): string | undefined {
    const sessionId = args[CROSSAGENT_PROVIDER_SESSION_ID_ARG] ?? meta?.threadId;
    delete args[CROSSAGENT_PROVIDER_SESSION_ID_ARG];
    if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
    const threadId = this.deps.resolveProviderSessionThreadId?.(sessionId);
    if (!threadId || !this.providerSessionThreads.has(threadId)) return undefined;
    return threadId;
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      let total = 0;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BODY) {
          req.destroy();
          reject(new Error("body too large"));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!req.url) {
        this.sendJson(res, 404, { error: "not found" });
        return;
      }
      const path = new URL(req.url, "http://x").pathname;

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      const auth = this.resolveAuth(req);
      if (!auth) {
        this.sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      if (path === "/mcp" || path === "/mcp/") {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end();
          return;
        }
        await this.handleMcp(req, res, auth);
        return;
      }

      this.sendJson(res, 404, { error: "not found" });
    } catch (err) {
      this.sendJson(res, 500, { error: (err as Error).message ?? "internal" });
    }
  }

  private async handleMcp(
    req: IncomingMessage,
    res: ServerResponse,
    auth: CrossagentAuthContext,
  ): Promise<void> {
    const raw = await this.readBody(req);
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      this.sendJson(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    let sessionId = req.headers["mcp-session-id"];
    if (Array.isArray(sessionId)) sessionId = sessionId[0];
    if (typeof sessionId !== "string" || !sessionId) sessionId = randomUUID();
    res.setHeader("Mcp-Session-Id", sessionId);

    if (Array.isArray(body)) {
      const replies = await Promise.all(body.map((message) => this.handleSingle(message, auth)));
      const out = replies.filter((reply): reply is JsonRpcResponse => reply !== null);
      this.sendJson(res, 200, out);
      return;
    }
    const reply = await this.handleSingle(body, auth);
    if (!reply) {
      res.statusCode = 202;
      res.end();
      return;
    }
    this.sendJson(res, 200, reply);
  }

  private async handleSingle(
    message: unknown,
    auth: CrossagentAuthContext,
  ): Promise<JsonRpcResponse | null> {
    if (!isJsonRpcRequest(message)) return null;
    const { id = null, method, params } = message;
    try {
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "own_subagents", version: "1.0.0" },
            instructions: buildSubagentInstructions(this.deps.getRoutingGuide?.()),
          },
        };
      }
      if (method === "notifications/initialized" || method === "initialized") {
        return null;
      }
      if (method === "ping") {
        return { jsonrpc: "2.0", id, result: {} };
      }
      if (method === "tools/list") {
        // A provider-session connection is shared by concurrent sessions, so
        // discovery cannot safely apply one thread's filter. OpenCode applies
        // per-session deny rules; tools/call below still enforces the resolved
        // thread's policy authoritatively.
        const disabled =
          auth.mode === "thread"
            ? (this.disabledToolsByThread.get(auth.threadId) ?? new Set<string>())
            : new Set<string>();
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: TOOLS.filter(
              (tool) =>
                !disabled.has(tool.name) &&
                !disabled.has(TOOL_PERMISSION_ALIASES.get(tool.name) ?? ""),
            ),
          },
        };
      }
      if (method === "tools/call") {
        const p = (params ?? {}) as {
          name?: string;
          arguments?: Record<string, unknown>;
          _meta?: Record<string, unknown>;
        };
        const name = String(p.name ?? "");
        const rawArgs = p.arguments;
        const args =
          rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? { ...rawArgs } : {};
        const threadId =
          auth.mode === "thread"
            ? auth.threadId
            : this.resolveProviderSessionThreadId(args, p._meta);
        if (!threadId) {
          return {
            jsonrpc: "2.0",
            id,
            result: errorResult("Unable to route Crossagents call to a live parent thread."),
          };
        }
        const disabled = this.disabledToolsByThread.get(threadId);
        const permissionAlias = TOOL_PERMISSION_ALIASES.get(name);
        if (disabled?.has(name) || (permissionAlias && disabled?.has(permissionAlias))) {
          return {
            jsonrpc: "2.0",
            id,
            result: errorResult(`Tool disabled by CraftStation: ${name}`),
          };
        }
        if (!isKnownToolName(name)) {
          return { jsonrpc: "2.0", id, result: errorResult(`Unknown tool: ${name}`) };
        }
        const parentAgentKind = this.deps.resolveParentAgentKind?.(threadId);
        const parentEntity = this.deps.resolveParentEntity?.(threadId);
        // Same stringified-JSON unwrapping as the shared MCP ingress: OpenCode
        // bridges send tasks/fallbacks/run_ids as JSON text instead of arrays.
        const coercedArgs = coerceStringifiedJsonArgs(
          args,
          TOOLS.find((tool) => tool.name === name)?.inputSchema,
        );
        const result = await dispatchTool(name, coercedArgs, {
          parentThreadId: threadId,
          runManager: this.deps.runManager,
          listSpawnableAgents: this.deps.getSpawnableAgents,
          ...(parentAgentKind ? { parentAgentKind } : {}),
          ...(parentEntity ? { parentEntity } : {}),
          getRouteOrder: () => this.deps.getRouteOrder?.() ?? [],
          ...(this.deps.recordExplicitSelections
            ? { recordExplicitSelections: this.deps.recordExplicitSelections }
            : {}),
          ...(this.deps.listRoutingOverrides
            ? { listRoutingOverrides: this.deps.listRoutingOverrides }
            : {}),
          ...(this.deps.setRoutingOverride
            ? { setRoutingOverride: this.deps.setRoutingOverride }
            : {}),
          ...(this.deps.removeRoutingOverride
            ? { removeRoutingOverride: this.deps.removeRoutingOverride }
            : {}),
        });
        return { jsonrpc: "2.0", id, result };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: (err as Error).message ?? "internal" },
      };
    }
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (value as { method?: unknown }).method === "string"
  );
}
