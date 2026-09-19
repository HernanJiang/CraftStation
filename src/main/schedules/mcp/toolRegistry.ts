import type {
  StreamableHttpMcpToolResult,
  StreamableHttpMcpToolSpec,
} from "../../mcp/StreamableHttpMcpIngress";
import { scheduleTools } from "./schedules";
import type { ScheduleToolContext, ScheduleToolHandler } from "./types";

export type { ScheduleToolContext } from "./types";

export const SCHEDULE_MCP_SERVER_INFO = {
  name: "Schedule",
  version: "1.0.0",
} as const;

export const SCHEDULE_MCP_INSTRUCTIONS =
  "Use the Schedule MCP server for plans, monitoring, daily routines, and timed tasks " +
  "(计划 / 监控 / 日常 / 定时任务). When work must wait — a training job, CI, a later reminder, " +
  "a recurring check — call create and end this turn. Do not poll, sleep in a loop, or keep " +
  "generating tokens while waiting; the host fires the schedule on this device while CraftStation " +
  "is open and awake. Tools: create, list, get, update, pause, resume, run_now, list_runs, delete. " +
  "list_runs is the ScheduledTaskRun history an agent must use to monitor firings; lastStatus on " +
  "get is only a summary. once.runAt is ISO-8601, Z or offset like +08:00. For sub-hourly repeats " +
  "use recurrence {kind:'interval',everyMinutes:N}. Never ask the scheduled prompt to create its " +
  "own next schedule. Schedules bind to the creating thread by default; set " +
  "continueInCurrentThread:false or threadTarget {kind:'new'} to detach. Thread targets share the " +
  "Crossagents address space: a sidebar thread UUID, thread:<uuid>, or a harness:nativeId address " +
  "(e.g. kimi:session_…, devin:…) all resolve to the SAME thread — no duplicate native session is " +
  "ever created. To fire runs as Devin use agentKind:'devin' with model:'swe-2-max'; get/list/" +
  "list_runs report each task/run's boundThreadId and peerAddress.";

export const TOOLS: readonly StreamableHttpMcpToolSpec[] = scheduleTools.specs;

const HANDLERS: Record<string, ScheduleToolHandler> = scheduleTools.handlers;

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

export function isKnownToolName(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ScheduleToolContext,
): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(args, ctx);
}

export function formatToolResult(_name: string, result: unknown): StreamableHttpMcpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
