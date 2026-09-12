import type { McpThreadIdentity } from "@/shared/browserMcpThread";
import type { StreamableHttpMcpToolResult } from "../mcp/StreamableHttpMcpIngress";
import type { InterHarnessMessageBus } from "../thread-messaging/interHarnessMessageBus";

export const CROSSAGENTS_MCP_SERVER_INFO = {
  name: "crossagents",
  version: "1.0.0",
} as const;

export const CROSSAGENTS_MCP_INSTRUCTIONS = [
  "Use the Crossagents MCP server to message persistent native threads (agents) in this workspace — across harnesses.",
  "Every tool named below belongs to this server. Hosts that namespace MCP tools expose them under this server's name (for example `crossagents__list_peers`), so resolve each bare name against your own tool list and call the crossagents entry.",
  "Peers are stable harness:nativeId addresses (for example codex:C123, kimi:K456). Ask the user which peer to contact, or call list_peers to discover the workspace roster; never invent an address.",
  "Sending or asking auto-binds an external peer to its REAL native thread — a duplicate native thread is never created. Use spawn_peer to create a brand-new long-lived native thread on the requested model/harness (the target runtime executes, not the caller). switch_peer_model changes a peer's model; a cross-harness switch creates a NEW native session instead of relabeling the old one. stop_peer fully removes a test peer. Ordinary send_message/ask to a busy peer queue behind its current turn; pass interrupt=true to abort that turn (same class as the user hitting Stop) and deliver the new message as the next turn. interrupt never deletes the thread — stop_peer is the destructive cleanup tool.",
  "ask waits up to timeout_s for the reply and then stops waiting; the message itself stays durable and a late reply remains readable via inbox. Never treat a timeout as a failure of the peer.",
  "Use reply() to answer an exchange addressed to this thread so the conversation stays threaded.",
  "For one-off temporary helpers inside your own thread, use the separate own_subagents server (spawn_agent) or your harness's own native subagent tools — not this server.",
].join(" ");

export interface CrossagentsToolContext {
  bus: InterHarnessMessageBus;
  identity: McpThreadIdentity;
}

export const TOOLS = [
  {
    name: "list_peers",
    description:
      "List native thread peers in the calling thread's workspace scope as stable harness:nativeId addresses, with online/offline/busy/unknown status. Optionally filter with query.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", maxLength: 200 } },
    },
  },
  {
    name: "send_message",
    description:
      "Send a durable fire-and-forget message to one peer address. Default: a busy peer queues behind its current turn; an idle peer is delivered immediately. Set interrupt=true to abort the current native turn (same class as Stop in the sidebar) and deliver this message as the next turn without deleting the thread. Offline or error runtimes fail closed instead of queuing forever. Returns the durable exchange id and its status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["target", "message"],
      properties: {
        target: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1, maxLength: 50000 },
        interrupt: { type: "boolean" },
      },
    },
  },
  {
    name: "ask",
    description:
      "Ask one peer address a question and wait up to timeout_s (default 30, max 110) for its reply. A timeout only stops waiting — the ask stays durable and a late reply remains readable via inbox. Never treat a timeout as a failure of the peer or as an interrupt. Set interrupt=true to abort a busy turn first, then wait for the new turn's reply. Returns the exchange and whether the wait timed out.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["target", "message"],
      properties: {
        target: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1, maxLength: 50000 },
        timeout_s: { type: "number", minimum: 0, maximum: 110 },
        interrupt: { type: "boolean" },
      },
    },
  },
  {
    name: "reply",
    description:
      "Reply to one exchange addressed to this thread. Threading is preserved at the conversation level; the original ask additionally settles to replied when this thread completes its turn.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["exchangeId", "response"],
      properties: {
        exchangeId: { type: "string", minLength: 1 },
        response: { type: "string", minLength: 1, maxLength: 50000 },
      },
    },
  },
  {
    name: "inbox",
    description:
      "Read this thread's durable cross-thread inbox: incoming asks and messages with threading metadata (exchange ids, statuses, reply excerpts).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
    },
  },
  {
    name: "get_peer_status",
    description:
      "Read one peer's current status (online/offline/busy/unknown) without sending anything.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["target"],
      properties: { target: { type: "string", minLength: 1 } },
    },
  },
  {
    name: "wake_peer",
    description:
      "Retry delivery of queued messages to one peer address (for example after it came back online). Never interrupts the peer; ordinary queued messages still wait for its current turn to settle. To preempt a busy peer, use send_message or ask with interrupt=true.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["target"],
      properties: { target: { type: "string", minLength: 1 } },
    },
  },
  {
    name: "spawn_peer",
    description:
      "Create a REAL long-lived native thread (first-class sidebar thread + official supervisor-launched native session) and bind it as a peer address. The thread opens with the given first message. Returns the harness:nativeId address once the native session id is discovered — never a fabricated id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["model", "message"],
      properties: {
        harness: {
          type: "string",
          minLength: 1,
          description:
            "Harness kind (codex, kimi, opencode, grok, antigravity). When omitted, inferred from the model (e.g. gemini* → antigravity). Never silently reuse the caller's harness for a different model family.",
        },
        model: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1, maxLength: 200 },
        message: { type: "string", minLength: 1, maxLength: 50000 },
        effort: { type: "string", minLength: 1 },
        fast: { type: "boolean" },
      },
    },
  },
  {
    name: "switch_peer_model",
    description:
      "Change a peer thread's model. Same-harness updates the live session config. Cross-harness (e.g. Grok → Gemini) creates a NEW native runtime/session for the target harness, bootstrapped from this thread's conversation — it never relabels a Grok session as Gemini. Failure rolls back to the original model/harness.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["target", "model"],
      properties: {
        target: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "stop_peer",
    description:
      "DESTRUCTIVE: close a peer's runtime session, drop its address binding, and delete its thread row. For test threads and explicit user cleanup — not for archiving conversations. A thread cannot stop itself.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["target"],
      properties: { target: { type: "string", minLength: 1 } },
    },
  },
] as const;

const TOOL_NAMES: ReadonlySet<string> = new Set(TOOLS.map((tool) => tool.name));

export function isKnownToolName(name: string): boolean {
  return TOOL_NAMES.has(name);
}

function requireCallerThreadId(ctx: CrossagentsToolContext): string {
  const threadId = ctx.identity.threadId;
  if (!threadId) {
    throw new Error("This MCP request is not associated with a CraftStation thread.");
  }
  return threadId;
}

function errorResult(message: string): StreamableHttpMcpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function jsonResult(value: unknown): StreamableHttpMcpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function formatToolResult(_name: string, result: unknown): StreamableHttpMcpToolResult {
  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown }).content)
  ) {
    return result as StreamableHttpMcpToolResult;
  }
  return jsonResult(result);
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: CrossagentsToolContext,
): Promise<unknown> {
  const caller = () => requireCallerThreadId(ctx);
  try {
    switch (name) {
      case "list_peers": {
        const query = typeof args.query === "string" ? args.query : undefined;
        const peers = ctx.bus.listPeers(caller(), query);
        return { count: peers.length, peers };
      }
      case "send_message": {
        const target = stringArg(args.target, "target");
        const message = stringArg(args.message, "message");
        return await ctx.bus.send(caller(), target, message, deliveryModeArg(args.interrupt));
      }
      case "ask": {
        const target = stringArg(args.target, "target");
        const message = stringArg(args.message, "message");
        const timeoutMs = timeoutArg(args.timeout_s);
        const source = ctx.bus.requireSource(caller());
        const { threadId } = ctx.bus.resolveAddress(target, source.projectId);
        const exchange = await ctx.bus.askRaw(
          caller(),
          threadId,
          message,
          deliveryModeArg(args.interrupt),
        );
        if (timeoutMs === undefined) return { exchange, timedOut: false };
        const waited = await ctx.bus.waitForReply(caller(), exchange.id, exchange.updatedAt, timeoutMs);
        return { exchange: waited.exchange, timedOut: waited.timedOut };
      }
      case "reply": {
        const exchangeId = stringArg(args.exchangeId, "exchangeId");
        const response = stringArg(args.response, "response");
        return await ctx.bus.reply(caller(), exchangeId, response);
      }
      case "inbox": {
        const limit = intArg(args.limit, 1, 100) ?? 30;
        const exchanges = ctx.bus.inbox(caller(), limit);
        return { count: exchanges.length, exchanges };
      }
      case "get_peer_status": {
        const target = stringArg(args.target, "target");
        return ctx.bus.getPeer(caller(), target);
      }
      case "wake_peer": {
        const target = stringArg(args.target, "target");
        return await ctx.bus.wakePeer(caller(), target);
      }
      case "spawn_peer": {
        const model = stringArg(args.model, "model");
        const message = stringArg(args.message, "message");
        return await ctx.bus.spawnPeer(caller(), {
          model,
          message,
          ...(typeof args.harness === "string" && args.harness.trim()
            ? { harness: args.harness }
            : {}),
          ...(typeof args.title === "string" && args.title.trim() ? { title: args.title } : {}),
          ...(typeof args.effort === "string" && args.effort ? { effort: args.effort } : {}),
          ...(typeof args.fast === "boolean" ? { fast: args.fast } : {}),
        });
      }
      case "switch_peer_model": {
        const target = stringArg(args.target, "target");
        const model = stringArg(args.model, "model");
        return await ctx.bus.switchPeerModel(caller(), target, model);
      }
      case "stop_peer": {
        const target = stringArg(args.target, "target");
        return await ctx.bus.stopPeer(caller(), target);
      }
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function intArg(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Expected an integer between ${min} and ${max}`);
  }
  return Math.min(max, Math.max(min, value));
}

function deliveryModeArg(interrupt: unknown): "after-current-turn" | "interrupt-and-send" {
  return interrupt === true ? "interrupt-and-send" : "after-current-turn";
}

function timeoutArg(value: unknown): number | undefined {
  if (value === undefined) return 30_000;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("timeout_s must be a non-negative number");
  }
  return Math.min(110_000, value * 1000);
}
