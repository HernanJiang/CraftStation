import type { HostCacheStore, HttpClient, Logger } from "./host";

/**
 * OpenCode.ai web-session primitives shared by the usage scanner (reads the Zen
 * balance) and the browser-login flow (verifies a captured cookie is a *real*
 * signed-in session before prompting). Kept here, behind the injected
 * {@link HttpClient}, so both the supervisor scanner and the main-process login
 * validator run the same proven request shape instead of drifting copies.
 *
 * Note: a cookie merely *named* `auth`/`__Host-auth` is not proof of a session —
 * the OpenAuth `/authorize` flow can set one before login completes, and stale
 * values linger in the cookie jar. Only {@link isOpenCodeSessionLive} (an actual
 * authenticated round-trip) reliably distinguishes a live session.
 */

const OPENCODE_WORKSPACES_SERVER_ID =
  "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f";
/**
 * SolidStart server-function id for `lite.subscription.get` (Go plan windows).
 * Shared with CodexBar / community scrapers; reverse-engineered from the console.
 * The id rotates whenever opencode.ai rebuilds the frontend; when every call
 * with it comes back non-2xx, {@link fetchOpenCodeSubscriptionText} re-resolves
 * it from the live route chunks (see {@link resolveOpenCodeSubscriptionServerId}).
 */
const OPENCODE_SUBSCRIPTION_SERVER_ID =
  "c7389bd0e731f80f49593e5ee53835475f4e28594dd6bd83eb229bab753498cd";
/** Host-cache scope holding the last dynamically resolved subscription id. */
const OPENCODE_SUBSCRIPTION_SERVER_ID_CACHE_SCOPE = "opencode.subscription-server-id";
/**
 * Stable log code emitted when the subscription server-fn rejects every call
 * with non-2xx — the telltale sign the id above has rotated again.
 */
export const OPENCODE_SERVER_FN_STALE_CODE = "OPENCODE_SERVER_FN_STALE";
export const OPENCODE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

export const OPENCODE_AUTH_COOKIE_NAMES = new Set(["auth", "__Host-auth"]);

/**
 * Reduce a full `Cookie` header to just the OpenCode auth cookies, or undefined
 * when none are present. Used to forward the minimal credential to opencode.ai.
 */
export function openCodeRequestCookie(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const eq = part.indexOf("=");
      if (eq <= 0) return false;
      return OPENCODE_AUTH_COOKIE_NAMES.has(part.slice(0, eq));
    });
  return parts.length > 0 ? parts.join("; ") : undefined;
}

export function looksSignedOut(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("login") ||
    lower.includes("sign in") ||
    lower.includes("auth/authorize") ||
    lower.includes("not associated with an account") ||
    lower.includes('actor of type "public"')
  );
}

function collectWorkspaceIds(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectWorkspaceIds(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectWorkspaceIds(item, out);
    return;
  }
  if (typeof value === "string" && value.startsWith("wrk_") && !out.includes(value)) {
    out.push(value);
  }
}

export function workspaceIdsFromText(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(/id\s*:\s*"([^"]+)"/g)) {
    const id = match[1];
    if (id?.startsWith("wrk_") && !ids.includes(id)) ids.push(id);
  }
  if (ids.length > 0) return ids;
  try {
    collectWorkspaceIds(JSON.parse(text), ids);
  } catch {
    // non-JSON server payload
  }
  return ids;
}

function serverHeaders(cookie: string, serverId: string): Record<string, string> {
  return {
    Cookie: cookie,
    "X-Server-Id": serverId,
    "X-Server-Instance": `server-fn:${globalThis.crypto.randomUUID()}`,
    "User-Agent": OPENCODE_USER_AGENT,
    Origin: "https://opencode.ai",
    Referer: "https://opencode.ai",
    Accept: "text/javascript, application/json;q=0.9, */*;q=0.8",
  };
}

/**
 * Resolve the user's workspace id from opencode.ai using the auth cookie, or
 * undefined when the cookie is missing/stale/signed-out. Doubles as the
 * authoritative "is this cookie a live session?" probe.
 */
export async function fetchOpenCodeWorkspaceId(
  http: HttpClient,
  cookie: string,
): Promise<string | undefined> {
  const getUrl = `https://opencode.ai/_server?id=${encodeURIComponent(OPENCODE_WORKSPACES_SERVER_ID)}`;
  for (const req of [
    { method: "GET" as const, url: getUrl },
    {
      method: "POST" as const,
      url: "https://opencode.ai/_server",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    },
  ]) {
    const res = await http.request({
      method: req.method,
      url: req.url,
      headers: {
        ...serverHeaders(cookie, OPENCODE_WORKSPACES_SERVER_ID),
        ...(req.headers ?? {}),
      },
      ...(req.body !== undefined ? { body: req.body } : {}),
      timeoutMs: 5000,
    });
    if (res.status !== 200 || looksSignedOut(res.body)) continue;
    const id = workspaceIdsFromText(res.body)[0];
    if (id) return id;
  }
  return undefined;
}

/**
 * True when the body looks like a Go subscription payload (seroval or JSON)
 * rather than a signed-out/error page. Used to stop trying alternate server-fn
 * body shapes once one succeeds.
 */
export function looksLikeOpenCodeSubscription(text: string): boolean {
  if (!text || looksSignedOut(text)) return false;
  return /rollingUsage/i.test(text) && /usagePercent/i.test(text);
}

/** Optional host wiring for {@link fetchOpenCodeSubscriptionText} self-healing. */
export interface FetchOpenCodeSubscriptionOptions {
  /** Persisted last-known-good server-fn id; takes precedence over the hardcoded one. */
  serverIdCache?: HostCacheStore;
  log?: Logger;
}

/** Total budget for one dynamic server-id re-resolution (~3 sequential fetches). */
const OPENCODE_RESOLVE_TIMEOUT_MS = 10_000;

/** Entry-client script URL (site-root-relative) from an opencode.ai HTML page. */
export function openCodeEntryClientUrl(html: string): string | undefined {
  return html.match(/["'](\/_build\/assets\/entry-client-[\w-]+\.js)["']/)?.[1];
}

/** Chunk file name of the `/workspace/:id/go/` route from the entry-client manifest. */
export function openCodeGoRouteChunkUrl(entryClientJs: string): string | undefined {
  const routeIndex = entryClientJs.indexOf('"path": "/workspace/:id/go/"');
  if (routeIndex < 0) return undefined;
  // The route's $component block (with its `./chunk.js` references) precedes the
  // path key; the nearest chunk reference before it is the route chunk.
  const before = entryClientJs.slice(Math.max(0, routeIndex - 4000), routeIndex);
  const refs = [...before.matchAll(/"\.\/([\w-]+\.js)"/g)];
  return refs.at(-1)?.[1];
}

/** Server-fn id bound to `lite.subscription.get` inside a route chunk. */
export function openCodeSubscriptionServerIdFromChunk(chunkJs: string): string | undefined {
  const bindingIndex = chunkJs.indexOf('"lite.subscription.get"');
  if (bindingIndex < 0) return undefined;
  // Compiled shape: `const x_query = createServerReference("<64hex>");` then
  // `const x = query(x_query, "lite.subscription.get")` — so the binding id is
  // the closest server reference preceding the public name.
  const before = chunkJs.slice(0, bindingIndex);
  const refs = [...before.matchAll(/createServerReference\(\s*"([a-f0-9]{64})"/g)];
  return refs.at(-1)?.[1];
}

/**
 * Re-resolve the `lite.subscription.get` server-function id from the live
 * opencode.ai frontend: home HTML -> entry-client manifest -> `/workspace/:id/go/`
 * route chunk -> the 64-hex id bound to `lite.subscription.get`. Best-effort:
 * any failure (network, shape drift, timeout) returns undefined so callers fall
 * back to the last-known id without taking the usage scan down.
 */
export async function resolveOpenCodeSubscriptionServerId(
  http: HttpClient,
): Promise<string | undefined> {
  const deadline = Date.now() + OPENCODE_RESOLVE_TIMEOUT_MS;
  const get = async (url: string): Promise<string | undefined> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;
    try {
      const res = await http.request({
        url,
        headers: { "User-Agent": OPENCODE_USER_AGENT },
        timeoutMs: remaining,
      });
      return res.status === 200 ? res.body : undefined;
    } catch {
      return undefined;
    }
  };
  const html = await get("https://opencode.ai/");
  const entryPath = html ? openCodeEntryClientUrl(html) : undefined;
  if (!entryPath) return undefined;
  const entryJs = await get(`https://opencode.ai${entryPath}`);
  const chunkName = entryJs ? openCodeGoRouteChunkUrl(entryJs) : undefined;
  if (!chunkName) return undefined;
  const chunkJs = await get(`https://opencode.ai/_build/assets/${chunkName}`);
  return chunkJs ? openCodeSubscriptionServerIdFromChunk(chunkJs) : undefined;
}

interface SubscriptionFetchOutcome {
  body?: string;
  /**
   * True when the server was reached but rejected every attempt with a non-2xx
   * status — the signature of a rotated server-function id. A 2xx that is
   * signed-out or a bad-args reply means the id still resolves, so those do not
   * count as stale.
   */
  stale: boolean;
}

async function attemptOpenCodeSubscriptionFetch(
  http: HttpClient,
  cookie: string,
  workspaceId: string,
  serverId: string,
): Promise<SubscriptionFetchOutcome> {
  const getUrl =
    `https://opencode.ai/_server?id=${encodeURIComponent(serverId)}` +
    `&input=${encodeURIComponent(JSON.stringify(workspaceId))}`;
  // SolidStart server functions have accepted a few arg encodings over time;
  // try the shapes community tools (CodexBar / VS Code scrapers) have observed.
  const attempts: Array<{
    method: "GET" | "POST";
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }> = [
    {
      method: "POST",
      url: "https://opencode.ai/_server",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([workspaceId]),
    },
    {
      method: "POST",
      url: "https://opencode.ai/_server",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([[workspaceId]]),
    },
    { method: "GET", url: getUrl },
  ];
  let sawResponse = false;
  let sawOk = false;
  for (const req of attempts) {
    try {
      const res = await http.request({
        method: req.method,
        url: req.url,
        headers: {
          ...serverHeaders(cookie, serverId),
          ...(req.headers ?? {}),
        },
        ...(req.body !== undefined ? { body: req.body } : {}),
        timeoutMs: 5000,
      });
      sawResponse = true;
      if (res.status >= 200 && res.status < 300) sawOk = true;
      if (res.status !== 200 || looksSignedOut(res.body)) continue;
      if (looksLikeOpenCodeSubscription(res.body)) return { body: res.body, stale: false };
    } catch {
      // try the next encoding
    }
  }
  return { stale: sawResponse && !sawOk };
}

/**
 * Fetch the Go (Lite) subscription payload via the `lite.subscription.get`
 * server function. Prefer this over scraping `/workspace/{id}/go` HTML — the
 * console often hydrates windows client-side, so the page body can omit
 * `rollingUsage` even for a live Go account. Returns the raw response body, or
 * undefined when every attempt fails / looks signed out.
 *
 * Server-id resolution order: the host-persisted cache (itself preferring this
 * run's dynamically resolved value) over the hardcoded constant. When every
 * reached response rejects the call (non-2xx — the id rotated with a site
 * rebuild), the id is re-resolved once from the live route chunks, persisted,
 * and retried once; failures degrade silently to the old "no data" behavior.
 */
export async function fetchOpenCodeSubscriptionText(
  http: HttpClient,
  cookie: string,
  workspaceId: string,
  options?: FetchOpenCodeSubscriptionOptions,
): Promise<string | undefined> {
  const usedId =
    options?.serverIdCache?.read(OPENCODE_SUBSCRIPTION_SERVER_ID_CACHE_SCOPE) ??
    OPENCODE_SUBSCRIPTION_SERVER_ID;
  const initial = await attemptOpenCodeSubscriptionFetch(http, cookie, workspaceId, usedId);
  if (initial.body !== undefined) return initial.body;
  if (!initial.stale) return undefined;

  options?.log?.warn("opencode subscription server-fn rejected every call; re-resolving id", {
    code: OPENCODE_SERVER_FN_STALE_CODE,
    phase: "usage-scan",
    operation: "lite.subscription.get",
    status: "re-resolving",
    hint: "SolidStart server-function id rotated; attempting dynamic re-resolution",
  });
  const freshId = await resolveOpenCodeSubscriptionServerId(http).catch(() => undefined);
  if (!freshId || freshId === usedId) {
    options?.log?.warn("opencode subscription server-fn id re-resolution did not recover", {
      code: OPENCODE_SERVER_FN_STALE_CODE,
      phase: "usage-scan",
      operation: "lite.subscription.get",
      status: "unrecovered",
      hint: "check network reachability of opencode.ai, then update the hardcoded id",
    });
    return undefined;
  }
  try {
    options?.serverIdCache?.write(OPENCODE_SUBSCRIPTION_SERVER_ID_CACHE_SCOPE, freshId);
  } catch {
    // best-effort persistence; the retry below still uses the fresh id
  }
  const retry = await attemptOpenCodeSubscriptionFetch(http, cookie, workspaceId, freshId);
  return retry.body;
}

/**
 * True iff the captured `Cookie` header authenticates as a live opencode.ai
 * session. Use this to gate the "Found a signed-in session" prompt so a stale
 * or in-progress-auth cookie never masquerades as a completed login.
 */
export async function isOpenCodeSessionLive(
  http: HttpClient,
  cookieHeader: string,
): Promise<boolean> {
  const cookie = openCodeRequestCookie(cookieHeader);
  if (!cookie) return false;
  return (await fetchOpenCodeWorkspaceId(http, cookie)) !== undefined;
}
