import type { HostCacheStore, HttpClient, HttpResponse, Logger } from "./host";
import type { UsageWindow } from "./types";

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

/**
 * opencode.ai runs two session systems on the same host. The legacy Zen
 * console (`/auth`, `/workspace/...`, SolidStart `useSession`) seals its session
 * into `auth`; the new console (`/console/`, the Effect API worker) issues
 * `console_session` (/`__Host-` variant) after its OIDC callback. A login on
 * either surface must count as a session, so both families are forwarded.
 */
export const OPENCODE_AUTH_COOKIE_NAMES = new Set([
  "auth",
  "__Host-auth",
  "console_session",
  "__Host-console_session",
]);

const OPENCODE_ZEN_COOKIE_NAMES = new Set(["auth", "__Host-auth"]);
const OPENCODE_CONSOLE_COOKIE_NAMES = new Set(["console_session", "__Host-console_session"]);

function cookieHeaderHas(cookie: string, names: Set<string>): boolean {
  return cookie.split(";").some((part) => {
    const eq = part.indexOf("=");
    return eq > 0 && names.has(part.slice(0, eq).trim());
  });
}

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

interface ZenWorkspaceProbe {
  /** A workspace id listed by the `workspaces` server-fn for this session. */
  workspaceId?: string;
  /**
   * The `auth` session decoded to a real account even though no workspace was
   * returned. `getWorkspaces` throws a redirect to the new-console login for
   * accounts whose billing moved off the Zen console; anonymous and garbage
   * cookies instead get the 200 "public actor" error or a 500, so a redirect
   * response is itself the authenticated signal.
   */
  authenticated: boolean;
}

async function probeZenWorkspace(http: HttpClient, cookie: string): Promise<ZenWorkspaceProbe> {
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
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location && !location.includes("/auth/")) {
      return { authenticated: true };
    }
    if (res.status !== 200) continue;
    // A workspace id in the payload is itself proof of a signed-in session;
    // extract before the signed-out heuristic so incidental "login" text in a
    // live response (e.g. a workspace slug) can't veto it.
    const id = workspaceIdsFromText(res.body)[0];
    if (id) return { workspaceId: id, authenticated: true };
    if (looksSignedOut(res.body)) continue;
  }
  return { authenticated: false };
}

/**
 * Resolve the user's workspace id from opencode.ai using the auth cookie, or
 * undefined when the cookie is missing/stale/signed-out (or the account was
 * migrated to the new console, which redirects instead of listing workspaces).
 */
export async function fetchOpenCodeWorkspaceId(
  http: HttpClient,
  cookie: string,
): Promise<string | undefined> {
  return (await probeZenWorkspace(http, cookie)).workspaceId;
}

/**
 * New-console session probe: `GET /console/auth/session` answers 401
 * `SessionQueryFailed` for anonymous calls and 200 with the session payload for
 * a live `console_session` cookie — no billing/workspace membership required,
 * so it also authenticates accounts the Zen console can no longer list.
 */
async function probeOpenCodeConsoleSession(http: HttpClient, cookie: string): Promise<boolean> {
  const res = await http.request({
    url: "https://opencode.ai/console/auth/session",
    headers: {
      Cookie: cookie,
      "User-Agent": OPENCODE_USER_AGENT,
      Accept: "application/json",
    },
    timeoutMs: 5000,
  });
  return res.status === 200 && !res.body.includes("SessionQueryFailed");
}

export interface OpenCodeSessionCheck {
  /** The cookie authenticates a signed-in session on either console surface. */
  live: boolean;
  /** Zen-console workspace id, when the `auth` session still resolves one. */
  workspaceId?: string;
}

/**
 * Classify a captured `Cookie` header against both opencode.ai session
 * surfaces: the Zen `workspaces` server-fn (also yields the workspace id used
 * for usage reads) and the new console's `/console/auth/session`. A login that
 * only set `console_session` still counts as live — the Zen surfaces simply
 * have no meters to read for it.
 */
export async function resolveOpenCodeSession(
  http: HttpClient,
  cookieHeader: string,
): Promise<OpenCodeSessionCheck> {
  const cookie = openCodeRequestCookie(cookieHeader);
  if (!cookie) return { live: false };
  if (cookieHeaderHas(cookie, OPENCODE_ZEN_COOKIE_NAMES)) {
    const zen = await probeZenWorkspace(http, cookie);
    if (zen.workspaceId !== undefined) return { live: true, workspaceId: zen.workspaceId };
    if (zen.authenticated) return { live: true };
  }
  if (cookieHeaderHas(cookie, OPENCODE_CONSOLE_COOKIE_NAMES)) {
    if (await probeOpenCodeConsoleSession(http, cookie)) return { live: true };
  }
  return { live: false };
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
 * Console money unit: micro-cents, 1e8 = 1 USD (Go's $10/mo price is stored as
 * `recurringMicroCents: 1000000000n` in the product catalog).
 */
const OPENCODE_MICRO_CENTS_PER_USD = 1e8;

/** `console/api/go/status` meter keys → canonical window ids (Zen-compatible). */
const OPENCODE_CONSOLE_GO_METERS = [
  { meter: "fiveHour", id: "session-5h", label: "Rolling" },
  { meter: "week", id: "weekly", label: "Weekly" },
  { meter: "month", id: "monthly", label: "Monthly" },
] as const;

/** Usage read from the new console (no Zen workspace involved). */
export interface OpenCodeConsoleUsage {
  /** Prepaid balance in USD from `billing/status` (`availableMicroCents` first). */
  balance?: number;
  /** Subscription product id reported by `go/status` ("go", "go-plus", ...). */
  product?: string;
  /** Go rate-limit windows mapped to the canonical ids. Empty when unsubscribed. */
  goWindows: UsageWindow[];
}

function openCodeConsoleGet(
  http: HttpClient,
  cookie: string,
  path: string,
  orgId?: string,
): Promise<HttpResponse | undefined> {
  return http
    .request({
      url: `https://opencode.ai${path}`,
      headers: {
        Cookie: cookie,
        "User-Agent": OPENCODE_USER_AGENT,
        Accept: "application/json",
        ...(orgId !== undefined ? { "x-org-id": orgId } : {}),
      },
      timeoutMs: 5000,
    })
    .catch(() => undefined);
}

/** Org ids from `GET /console/api/orgs` (`[{id: "wrk_…", name}]`). */
export function openCodeConsoleOrgIds(body: string): string[] {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((org) => (org && typeof org === "object" ? (org as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function consoleMicroCents(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

interface OpenCodeConsoleGoStatus {
  product?: string;
  windows: UsageWindow[];
}

/**
 * Parse `GET /console/api/go/status`. The org without the subscription answers
 * `200 null`; a subscribing org answers `{product, access:{meters}}` where
 * `fiveHour`/`week`/`month` budgets are in micro-cents. `fiveHour`'s
 * `startsAt`/`resetsAt` stay null until the rolling window first engages.
 */
export function openCodeConsoleGoStatus(body: string): OpenCodeConsoleGoStatus | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const product = (parsed as { product?: unknown }).product;
  const meters = (parsed as { access?: { meters?: unknown } }).access?.meters;
  if (!meters || typeof meters !== "object") return undefined;
  const windows: UsageWindow[] = [];
  for (const spec of OPENCODE_CONSOLE_GO_METERS) {
    const meter = (meters as Record<string, unknown>)[spec.meter];
    if (!meter || typeof meter !== "object") continue;
    const limit = consoleMicroCents((meter as { limitMicroCents?: unknown }).limitMicroCents);
    if (limit === undefined || limit <= 0) continue;
    const used = consoleMicroCents((meter as { usedMicroCents?: unknown }).usedMicroCents) ?? 0;
    const resetsAtRaw = (meter as { resetsAt?: unknown }).resetsAt;
    const resetsAt = typeof resetsAtRaw === "string" ? Date.parse(resetsAtRaw) : NaN;
    windows.push({
      id: spec.id,
      label: spec.label,
      usedPercent: Math.min(100, Math.max(0, (used / limit) * 100)),
      used: used / OPENCODE_MICRO_CENTS_PER_USD,
      limit: limit / OPENCODE_MICRO_CENTS_PER_USD,
      unit: "usd",
      currency: "USD",
      ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
    });
  }
  return { windows, ...(typeof product === "string" ? { product } : {}) };
}

/** Prepaid balance in USD from `GET /console/api/billing/status`. */
export function openCodeConsoleBalance(body: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const micro =
    consoleMicroCents((parsed as { availableMicroCents?: unknown }).availableMicroCents) ??
    consoleMicroCents((parsed as { balanceMicroCents?: unknown }).balanceMicroCents);
  return micro === undefined ? undefined : micro / OPENCODE_MICRO_CENTS_PER_USD;
}

/**
 * Usage read for `console_session` logins, which have no Zen workspace: list
 * orgs (`/console/api/orgs`), take Go meters from the first org whose
 * `go/status` reports `access.meters` (a subscription attaches to exactly one
 * org — the rest answer `200 null`), then read the prepaid balance from that
 * org (or the first one when no org has Go). Returns undefined when the cookie
 * lacks `console_session` or the orgs call fails — the caller already knows
 * the session is live and degrades to "live, no meters".
 */
export async function fetchOpenCodeConsoleUsage(
  http: HttpClient,
  cookieHeader: string,
): Promise<OpenCodeConsoleUsage | undefined> {
  const cookie = openCodeRequestCookie(cookieHeader);
  // Console endpoints only authenticate `console_session`; skip outright for
  // Zen-only cookies so migrated sessions don't spend requests on 401s.
  if (!cookie || !cookieHeaderHas(cookie, OPENCODE_CONSOLE_COOKIE_NAMES)) return undefined;

  const orgsRes = await openCodeConsoleGet(http, cookie, "/console/api/orgs");
  if (!orgsRes || orgsRes.status !== 200) return undefined;
  const orgIds = openCodeConsoleOrgIds(orgsRes.body);
  if (orgIds.length === 0) return undefined;

  // Bound the fan-out — accounts normally have 1–2 orgs.
  const probeIds = orgIds.slice(0, 8);
  const statuses = await Promise.all(
    probeIds.map(async (orgId) => {
      const res = await openCodeConsoleGet(http, cookie, "/console/api/go/status", orgId);
      return res?.status === 200 ? openCodeConsoleGoStatus(res.body) : undefined;
    }),
  );
  const goIndex = statuses.findIndex((s) => s !== undefined);
  const go = goIndex >= 0 ? statuses[goIndex] : undefined;

  const billingRes = await openCodeConsoleGet(
    http,
    cookie,
    "/console/api/billing/status",
    goIndex >= 0 ? probeIds[goIndex] : probeIds[0],
  );
  const balance = billingRes?.status === 200 ? openCodeConsoleBalance(billingRes.body) : undefined;

  return {
    goWindows: go?.windows ?? [],
    ...(go?.product !== undefined ? { product: go.product } : {}),
    ...(balance !== undefined ? { balance } : {}),
  };
}

/**
 * True iff the captured `Cookie` header authenticates as a live opencode.ai
 * session on either console surface. Use this to gate the "Found a signed-in
 * session" prompt so a stale or in-progress-auth cookie never masquerades as a
 * completed login.
 */
export async function isOpenCodeSessionLive(
  http: HttpClient,
  cookieHeader: string,
): Promise<boolean> {
  return (await resolveOpenCodeSession(http, cookieHeader)).live;
}
