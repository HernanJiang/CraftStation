import {
  antigravityModelsFromFetchAvailableModels,
  antigravityPoolWindows,
  antigravityQuotaSummaryWindows,
  type HostPort,
  type UsageWindow,
  type UsageSnapshot,
} from "@craftstation/agents-usage";
import {
  GET_COMMAND_MODEL_CONFIGS,
  GET_USER_STATUS,
  emailFromUserStatus,
  modelsFromBody,
  planFromUserStatus,
  queryLs,
  RETRIEVE_USER_QUOTA_SUMMARY,
} from "./antigravityLanguageServer";
import { resolveAntigravityLsEndpoints } from "./antigravityProcessScan";

/**
 * Antigravity usage from its local language server (LS-only by design).
 *
 * While `agy` (or the Antigravity IDE) is running it hosts a local language
 * server — a Connect-RPC service reachable on a loopback port. We read its
 * `RetrieveUserQuotaSummary` for the current two-group / 5h+weekly quota model,
 * and `GetUserStatus` for the plan name (and as a legacy fallback when the quota
 * summary is unavailable on older builds). When the LS is not reachable the
 * snapshot is app-not-running: there is no live session. We deliberately do NOT
 * fall back to `agy`'s Cloud Code surface — it reports a different backend's
 * quota (Gemini-only, with different reset windows and counts), so mixing it in
 * would flip the panel to inconsistent numbers as `agy` starts and stops.
 *
 * Discovery (process trees, loopback ports, CSRF tokens) lives in
 * `antigravityProcessScan.ts`; the RPC calls + response parsing live in
 * `antigravityLanguageServer.ts`. This file orchestrates the two.
 */

/**
 * Legacy per-model pooling: GetUserStatus carries each model's 5-hour
 * `quotaInfo.remainingFraction`, which we fold into Gemini Pro / Flash / Claude
 * pools. Used only when `RetrieveUserQuotaSummary` is unavailable.
 */
async function legacyPoolWindows(
  port: number,
  statusBody: unknown,
  csrfTokens: string[],
): Promise<UsageWindow[]> {
  let models = statusBody !== undefined ? modelsFromBody(statusBody) : [];
  if (statusBody !== undefined && models.length === 0) {
    // GetUserStatus answered but carried no quota — try the configs endpoint.
    const configs = await queryLs(port, GET_COMMAND_MODEL_CONFIGS, csrfTokens);
    if (configs !== undefined) models = modelsFromBody(configs);
  }
  return antigravityPoolWindows(models);
}

/** Probe the running language server; undefined when none is reachable. */
async function scanLanguageServer(
  nowMs: number,
  wslDistros: readonly string[],
): Promise<UsageSnapshot | undefined> {
  const { ports, csrfTokens } = await resolveAntigravityLsEndpoints(wslDistros);
  for (const port of ports) {
    // GetUserStatus (plan + legacy fallback) and RetrieveUserQuotaSummary (the
    // preferred quota surface) are independent, so fire them concurrently. This
    // matters most when the port is stale: each queryLs can burn up to ~10s of
    // connect timeouts, so running them in series would double the wall-clock
    // spent before moving on to the next port.
    const [statusBody, summaryBody] = await Promise.all([
      queryLs(port, GET_USER_STATUS, csrfTokens),
      queryLs(port, RETRIEVE_USER_QUOTA_SUMMARY, csrfTokens),
    ]);
    let windows = summaryBody !== undefined ? antigravityQuotaSummaryWindows(summaryBody) : [];
    if (windows.length === 0) {
      windows = await legacyPoolWindows(port, statusBody, csrfTokens);
    }
    const authenticatedAs = emailFromUserStatus(statusBody);
    const plan = planFromUserStatus(statusBody);
    // Keep a reachable, authenticated LS visible even when a particular
    // Antigravity build returns identity/plan but no quota buckets (for
    // example while the quota RPC is warming up). This must not invent a
    // percentage: the renderer will show unavailable bars until real windows
    // arrive, while the full email and subscription tier remain visible.
    if (windows.length > 0 || authenticatedAs || plan) {
      return {
        providerId: "antigravity",
        status: "ok",
        windows,
        fetchedAt: nowMs,
        ...(authenticatedAs ? { authenticatedAs } : {}),
        ...(plan ? { plan } : {}),
      };
    }
  }
  return undefined;
}

/**
 * CLI-only Antigravity machines have no always-on language server, so the LS
 * probe fails and quota would never render (the reported "Antigravity language
 * server is not running" dead end). Fall back to the same OAuth-only upstream
 * the LS itself proxies — the approach verified working in CodexRouter: POST
 * `v1internal:fetchAvailableModels` on cloudcode-pa with the stored Google
 * OAuth token and fold `models{}.quotaInfo.remainingFraction` into pools. This
 * is the LS's own backend surface, not the mismatched Cloud Code quota surface.
 */
const CLOUDCODE_BASES = [
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.googleapis.com",
] as const;

const LOAD_CODE_ASSIST_BODY = JSON.stringify({
  metadata: { ideType: "GEMINI_CLI", pluginType: "GEMINI" },
});

type AntigravityCloudcodeResult =
  | { kind: "ok"; windows: UsageWindow[]; authenticatedAs?: string }
  | { kind: "auth-missing" }
  | { kind: "rate-limited" }
  | { kind: "error"; error: string };

/** Sentinel keys used to flag a terminal status out of the base loop. */
const AUTH_REJECTED = "__antigravityAuthRejected";
const RATE_LIMITED = "__antigravityRateLimited";

function isSentinel(value: unknown, marker: string): boolean {
  return value !== null && typeof value === "object" && marker in (value as object);
}

/**
 * `fetchAvailableModels` without a project answers against a default project
 * whose buckets always read full — a CLI-only machine would show a stuck 0%
 * pool. `loadCodeAssist` names the project the quota endpoints actually scope
 * against; resolve it once per poll before reading models.
 */
async function discoverCloudcodeProjectId(
  accessToken: string,
  host: HostPort,
): Promise<string | undefined> {
  for (const base of CLOUDCODE_BASES) {
    let body: string | undefined;
    try {
      const res = await host.http.request({
        method: "POST",
        url: `${base}/v1internal:loadCodeAssist`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: LOAD_CODE_ASSIST_BODY,
        timeoutMs: 15_000,
      });
      if (res.status < 200 || res.status >= 300) continue;
      body = res.body;
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(body ?? "") as { cloudaicompanionProject?: unknown };
      if (
        typeof parsed.cloudaicompanionProject === "string" &&
        parsed.cloudaicompanionProject.trim()
      ) {
        return parsed.cloudaicompanionProject.trim();
      }
    } catch {
      // Malformed body — try the next base.
    }
  }
  return undefined;
}

async function fetchAntigravityCloudcodeQuota(host: HostPort): Promise<AntigravityCloudcodeResult> {
  let token = await host.credentials.getOAuthToken("antigravity").catch(() => undefined);
  if (!token?.accessToken) return { kind: "auth-missing" };

  const projectId = await discoverCloudcodeProjectId(token.accessToken, host).catch(
    () => undefined,
  );
  const modelsRequestBody = projectId ? JSON.stringify({ project: projectId }) : "{}";
  const readModels = async (accessToken: string): Promise<unknown | string | undefined> => {
    // Terminal verdicts are returned as `{ [AUTH_REJECTED]: true }`-style marker
    // objects so they can never be confused with a successful models body.
    for (const base of CLOUDCODE_BASES) {
      let status = 0;
      let body: string | undefined;
      try {
        const res = await host.http.request({
          method: "POST",
          url: `${base}/v1internal:fetchAvailableModels`,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "User-Agent": "antigravity",
            Accept: "application/json",
          },
          body: modelsRequestBody,
          timeoutMs: 15_000,
        });
        status = res.status;
        body = res.body;
      } catch {
        continue;
      }
      if (status === 401 || status === 403) return { [AUTH_REJECTED]: true };
      if (status === 429) return { [RATE_LIMITED]: true };
      if (status < 200 || status >= 300) continue;
      try {
        return JSON.parse(body ?? "");
      } catch {
        continue;
      }
    }
    return undefined;
  };

  let parsed = await readModels(token.accessToken);
  if (isSentinel(parsed, AUTH_REJECTED)) {
    // One refresh-and-retry: an expired access token must not read as signed out.
    const refreshed = await host.credentials.refreshOAuthToken?.("antigravity", token);
    if (!refreshed?.accessToken || refreshed.accessToken === token.accessToken) {
      return { kind: "auth-missing" };
    }
    token = refreshed;
    parsed = await readModels(token.accessToken);
    if (isSentinel(parsed, AUTH_REJECTED)) return { kind: "auth-missing" };
  }
  if (isSentinel(parsed, RATE_LIMITED)) return { kind: "rate-limited" };
  if (!parsed || typeof parsed !== "object") {
    return { kind: "error", error: "Antigravity quota endpoint unreachable" };
  }

  const models = antigravityModelsFromFetchAvailableModels(parsed);
  const windows = antigravityPoolWindows(models);
  if (windows.length === 0) {
    return { kind: "error", error: "Antigravity quota response carried no models" };
  }
  const authenticatedAs = token.email?.trim() || token.accountId?.trim();
  return {
    kind: "ok",
    windows,
    ...(authenticatedAs ? { authenticatedAs } : {}),
  };
}

/** Build the Antigravity usage snapshot from its local language server. */
export async function scanAntigravityUsage(
  nowMs: number,
  wslDistros: readonly string[] = [],
  host?: HostPort,
): Promise<UsageSnapshot> {
  const ls = await scanLanguageServer(nowMs, wslDistros).catch(() => undefined);
  if (ls) {
    if (ls.windows.length > 0) return ls;
    // The LS answered but carried no quota (or the answer was identity-only):
    // try the OAuth quota path before giving up on numbers entirely.
    const oauth = host
      ? await fetchAntigravityCloudcodeQuota(host).catch(() => undefined)
      : undefined;
    if (oauth?.kind === "ok") {
      return {
        providerId: "antigravity",
        status: "ok",
        windows: oauth.windows,
        fetchedAt: nowMs,
        ...(oauth.authenticatedAs && !ls.authenticatedAs
          ? { authenticatedAs: oauth.authenticatedAs }
          : {}),
        ...(ls.plan ? { plan: ls.plan } : {}),
      };
    }
    const stored = await storedAntigravityIdentity(host);
    return stored.authenticatedAs || stored.plan
      ? {
          ...ls,
          ...(stored.authenticatedAs && !ls.authenticatedAs
            ? { authenticatedAs: stored.authenticatedAs }
            : {}),
          ...(stored.plan && !ls.plan ? { plan: stored.plan } : {}),
        }
      : ls;
  }
  // No language server at all (CLI-only machine): the OAuth quota path is the
  // primary source, with the stored identity as the honest last resort.
  const oauth = host
    ? await fetchAntigravityCloudcodeQuota(host).catch(() => undefined)
    : undefined;
  if (oauth) {
    if (oauth.kind === "ok") {
      return {
        providerId: "antigravity",
        status: "ok",
        windows: oauth.windows,
        fetchedAt: nowMs,
        ...(oauth.authenticatedAs ? { authenticatedAs: oauth.authenticatedAs } : {}),
      };
    }
    if (oauth.kind === "auth-missing") {
      return { providerId: "antigravity", status: "auth-missing", windows: [], fetchedAt: nowMs };
    }
    if (oauth.kind === "rate-limited") {
      return { providerId: "antigravity", status: "rate-limited", windows: [], fetchedAt: nowMs };
    }
    const stored = await storedAntigravityIdentity(host);
    if (stored.authenticatedAs || stored.plan) {
      return {
        providerId: "antigravity",
        status: "ok",
        windows: [],
        fetchedAt: nowMs,
        ...(stored.authenticatedAs ? { authenticatedAs: stored.authenticatedAs } : {}),
        ...(stored.plan ? { plan: stored.plan } : {}),
        error: oauth.error,
      };
    }
    return {
      providerId: "antigravity",
      status: "error",
      windows: [],
      fetchedAt: nowMs,
      error: oauth.error,
    };
  }
  const stored = await storedAntigravityIdentity(host);
  if (stored.authenticatedAs || stored.plan) {
    // Neither the LS nor the quota endpoint answered, but a stored Google OAuth
    // session still proves the account exists. Keep the email/plan visible and
    // leave windows empty so the renderer shows unavailable bars instead of
    // inventing percentages.
    return {
      providerId: "antigravity",
      status: "ok",
      windows: [],
      fetchedAt: nowMs,
      ...(stored.authenticatedAs ? { authenticatedAs: stored.authenticatedAs } : {}),
      ...(stored.plan ? { plan: stored.plan } : {}),
      error: "Antigravity language server is not running",
    };
  }
  return { providerId: "antigravity", status: "app-not-running", windows: [], fetchedAt: nowMs };
}

async function storedAntigravityIdentity(
  host: HostPort | undefined,
): Promise<{ authenticatedAs?: string; plan?: string }> {
  if (!host) return {};
  try {
    const token = await host.credentials.getOAuthToken("antigravity");
    const authenticatedAs = token?.email?.trim() || token?.accountId?.trim();
    return authenticatedAs ? { authenticatedAs } : {};
  } catch {
    return {};
  }
}
