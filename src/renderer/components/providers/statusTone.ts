import type { Thread } from "@/shared/contracts";

export type StatusTone =
  | "inactive"
  | "active"
  | "working"
  | "finished"
  | "error"
  | "attention"
  | "done";

export function getStatusTone(thread: Pick<Thread, "status" | "done">): StatusTone {
  if (thread.done) {
    return "done";
  }

  if (thread.status === "error") {
    return "error";
  }

  if (thread.status === "needs_approval" || thread.status === "needs_reply") {
    return "attention";
  }

  if (thread.status === "working") {
    return "working";
  }

  // A settled turn stays settled. Detached sub-agents keep their own
  // "N Agents working" count inside the thread; they must not put the
  // sidebar, header, or provider icon back on a spinner after 已完成.

  if (thread.status === "finished") {
    return "finished";
  }

  if (thread.status === "idle") {
    return "active";
  }

  return "inactive";
}
