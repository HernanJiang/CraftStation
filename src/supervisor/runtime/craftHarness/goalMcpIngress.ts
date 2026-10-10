import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { LOCAL_MCP_BIND_HOST } from "@/shared/localMcpBind";
import { readBoundedNodeRequestBody, writeJsonResponse } from "@/shared/http";
import type { ResolvedMcpServer } from "@/shared/contracts";
import type { GoalCoordinator } from "./goalCoordinator";

const createArgs = z.object({
  objective: z.string().trim().min(1),
  token_budget: z.number().int().positive().optional(),
});
const updateArgs = z.object({
  status: z.enum(["complete", "blocked"]),
  reason: z.string().trim().min(1),
});
export const GOAL_MCP_TOOLS = [
  {
    name: "create_goal",
    description:
      "仅在用户明确要求设置目标时创建线程目标。已有未完成目标时失败。仅在用户明确给出 token 预算时设置 token_budget。",
    inputSchema: z.toJSONSchema(createArgs),
  },
  {
    name: "get_goal",
    description: "读取当前线程目标、状态、预算和累计用量。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_goal",
    description:
      "仅在完整目标已验证时 complete，reason 必须包含具体证据。blocked 需要同一阻塞连续至少三个目标回合；首次阻塞继续推进。不得自行暂停或恢复。",
    inputSchema: z.toJSONSchema(updateArgs),
  },
];

/** 每线程凭据；共享 provider 连接必须用运行时注入的原生 Session identity 路由。 */
export class GoalMcpIngress {
  private server?: Server;
  private url?: string;
  private starting?: Promise<void>;
  private readonly tokens = new Map<string, string>();
  private readonly providerThreads = new Set<string>();
  private readonly sharedToken = randomBytes(32).toString("hex");

  constructor(
    private readonly goals: GoalCoordinator,
    private readonly resolveSession: (sessionId: string) => string | undefined,
  ) {}

  async start(): Promise<void> {
    if (this.url) return;
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res);
      });
      this.server = server;
      server.once("error", reject);
      server.listen(0, LOCAL_MCP_BIND_HOST, () => {
        const address = server.address();
        if (!address || typeof address === "string")
          return reject(new Error("GOAL_MCP_BIND_FAILED"));
        this.url = `http://127.0.0.1:${address.port}/mcp`;
        resolve();
      });
    });
    return this.starting;
  }

  async register(threadId: string, providerSession = false): Promise<ResolvedMcpServer> {
    await this.start();
    let token = [...this.tokens].find(([, thread]) => thread === threadId)?.[0];
    if (providerSession) {
      token = this.sharedToken;
      this.providerThreads.add(threadId);
    } else if (!token) {
      token = randomBytes(32).toString("hex");
      this.tokens.set(token, threadId);
    }
    return {
      id: "craft-goal",
      name: "craft_goal",
      timeoutMs: 30_000,
      transport: { type: "http", url: this.url!, headers: { Authorization: `Bearer ${token}` } },
    };
  }

  unregister(threadId: string): void {
    for (const [token, thread] of this.tokens) if (thread === threadId) this.tokens.delete(token);
    this.providerThreads.delete(threadId);
  }
  dispose(): void {
    this.tokens.clear();
    this.providerThreads.clear();
    this.server?.closeAllConnections();
    this.server?.close();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const fixedThread = this.tokens.get(token);
    if (!fixedThread && token !== this.sharedToken)
      return writeJsonResponse(res, 401, { error: "unauthorized" });
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp")
      return writeJsonResponse(res, 404, {});
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      res.end();
      return;
    }
    try {
      const raw = await readBoundedNodeRequestBody(
        req,
        1024 * 1024,
        () => new Error("GOAL_MCP_BODY_TOO_LARGE"),
      );
      const body = JSON.parse(raw.toString("utf8"));
      const replies = (Array.isArray(body) ? body : [body]).map((message) =>
        this.dispatch(message, fixedThread),
      );
      const results = replies.filter((reply) => reply !== null);
      if (results.length === 0) {
        res.writeHead(202);
        res.end();
        return;
      }
      writeJsonResponse(res, 200, Array.isArray(body) ? results : results[0], {
        cacheControl: "no-store",
      });
    } catch {
      writeJsonResponse(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid MCP request" },
      });
    }
  }

  private dispatch(message: unknown, fixedThread?: string): Record<string, unknown> | null {
    const parsed = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.union([z.string(), z.number(), z.null()]).optional(),
        method: z.string(),
        params: z.unknown().optional(),
      })
      .safeParse(message);
    if (!parsed.success)
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
    const { id, method, params } = parsed.data;
    if (id === undefined) return null;
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    if (method === "initialize")
      return reply({
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "craft_goal", version: "1.0.0" },
      });
    if (method === "ping") return reply({});
    if (method === "tools/list") return reply({ tools: GOAL_MCP_TOOLS });
    if (method !== "tools/call")
      return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
    try {
      const call = z
        .object({
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()).optional(),
          _meta: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(params);
      const args = call.arguments ?? {};
      const nativeSession = args.__craftstation_provider_session_id ?? call._meta?.threadId;
      const routed =
        typeof nativeSession === "string" ? this.resolveSession(nativeSession) : undefined;
      const threadId =
        fixedThread ?? (routed && this.providerThreads.has(routed) ? routed : undefined);
      if (!threadId) throw new Error("GOAL_THREAD_IDENTITY_REQUIRED");
      this.goals.noteToolCall(threadId);
      let result: unknown;
      if (call.name === "get_goal") result = this.goals.get(threadId);
      else if (call.name === "create_goal") {
        const input = createArgs.parse(args);
        const old = this.goals.get(threadId);
        if (old && old.status !== "complete") throw new Error("GOAL_ALREADY_EXISTS");
        this.goals.control(threadId, {
          action: "edit",
          objective: input.objective,
          ...(input.token_budget ? { tokenBudget: input.token_budget } : {}),
        });
        result = this.goals.get(threadId);
      } else if (call.name === "update_goal") {
        const input = updateArgs.parse(args);
        result = this.goals.update(threadId, input.status, input.reason);
      } else throw new Error("GOAL_TOOL_UNKNOWN");
      return reply({ content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch (error) {
      return reply({
        isError: true,
        content: [
          { type: "text", text: error instanceof Error ? error.message : "GOAL_TOOL_FAILED" },
        ],
      });
    }
  }
}
