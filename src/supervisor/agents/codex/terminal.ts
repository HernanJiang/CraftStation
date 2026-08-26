// Bulletproof Codex detection patterns for spawn orchestration (ready screen).
//
// Codex status layering:
//   L1 — CLI hooks (authoritative): UserPromptSubmit → working,
//        turn-complete → idle, approval events → needs_approval.
//   L2 — OSC only:
//     * OSC 0/2 title with leading braille glyph (U+2800–U+28FF) → working.
//     * OSC 9/777/99 notify → idle + needs_approval (see `codexOscHint` in
//       index.ts). Hooks own L1; OSC is the fallback when not deferred.
//
// Previously L2 also ran a TUI-regex heuristic over `stripAnsiPreservingLayout`
// PTY chunks to detect `Working (Xs • esc to interrupt)` rows. That path was
// removed once Codex's braille-title OSC was discovered to be a strictly
// stronger signal: a single-shot control sequence with no scrollback-repaint
// problem, so the previous `idleStrippedTail` snapshot logic is no longer
// needed either.

const CODEX_UPDATE_RE = /(?:[✨⚡]\s*)?update\s+available/i;
const CODEX_READY_RE = /openai\s+codex/i;
const CODEX_DIRECTORY_RE = /directory\s*:/i;
const CODEX_MODEL_RE = new RegExp("\\/model\\s+to\\s+change", "i");

/**
 * Detect a Codex TUI "Update available!" interactive prompt from
 * ANSI-stripped PTY output.
 */
export function detectCodexUpdatePrompt(text: string): boolean {
  const normalized = text
    .replace(/[✨⚡💡]\s*/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return CODEX_UPDATE_RE.test(normalized);
}

export function detectCodexReadyForInitialPrompt(text: string): boolean {
  if (detectCodexUpdatePrompt(text)) {
    return false;
  }

  const normalized = text.toLowerCase().replace(/\s+/g, " ");

  const hasReady = CODEX_READY_RE.test(normalized);
  const hasDirectory = CODEX_DIRECTORY_RE.test(normalized);
  const hasModel = CODEX_MODEL_RE.test(normalized);

  return hasReady && hasDirectory && hasModel;
}
