import { isGrokPoolQuotaError, isKimiPoolQuotaError } from "../agents/acp/sessionErrors";
import { isAntigravityQuotaError } from "../agents/antigravity/sessionErrors";
import { isCodexPoolQuotaError } from "../agents/codex/sessionErrors";

/**
 * Subscription-pool providers whose quota exhaustion may trigger same-turn
 * pool failover. Third-party (`openai-compatible`) sessions never walk the
 * pool: their credential source is a single validated endpoint, not a pool
 * account. Auth failures stay fail-closed everywhere — only quota may move
 * a thread to the next row automatically.
 *
 * Shared by the legacy chat lane (`ThreadSessionManager.tryPoolFailover`)
 * and the crafted lane (`SupervisorRuntime` crafted-turn failover) so both
 * agree on which providers rotate and what "this row is spent" means.
 */
export const POOL_FAILOVER_PROVIDERS: ReadonlySet<string> = new Set([
  "grok",
  "kimi",
  "codex",
  "antigravity",
]);

/**
 * Same-turn pool-failover budget: one turn may walk at most this many pool
 * accounts before the original quota error surfaces. Progress is normally
 * bounded earlier by the tried-account set (each attempt marks its account
 * exhausted); the cap only backstops pools whose marks never stick.
 */
export const MAX_POOL_FAILOVER_ATTEMPTS_PER_TURN = 6;

/** Provider-dispatched pool-quota matcher for same-turn failover. */
export function isPoolQuotaErrorForProvider(provider: string, error: unknown): boolean {
  switch (provider) {
    case "grok":
      return isGrokPoolQuotaError(error);
    case "kimi":
      return isKimiPoolQuotaError(error);
    case "codex":
      return isCodexPoolQuotaError(error);
    case "antigravity": {
      const message = error instanceof Error ? error.message : String(error ?? "");
      return isAntigravityQuotaError(message);
    }
    default:
      return false;
  }
}

/** Third-party (`openai-compatible`) channel account id prefix. */
export const THIRD_PARTY_CHANNEL_PROVIDER = "openai-compatible";

/**
 * Whether a session binding may walk to another row on failure. Subscription
 * pools (grok/kimi/codex/antigravity) plus third-party channels; ambient
 * logins and unknown providers stay put.
 */
export function isPoolRotationProvider(provider: string): boolean {
  return POOL_FAILOVER_PROVIDERS.has(provider) || provider === THIRD_PARTY_CHANNEL_PROVIDER;
}

/**
 * Third-party channel failure classification. Narrow on purpose:
 * - `quota`: the channel's inference budget is spent (402 / insufficient
 *   quota / billing limit). Rotates AND cools the row down.
 * - `rate_limited`: transient per-channel throttling (429). Rotates within
 *   the turn but never marks the row — it recovers on its own.
 * - `undefined`: auth denials (401/403), unknown models (404), bad requests
 *   (400) and everything else stay fail-closed: rotating cannot help (wrong
 *   key, wrong model, wrong payload) and a human must look. These shapes
 *   must also never mark the row.
 */
export type ThirdPartyFailureKind = "quota" | "rate_limited";

function thirdPartyFailureSignal(error: unknown): { status?: number; message: string } {
  if (typeof error === "string") return { message: error };
  if (!error || typeof error !== "object") return { message: "" };
  const record = error as {
    status?: unknown;
    httpStatus?: unknown;
    code?: unknown;
    message?: unknown;
    data?: unknown;
    error?: unknown;
  };
  const data =
    record.data && typeof record.data === "object"
      ? (record.data as { http_status?: unknown; status?: unknown; message?: unknown })
      : undefined;
  const nested =
    record.error && typeof record.error === "object"
      ? (record.error as { code?: unknown; message?: unknown; type?: unknown })
      : undefined;
  const firstNumber = (values: unknown[]): number | undefined => {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && /^\d{3}$/.test(value.trim())) return Number(value.trim());
    }
    return undefined;
  };
  const status = firstNumber([
    record.status,
    record.httpStatus,
    data?.http_status,
    data?.status,
    typeof record.code === "number" ||
    (typeof record.code === "string" && /^\d{3}$/.test(record.code.trim()))
      ? record.code
      : undefined,
  ]);
  const messageParts: string[] = [];
  for (const candidate of [
    record.message,
    data?.message,
    nested?.message,
    nested?.code,
    nested?.type,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) messageParts.push(candidate.trim());
  }
  return { ...(status !== undefined ? { status } : {}), message: messageParts.join(" ") };
}

const THIRD_PARTY_FAIL_CLOSED_RE =
  /model[_ ]?not[_ ]?found|does not exist|is not a valid model|no such model|incorrect api key|invalid_api_key|invalid api key|unauthorized|forbidden|bad request|invalid_request_error/i;

const THIRD_PARTY_QUOTA_RE =
  /insufficient_quota|insufficient quota|quota[_ ]?(exceeded|exhausted)|exceed(ed|s)?.{0,24}quota|quota.{0,24}exceed(ed|s)?|billing.*(hard[_ ]?limit|exceeded|limit|quota)|out of (credits?|balance)|balance.*(exhausted|insufficient)|payment required|pay[_ -]?as[_ -]?you[_ -]?go.{0,24}(exhausted|limit)|usage[_ -]?limit|billing[_ -]?quota/i;

const THIRD_PARTY_RATE_LIMIT_RE = /rate[_ -]?limit|too many requests|\b429\b/i;

export function thirdPartyFailureKind(error: unknown): ThirdPartyFailureKind | undefined {
  const { status, message } = thirdPartyFailureSignal(error);
  if (!message && status === undefined) return undefined;
  // Auth denials, unknown models and bad requests fail closed first: a bare
  // status match must never rescue a wrong key or a wrong model id.
  if (status === 401 || status === 403 || status === 404 || status === 400) return undefined;
  if (THIRD_PARTY_FAIL_CLOSED_RE.test(message)) return undefined;
  if (status === 402 || THIRD_PARTY_QUOTA_RE.test(message)) return "quota";
  if (status === 429 || THIRD_PARTY_RATE_LIMIT_RE.test(message)) return "rate_limited";
  return undefined;
}

/**
 * Same-channel protocol-flip trigger for third-party sessions. A 400-class
 * failure means the CHANNEL is reachable and the credential works, but the
 * wire type is wrong for this endpoint — e.g. Volcengine Ark coding rejects
 * Kimi CLI's Responses payload (`400 A parameter specified in the request
 * is not valid`) while the same model answers over chat_completions. The
 * fix is flipping the provider table type on the SAME channel, never
 * walking to another account.
 *
 * Deliberately narrow: only genuine 400s flip. 404 model-not-found is a
 * config error (wrong model id — flipping would just add noise), and
 * 401/403/429/402 keep their existing verdicts (fail-closed / rotate /
 * cool down). Model-not-found and auth wording veto the flip even when a
 * bare 400 appears in the text.
 */
export function isThirdPartyProtocolFlipError(error: unknown): boolean {
  const { status, message } = thirdPartyFailureSignal(error);
  if (!message) return false;
  if (status !== undefined && status !== 400) return false;
  if (
    /model[_ ]?not[_ ]?found|does not exist|no such model|is not a valid model|invalid_api_key|incorrect api key|unauthorized|forbidden/i.test(
      message,
    )
  ) {
    return false;
  }
  return (
    status === 400 ||
    /\b400\b/.test(message) ||
    /bad request|invalid (parameter|request)|parameter.*not valid|not valid.*parameter/i.test(
      message,
    )
  );
}
