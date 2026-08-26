const UPDATE_RE = /Update available!/;

/**
 * Detect a Codex TUI "Update available!" interactive prompt from
 * ANSI-stripped PTY output.
 *
 * The expected layout (after `stripAnsiPreservingLayout`):
 *
 *   🎉Update available! 0.116.0 -> 0.117.0
 *
 *   Release notes: https://github.com/openai/codex/releases/latest
 *
 *   > 1. Update now (runs `npm install -g @openai/codex`)
 *     2. Skip
 *     3. Skip until next version
 *
 *   Press enter to continue
 */
export function detectUpdatePrompt(text: string): boolean {
  return UPDATE_RE.test(text);
}
