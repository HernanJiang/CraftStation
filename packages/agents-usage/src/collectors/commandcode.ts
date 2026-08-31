import { toEpochMs } from "../formatters";
import type { CollectOptions, HostPort, HttpClient, HttpResponse } from "../host";
import type { UsageSnapshot, UsageWindow } from "../types";

/**
 * Command Code reads the CLI API key from
 * `COMMAND_CODE_API_KEY`/`~/.commandcode/auth.json` and calls its authenticated
 * `/alpha/*` API directly. The usage flow mirrors the CLI (`/usage` overlay):
 *
 *   GET /alpha/whoami
 *   GET /alpha/billing/credits
 *   GET /alpha/billing/subscriptions
 *   GET /alpha/usage/summary?since=<currentPeriodStart>
 *
 * Organization accounts include `orgId` on the three billing requests. Usage is
 * a monthly USD credit pool plus rolling 5-hour and weekly USD caps from
 * `credits.windowLimits` (30% / 60% of the plan's monthly credits on most
 * plans), normalized into the shared snapshot shape.
 */

const COMMANDCODE_BASE = "https://api.commandcode.ai";
export const COMMANDCODE_WHOAMI_ENDPOINT = `${COMMANDCODE_BASE}/alpha/whoami`;
export const COMMANDCODE_BILLING_CREDITS_ENDPOINT = `${COMMANDCODE_BASE}/alpha/billing/credits`;
export const COMMANDCODE_BILLING_SUBSCRIPTIONS_ENDPOINT = `${COMMANDCODE_BASE}/alpha/billing/subscriptions`;
export const COMMANDCODE_USAGE_SUMMARY_ENDPOINT = `${COMMANDCODE_BASE}/alpha/usage/summary`;

/**
 * Web-session endpoints (browser Cookie auth) — the same billing service the
 * commandcode.ai settings page calls. The /alpha/* surface authenticates the
 * CLI API key; /internal/* authenticates the better-auth web session. Per
 * token-monitor findings, production session cookies are namespaced
 * commandcode_prod_. (better-auth), and the monthly pool + 5h/weekly caps come
 * from the same credits/subscriptions bodies parsed below.
 */
export const COMMANDCODE_INTERNAL_CREDITS_ENDPOINT = `${COMMANDCODE_BASE}/internal/billing/credits`;
export const COMMANDCODE_INTERNAL_SUBSCRIPTIONS_ENDPOINT = `${COMMANDCODE_BASE}/internal/billing/subscriptions`;
/** Better Auth session endpoint used by commandcode.ai's own web client. */
export const COMMANDCODE_AUTH_SESSION_ENDPOINT = `${COMMANDCODE_BASE}/auth/get-session`;
const COMMANDCODE_WEB_ORIGIN = "https://commandcode.ai";
const COMMANDCODE_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const COMMANDCODE_PROVIDER_ID = "commandcode" as const;

interface CommandCodeWhoamiBody {
  user?: {
    id?: string;
    name?: string;
    email?: string;
    userName?: string;
  };
  org?: {
    id?: string;
    name?: string;
    login?: string;
  } | null;
}

interface CommandCodeSessionBody {
  user?: {
    name?: string;
    email?: string;
    userName?: string;
  } | null;
  session?: {
    user?: {
      name?: string;
      email?: string;
      userName?: string;
    } | null;
  } | null;
}

/** Rolling 5h / weekly USD caps from GET /alpha/billing/credits (CLI ≥1.15). */

interface CommandCodeSubscriptionsBody {
  data?: {
    planId?: string;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    status?: string;
  };
}

/** Plan table aligned with command-code CLI (`$n` / `Fn` maps). */
const COMMANDCODE_PLANS: Record<string, { label: string; monthlyCredits: number }> = {
  "individual-go": { label: "Go", monthlyCredits: 10 },
  "individual-goat": { label: "GOAT", monthlyCredits: 70 },
  "individual-pro": { label: "Pro", monthlyCredits: 30 },
  "individual-pro-v1": { label: "Pro", monthlyCredits: 80 },
  "individual-provider": { label: "Provider", monthlyCredits: 15 },
  "individual-max": { label: "Max", monthlyCredits: 150 },
  "individual-ultra": { label: "Ultra", monthlyCredits: 300 },
  "teams-pro": { label: "Teams Pro", monthlyCredits: 40 },
};
const COMMANDCODE_PLAN_IDS = Object.keys(COMMANDCODE_PLANS).sort((a, b) => b.length - a.length);

function commandCodePlan(
  value: string | undefined,
): { label: string; monthlyCredits: number } | undefined {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  if (!normalized) return undefined;
  const id = COMMANDCODE_PLAN_IDS.find((candidate) => normalized.startsWith(candidate));
  return id ? COMMANDCODE_PLANS[id] : undefined;
}

/** Map a Command Code plan id to the CLI display name. */
export function formatCommandCodePlanLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return commandCodePlan(trimmed)?.label ?? trimmed;
}

function numeric(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function nonNegative(value: number | string | undefined): number {
  return Math.max(0, numeric(value) ?? 0);
}

/**
 * Map a Command Code rolling window (`fiveHour` / `weekly`) into a shared
 * UsageWindow. Caps are USD slices of the monthly credit pool; the CLI shows
 * them as "5-hour" / "Weekly" meters next to the monthly bar.
 */
function commandCodeRollingWindow(
  id: "session-5h" | "weekly",
  label: string,
  limit: any,
): UsageWindow | undefined {
  if (!limit || typeof limit !== "object") return undefined;
  const used = numeric(limit.used ?? limit.consumed ?? limit.amount);
  const cap = numeric(limit.cap ?? limit.limit ?? limit.total ?? limit.allowance);
  if (used === undefined && cap === undefined) return undefined;
  const usedValue = Math.max(0, used ?? 0);
  const capValue = cap !== undefined && cap > 0 ? cap : undefined;
  const usedPercent =
    capValue !== undefined ? Math.min(100, (usedValue / capValue) * 100) : usedValue > 0 ? 100 : 0;
  const rawReset = limit.resetAt ?? limit.reset_at ?? limit.resetsAt ?? limit.resets_at;
  const resetsAt = toEpochMs(rawReset);
  return {
    id,
    label,
    usedPercent,
    unit: "usd",
    currency: "USD",
    used: Number(usedValue.toFixed(4)),
    ...(capValue !== undefined ? { limit: Number(capValue.toFixed(4)) } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

/**
 * Pure: project the billing responses into monthly credits plus rolling 5h /
 * weekly USD caps. For an active known plan, use the plan allocation as the
 * monthly pool floor exactly as the CLI does; otherwise reconstruct the pool
 * from remaining + reported spend. Rolling windows come from
 * `credits.windowLimits` when the API returns them.
 */
export function parseCommandCodeUsage(
  creditsBody: unknown,
  summaryBody: unknown,
  subscriptionsBody: unknown,
  nowMs: number,
  whoamiBody?: unknown,
): UsageSnapshot {
  const body = (creditsBody ?? {}) as any;
  const credits = body.credits ?? body;
  const windowLimits =
    body.windowLimits ?? body.window_limits ?? credits?.windowLimits ?? credits?.window_limits;
  const summary = (summaryBody ?? {}) as any;
  const subData = ((subscriptionsBody ?? {}) as any).data ?? subscriptionsBody;
  const whoami = (whoamiBody ?? {}) as any;

  const monthlyRemaining = nonNegative(credits?.monthlyCredits ?? credits?.monthly_credits);
  const purchasedRemaining = nonNegative(credits?.purchasedCredits ?? credits?.purchased_credits);
  const freeRemaining = nonNegative(credits?.freeCredits ?? credits?.free_credits);
  const totalRemaining = monthlyRemaining + purchasedRemaining + freeRemaining;
  const totalSpent = nonNegative(summary?.totalCost ?? summary?.total_cost ?? summary?.cost);
  const planIdRaw = subData?.planId ?? subData?.plan_id ?? subData?.plan;
  const knownPlan = commandCodePlan(planIdRaw);
  const activePlanAllocation = subData?.status === "active" ? knownPlan?.monthlyCredits : undefined;
  const totalPool =
    activePlanAllocation !== undefined
      ? Math.max(activePlanAllocation, monthlyRemaining) + purchasedRemaining + freeRemaining
      : totalSpent + totalRemaining;
  const used = Math.max(0, totalPool - totalRemaining);
  const usedPercent = totalPool > 0 ? Math.min(100, (used / totalPool) * 100) : 0;
  const rawPeriodEnd =
    subData?.currentPeriodEnd ?? subData?.current_period_end ?? subData?.current_period_reset_at;
  const resetsAt = toEpochMs(rawPeriodEnd);

  const hasCreditData =
    Boolean(
      creditsBody && typeof creditsBody === "object" && Object.keys(creditsBody).length > 0,
    ) ||
    Boolean(summaryBody && typeof summaryBody === "object" && Object.keys(summaryBody).length > 0);
  const monthlyWindow: UsageWindow = {
    id: "monthly",
    label: "Monthly credits",
    usedPercent,
    unit: "usd",
    currency: "USD",
    ...(hasCreditData ? { used: Number(used.toFixed(4)) } : {}),
    ...(totalPool > 0 ? { limit: Number(totalPool.toFixed(4)) } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };

  // Match CLI / Studio order: 5-hour, weekly, then monthly pool.
  const windows: UsageWindow[] = [];
  const fiveHour = commandCodeRollingWindow(
    "session-5h",
    "5-hour limit",
    windowLimits?.fiveHour ?? windowLimits?.five_hour,
  );
  const weekly = commandCodeRollingWindow("weekly", "Weekly limit", windowLimits?.weekly);
  if (fiveHour) windows.push(fiveHour);
  if (weekly) windows.push(weekly);
  windows.push(monthlyWindow);

  const plan = formatCommandCodePlanLabel(subData?.planId ?? subData?.plan_id);
  const authenticatedAs = identityFromCommandCodeBody(whoami);
  return {
    providerId: COMMANDCODE_PROVIDER_ID,
    status: "ok",
    windows,
    fetchedAt: nowMs,
    ...(plan ? { plan } : {}),
    ...(authenticatedAs ? { authenticatedAs } : {}),
  };
}

function commandCodeRequest(http: HttpClient, url: string, apiKey: string): Promise<HttpResponse> {
  return http.request({
    method: "GET",
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    timeoutMs: 15_000,
  });
}

function queryEndpoint(endpoint: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `${endpoint}?${suffix}` : endpoint;
}

function parseJson(res: HttpResponse): unknown {
  try {
    return JSON.parse(res.body);
  } catch {
    return undefined;
  }
}

function identityFromCommandCodeBody(body: unknown): string | undefined {
  const value = (body ?? {}) as CommandCodeSessionBody &
    CommandCodeWhoamiBody & {
      email?: string;
      userName?: string;
      name?: string;
    };
  const candidates = [
    value.email,
    value.userName,
    value.name,
    value.user?.email,
    value.user?.userName,
    value.user?.name,
    value.session?.user?.email,
    value.session?.user?.userName,
    value.session?.user?.name,
    value.org?.login,
    value.org?.name,
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate?.trim()))?.trim();
}

function commandCodeSnapshot(
  status: UsageSnapshot["status"],
  now: number,
  error?: string,
): UsageSnapshot {
  return {
    providerId: COMMANDCODE_PROVIDER_ID,
    status,
    windows: [],
    fetchedAt: now,
    ...(error ? { error } : {}),
  };
}

function responseFailure(responses: HttpResponse[], now: number): UsageSnapshot | undefined {
  if (responses.some((response) => response.status === 401 || response.status === 403)) {
    return commandCodeSnapshot("auth-missing", now);
  }
  if (responses.some((response) => response.status === 429)) {
    return commandCodeSnapshot("rate-limited", now);
  }
  const failed = responses.find((response) => response.status < 200 || response.status >= 300);
  return failed ? commandCodeSnapshot("error", now, `HTTP ${failed.status}`) : undefined;
}

function commandCodeCookieRequest(
  http: HttpClient,
  url: string,
  cookieHeader: string,
): Promise<HttpResponse> {
  return http.request({
    method: "GET",
    url,
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": COMMANDCODE_BROWSER_UA,
      Origin: COMMANDCODE_WEB_ORIGIN,
      Referer: `${COMMANDCODE_WEB_ORIGIN}/`,
    },
    timeoutMs: 15_000,
  });
}

/**
 * True iff a captured commandcode.ai Cookie header authenticates as a live web
 * session. Gates the browser-login prompt; fail-closed so a stale cookie keeps
 * polling instead of falsely reporting a session.
 */
export async function isCommandCodeSessionLive(
  http: HttpClient,
  cookieHeader: string,
): Promise<boolean> {
  try {
    const res = await commandCodeCookieRequest(
      http,
      COMMANDCODE_INTERNAL_CREDITS_ENDPOINT,
      cookieHeader,
    );
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

/** Collect usage via the captured browser session (same bodies as /alpha/*). */
async function collectCommandCodeWithCookie(
  host: HostPort,
  cookieHeader: string,
  now: number,
): Promise<UsageSnapshot> {
  let creditsResponse: HttpResponse;
  let subscriptionsResponse: HttpResponse;
  let whoamiResponse: HttpResponse | undefined;
  let sessionResponse: HttpResponse | undefined;
  try {
    const responses = await Promise.all([
      commandCodeCookieRequest(host.http, COMMANDCODE_INTERNAL_CREDITS_ENDPOINT, cookieHeader),
      commandCodeCookieRequest(
        host.http,
        COMMANDCODE_INTERNAL_SUBSCRIPTIONS_ENDPOINT,
        cookieHeader,
      ),
      // The browser session is also accepted by the identity endpoint on
      // current deployments. Keep this request cookie-scoped so the card can
      // show the same full email for web-session accounts as it does for CLI
      // API-key accounts.
      commandCodeCookieRequest(host.http, COMMANDCODE_WHOAMI_ENDPOINT, cookieHeader),
      commandCodeCookieRequest(host.http, COMMANDCODE_AUTH_SESSION_ENDPOINT, cookieHeader),
    ]);
    [creditsResponse, subscriptionsResponse, whoamiResponse, sessionResponse] = responses;
  } catch {
    // Identity is supplementary for the web session. A deployment that has
    // not exposed the whoami route must not hide otherwise valid billing data.
    try {
      [creditsResponse, subscriptionsResponse] = await Promise.all([
        commandCodeCookieRequest(host.http, COMMANDCODE_INTERNAL_CREDITS_ENDPOINT, cookieHeader),
        commandCodeCookieRequest(
          host.http,
          COMMANDCODE_INTERNAL_SUBSCRIPTIONS_ENDPOINT,
          cookieHeader,
        ),
      ]);
    } catch {
      return commandCodeSnapshot("error", now);
    }
  }
  const failure = responseFailure([creditsResponse, subscriptionsResponse], now);
  if (failure) return failure;
  const credits = parseJson(creditsResponse);
  const subscriptions = parseJson(subscriptionsResponse);
  const whoami =
    whoamiResponse && whoamiResponse.status >= 200 && whoamiResponse.status < 300
      ? parseJson(whoamiResponse)
      : undefined;
  const session =
    sessionResponse && sessionResponse.status >= 200 && sessionResponse.status < 300
      ? parseJson(sessionResponse)
      : undefined;
  if (credits === undefined || subscriptions === undefined) {
    return commandCodeSnapshot("error", now, "invalid JSON response");
  }
  // The web surface has no per-period usage summary; the plan-allowance path in
  // parseCommandCodeUsage derives the monthly pool from the subscription alone.
  const identity = identityFromCommandCodeBody(session) ?? identityFromCommandCodeBody(whoami);
  return parseCommandCodeUsage(
    credits,
    undefined,
    subscriptions,
    now,
    identity ? { user: { email: identity } } : whoami,
  );
}

/** Collect usage with the same API-key and `/alpha/*` flow as the Command Code CLI. */
export async function collectCommandCode(
  host: HostPort,
  _opts?: CollectOptions,
): Promise<UsageSnapshot> {
  const now = host.now();
  const token = await host.credentials.getOAuthToken(COMMANDCODE_PROVIDER_ID);
  if (!token?.accessToken) {
    // No CLI key — fall back to the captured commandcode.ai web session.
    const cookie = (await host.credentials.getSecret(COMMANDCODE_PROVIDER_ID, "cookie"))?.trim();
    if (cookie) return collectCommandCodeWithCookie(host, cookie, now);
    return commandCodeSnapshot("auth-missing", now);
  }

  let whoamiResponse: HttpResponse;
  try {
    whoamiResponse = await commandCodeRequest(
      host.http,
      COMMANDCODE_WHOAMI_ENDPOINT,
      token.accessToken,
    );
  } catch {
    return commandCodeSnapshot("error", now);
  }
  const whoamiFailure = responseFailure([whoamiResponse], now);
  if (whoamiFailure) return whoamiFailure;

  const parsedWhoami = parseJson(whoamiResponse);
  if (parsedWhoami === undefined) {
    return commandCodeSnapshot("error", now, "invalid JSON response");
  }
  const whoami = (parsedWhoami ?? {}) as CommandCodeWhoamiBody;
  const orgId = whoami.org?.id?.trim() || undefined;
  let creditsResponse: HttpResponse;
  let subscriptionsResponse: HttpResponse;
  try {
    [creditsResponse, subscriptionsResponse] = await Promise.all([
      commandCodeRequest(
        host.http,
        queryEndpoint(COMMANDCODE_BILLING_CREDITS_ENDPOINT, { orgId }),
        token.accessToken,
      ),
      commandCodeRequest(
        host.http,
        queryEndpoint(COMMANDCODE_BILLING_SUBSCRIPTIONS_ENDPOINT, { orgId }),
        token.accessToken,
      ),
    ]);
  } catch {
    return commandCodeSnapshot("error", now);
  }
  const billingFailure = responseFailure([creditsResponse, subscriptionsResponse], now);
  if (billingFailure) return billingFailure;

  const credits = parseJson(creditsResponse);
  const parsedSubscriptions = parseJson(subscriptionsResponse);
  if (credits === undefined || parsedSubscriptions === undefined) {
    return commandCodeSnapshot("error", now, "invalid JSON response");
  }
  const subscriptions = (parsedSubscriptions ?? {}) as CommandCodeSubscriptionsBody;
  const since = subscriptions.data?.currentPeriodStart;
  let summaryResponse: HttpResponse;
  try {
    summaryResponse = await commandCodeRequest(
      host.http,
      queryEndpoint(COMMANDCODE_USAGE_SUMMARY_ENDPOINT, { orgId, since }),
      token.accessToken,
    );
  } catch {
    return commandCodeSnapshot("error", now);
  }
  const summaryFailure = responseFailure([summaryResponse], now);
  if (summaryFailure) return summaryFailure;
  const summary = parseJson(summaryResponse);
  if (summary === undefined) {
    return commandCodeSnapshot("error", now, "invalid JSON response");
  }

  const tokenIdentity = [
    token.email,
    token.accountId,
    typeof token.raw?.userName === "string" ? token.raw.userName : undefined,
  ].find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const identity = identityFromCommandCodeBody(whoami) ?? tokenIdentity?.trim();
  return parseCommandCodeUsage(
    credits,
    summary,
    subscriptions,
    now,
    identity ? { user: { email: identity } } : whoami,
  );
}
