const INVALID_SESSION_RE = /Error resuming session:\s+Invalid session identifier/i;

export function detectGeminiInvalidSessionRef(output: string): boolean {
  return INVALID_SESSION_RE.test(output);
}
