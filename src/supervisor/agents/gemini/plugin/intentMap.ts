import type { AgentEventIntent } from "@/shared/contracts";

export interface GeminiHookPayload {
  hook_event_name?: string;
  notification_type?: string;
  type?: string;
  message?: string;
}

function notificationNeedsApproval(payload: GeminiHookPayload | undefined): boolean {
  const notificationType = `${payload?.notification_type ?? payload?.type ?? ""}`.toLowerCase();
  const message = `${payload?.message ?? ""}`.toLowerCase();
  return (
    notificationType === "toolpermission" ||
    notificationType.includes("permission") ||
    message.includes("permission") ||
    message.includes("approval")
  );
}

/**
 * Mirror of the trimmed hook surface registered in `install.ts`.
 *
 * Gemini's lifecycle has redundant turn-open events (BeforeModel, BeforeTool,
 * AfterTool) that all converge to `session.turn_started`. Registering them
 * paid the spawn/POST cost N+ times per turn for no state change, so we now
 * register only `BeforeAgent` (turn opens) and `AfterAgent` (turn closes)
 * plus `SessionStart` (bookkeeping) and `Notification` (approval prompts).
 */
export function geminiIntentFor(
  eventName: string,
  payload: GeminiHookPayload | undefined,
): AgentEventIntent | undefined {
  const name = payload?.hook_event_name ?? eventName;
  switch (name) {
    case "SessionStart":
      return "session.started";
    case "BeforeAgent":
      return "session.turn_started";
    case "AfterAgent":
      return "session.turn_finished";
    case "Notification":
      return notificationNeedsApproval(payload) ? "session.needs_approval" : undefined;
    default:
      return undefined;
  }
}
