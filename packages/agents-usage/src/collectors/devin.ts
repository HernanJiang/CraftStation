import { toEpochMs } from "../formatters";
import type { CollectOptions, HostPort, HttpClient, HttpResponse } from "../host";
import type { UsageSnapshot, UsageWindow } from "../types";

/**
 * Devin CLI / Cognition. The CLI writes a persistent PAT to credentials.toml
 * (`devin auth login`); `DEVIN_API_KEY` / a pasted key is the fallback. Usage
 * lives behind api.devin.ai (Bearer `cog_…`); daily/weekly/monthly windows are
 * parsed when the payload carries them (nested objects or `<window>_used` /
 * `<window>_limit` fields), with the legacy unscoped `{used, limit}` shape
 * still mapping to the monthly pool. Identity comes from the CLI itself
 * (`devin auth status`, attached supervisor-side): a live token still yields
 * `ok` with identity so the channel stays configured without re-login and
 * Devin models appear in 管理模型.
 *
 *   GET https://api.devin.ai/v3/users/me
 *   GET https://api.devin.ai/v3/usage
 */

export const DEVIN_PROVIDER_ID = "devin" as const;

export const DEVIN_ME_ENDPOINT = "https://api.devin.ai/v3/users/me";
export const DEVIN_USAGE_ENDPOINT = "https://api.devin.ai/v3/usage";

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
 * Collect Devin usage. Pasted API key wins over the host CLI/env token.
 * A live token with no quota payload still returns `ok` plus identity.
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

  let meResponse: HttpResponse | undefined;
  let usageResponse: HttpResponse | undefined;
  try {
    [meResponse, usageResponse] = await Promise.all([
      getJson(host.http, DEVIN_ME_ENDPOINT, bearer),
      getJson(host.http, DEVIN_USAGE_ENDPOINT, bearer),
    ]);
  } catch {
    return parseDevinUsage(undefined, undefined, now, fallbackIdentity);
  }

  const rejected = [meResponse, usageResponse].some(
    (response) => response.status === 401 || response.status === 403,
  );
  if (rejected && !fallbackIdentity.authenticatedAs && !fallbackIdentity.plan) {
    return snapshot("auth-missing", now, { error: "token rejected" });
  }
  if (meResponse.status === 429 || usageResponse.status === 429) {
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

  return parseDevinUsage(parseBody(meResponse), parseBody(usageResponse), now, fallbackIdentity);
}
