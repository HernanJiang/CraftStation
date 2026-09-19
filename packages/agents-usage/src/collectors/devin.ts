import { toEpochMs } from "../formatters";
import type { CollectOptions, HostPort, HttpClient, HttpResponse } from "../host";
import type { UsageSnapshot, UsageWindow } from "../types";

/**
 * Devin CLI / Cognition. The CLI writes a persistent PAT to credentials.toml
 * (`devin auth login`); `DEVIN_API_KEY` / a pasted key is the fallback.
 *
 * Two upstream surfaces, token-dependent:
 * - A pasted `cog_…` API key can call api.devin.ai/v3 (users/me, usage) —
 *   daily/weekly/monthly windows are parsed when the payload carries them.
 * - The CLI's `devin-session-token$…` (windsurf_api_key) is rejected by
 *   api.devin.ai/v3/* with 404; its quota lives on the Windsurf self-serve
 *   seat-management surface (`GetUserStatus`, verified 200 with the CLI
 *   token). That response carries planInfo.planName plus
 *   daily/weekly reset instants; usage-percentage fields only appear for
 *   some account shapes, so windows without one render at 0% until the
 *   server starts reporting a real number (never invented).
 *
 * Identity comes from the CLI itself (`devin auth status`, attached
 * supervisor-side): a live token still yields `ok` with identity so the
 * channel stays configured without re-login and Devin models appear in
 * 管理模型.
 *
 *   GET  https://api.devin.ai/v3/users/me
 *   GET  https://api.devin.ai/v3/usage
 *   POST https://server.self-serve.windsurf.com/…/GetUserStatus
 */

export const DEVIN_PROVIDER_ID = "devin" as const;

export const DEVIN_ME_ENDPOINT = "https://api.devin.ai/v3/users/me";
export const DEVIN_USAGE_ENDPOINT = "https://api.devin.ai/v3/usage";
export const DEVIN_USER_STATUS_ENDPOINT =
  "https://server.self-serve.windsurf.com/exa.seat_management_pb.SeatManagementService/GetUserStatus";

/** The `devin auth login` session token shape (windsurf_api_key in credentials.toml). */
const CLI_SESSION_TOKEN_PREFIX = "devin-session-token$";

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function pickString(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const found = stringField(record[key]);
    if (found) return found;
  }
  return undefined;
}

function identityFromBody(body: unknown): { authenticatedAs?: string; plan?: string } {
  const root = asRecord(body);
  const user = asRecord(root?.user) ?? asRecord(root?.account) ?? asRecord(root?.profile) ?? root;
  const authenticatedAs =
    pickString(user, ["email", "name", "username", "userName", "login", "id"]) ??
    pickString(root, ["email", "name", "username"]);
  const plan =
    pickString(user, ["plan", "planName", "tier", "subscription", "product"]) ??
    pickString(asRecord(root?.subscription), ["plan", "planName", "name", "tier"]) ??
    pickString(root, ["plan", "planName", "tier"]);
  return {
    ...(authenticatedAs ? { authenticatedAs } : {}),
    ...(plan ? { plan } : {}),
  };
}

function windowFromContainer(
  id: string,
  label: string,
  container: Record<string, unknown>,
): UsageWindow | undefined {
  const used = numeric(
    container.used ?? container.consumed ?? container.spent ?? container.current,
  );
  const limit = numeric(
    container.limit ??
      container.total ??
      container.cap ??
      container.allowance ??
      container.included,
  );
  if (used === undefined && limit === undefined) return undefined;
  const usedValue = Math.max(0, used ?? 0);
  const capValue = limit !== undefined && limit > 0 ? limit : undefined;
  const usedPercent =
    capValue !== undefined ? Math.min(100, (usedValue / capValue) * 100) : usedValue > 0 ? 100 : 0;
  const resetRaw =
    container.resetsAt ?? container.resetAt ?? container.reset_at ?? container.resets_at;
  const resetsAt = toEpochMs(
    typeof resetRaw === "string" || typeof resetRaw === "number" ? resetRaw : undefined,
  );
  return {
    id,
    label,
    usedPercent,
    unit: "credits",
    used: usedValue,
    ...(capValue !== undefined ? { limit: capValue } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

const DEVIN_WINDOW_IDS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
] as const;

/**
 * Collect one window's fields from flat `<window>_<field>` keys
 * (`daily_used`, `weeklyLimit`, …) into a synthetic container.
 */
function scopedFieldsFromRecord(
  record: Record<string, unknown>,
  windowId: string,
): Record<string, unknown> | undefined {
  const scoped: Record<string, unknown> = {};
  const prefix = windowId.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    const match = /^([A-Za-z]+)[_]?([A-Za-z_]+)$/.exec(key);
    if (!match) continue;
    const [, scope, field] = match;
    if (scope?.toLowerCase() !== prefix || !field) continue;
    const normalized = field.toLowerCase().replace(/_/g, "");
    if (["used", "consumed", "spent", "current"].includes(normalized)) scoped.used = value;
    else if (["limit", "total", "cap", "allowance", "included"].includes(normalized))
      scoped.limit = value;
    else if (["resetsat", "resetat"].includes(normalized)) scoped.resetsAt = value;
  }
  return Object.keys(scoped).length > 0 ? scoped : undefined;
}

/**
 * Extract daily/weekly/monthly windows from a usage payload. Accepts a window
 * as a nested object (`usage.daily`, `quota.weekly`, …), as flat prefixed
 * fields (`daily_used`/`weekly_limit`), or — for `monthly` only — as the
 * legacy unscoped `{used, limit}` shape, so older payloads keep working.
 */
function windowsFromBody(body: unknown): UsageWindow[] {
  const root = asRecord(body);
  if (!root) return [];
  const nests = [root.usage, root.quota, root.credits, root.acu, root.consumption, root]
    .map(asRecord)
    .filter((nest): nest is Record<string, unknown> => nest !== undefined);
  const windows: UsageWindow[] = [];
  for (const { id, label } of DEVIN_WINDOW_IDS) {
    let found: UsageWindow | undefined;
    for (const nest of nests) {
      const nested = asRecord(nest[id]);
      const scoped = nested ?? scopedFieldsFromRecord(nest, id);
      // Unscoped `{used, limit}` still means the monthly pool (back-compat).
      const container = scoped ?? (id === "monthly" ? nest : undefined);
      if (!container) continue;
      found = windowFromContainer(id, label, container);
      if (found) break;
    }
    if (found) windows.push(found);
  }
  return windows;
}

function mergeWindows(primary: UsageWindow[], fallback: UsageWindow[]): UsageWindow[] {
  const seen = new Set(primary.map((window) => window.id));
  return [...primary, ...fallback.filter((window) => !seen.has(window.id))];
}

/**
 * Quota percentage from a GetUserStatus planStatus. Some account shapes report
 * `dailyRemainingPercent` / `dailyQuotaRemainingPercent` (and weekly twins);
 * most QUOTA-billed accounts report none. undefined means "no number to show".
 */
function remainingPercent(
  planStatus: Record<string, unknown>,
  cadence: "daily" | "weekly",
): number | undefined {
  for (const key of [`${cadence}RemainingPercent`, `${cadence}QuotaRemainingPercent`]) {
    const value = planStatus[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) {
      return value;
    }
  }
  return undefined;
}

function resetAtMs(
  planStatus: Record<string, unknown>,
  cadence: "daily" | "weekly",
): number | undefined {
  for (const key of [`${cadence}ResetAtUnix`, `${cadence}QuotaResetAtUnix`]) {
    const value = planStatus[key];
    if (typeof value === "string" || typeof value === "number") {
      const ms = toEpochMs(value);
      if (ms !== undefined) return ms;
    }
  }
  return undefined;
}

/**
 * Build daily/weekly windows from a GetUserStatus planStatus. A window is
 * emitted when the server reports a reset instant or a remaining percentage —
 * both missing means there is nothing honest to render. Without a percentage
 * the window shows 0% (QUOTA-billed accounts carry no usage number; the reset
 * instant and plan name are the real content).
 */
export function windowsFromUserStatus(body: unknown): UsageWindow[] {
  const root = asRecord(body);
  const userStatus = asRecord(root?.userStatus) ?? root;
  const planStatus = asRecord(userStatus?.planStatus) ?? asRecord(root?.planStatus);
  if (!planStatus) return [];
  const windows: UsageWindow[] = [];
  for (const cadence of ["daily", "weekly"] as const) {
    const percent = remainingPercent(planStatus, cadence);
    const resetsAt = resetAtMs(planStatus, cadence);
    if (percent === undefined && resetsAt === undefined) continue;
    windows.push({
      id: cadence,
      label: cadence === "daily" ? "Daily" : "Weekly",
      usedPercent: percent === undefined ? 0 : Math.round((100 - percent) * 10) / 10,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    });
  }
  return windows;
}

/**
 * Identity + plan from a GetUserStatus body. planInfo can sit at the top level,
 * under userStatus, or under userStatus.planStatus (observed shapes all three).
 */
export function identityFromUserStatus(body: unknown): {
  authenticatedAs?: string;
  plan?: string;
} {
  const root = asRecord(body);
  const userStatus = asRecord(root?.userStatus) ?? root;
  const planStatus = asRecord(userStatus?.planStatus);
  const planInfo =
    asRecord(planStatus?.planInfo) ?? asRecord(userStatus?.planInfo) ?? asRecord(root?.planInfo);
  const authenticatedAs = pickString(userStatus, ["email", "name", "userId"]);
  const plan = pickString(planInfo, ["planName", "teamsTier"]) ?? pickString(root, ["plan"]);
  return {
    ...(authenticatedAs ? { authenticatedAs } : {}),
    ...(plan ? { plan } : {}),
  };
}

export function parseDevinUsage(
  meBody: unknown,
  usageBody: unknown,
  nowMs: number,
  fallbackIdentity?: { authenticatedAs?: string; plan?: string },
): UsageSnapshot {
  const identity = identityFromBody(meBody);
  const usageIdentity = identityFromBody(usageBody);
  const authenticatedAs =
    identity.authenticatedAs ?? usageIdentity.authenticatedAs ?? fallbackIdentity?.authenticatedAs;
  const plan = identity.plan ?? usageIdentity.plan ?? fallbackIdentity?.plan;
  // The usage endpoint wins per window; `/users/me` fills windows it lacks.
  const windows = mergeWindows(windowsFromBody(usageBody), windowsFromBody(meBody));
  return {
    providerId: DEVIN_PROVIDER_ID,
    status: "ok",
    windows,
    fetchedAt: nowMs,
    ...(authenticatedAs ? { authenticatedAs } : {}),
    ...(plan ? { plan } : {}),
  };
}

function snapshot(
  status: UsageSnapshot["status"],
  now: number,
  extra?: Partial<UsageSnapshot>,
): UsageSnapshot {
  return {
    providerId: DEVIN_PROVIDER_ID,
    status,
    windows: [],
    fetchedAt: now,
    ...extra,
  };
}

async function getJson(http: HttpClient, url: string, token: string): Promise<HttpResponse> {
  return http.request({
    method: "GET",
    url,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    timeoutMs: 15_000,
  });
}

/**
 * Windsurf self-serve seat-management `GetUserStatus`: the surface that
 * actually answers for the CLI session token (api.devin.ai/v3 404s for it).
 * Connect-RPC JSON: the token rides both the Bearer header and
 * `metadata.api_key` (verified working request shape).
 */
async function getUserStatus(
  http: HttpClient,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const res = await http.request({
    method: "POST",
    url: DEVIN_USER_STATUS_ENDPOINT,
    headers: {
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      metadata: {
        ide_name: "WINDSURF",
        ide_version: "1.0.0",
        extension_version: "1.0.0",
        api_key: token,
      },
    }),
    timeoutMs: 15_000,
  });
  let parsed: unknown;
  const text = res.body?.trim();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  return { status: res.status, body: parsed };
}

/**
 * Collect Devin usage. Pasted API key wins over the host CLI/env token. The
 * CLI session token goes straight to GetUserStatus (v3 rejects it with 404);
 * other tokens try the v3 usage API first and fall back to GetUserStatus when
 * it yields no windows. A live token with no quota payload still returns `ok`
 * plus identity.
 */
export async function collectDevin(host: HostPort, _opts?: CollectOptions): Promise<UsageSnapshot> {
  const now = host.now();
  const pasted = (await host.credentials.getSecret(DEVIN_PROVIDER_ID, "apiKey"))?.trim();
  const token = await host.credentials.getOAuthToken(DEVIN_PROVIDER_ID);
  const bearer = pasted || token?.accessToken?.trim();
  if (!bearer) return snapshot("auth-missing", now);

  const fallbackIdentity = {
    ...(token?.email?.trim() ? { authenticatedAs: token.email.trim() } : {}),
    ...(token?.subscriptionType?.trim() ? { plan: token.subscriptionType.trim() } : {}),
    ...(token?.accountId?.trim() && !token.email?.trim()
      ? { authenticatedAs: token.accountId.trim() }
      : {}),
  };

  const isCliSessionToken = bearer.startsWith(CLI_SESSION_TOKEN_PREFIX);
  let meResponse: HttpResponse | undefined;
  let usageResponse: HttpResponse | undefined;
  let userStatus: { status: number; body: unknown } | undefined;

  if (isCliSessionToken) {
    // Verified: api.devin.ai/v3/* answers 404 for this token shape — the
    // seat-management surface is the only quota source for it.
    try {
      userStatus = await getUserStatus(host.http, bearer);
    } catch {
      userStatus = undefined;
    }
  } else {
    try {
      [meResponse, usageResponse] = await Promise.all([
        getJson(host.http, DEVIN_ME_ENDPOINT, bearer),
        getJson(host.http, DEVIN_USAGE_ENDPOINT, bearer),
      ]);
    } catch {
      return parseDevinUsage(undefined, undefined, now, fallbackIdentity);
    }
  }

  const rejected =
    [meResponse, usageResponse].some(
      (response) => response !== undefined && (response.status === 401 || response.status === 403),
    ) ||
    (isCliSessionToken &&
      userStatus !== undefined &&
      (userStatus.status === 401 || userStatus.status === 403));
  if (rejected && !fallbackIdentity.authenticatedAs && !fallbackIdentity.plan) {
    return snapshot("auth-missing", now, { error: "token rejected" });
  }
  const rateLimited =
    meResponse?.status === 429 || usageResponse?.status === 429 || userStatus?.status === 429;
  if (rateLimited) {
    return snapshot("rate-limited", now);
  }

  const parseBody = (response: HttpResponse): unknown => {
    if (response.status < 200 || response.status >= 300) return undefined;
    const body = response.body?.trim();
    if (!body) return undefined;
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return undefined;
    }
  };

  const meBody = meResponse ? parseBody(meResponse) : undefined;
  const usageBody = usageResponse ? parseBody(usageResponse) : undefined;
  const parsed = parseDevinUsage(meBody, usageBody, now, fallbackIdentity);

  // CLI session token: GetUserStatus is the primary (only) source. API key:
  // fall back only when the v3 payload carried no windows of its own.
  const needsUserStatus = isCliSessionToken || parsed.windows.length === 0;
  if (needsUserStatus && userStatus === undefined) {
    try {
      userStatus = await getUserStatus(host.http, bearer);
    } catch {
      userStatus = undefined;
    }
  }
  if (userStatus && userStatus.status >= 200 && userStatus.status < 300) {
    // The server's own view of identity/plan wins over the stored token's
    // static fields and the v3 payload — it reflects the account as it is now.
    const statusIdentity = identityFromUserStatus(userStatus.body);
    const statusWindows = windowsFromUserStatus(userStatus.body);
    return {
      ...parsed,
      ...(statusIdentity.authenticatedAs
        ? { authenticatedAs: statusIdentity.authenticatedAs }
        : {}),
      ...(statusIdentity.plan ? { plan: statusIdentity.plan } : {}),
      windows: mergeWindows(parsed.windows, statusWindows),
    };
  }
  return parsed;
}
