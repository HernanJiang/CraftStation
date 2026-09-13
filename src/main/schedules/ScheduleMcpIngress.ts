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
}

export class ScheduleMcpIngress {
  private readonly ingress: StreamableHttpMcpIngress<ScheduleToolContext>;

  constructor(deps: ScheduleMcpIngressDeps) {
    this.ingress = new StreamableHttpMcpIngress<ScheduleToolContext>({
      serverInfo: { ...SCHEDULE_MCP_SERVER_INFO },
      instructions: SCHEDULE_MCP_INSTRUCTIONS,
      tools: TOOLS,
      isKnownToolName,
      buildContext: (identity) => ({
        identity,
        scheduleService: deps.scheduleService,
        getThread: deps.getThread,
      }),
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
