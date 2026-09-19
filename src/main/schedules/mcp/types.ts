import type { McpThreadIdentity } from "@/shared/browserMcpThread";
import type { Thread } from "@/shared/contracts";
import type { StreamableHttpMcpToolSpec } from "../../mcp/StreamableHttpMcpIngress";
import type { ScheduleCapability } from "../ScheduleCapability";

/** Per-request context for the standalone Schedule MCP server. */
export interface ScheduleToolContext {
  identity: McpThreadIdentity;
  scheduleService: ScheduleCapability;
  getThread(threadId: string): Thread | null;
  /**
   * Shared Crossagents peer-target resolution: a `harness:nativeId` address
   * (or `thread:<uuid>`, or a bare sidebar UUID) resolves to the SAME thread
   * row — never a duplicate native session. Wired from the
   * InterHarnessMessageBus in production; absent only in isolated tests.
   */
  resolvePeerTarget?(target: string, sourceThreadId: string | null): { threadId: string };
  /**
   * The native peer address (`harness:nativeId`) of a thread row, from the
   * durable binding or the same synthesis Crossagents uses. Null when the
   * thread is unknown or its harness is outside the native-messaging scope.
   */
  peerAddressOfThread?(threadId: string): string | null;
}

export type ScheduleToolHandler = (
  args: Record<string, unknown>,
  ctx: ScheduleToolContext,
) => Promise<unknown> | unknown;

export interface ScheduleToolDomain {
  specs: readonly StreamableHttpMcpToolSpec[];
  handlers: Record<string, ScheduleToolHandler>;
}
