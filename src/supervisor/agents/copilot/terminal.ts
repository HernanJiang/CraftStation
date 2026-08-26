import { findBestHint, type HintEntry, type TerminalStatusHint } from "../base";

export const READY_RE =
  /Type @ to mention files, # for issues\/PRs, \/ for commands, or \? for shortcuts/i;

const INVALID_SESSION_RE = /Failed to resume session:|Session not found:/i;

const COPILOT_KNOWN_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

// Reject capture-group payloads that contain TUI overlay glyphs. The status
// line lives on the same logical row as the `/model` picker, so when the picker
// is open the captured "model" can be box-drawing chars, an arrow indicator,
// or two visual lines glued by a bare `\r` (which `.` matches).
//   \u0000-\u001f + \u007f  control chars (CR/LF/TAB/etc.)
//   ─-▟            box-drawing + block elements
//   ■-◿            geometric shapes (▶ ◀ ● ○ etc.)
//   ☀-⛿            misc symbols
//   ✀-➿            dingbats (❯ ❮ etc.)
// Real model names are alphanumeric + `.`/`-`/space (e.g. "Claude Opus 4.6",
// "gpt-5.4-mini", "GLM-5.1"), so this is safely conservative.
const MODEL_NAME_REJECT_RE = /[─-▟■-◿☀-⛿✀-➿]/;

function hasControlCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code !== undefined && (code < 0x20 || code === 0x7f)) return true;
  }
  return false;
}

export function sanitizeModelName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return undefined;
  if (hasControlCharacter(trimmed) || MODEL_NAME_REJECT_RE.test(trimmed)) return undefined;
  if (!/[A-Za-z0-9]/.test(trimmed)) return undefined;
  return trimmed;
}

interface CopilotHintEntry extends HintEntry {
  status: TerminalStatusHint["status"];
  attention: TerminalStatusHint["attention"];
  planMode?: boolean;
  approvalPolicy?: string;
}

const COPILOT_HINTS: CopilotHintEntry[] = [
  // ── needs_approval ────────────────────────────────────
  {
    re: /Permission request\s*\(|Path confirmation\s*\(|URL confirmation\s*\(/i,
    status: "needs_approval",
    attention: "needs_approval",
    strong: true,
  },
  // ── needs_reply — interactive forms ───────────────────
  {
    re: /Copilot is requesting information|Enter accept\s*[·•]\s*Tab next\s*[·•]\s*ctrl\+d decline/i,
    status: "needs_reply",
    attention: "needs_reply",
    strong: true,
  },
  {
    re: /Plan Ready for Review|ctrl\+e to show full plan/i,
    status: "needs_reply",
    attention: "needs_reply",
    strong: true,
  },
  // ── needs_reply — persistent action indicator ─────────
  // The TUI form overlay can disappear during redraws, but the conversation
  // action indicator "○ Asking user …" persists in the buffer.
  {
    re: /[○◎◉●]\s*Asking user\b/i,
    status: "needs_reply",
    attention: "needs_reply",
    strong: true,
  },
  // ── needs_reply — existing patterns ───────────────────
  {
    re: /Question\s*\(|Enter to select|This folder is not trusted\. Please confirm folder trust to continue\./i,
    status: "needs_reply",
    attention: "needs_reply",
    strong: true,
  },
  // ── working ───────────────────────────────────────────
  {
    re: /\b(?:thinking|executing|cancelling)\b|\(Esc to cancel\)/i,
    status: "working",
    attention: "working",
    strong: true,
  },
  // ── idle — with mode/policy detection ─────────────────
  { re: /\bautopilot\b/i, status: "idle", attention: "none", approvalPolicy: "autopilot" },
  { re: /\bplan mode\b/i, status: "idle", attention: "none", planMode: true },
  {
    re: READY_RE,
    status: "idle",
    attention: "none",
    strong: true,
  },
];

// Copilot's status bar (always at the bottom of the TUI screen).
// Present in both idle and working states, but "ctrl+q enqueue" only during working.
const STATUS_BAR_RE = /shift\+tab\s+switch mode/i;

// Active working indicator in the TUI — absent once the agent finishes.
const ACTIVE_WORKING_RE = /\(Esc to cancel\)/i;

/**
 * Detect model + effort from explicit "Model changed to:" notification messages.
 * Example: "● Model changed to: claude-opus-4.6 (medium)"
 */
export function detectCopilotModelEffort(
  text: string,
): { rawModel?: string; effort?: string } | null {
  const re = /[●•]\s*Model changed to:\s*(.+?)\s*\((\w+)\)\s*$/gm;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    last = m;
  }
  if (!last) return null;

  const rawModel = sanitizeModelName(last[1]);
  const rawEffort = last[2]?.toLowerCase();
  const effort = rawEffort && COPILOT_KNOWN_EFFORTS.has(rawEffort) ? rawEffort : undefined;

  if (!rawModel && !effort) return null;
  const result: { rawModel?: string; effort?: string } = {};
  if (rawModel) result.rawModel = rawModel;
  if (effort) result.effort = effort;
  return result;
}

/**
 * Detect model + effort from the persistent Copilot status line.
 * Format: "<path> [<branch>]    <ModelDisplay> [(<effort>)]"
 * Example: "~/work/site-search-ui [↗ dev]          GPT-5.4 (xhigh)"
 */
export function detectCopilotStatusLineModel(
  text: string,
): { rawModel?: string; effort?: string } | null {
  // Match lines with a path prefix, bracketed branch info, then 2+ spaces and model info
  const re = /(?:~\/|\/|[A-Z]:).+\[[^\]]*?\]\s{2,}(.+?)\s*$/gm;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    last = m;
  }
  if (!last) return null;

  let raw = last[1]?.trim();
  if (!raw) return null;

  // Extract known effort from the last parenthetical group
  let effort: string | undefined;
  const effortMatch = raw.match(/\((\w+)\)\s*$/);
  if (effortMatch?.[1] && COPILOT_KNOWN_EFFORTS.has(effortMatch[1].toLowerCase())) {
    effort = effortMatch[1].toLowerCase();
    raw = raw.slice(0, effortMatch.index!).trim();
  }

  // Strip remaining parenthetical decorations like "(3x)" to get clean model name
  const rawModel = sanitizeModelName(raw.replace(/\s*\([^)]*\)/g, ""));

  if (!rawModel && !effort) return null;
  const result: { rawModel?: string; effort?: string } = {};
  if (rawModel) result.rawModel = rawModel;
  if (effort) result.effort = effort;
  return result;
}

export function detectCopilotTerminalStatus(text: string): TerminalStatusHint | null {
  const recent = text.slice(-1500);
  const best = findBestHint(recent, COPILOT_HINTS);

  // Fallback idle detection: the combined buffer can include stale "Esc to cancel"
  // text from prevChunk when Copilot redraws from row 2 (\x1b[2;1H) instead of
  // cursor-home (\x1b[H).  In that case findBestHint returns a stale "working"
  // match.  Additionally, after the agent finishes the TUI may omit the "Type @"
  // placeholder prompt entirely, causing findBestHint to return null.
  //
  // Guard: inspect only the tail of the buffer (the most recently drawn screen
  // area).  If the status bar is visible there but no active working indicator
  // is present, the agent has finished and returned to idle.
  if (!best || best.status === "working") {
    const tail = text.slice(-500);
    if (STATUS_BAR_RE.test(tail) && !ACTIVE_WORKING_RE.test(tail)) {
      const hint: TerminalStatusHint = {
        status: "idle",
        attention: "none",
        corroborated: false,
      };
      const modelEffort = detectCopilotModelEffort(text) ?? detectCopilotStatusLineModel(text);
      if (modelEffort?.rawModel) hint.model = modelEffort.rawModel;
      if (modelEffort?.effort) hint.effort = modelEffort.effort;
      return hint;
    }
  }

  if (!best) {
    return null;
  }

  const hint: TerminalStatusHint = {
    status: best.status,
    attention: best.attention,
  };

  if (best.planMode) {
    hint.planMode = true;
  }
  if (best.approvalPolicy) {
    hint.approvalPolicy = best.approvalPolicy;
  }

  // Dual-pattern corroboration: strong patterns are self-corroborating.
  // Weak idle patterns ("autopilot", "plan mode") check for the READY_RE
  // as a second independent signal.
  if (best.strong) {
    hint.corroborated = true;
  } else {
    hint.corroborated = COPILOT_HINTS.some(
      (entry) =>
        entry.strong && entry.status === best.status && entry !== best && entry.re.test(recent),
    );
  }

  // Detect model/effort: prefer explicit "Model changed to:" over status line
  const modelEffort = detectCopilotModelEffort(text) ?? detectCopilotStatusLineModel(text);
  if (modelEffort?.rawModel) hint.model = modelEffort.rawModel;
  if (modelEffort?.effort) hint.effort = modelEffort.effort;

  return hint;
}

export function detectCopilotInvalidSessionRef(text: string): boolean {
  return INVALID_SESSION_RE.test(text);
}

/**
 * Resolve a raw model display name against the adapter's dynamic capabilities.
 * Cascade: exact ID → exact label → substring contains → fallback to raw string.
 */
export function resolveModelId(
  rawModel: string,
  models: Array<{ id: string; label?: string }>,
): string {
  if (!models.length) return rawModel;

  const lower = rawModel.toLowerCase();

  // Exact match on ID
  const exactId = models.find((m) => m.id.toLowerCase() === lower);
  if (exactId) return exactId.id;

  // Exact match on label
  const exactLabel = models.find((m) => m.label?.toLowerCase() === lower);
  if (exactLabel) return exactLabel.id;

  // Substring match: raw contains label or label contains raw
  const containsLabel = models.find(
    (m) =>
      m.label && (lower.includes(m.label.toLowerCase()) || m.label.toLowerCase().includes(lower)),
  );
  if (containsLabel) return containsLabel.id;

  // Substring match on ID
  const containsId = models.find(
    (m) => lower.includes(m.id.toLowerCase()) || m.id.toLowerCase().includes(lower),
  );
  if (containsId) return containsId.id;

  // No match — return raw so the config still reflects the TUI change
  return rawModel;
}
