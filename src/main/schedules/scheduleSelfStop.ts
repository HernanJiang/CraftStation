/**
 * Host-side stop for a scheduled run whose harness has no Schedule MCP.
 * The model cannot call `pause`/`delete`, so the last line of its reply is
 * the control. Matching is exact and last-line-only so echoing the
 * instructions (which do not end on the command) does not stop the schedule.
 */

export const SCHEDULE_SELF_STOP_PAUSE = "CRAFTSTATION_SCHEDULE: pause";
export const SCHEDULE_SELF_STOP_DELETE = "CRAFTSTATION_SCHEDULE: delete";

const SELF_STOP_LINE =
  /^CRAFTSTATION_SCHEDULE:\s*(pause|delete)(?:\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?\s*$/iu;

export type ScheduleSelfStopAction = "pause" | "delete";

export function scheduleSelfStopInstructions(scheduleId: string): string {
  return [
    "[CraftStation schedule control]",
    `This run is schedule ${scheduleId}.`,
    "If this harness has no Schedule MCP, stop it yourself: the LAST non-empty line of your reply must be exactly",
    `\`${SCHEDULE_SELF_STOP_PAUSE}\` to disable future runs, or \`${SCHEDULE_SELF_STOP_DELETE}\` to remove the schedule.`,
    "Omit that line to keep the schedule. Do not ask a person to pause it.",
    "[CraftStation 定时任务控制]",
    `本轮属于计划 ${scheduleId}。即使当前 harness 没有 Schedule MCP，也可以自己停：回复的最后一个非空行必须正好是`,
    `\`${SCHEDULE_SELF_STOP_PAUSE}\`（暂停后续触发）或 \`${SCHEDULE_SELF_STOP_DELETE}\`（删除）。`,
    "不写这一行则计划继续。不要请人代为暂停。",
  ].join("\n");
}

/** Last non-empty line only. An id, when present, must be this schedule. */
export function readScheduleSelfStop(
  summary: string | null | undefined,
  scheduleId: string,
): ScheduleSelfStopAction | null {
  if (!summary) return null;
  const last = summary
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
  if (!last) return null;
  const match = SELF_STOP_LINE.exec(last);
  if (!match?.[1]) return null;
  const namedId = match[2];
  if (namedId && namedId.toLowerCase() !== scheduleId.toLowerCase()) return null;
  return match[1].toLowerCase() === "delete" ? "delete" : "pause";
}
