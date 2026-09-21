import type { Thread } from "@/shared/contracts";
import {
  StreamableHttpMcpIngress,
  type StreamableHttpMcpIngressInfo,
} from "../mcp/StreamableHttpMcpIngress";
import type { ScheduleCapability } from "./ScheduleCapability";
import {
  SCHEDULE_MCP_INSTRUCTIONS,
  SCHEDULE_MCP_SERVER_INFO,
  TOOLS,
  dispatchTool,
  formatToolResult,
  isKnownToolName,
  type ScheduleToolContext,
} from "./mcp/toolRegistry";

export type ScheduleMcpIngressInfo = StreamableHttpMcpIngressInfo;

export interface ScheduleMcpIngressDeps {
  scheduleService: ScheduleCapability;
  getThread(threadId: string): Thread | null;
  /**
   * Resolve an OpenCode provider session id (injected per tool call by the
   * in-process plugin) to its CraftStation thread row. Wired from the
   * persisted sessionRef mapping; without it the URL identity is used.
   */
  resolveThreadIdBySessionId?(sessionId: string): string | null;
  /**
   * Shared Crossagents peer-target resolution (harness:nativeId, thread:<uuid>,
   * or bare sidebar UUID → the same thread row). Wire from the
   * InterHarnessMessageBus so Schedule and Crossagents never diverge on what a
   * target names.
   */
  resolvePeerTarget?(target: string, sourceThreadId: string | null): { threadId: string };
  /** Native peer address of a thread row, when addressable (Crossagents parity). */
  peerAddressOfThread?(threadId: string): string | null;
}

export class ScheduleMcpIngress {
  private readonly ingress: StreamableHttpMcpIngress<ScheduleToolContext>;

  constructor(deps: ScheduleMcpIngressDeps) {
    this.ingress = new StreamableHttpMcpIngress<ScheduleToolContext>({
      serverInfo: { ...SCHEDULE_MCP_SERVER_INFO },
      instructions: SCHEDULE_MCP_INSTRUCTIONS,
      tools: TOOLS,
      progressiveDisclosure: { enabled: true },
      isKnownToolName,
      buildContext: (identity) => ({
        identity,
        scheduleService: deps.scheduleService,
        getThread: deps.getThread,
        ...(deps.resolvePeerTarget ? { resolvePeerTarget: deps.resolvePeerTarget } : {}),
        ...(deps.peerAddressOfThread ? { peerAddressOfThread: deps.peerAddressOfThread } : {}),
      }),
      ...(deps.resolveThreadIdBySessionId
        ? { resolveThreadIdBySessionId: deps.resolveThreadIdBySessionId }
        : {}),
      dispatchTool,
      formatToolResult,
    });
  }

  start(): Promise<ScheduleMcpIngressInfo> {
    return this.ingress.start();
  }

  getInfo(): ScheduleMcpIngressInfo | null {
    return this.ingress.getInfo();
  }

  dispose(): void {
    this.ingress.dispose();
  }
}
