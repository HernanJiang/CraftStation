import type { AgentEventIntent } from "@/shared/contracts";

// Mirrors the JS-side mapping in plugin.mjs. Kept as TS so the canonical event
// list is type-checked and easy to keep in sync from PR review.
//
// `tool.execute.before` is a top-level hook key in OpenCode's `Hooks`
// interface. Everything else here is dispatched from the unified `event`
// callback by switching on `event.type` — those names are not valid as
// top-level keys and are listed here only as the canonical intent map.
export function opencodeIntentFor(eventName: string): AgentEventIntent | undefined {
  switch (eventName) {
    case "session.created":
      return "session.started";
    case "tool.execute.before":
      return "session.turn_started";
    case "permission.asked":
    case "permission.updated":
      return "session.needs_approval";
    case "session.idle":
      return "session.turn_finished";
    case "session.error":
      return "session.turn_errored";
    default:
      return undefined;
  }
}
