/**
 * Actionable explanation for native-CLI network failures.
 *
 * Native pairings (official CLI + account pool, never CPA) surface the CLI's
 * raw transport text on network failure — e.g. Grok's Rust `reqwest ... error
 * sending request for url (https://cli-chat-proxy.grok.com/v1/responses)`.
 * Users read that as a CraftStation routing bug ("why is it going through a
 * proxy?"). This helper detects transport-level failures and projects a short
 * Chinese explanation that states the native route explicitly and points at
 * network/proxy/VPN, keeping the trimmed original for diagnosis.
 *
 * Deliberately narrow: quota/auth/model errors and our own turn watchdogs
 * must never match here.
 */

const NETWORK_PATTERNS: RegExp[] = [
  /reqwest/i,
  /error sending request/i,
  /\bECONNREFUSED\b/i,
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
  /\bEAI_AGAIN\b/i,
  /\bENOTFOUND\b/i,
  /\bEHOSTUNREACH\b/i,
  /\bENETUNREACH\b/i,
  /timed?\s*out/i,
  /deadline exceeded/i,
  /connection\s+(reset|refused|aborted|closed)/i,
  /failed to connect/i,
  /could not resolve|dns/i,
  /tls|certificate|ssl/i,
  /proxy\s+(error|auth|refused|timeout)|407\b/i,
  /network\s+(is\s+)?unreachable/i,
  /socket hang up/i,
];

/** Internal turn-timeout text (local watchdog, not a network failure). */
const INTERNAL_TIMEOUT_RE = /turn\.completed|waiting for turn/i;

const URL_HOST_RE = /https?:\/\/([^\s/)]+)/i;

/** Marker of our own projected explanation — never re-wrap it. */
const EXPLAINED_MARKER_RE = /未经过 CPA 中转/;

/** True when the text looks like a transport-level failure, not quota/auth. */
export function isNativeNetworkErrorMessage(text: string): boolean {
  if (!text || !text.trim()) return false;
  if (INTERNAL_TIMEOUT_RE.test(text)) return false;
  if (EXPLAINED_MARKER_RE.test(text)) return false;
  return NETWORK_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Project a raw native-CLI error into an actionable message when it is a
 * network failure; otherwise return undefined so callers keep the original.
 * The official host is extracted from the raw text when present
 * (`providerLabel` is optional context, e.g. "Grok").
 */
export function explainNativeNetworkError(
  raw: unknown,
  providerLabel?: string,
): string | undefined {
  const text = raw instanceof Error ? raw.message : String(raw ?? "");
  const trimmed = text.trim();
  if (!isNativeNetworkErrorMessage(trimmed)) return undefined;
  const host = URL_HOST_RE.exec(trimmed)?.[1] ?? "官方服务";
  const subject = providerLabel ? `原生${providerLabel}` : "原生直连";
  const excerpt = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  return (
    `${subject}官方服务失败（${host} 不可达）：` +
    `请检查网络/代理/VPN 后重试。本次走的是原生 CLI + 号池，未经过 CPA 中转。原始错误：${excerpt}`
  );
}
