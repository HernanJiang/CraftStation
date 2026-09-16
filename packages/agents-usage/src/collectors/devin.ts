import { toEpochMs } from "../formatters";
import type { CollectOptions, HostPort, HttpClient, HttpResponse } from "../host";
import type { UsageSnapshot, UsageWindow } from "../types";

/**
 * Devin CLI / Cognition. The CLI writes a persistent PAT to credentials.toml
 * (`devin auth login`); `DEVIN_API_KEY` / a pasted key is the fallback. Usage
 * lives behind api.devin.ai (Bearer `cog_…`). Individual plans often have no
 * public quota payload — a live token still yields `ok` with identity so the
 * channel can be configured and Devin models appear in 管理模型.
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

function monthlyWindowFromBody(body: unknown): UsageWindow | undefined {
  const root = asRecord(body);
  const usage =
    asRecord(root?.usage) ??
    asRecord(root?.quota) ??
    asRecord(root?.credits) ??
    asRecord(root?.acu) ??
    root;
  if (!usage) return undefined;
  const used = numeric(usage.used ?? usage.consumed ?? usage.spent ?? usage.current);
  const limit = numeric(
    usage.limit ?? usage.total ?? usage.cap ?? usage.allowance ?? usage.included,
  );
  if (used === undefined && limit === undefined) return undefined;
  const usedValue = Math.max(0, used ?? 0);
  const capValue = limit !== undefined && limit > 0 ? limit : undefined;
  const usedPercent =
    capValue !== undefined ? Math.min(100, (usedValue / capValue) * 100) : usedValue > 0 ? 100 : 0;
  const resetRaw = usage.resetsAt ?? usage.resetAt ?? usage.reset_at ?? usage.resets_at;
  const resetsAt = toEpochMs(
    typeof resetRaw === "string" || typeof resetRaw === "number" ? resetRaw : undefined,
  );
  return {
    id: "monthly",
    label: "Monthly",
    usedPercent,
    unit: "credits",
    used: usedValue,
    ...(capValue !== undefined ? { limit: capValue } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
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
  const window = monthlyWindowFromBody(usageBody) ?? monthlyWindowFromBody(meBody);
  return {
    providerId: DEVIN_PROVIDER_ID,
    status: "ok",
    windows: window ? [window] : [],
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
