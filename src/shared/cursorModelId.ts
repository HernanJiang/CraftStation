/**
 * Cursor encodes effort and modifier flags into the model id itself
 * (e.g. `claude-3-7-sonnet-high-thinking-fast`). This module parses that
 * encoding so renderer and supervisor can stay in sync about how to decode
 * a saved id back into a `{ base, effort, fast, thinking }` tuple.
 */

const EFFORT_GROUP = "(?:none|low|medium|high|xhigh|extra-high|max)";
const EFFORT_SUFFIX = new RegExp(`-${EFFORT_GROUP}(?=$|-thinking$)`, "i");
const EFFORT_CAPTURE = new RegExp(`-(${EFFORT_GROUP})(?=$|-thinking$)`, "i");
const FAST_SUFFIX = /-fast$/i;
const THINKING_SUFFIX = /-thinking$/i;

export interface ParsedCursorModelId {
  baseId: string;
  effort?: string;
  fast: boolean;
  thinking: boolean;
}

export function parseCursorModelId(modelId: string): ParsedCursorModelId {
  const fast = FAST_SUFFIX.test(modelId);
  const withoutFast = modelId.replace(FAST_SUFFIX, "");
  const thinking = THINKING_SUFFIX.test(withoutFast);
  const effortMatch = EFFORT_CAPTURE.exec(withoutFast);
  const rawEffort = effortMatch?.[1]?.toLowerCase();
  const effort = rawEffort === "extra-high" ? "xhigh" : rawEffort;
  const baseId = withoutFast.replace(EFFORT_SUFFIX, "").replace(THINKING_SUFFIX, "");
  return { baseId, ...(effort ? { effort } : {}), fast, thinking };
}

/**
 * Older Cursor builds saved the codex-max model as `gpt-5.1-codex`; newer
 * builds expose it as `gpt-5.1-codex-max`. Renderer-side helpers use this to
 * migrate stored configs that reference the legacy id.
 */
export function migrateCursorBaseId(baseId: string): string {
  return baseId === "gpt-5.1-codex" ? "gpt-5.1-codex-max" : baseId;
}
