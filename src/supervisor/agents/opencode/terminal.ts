import type { OscNotification } from "@/shared/osc";
import {
  brailleSpinnerOscTitleHint,
  findBestHint,
  getOscNotificationText,
  iterm2ProgressOscHint,
  type HintEntry,
  type TerminalStatusHint,
} from "../base";

export const opencodeOscTitleHint = brailleSpinnerOscTitleHint;

function notifyOscHint(notification: OscNotification): TerminalStatusHint | null {
  const text = getOscNotificationText(notification);
  if (text.includes("approval") || text.includes("permission")) {
    return { status: "needs_approval", attention: "needs_approval", corroborated: true };
  }
  return null;
}

export function opencodeOscHint(notification: OscNotification): TerminalStatusHint | null {
  return iterm2ProgressOscHint(notification) ?? notifyOscHint(notification);
}

interface OpenCodeHintEntry extends HintEntry {
  status: TerminalStatusHint["status"];
  attention: TerminalStatusHint["attention"];
}

const OPENCODE_HINTS: OpenCodeHintEntry[] = [
  {
    re: /\[y\/n\]|\(y\/N\)|\(Y\/n\)|Allow\s+.*\?|Approve\s+.*\?/i,
    status: "needs_approval",
    attention: "needs_approval",
    strong: true,
  },
  {
    re: /esc to (?:interrupt|cancel|stop)/i,
    status: "working",
    attention: "working",
    strong: true,
  },
  // Idle: keybind footer is only painted when the TUI accepts input. The two
  // glyph clusters render side-by-side without a separator (`tab agentsctrl+p
  // commands`) because of cursor positioning, so match each independently and
  // skip the trailing word boundary — `agents` butts directly against `ctrl`
  // and `commands` against the cursor reset, so `\b` would refuse to match.
  // Strong because the footer is mutually exclusive with the working
  // indicator above (working state replaces it with "esc to interrupt").
  {
    re: /\btab\s*agents|\bctrl\+p\s*commands/i,
    status: "idle",
    attention: "none",
    strong: true,
  },
  // Backstop for older opencode releases that still painted the placeholder
  // text. Weak: counts only when no strong cue is closer to the tail.
  { re: /Type a message|Type your message|Send a message/i, status: "idle", attention: "none" },
];

export function detectOpenCodeTerminalStatus(text: string): TerminalStatusHint | null {
  // Pre-slice so stale spinner / approval text from earlier in the rolling
  // buffer can't outrank the current footer (mirrors copilot/gemini).
  const tail = text.slice(-1200);
  const best = findBestHint(tail, OPENCODE_HINTS);
  if (!best) return null;
  return { status: best.status, attention: best.attention, corroborated: Boolean(best.strong) };
}
