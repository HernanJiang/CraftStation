import type { McpThreadIdentity } from "@/shared/browserMcpThread";
import type { Thread } from "@/shared/contracts";
import type { StreamableHttpMcpToolSpec } from "../../mcp/StreamableHttpMcpIngress";
import type { ScheduleCapability } from "../ScheduleCapability";

/** Per-request context for the standalone Schedule MCP server. */
export interface ScheduleToolContext {
  identity: McpThreadIdentity;
  scheduleService: ScheduleCapability;
  getThread(threadId: string): Thread | null;
}

export type ScheduleToolHandler = (
  args: Record<string, unknown>,
  ctx: ScheduleToolContext,
) => Promise<unknown> | unknown;

export interface ScheduleToolDomain {
  specs: readonly StreamableHttpMcpToolSpec[];
  handlers: Record<string, ScheduleToolHandler>;
}
