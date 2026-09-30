import { describe, expect, it, vi } from "vitest";
import type { HostCacheStore, HttpClient, HttpRequest, HttpResponse } from "./host";
import {
  fetchOpenCodeConsoleUsage,
  fetchOpenCodeSubscriptionText,
  fetchOpenCodeWorkspaceId,
  isOpenCodeSessionLive,
  looksLikeOpenCodeSubscription,
  openCodeConsoleBalance,
  openCodeConsoleGoStatus,
  openCodeConsoleOrgIds,
  openCodeEntryClientUrl,
  openCodeGoRouteChunkUrl,
  openCodeRequestCookie,
  openCodeSubscriptionServerIdFromChunk,
  resolveOpenCodeSession,
  resolveOpenCodeSubscriptionServerId,
  workspaceIdsFromText,
} from "./openCodeWeb";

function stubHttp(responder: (req: HttpRequest) => HttpResponse): {
  http: HttpClient;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];
  return {
    calls,
    http: {
      request(req: HttpRequest): Promise<HttpResponse> {
        calls.push(req);
        return Promise.resolve(responder(req));
      },
    },
  };
}

const ok = (body: string): HttpResponse => ({ status: 200, headers: {}, body });

describe("openCodeRequestCookie", () => {
  it("keeps only the opencode auth cookies", () => {
    expect(openCodeRequestCookie("auth=tok; theme=dark; __Host-auth=x")).toBe(
      "auth=tok; __Host-auth=x",
    );
  });

  it("keeps the new-console session cookies alongside the zen ones", () => {
    // opencode.ai/console sessions live in console_session / __Host-console_session,
    // not `auth` — dropping them makes a completed console login invisible.
    expect(
      openCodeRequestCookie(
        "auth=anon; __Host-console_oidc_flow=state; console_session=s1; __Host-console_session=s2; ga=1",
      ),
    ).toBe("auth=anon; console_session=s1; __Host-console_session=s2");
  });

  it("returns undefined when no auth cookie is present", () => {
    expect(openCodeRequestCookie("theme=dark; ga=123")).toBeUndefined();
    expect(openCodeRequestCookie(undefined)).toBeUndefined();
  });
});

describe("workspaceIdsFromText", () => {
  it("extracts workspace ids from server-fn text", () => {
    expect(workspaceIdsFromText('foo id:"wrk_abc" bar id:"wrk_def"')).toEqual([
      "wrk_abc",
      "wrk_def",
    ]);
  });

  it("falls back to scanning parsed JSON", () => {
    expect(workspaceIdsFromText(JSON.stringify({ a: { b: ["wrk_json"] } }))).toEqual(["wrk_json"]);
  });
});

describe("isOpenCodeSessionLive", () => {
  it("is false without an auth cookie (no request made)", async () => {
    const { http, calls } = stubHttp(() => ok("ignored"));
    expect(await isOpenCodeSessionLive(http, "theme=dark")).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("is false for a signed-out response even when the cookie name matches", async () => {
    // The mid-`/authorize` and stale-cookie case: the cookie is named `auth` but
    // the server reports a public/sign-in page.
    const { http } = stubHttp(() => ok('please <a href="/auth/authorize">login</a>'));
    expect(await isOpenCodeSessionLive(http, "auth=stale")).toBe(false);
  });

  it("is true when the workspace probe resolves an id", async () => {
    const { http, calls } = stubHttp(() => ok('{"data": id:"wrk_live"}'));
    expect(await isOpenCodeSessionLive(http, "auth=real; other=1")).toBe(true);
    // Only the captured auth cookie is forwarded upstream.
    expect(calls[0]?.headers?.Cookie).toBe("auth=real");
  });

  it("is true when a real zen session is redirected to the new console", async () => {
    // Migrated billing: the workspaces fn throws redirect("<console>/login")
    // instead of the 200 public-actor body an anonymous cookie gets.
    const { http } = stubHttp(() => ({
      status: 302,
      headers: { location: "https://opencode.ai/console/login" },
      body: "",
    }));
    expect(await isOpenCodeSessionLive(http, "auth=real")).toBe(true);
  });

  it("is false when the zen redirect points back at the auth flow", async () => {
    const { http } = stubHttp(() => ({
      status: 302,
      headers: { location: "/auth/authorize" },
      body: "",
    }));
    expect(await isOpenCodeSessionLive(http, "auth=real")).toBe(false);
  });

  it("is true when only the new-console session cookie is live", async () => {
    // Console logins set console_session, never upgrading `auth`: the zen
    // probe must not be the sole liveness oracle.
    const { http, calls } = stubHttp((req) =>
      req.url === "https://opencode.ai/console/auth/session"
        ? ok('{"session":{"id":"s1"}}')
        : ok('actor of type "public" is not associated with an account'),
    );
    expect(await isOpenCodeSessionLive(http, "auth=anon; __Host-console_session=live")).toBe(true);
    expect(calls.some((c) => c.url === "https://opencode.ai/console/auth/session")).toBe(true);
  });

  it("is false when the console session probe reports not authenticated", async () => {
    const { http } = stubHttp((req) =>
      req.url === "https://opencode.ai/console/auth/session"
        ? { status: 401, headers: {}, body: '{"_tag":"SessionQueryFailed"}' }
        : ok('actor of type "public"'),
    );
    expect(await isOpenCodeSessionLive(http, "console_session=dead")).toBe(false);
  });

  it("does not probe the console endpoint when no console cookie exists", async () => {
    const { http, calls } = stubHttp(() => ok('actor of type "public"'));
    expect(await isOpenCodeSessionLive(http, "auth=anon")).toBe(false);
    expect(calls.some((c) => c.url.includes("/console/"))).toBe(false);
  });

  it("propagates probe errors to the caller (treated as not-live upstream)", async () => {
    const http: HttpClient = { request: () => Promise.reject(new Error("network")) };
    await expect(isOpenCodeSessionLive(http, "auth=real")).rejects.toThrow("network");
  });
});

describe("resolveOpenCodeSession", () => {
  it("returns the workspace id when the zen session lists workspaces", async () => {
    const { http } = stubHttp(() => ok('id:"wrk_live"'));
    await expect(resolveOpenCodeSession(http, "auth=real")).resolves.toEqual({
      live: true,
      workspaceId: "wrk_live",
    });
  });

  it("returns live without a workspace id for a console-only session", async () => {
    const { http } = stubHttp((req) =>
      req.url === "https://opencode.ai/console/auth/session"
        ? ok("{}")
        : ok('actor of type "public"'),
    );
    await expect(resolveOpenCodeSession(http, "console_session=s")).resolves.toEqual({
      live: true,
    });
  });
});

describe("fetchOpenCodeWorkspaceId", () => {
  it("keeps returning undefined for a migrated account redirect (no workspace)", async () => {
    const { http } = stubHttp(() => ({
      status: 302,
      headers: { location: "https://opencode.ai/console/login" },
      body: "",
    }));
    await expect(fetchOpenCodeWorkspaceId(http, "auth=real")).resolves.toBeUndefined();
  });
});

describe("looksLikeOpenCodeSubscription", () => {
  it("requires rollingUsage + usagePercent and rejects signed-out pages", () => {
    expect(
      looksLikeOpenCodeSubscription(
        `rollingUsage:$R[1]={status:"ok",usagePercent:42},weeklyUsage:{usagePercent:1}`,
      ),
    ).toBe(true);
    expect(looksLikeOpenCodeSubscription(`please <a href="/auth/authorize">login</a>`)).toBe(false);
    expect(looksLikeOpenCodeSubscription(`{monthlyUsage:{usagePercent:1}}`)).toBe(false);
  });
});

describe("fetchOpenCodeSubscriptionText", () => {
  it("returns the first successful subscription payload body", async () => {
    const payload =
      `rollingUsage:$R[28]={status:"ok",resetInSec:1,usagePercent:100},` +
      `weeklyUsage:$R[29]={status:"ok",resetInSec:2,usagePercent:79}`;
    const { http, calls } = stubHttp((req) => {
      // First POST encoding succeeds.
      if (req.method === "POST" && req.body?.includes("wrk_test")) return ok(payload);
      return ok("nope");
    });
    await expect(fetchOpenCodeSubscriptionText(http, "auth=tok", "wrk_test")).resolves.toBe(
      payload,
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]?.headers?.Cookie).toBe("auth=tok");
    expect(calls[0]?.headers?.["X-Server-Id"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("tries alternate encodings when the first body shape is rejected", async () => {
    let posts = 0;
    const payload = `rollingUsage:{usagePercent:1},weeklyUsage:{usagePercent:2}`;
    const { http } = stubHttp((req) => {
      if (req.method !== "POST") return ok("ignore");
      posts += 1;
      // First encoding fails (empty/error), second succeeds.
      if (posts === 1) return ok('{"error":"bad args"}');
      return ok(payload);
    });
    await expect(fetchOpenCodeSubscriptionText(http, "auth=tok", "wrk_x")).resolves.toBe(payload);
    expect(posts).toBe(2);
  });

  it("returns undefined when every attempt is signed-out or empty", async () => {
    const { http } = stubHttp(() => ok('actor of type "public"'));
    await expect(
      fetchOpenCodeSubscriptionText(http, "auth=stale", "wrk_x"),
    ).resolves.toBeUndefined();
  });

  it("prefers the persisted server-id over the hardcoded fallback", async () => {
    const cachedId = "a".repeat(64);
    const payload = `rollingUsage:{usagePercent:1},weeklyUsage:{usagePercent:2}`;
    const { http, calls } = stubHttp((req) =>
      req.method === "POST" && req.headers?.["X-Server-Id"] === cachedId ? ok(payload) : ok("nope"),
    );
    const serverIdCache: HostCacheStore = {
      read: (scope) => (scope.includes("subscription") ? cachedId : undefined),
      write: () => {},
    };
    await expect(
      fetchOpenCodeSubscriptionText(http, "auth=tok", "wrk_x", { serverIdCache }),
    ).resolves.toBe(payload);
    expect(calls[0]?.headers?.["X-Server-Id"]).toBe(cachedId);
  });

  it("re-resolves and persists a rotated server-fn id, then retries once", async () => {
    const freshId = "b".repeat(64);
    const payload = `rollingUsage:{usagePercent:3},weeklyUsage:{usagePercent:4}`;
    const write = vi.fn<(scope: string, value: string) => void>();
    const serverIdCache: HostCacheStore = { read: () => undefined, write };
    const warn = vi.fn<(message: string, meta?: Record<string, unknown>) => void>();
    const { http, calls } = stubHttp((req) => {
      const url = req.url;
      // Live-site re-resolution chain: home HTML -> entry-client -> route chunk.
      if (url === "https://opencode.ai/") {
        return ok('<script src="/_build/assets/entry-client-abc123.js"></script>');
      }
      if (url === "https://opencode.ai/_build/assets/entry-client-abc123.js") {
        return ok('x=["./route-chunk-9.js"],"path": "/workspace/:id/go/"');
      }
      if (url === "https://opencode.ai/_build/assets/route-chunk-9.js") {
        return ok(
          `const q = createServerReference("${freshId}"); const s = query(q, "lite.subscription.get")`,
        );
      }
      // Every call with the stale id is rejected non-2xx; the fresh id succeeds.
      if (req.headers?.["X-Server-Id"] === freshId) return ok(payload);
      return { status: 404, headers: {}, body: "not found" };
    });

    await expect(
      fetchOpenCodeSubscriptionText(http, "auth=tok", "wrk_x", {
        serverIdCache,
        log: { warn, debug: () => {} },
      }),
    ).resolves.toBe(payload);
    expect(write).toHaveBeenCalledWith("opencode.subscription-server-id", freshId);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("re-resolving id"),
      expect.objectContaining({ code: "OPENCODE_SERVER_FN_STALE" }),
    );
    // The retried call carries the fresh id.
    expect(calls.at(-1)?.headers?.["X-Server-Id"]).toBe(freshId);
  });

  it("returns undefined when re-resolution cannot recover a rotated id", async () => {
    const { http } = stubHttp(() => ({ status: 404, headers: {}, body: "gone" }));
    await expect(
      fetchOpenCodeSubscriptionText(http, "auth=tok", "wrk_x", {
        log: { warn: () => {}, debug: () => {} },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("opencode server-fn id re-resolution helpers", () => {
  it("extracts the entry-client script url from the home html", () => {
    expect(
      openCodeEntryClientUrl('<script src="/_build/assets/entry-client-XYZ_9.js"></script>'),
    ).toBe("/_build/assets/entry-client-XYZ_9.js");
    expect(openCodeEntryClientUrl("<html>no entry</html>")).toBeUndefined();
  });

  it("finds the /workspace/:id/go/ route chunk in the entry-client manifest", () => {
    const manifest = 'a=["./other-1.js","./go-Route-2.js"],"path": "/workspace/:id/go/"';
    expect(openCodeGoRouteChunkUrl(manifest)).toBe("go-Route-2.js");
    expect(openCodeGoRouteChunkUrl('"path": "/workspace/:id/settings/"')).toBeUndefined();
  });

  it("extracts the server-reference id bound to lite.subscription.get", () => {
    const chunk =
      `const a = createServerReference("${"c".repeat(64)}");` +
      `const sub = query(a, "lite.subscription.get")`;
    expect(openCodeSubscriptionServerIdFromChunk(chunk)).toBe("c".repeat(64));
    expect(openCodeSubscriptionServerIdFromChunk("nothing here")).toBeUndefined();
  });

  it("resolveOpenCodeSubscriptionServerId walks html -> entry -> chunk", async () => {
    const freshId = "d".repeat(64);
    const { http } = stubHttp((req) => {
      if (req.url === "https://opencode.ai/") {
        return ok('<script src="/_build/assets/entry-client-e.js"></script>');
      }
      if (req.url.endsWith("entry-client-e.js")) {
        return ok('"./goChunk-7.js","path": "/workspace/:id/go/"');
      }
      if (req.url.endsWith("goChunk-7.js")) {
        return ok(`createServerReference("${freshId}"),"lite.subscription.get"`);
      }
      return { status: 404, headers: {}, body: "" };
    });
    await expect(resolveOpenCodeSubscriptionServerId(http)).resolves.toBe(freshId);
  });

  it("resolveOpenCodeSubscriptionServerId returns undefined on network failure", async () => {
    const http: HttpClient = { request: () => Promise.reject(new Error("offline")) };
    await expect(resolveOpenCodeSubscriptionServerId(http)).resolves.toBeUndefined();
  });
});

describe("openCodeConsoleOrgIds", () => {
  it("collects id strings from the orgs array", () => {
    expect(openCodeConsoleOrgIds('[{"id":"wrk_a","name":"x"},{"id":"wrk_b"},{}]')).toEqual([
      "wrk_a",
      "wrk_b",
    ]);
  });

  it("returns [] for non-array / invalid bodies", () => {
    expect(openCodeConsoleOrgIds("null")).toEqual([]);
    expect(openCodeConsoleOrgIds("not json")).toEqual([]);
    expect(openCodeConsoleOrgIds("{}")).toEqual([]);
  });
});

describe("openCodeConsoleBalance", () => {
  it("prefers availableMicroCents and converts micro-cents to USD", () => {
    expect(
      openCodeConsoleBalance('{"balanceMicroCents":"200000000","availableMicroCents":"150000000"}'),
    ).toBe(1.5);
  });

  it("falls back to balanceMicroCents and handles absent fields", () => {
    expect(openCodeConsoleBalance('{"balanceMicroCents":"1000000000"}')).toBe(10);
    expect(openCodeConsoleBalance("{}")).toBeUndefined();
    expect(openCodeConsoleBalance("oops")).toBeUndefined();
  });
});

describe("openCodeConsoleGoStatus", () => {
  const live =
    '{"product":"go","access":{"meters":{' +
    '"fiveHour":{"startsAt":null,"resetsAt":null,"limitMicroCents":"1200000000","usedMicroCents":"0"},' +
    '"week":{"startsAt":"2026-09-28T00:00:00.000Z","resetsAt":"2026-10-05T00:00:00.000Z","limitMicroCents":"3000000000","usedMicroCents":"0"},' +
    '"month":{"resetsAt":"2026-10-01T00:00:00.000Z","limitMicroCents":"6000000000","usedMicroCents":"3792192729"}}}}';

  it("maps fiveHour/week/month meters to the canonical window ids", () => {
    const status = openCodeConsoleGoStatus(live);
    expect(status?.product).toBe("go");
    expect(status?.windows.map((w) => w.id)).toEqual(["session-5h", "weekly", "monthly"]);
    const monthly = status?.windows.find((w) => w.id === "monthly");
    expect(monthly).toMatchObject({
      usedPercent: (3792192729 / 6000000000) * 100,
      used: 37.92192729,
      limit: 60,
      unit: "usd",
      currency: "USD",
      resetsAt: Date.parse("2026-10-01T00:00:00.000Z"),
    });
    // Rolling 5h has no resetsAt until first use — must not fabricate one.
    expect(status?.windows[0]?.resetsAt).toBeUndefined();
  });

  it("returns undefined for the no-subscription `null` body and non-objects", () => {
    expect(openCodeConsoleGoStatus("null")).toBeUndefined();
    expect(openCodeConsoleGoStatus('"go"')).toBeUndefined();
    expect(openCodeConsoleGoStatus("not json")).toBeUndefined();
    expect(openCodeConsoleGoStatus('{"product":"go"}')).toBeUndefined();
  });

  it("skips meters without a positive limit", () => {
    const status = openCodeConsoleGoStatus(
      '{"access":{"meters":{"fiveHour":{"limitMicroCents":"0","usedMicroCents":"0"},' +
        '"week":{"limitMicroCents":"3000000000","usedMicroCents":"1500000000","resetsAt":"2026-10-05T00:00:00.000Z"}}}}',
    );
    expect(status?.windows.map((w) => w.id)).toEqual(["weekly"]);
    expect(status?.windows[0]?.usedPercent).toBe(50);
  });
});

describe("fetchOpenCodeConsoleUsage", () => {
  const consoleSession = "console_session=live";
  const goBody =
    '{"product":"go","access":{"meters":{' +
    '"fiveHour":{"limitMicroCents":"1200000000","usedMicroCents":"0"},' +
    '"week":{"limitMicroCents":"3000000000","usedMicroCents":"0"},' +
    '"month":{"resetsAt":"2026-10-01T00:00:00.000Z","limitMicroCents":"6000000000","usedMicroCents":"3000000000"}}}}';

  function consoleResponder(over: Record<string, HttpResponse>) {
    return (req: HttpRequest): HttpResponse => {
      for (const [path, res] of Object.entries(over)) {
        if (req.url === `https://opencode.ai${path}`) return res;
      }
      return { status: 404, headers: {}, body: "" };
    };
  }

  it("returns undefined without a console_session cookie and makes no requests", async () => {
    const { http, calls } = stubHttp(() => ok("ignored"));
    await expect(fetchOpenCodeConsoleUsage(http, "auth=zen")).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("returns undefined when the orgs call fails", async () => {
    const { http } = stubHttp(() => ({
      status: 401,
      headers: {},
      body: '{"_tag":"Unauthorized"}',
    }));
    await expect(fetchOpenCodeConsoleUsage(http, consoleSession)).resolves.toBeUndefined();
  });

  it("reads Go meters from the org that has the subscription and its balance", async () => {
    const { http, calls } = stubHttp(
      consoleResponder({
        "/console/api/orgs": ok('[{"id":"wrk_idle"},{"id":"wrk_live"}]'),
        "/console/api/billing/status": ok('{"availableMicroCents":"250000000"}'),
      }),
    );
    // go/status answers null for the first org, live meters for the second —
    // keyed on the x-org-id header.
    const base = http.request.bind(http);
    http.request = (req: HttpRequest) => {
      if (req.url === "https://opencode.ai/console/api/go/status") {
        return Promise.resolve(req.headers?.["x-org-id"] === "wrk_live" ? ok(goBody) : ok("null"));
      }
      return base(req);
    };
    const usage = await fetchOpenCodeConsoleUsage(http, consoleSession);
    expect(usage?.product).toBe("go");
    expect(usage?.goWindows.map((w) => w.id)).toEqual(["session-5h", "weekly", "monthly"]);
    expect(usage?.goWindows.find((w) => w.id === "monthly")?.usedPercent).toBe(50);
    // Balance is read from the org that owns the subscription.
    const billingCall = calls.find((c) => c.url.endsWith("/billing/status"));
    expect(billingCall?.headers?.["x-org-id"]).toBe("wrk_live");
    expect(usage?.balance).toBe(2.5);
  });

  it("still reports the balance when no org has a Go subscription", async () => {
    const { http, calls } = stubHttp(
      consoleResponder({
        "/console/api/orgs": ok('[{"id":"wrk_a"}]'),
        "/console/api/go/status": ok("null"),
        "/console/api/billing/status": ok('{"balanceMicroCents":"100000000"}'),
      }),
    );
    const usage = await fetchOpenCodeConsoleUsage(http, consoleSession);
    expect(usage).toMatchObject({ goWindows: [], balance: 1 });
    expect(calls.find((c) => c.url.endsWith("/billing/status"))?.headers?.["x-org-id"]).toBe(
      "wrk_a",
    );
  });

  it("returns empty usage when the account has no orgs", async () => {
    const { http } = stubHttp(consoleResponder({ "/console/api/orgs": ok("[]") }));
    await expect(fetchOpenCodeConsoleUsage(http, consoleSession)).resolves.toBeUndefined();
  });
});
