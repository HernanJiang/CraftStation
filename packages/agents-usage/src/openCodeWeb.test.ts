import { describe, expect, it, vi } from "vitest";
import type { HostCacheStore, HttpClient, HttpRequest, HttpResponse } from "./host";
import {
  fetchOpenCodeSubscriptionText,
  isOpenCodeSessionLive,
  looksLikeOpenCodeSubscription,
  openCodeEntryClientUrl,
  openCodeGoRouteChunkUrl,
  openCodeRequestCookie,
  openCodeSubscriptionServerIdFromChunk,
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

  it("propagates probe errors to the caller (treated as not-live upstream)", async () => {
    const http: HttpClient = { request: () => Promise.reject(new Error("network")) };
    await expect(isOpenCodeSessionLive(http, "auth=real")).rejects.toThrow("network");
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
