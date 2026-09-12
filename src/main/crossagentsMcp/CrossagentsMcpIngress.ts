import type { McpThreadIdentity } from "@/shared/browserMcpThread";
import type {
  StreamableHttpMcpIngressInfo,
  StreamableHttpMcpToolResult,
} from "../mcp/StreamableHttpMcpIngress";
import { StreamableHttpMcpIngress } from "../mcp/StreamableHttpMcpIngress";
import type { InterHarnessMessageBus } from "../thread-messaging/interHarnessMessageBus";
import {
  CROSSAGENTS_MCP_INSTRUCTIONS,
  CROSSAGENTS_MCP_SERVER_INFO,
  dispatchTool,
  formatToolResult,
  isKnownToolName,
  TOOLS,
  type CrossagentsToolContext,
} from "./toolRegistry";

export type CrossagentsMcpIngressInfo = StreamableHttpMcpIngressInfo;

export interface CrossagentsMcpIngressDeps {
  bus: InterHarnessMessageBus;
}

/**
 * Independent Crossagents (persistent native-peer messaging) MCP ingress.
 * Own HTTP endpoint, own tool registry, own lifecycle — no shared business
 * state with the Own Subagents ingress (only the transport helper and the
 * durable thread ledger are shared). Per-call thread identity arrives via the
 * `?thread=` endpoint query, authenticated by the shared bearer token.
 */
export class CrossagentsMcpIngress {
  private readonly ingress: StreamableHttpMcpIngress<CrossagentsToolContext>;

  constructor(deps: CrossagentsMcpIngressDeps) {
    this.ingress = new StreamableHttpMcpIngress<CrossagentsToolContext>({
      serverInfo: { ...CROSSAGENTS_MCP_SERVER_INFO },
      instructions: CROSSAGENTS_MCP_INSTRUCTIONS,
      tools: TOOLS,
      isKnownToolName,
      buildContext: (identity: McpThreadIdentity) => ({ bus: deps.bus, identity }),
      dispatchTool,
      formatToolResult,
    });
  }

  start(): Promise<CrossagentsMcpIngressInfo> {
    return this.ingress.start();
  }

  getInfo(): CrossagentsMcpIngressInfo | null {
    return this.ingress.getInfo();
  }

  dispose(): void {
    this.ingress.dispose();
  }
}

export type { CrossagentsToolContext };
export type { StreamableHttpMcpToolResult };
