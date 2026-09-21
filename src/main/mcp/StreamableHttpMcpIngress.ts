import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import {
  decodeThreadIdentity,
  PROVIDER_SESSION_ID_ARG,
  type McpThreadIdentity,
} from "@/shared/browserMcpThread";
import { isLocalhostOrigin, readBoundedNodeRequestBody, writeJsonResponse } from "@/shared/http";
import { LOCAL_MCP_BIND_HOST } from "@/shared/localMcpBind";
import { coerceStringifiedJsonArgs } from "@/shared/stringifiedJsonArgs";
import {
  planProgressiveToolDisclosure,
  searchProgressiveTools,
  TOOL_INVOKE_NAME,
  TOOL_SEARCH_NAME,
  validateToolArguments,
  type ProgressiveToolDisclosureOptions,
} from "./progressiveToolCatalog";

export interface StreamableHttpMcpIngressInfo {
  url: string;
  token: string;
  port: number;
}

export interface StreamableHttpMcpToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface StreamableHttpMcpContent {
  type: "text" | "image";
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface StreamableHttpMcpToolResult {
  content: StreamableHttpMcpContent[];
  isError?: boolean;
}

export interface StreamableHttpMcpIngressOptions<TContext> {
  /**
   * Network interface to bind. Defaults to loopback so Windows Firewall is not
   * prompted at launch. Pass `"0.0.0.0"` only for a surface that must be
   * reachable off-host (remote access), never for local MCP.
   */
  bindHost?: string;
  contextUnavailableMessage?: string;
  dispatchTool(name: string, args: Record<string, unknown>, ctx: TContext): Promise<unknown>;
  formatToolResult(name: string, result: unknown): StreamableHttpMcpToolResult;
  /**
   * Build the per-request tool context. Receives the thread identity decoded
   * from the endpoint URL query (`?thread=&title=`) so each thread can be
   * scoped/named; consumers that don't need it may ignore the argument.
   */
  buildContext(identity: McpThreadIdentity): TContext | null;
  /**
   * Optional per-request identity override for shared-agent MCP bridges (e.g.
   * one `opencode serve` sidecar per workspace serves many threads through one
   * endpoint URL, so the URL `?thread=` identity is whichever thread synced
   * last). When set, a tool call carrying {@link PROVIDER_SESSION_ID_ARG} has
   * that arg stripped and its value resolved through this function; a
   * resolved id REPLACES the URL identity, and an unresolvable one fails the
   * call closed instead of silently binding the wrong thread.
   */
  resolveThreadIdBySessionId?(sessionId: string): string | null;
  instructions: string;
  isKnownToolName(name: string): boolean;
  onBeforeToolCall?(name: string, ctx: TContext): void;
  serverInfo: { name: string; version: string };
  tools: readonly StreamableHttpMcpToolSpec[];
  progressiveDisclosure?: ProgressiveToolDisclosureOptions;
}

const MAX_BODY = 1024 * 1024;
const MCP_PROTOCOL_VERSION = "2025-03-26";

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

export class StreamableHttpMcpIngress<TContext> {
  private server: Server | null = null;
  private token = randomBytes(32).toString("hex");
  private info: StreamableHttpMcpIngressInfo | null = null;

  constructor(private readonly options: StreamableHttpMcpIngressOptions<TContext>) {}

  async start(): Promise<StreamableHttpMcpIngressInfo> {
    if (this.info) return this.info;
    const bindHost = this.options.bindHost ?? LOCAL_MCP_BIND_HOST;
    return await new Promise<StreamableHttpMcpIngressInfo>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res);
      });
      server.on("error", reject);
      // Access is guarded by a 256-bit bearer token regenerated per app launch;
      // the URL is only ever passed to immediate child processes via env vars.
      server.listen(0, bindHost, () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        this.server = server;
        this.info = { url: `http://127.0.0.1:${port}`, token: this.token, port };
        resolve(this.info);
      });
    });
  }

  getInfo(): StreamableHttpMcpIngressInfo | null {
    return this.info;
  }

  dispose(): void {
    try {
      this.server?.closeAllConnections?.();
    } catch {}
    try {
      this.server?.close();
    } catch {}
    this.server = null;
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    const body = await readBoundedNodeRequestBody(req, MAX_BODY, () => new Error("body too large"));
    return body.toString("utf8");
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    writeJsonResponse(res, status, body, { cacheControl: "no-store" });
  }

  private checkAuth(req: IncomingMessage): boolean {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ") && this.tokenMatches(auth.slice(7).trim())) {
      return true;
    }
    const xToken = req.headers["x-craftstation-token"];
    return typeof xToken === "string" && this.tokenMatches(xToken);
  }

  /**
   * Constant-time bearer-token comparison. A plain `===` short-circuits on the
   * first mismatching byte, leaking token bytes through response timing; compare
   * over the full length instead. `timingSafeEqual` throws on length mismatch,
   * so gate on length first (the length itself is not secret — the token is a
   * fixed 64-hex-char string).
   */
  private tokenMatches(candidate: string): boolean {
    const expected = Buffer.from(this.token);
    const actual = Buffer.from(candidate);
    if (actual.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(actual, expected);
  }

  /**
   * DNS-rebinding defense-in-depth: reject requests whose `Host` header is a
   * real DNS name rather than a loopback name or a raw IP literal. A rebinding
   * attack points an attacker-controlled hostname at the loopback address, so
   * the forged request carries that hostname in `Host`. Loopback (`localhost`)
   * and IP literals are safe: local MCP binds loopback, and any remaining
   * IP-literal callers (tests, WSL mirrored `127.0.0.1`) keep working. The
   * port, when present, must match the bound port.
   */
  private isAllowedHost(req: IncomingMessage): boolean {
    const hostHeader = req.headers.host;
    if (typeof hostHeader !== "string" || hostHeader.length === 0) {
      return false;
    }
    let parsed: URL;
    try {
      parsed = new URL(`http://${hostHeader}`);
    } catch {
      return false;
    }
    const boundPort = this.info?.port;
    if (boundPort !== undefined && parsed.port !== "" && Number(parsed.port) !== boundPort) {
      return false;
    }
    let hostname = parsed.hostname;
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }
    if (hostname === "localhost") {
      return true;
    }
    return isIP(hostname) !== 0;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!req.url) {
        this.sendJson(res, 404, { error: "not found" });
        return;
      }
      if (!this.isAllowedHost(req)) {
        this.sendJson(res, 403, { error: "forbidden host" });
        return;
      }
      const path = new URL(req.url, "http://x").pathname;

      // CORS preflight — restrict to localhost origins so remote web pages
      // cannot issue cross-origin requests to the MCP ingress.
      if (req.method === "OPTIONS") {
        const origin = req.headers.origin;
        if (typeof origin === "string" && isLocalhostOrigin(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader(
            "Access-Control-Allow-Headers",
            "Authorization, X-CraftStation-Token, Content-Type, Mcp-Session-Id",
          );
          res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        }
        res.statusCode = 204;
        res.end();
        return;
      }

      if (!this.checkAuth(req)) {
        this.sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      if (path === "/mcp" || path === "/mcp/") {
        if (req.method === "GET") {
          // MCP Streamable HTTP allows GET to open an SSE stream. We don't
          // push server-initiated events; return 405 with Allow header.
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end();
          return;
        }
        if (req.method !== "POST") {
          this.sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        await this.handleMcp(req, res);
        return;
      }

      this.sendJson(res, 404, { error: "not found" });
    } catch (err) {
      this.sendJson(res, 500, { error: (err as Error).message ?? "internal" });
    }
  }

  private async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const identity = decodeThreadIdentity(req.url);
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

    // Mcp-Session-Id: stateless server, but echo a session id so clients
    // that key off of it have one.
    let sessionId = req.headers["mcp-session-id"];
    if (Array.isArray(sessionId)) sessionId = sessionId[0];
    if (typeof sessionId !== "string" || !sessionId) {
      sessionId = randomUUID();
    }
    res.setHeader("Mcp-Session-Id", sessionId);

    // Streamable HTTP allows a single response or a batch. Match the input.
    if (Array.isArray(body)) {
      const out: JsonRpcResponse[] = [];
      for (const message of body) {
        const reply = await this.handleSingle(message, identity);
        if (reply) out.push(reply);
      }
      this.sendJson(res, 200, out);
      return;
    }
    const reply = await this.handleSingle(body, identity);
    if (!reply) {
      // notification — no response
      res.statusCode = 202;
      res.end();
      return;
    }
    this.sendJson(res, 200, reply);
  }

  private async handleSingle(
    message: unknown,
    identity: McpThreadIdentity,
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
            serverInfo: this.options.serverInfo,
            instructions: this.options.instructions,
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
        const plan = planProgressiveToolDisclosure(
          this.options.tools,
          identity.disabledTools ?? [],
          this.options.progressiveDisclosure,
        );
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: plan.visibleTools },
        };
      }
      if (method === "tools/call") {
        const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        const name = String(p.name ?? "");
        let args = (p.arguments ?? {}) as Record<string, unknown>;
        // Shared-agent bridges (one `opencode serve` per workspace) cannot keep
        // the URL `?thread=` identity per thread — the plugin inside the
        // sidecar injects the real calling session per tool call. That value
        // wins over the URL; when it cannot be resolved the call fails closed
        // rather than binding (and possibly firing into) the wrong thread.
        const routedSession =
          this.options.resolveThreadIdBySessionId &&
          typeof args[PROVIDER_SESSION_ID_ARG] === "string"
            ? (args[PROVIDER_SESSION_ID_ARG] as string).trim()
            : "";
        if (routedSession) {
          const resolved = this.options.resolveThreadIdBySessionId!(routedSession);
          if (!resolved) {
            return {
              jsonrpc: "2.0",
              id,
              result: {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: `Cannot resolve CraftStation thread for calling session ${routedSession}. Refusing to bind this call to the endpoint thread.`,
                  },
                ],
              },
            };
          }
          const { [PROVIDER_SESSION_ID_ARG]: _dropped, ...rest } = args;
          args = rest;
          identity = { ...identity, threadId: resolved };
        }
        const disclosure = planProgressiveToolDisclosure(
          this.options.tools,
          identity.disabledTools ?? [],
          this.options.progressiveDisclosure,
        );
        if (disclosure.deferred && name === TOOL_SEARCH_NAME) {
          const query = typeof args.query === "string" ? args.query.trim() : "";
          const requestedLimit =
            typeof args.limit === "number" ? Math.trunc(args.limit) : disclosure.maxSearchResults;
          if (!query) {
            return {
              jsonrpc: "2.0",
              id,
              result: { isError: true, content: [{ type: "text", text: "query is required" }] },
            };
          }
          const matches = searchProgressiveTools(
            disclosure.availableTools,
            query,
            Math.min(disclosure.maxSearchResults, Math.max(1, requestedLimit)),
          );
          return {
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(matches) }] },
          };
        }
        if (disclosure.deferred && name === TOOL_INVOKE_NAME) {
          const targetName = typeof args.name === "string" ? args.name.trim() : "";
          const target = disclosure.availableTools.find((tool) => tool.name === targetName);
          if (!target) {
            return {
              jsonrpc: "2.0",
              id,
              result: {
                isError: true,
                content: [
                  { type: "text", text: `Unknown or disabled deferred tool: ${targetName}` },
                ],
              },
            };
          }
          const targetArgs =
            args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments)
              ? (args.arguments as Record<string, unknown>)
              : {};
          const coercedTargetArgs = coerceStringifiedJsonArgs(targetArgs, target.inputSchema);
          const validationError = validateToolArguments(target.inputSchema, coercedTargetArgs);
          if (validationError) {
            return {
              jsonrpc: "2.0",
              id,
              result: {
                isError: true,
                content: [
                  { type: "text", text: `Invalid arguments for ${targetName}: ${validationError}` },
                ],
              },
            };
          }
          args = coercedTargetArgs;
          // Continue through the original authorization, context, coercion and
          // dispatch path with the real target name.
          return await this.dispatchResolvedTool(id, targetName, args, identity);
        }
        return await this.dispatchResolvedTool(id, name, args, identity);
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

  private async dispatchResolvedTool(
    id: number | string | null,
    name: string,
    initialArgs: Record<string, unknown>,
    identity: McpThreadIdentity,
  ): Promise<JsonRpcResponse> {
    let args = initialArgs;
    if (identity.disabledTools?.includes(name)) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: `Tool disabled by CraftStation: ${name}` }],
        },
      };
    }
    if (!this.options.isKnownToolName(name)) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
        },
      };
    }
    const ctx = this.options.buildContext(identity);
    if (!ctx) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: this.options.contextUnavailableMessage ?? "not ready" }],
        },
      };
    }
    this.options.onBeforeToolCall?.(name, ctx);
    // OpenCode-style bridges stringify nested object/array params into JSON
    // text. Only unwrap fields whose declared schema expects object/array.
    args = coerceStringifiedJsonArgs(
      args,
      this.options.tools.find((tool) => tool.name === name)?.inputSchema,
    );
    let raw: unknown;
    try {
      raw = await this.options.dispatchTool(name, args, ctx);
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: (err as Error).message ?? String(err) }],
        },
      };
    }
    const result = this.options.formatToolResult(name, raw);
    return { jsonrpc: "2.0", id, result };
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
