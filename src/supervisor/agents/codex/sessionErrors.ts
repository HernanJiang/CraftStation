/**
 * Codex pool quota signal for turn failures. The verbatim exhausted shape
 * observed in-repo (`Error running remote compact task You've hit your usage
 * limit. Visit https://chatgpt.com/codex/settings/usage to purchase more
 * credits.`) arrives via async `turn/completed(failed)` / `thread/error`
 * notifications, never as a `turn/start` rejection — so this matcher runs on
 * notification text, not RPC shapes.
 *
 * Deliberately narrow: rate-limiting (`429`, `willRetry`, approaching-limit
 * nudges) recovers on its own and must never burn a failover chain.
 */
export function isCodexPoolQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message) return false;
  if (/willRetry|rate limit exceeded|\b429\b|approaching\s+rate\s+limits/i.test(message)) {
    return false;
  }
  return /you've hit your usage limit/i.test(message);
}
