import { detectTerminalStatusFromHints, type TerminalStatusHint } from "../base";

const DEVIN_STRONG = [
  {
    re: /Enter to select|Choose an option/i,
    status: "needs_reply" as const,
    attention: "needs_reply" as const,
  },
  {
    re: /\[y\/n\]|\(y\/N\)|Allow\s+.*\?|Do you want to proceed|Continue\?|Approve\??|Trust this (?:folder|workspace)/i,
    status: "needs_approval" as const,
    attention: "needs_approval" as const,
  },
  {
    re: /\besc to (?:cancel|interrupt)\b|\(esc to cancel/i,
    status: "working" as const,
    attention: "working" as const,
  },
  {
    re: /\bWorking\b|Thinking…|Running command/i,
    status: "working" as const,
    attention: "working" as const,
  },
];

const DEVIN_FALLBACK_IDLE = [
  {
    re: /\?\s+for shortcuts|\/\s+for commands|\/help\b/i,
    status: "idle" as const,
    attention: "none" as const,
  },
  { re: /^\s*>\s*$/m, status: "idle" as const, attention: "none" as const },
];

export function detectDevinTerminalStatus(text: string): TerminalStatusHint | null {
  return detectTerminalStatusFromHints(text, DEVIN_STRONG, DEVIN_FALLBACK_IDLE);
}
