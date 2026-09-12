import type { PromptSegment } from "./contracts";

export type GoalSlashCommand =
  | { kind: "set"; prompt: string }
  | { kind: "empty" }
  | { kind: "not-goal" };

/**
 * Parse a composer line for the `/goal + Prompt` command. Only this form is
 * supported — no `/goal clear|done|...` subcommands in this round.
 */
export function parseGoalSlashCommand(text: string): GoalSlashCommand {
  if (!text.startsWith("/goal")) return { kind: "not-goal" };
  const rest = text.slice("/goal".length);
  if (rest.length > 0 && rest[0] !== " " && rest[0] !== "\t" && rest[0] !== "\n") {
    // `/goals`, `/goalie`, ... are not the goal command.
    return { kind: "not-goal" };
  }
  const prompt = rest.trim();
  if (prompt.length === 0) return { kind: "empty" };
  return { kind: "set", prompt };
}

/**
 * Strip a leading `/goal …` command from structured segments so the provider
 * never sees the command text — the goal itself travels out-of-band (draft
 * `goal` start input, or the live thread's durable goal). Only the leading
 * text segment is rewritten; mentions, files, skills and attachments ride
 * along untouched. Segments that don't start with the command come back
 * unchanged.
 */
export function stripLeadingGoalCommand(segments: PromptSegment[]): PromptSegment[] {
  const [first, ...rest] = segments;
  if (!first || first.kind !== "text" || !first.content.startsWith("/goal")) {
    return segments;
  }
  const tail = first.content.slice("/goal".length);
  if (tail.length > 0 && tail[0] !== " " && tail[0] !== "\t" && tail[0] !== "\n") {
    return segments;
  }
  const stripped = tail.trimStart();
  if (stripped.length === 0) {
    return rest;
  }
  return [{ kind: "text", content: stripped }, ...rest];
}

/**
 * Validate a goal prompt the same way for set and replace. Returns the
 * trimmed prompt or a human-readable rejection reason.
 */
export function validateGoalPrompt(
  prompt: string,
): { ok: true; prompt: string } | { ok: false; error: string } {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return { ok: false, error: "用法：/goal + Prompt（Prompt 不能为空）" };
  return { ok: true, prompt: trimmed };
}

/**
 * Build the fallback goal block prepended to the SENT prompt of every turn
 * while a thread goal is active. Explicitly labeled so neither the model nor
 * any reader mistakes it for a freshly typed user message. Native-goal
 * threads (Codex) never send this — the harness owns their goal.
 */
export function buildGoalContextText(prompt: string): string {
  return `[CraftStation Goal · fallback — persistent thread goal set via /goal, carried automatically; context, not a new user request]\n${prompt}`;
}

/**
 * Native-first routing: only Codex exposes a real harness-level goal surface
 * (`thread/goal/*` on the official app-server). Every other integrated
 * harness gets the CraftStation fallback. The UI derives 原生/兼容 from this
 * same predicate so the label can never disagree with the runtime path.
 */
export function isCodexNativeGoalAgent(agentKind: string): boolean {
  return agentKind === "codex";
}
