import { describe, expect, it } from "vitest";
import type { HostPort, HttpRequest, HttpResponse } from "@craftstation/agents-usage";
import { fetchOpenCodeWeb, parseOpenCodeGoWindows } from "./openCodeWebSession";

const NOW = 1_700_000_000_000;

/**
 * opencode.ai SSR's `lite.subscription.get` into the page as
 * `rollingUsage`/`weeklyUsage`/`monthlyUsage`, each `{ usagePercent, resetInSec }`.
 */
describe("parseOpenCodeGoWindows", () => {
  it("parses rolling/weekly/monthly windows with reset times", () => {
    const body =
      `{rollingUsage:{usagePercent:42,resetInSec:3600},` +
      `weeklyUsage:{usagePercent:10,resetInSec:86400},` +
      `monthlyUsage:{usagePercent:5,resetInSec:200000}}`;
    const windows = parseOpenCodeGoWindows(body, NOW);
    expect(windows.map((w) => w.id)).toEqual(["session-5h", "weekly", "monthly"]);
    expect(windows.find((w) => w.id === "session-5h")).toMatchObject({
      usedPercent: 42,
      resetsAt: NOW + 3600 * 1000,
    });
    expect(windows.find((w) => w.id === "weekly")?.usedPercent).toBe(10);
  });

  it("parses SolidStart seroval hydration (key:$R[n]={...})", () => {
    // Live console shape from opencode.ai / CodexBar fixtures.
    const body =
      `$R[24]($R[18],$R[27]={mine:!0,useBalance:!1,` +
      `rollingUsage:$R[28]={status:"ok",resetInSec:10620,usagePercent:100},` +
      `weeklyUsage:$R[29]={status:"ok",resetInSec:523600,usagePercent:79},` +
      `monthlyUsage:$R[30]={status:"ok",resetInSec:1990800,usagePercent:89}});`;
    const windows = parseOpenCodeGoWindows(body, NOW);
    expect(windows.find((w) => w.id === "session-5h")).toMatchObject({
      usedPercent: 100,
      resetsAt: NOW + 10620 * 1000,
    });
    expect(windows.find((w) => w.id === "weekly")?.usedPercent).toBe(79);
    expect(windows.find((w) => w.id === "monthly")?.usedPercent).toBe(89);
  });

  it("clamps usagePercent to 0-100 and omits resetsAt when absent", () => {
    const body = `{rollingUsage:{usagePercent:150},weeklyUsage:{usagePercent:0}}`;
    const windows = parseOpenCodeGoWindows(body, NOW);
    expect(windows.find((w) => w.id === "session-5h")?.usedPercent).toBe(100);
    expect(windows.find((w) => w.id === "session-5h")?.resetsAt).toBeUndefined();
  });

  it("returns [] when the two core windows are not both present (no Lite subscription)", () => {
    expect(parseOpenCodeGoWindows(`{monthlyUsage:{usagePercent:5,resetInSec:1}}`, NOW)).toEqual([]);
    expect(parseOpenCodeGoWindows(`<html>signed in, no subscription</html>`, NOW)).toEqual([]);
  });
});

describe("fetchOpenCodeWeb", () => {
  function hostWith(
    cookie: string | undefined,
    responder: (req: HttpRequest) => HttpResponse,
  ): { host: HostPort; calls: HttpRequest[] } {
    const calls: HttpRequest[] = [];
    return {
      calls,
      host: {
        http: {
          request: (req: HttpRequest) => {
            calls.push(req);
            return Promise.resolve(responder(req));
          },
        },
        credentials: { getSecret: async () => cookie },
      } as unknown as HostPort,
    };
  }

  it("reports live for a console_session login even without a zen workspace", async () => {
    // A console-only login never produces a Zen workspace; the session is still
    // signed in, so the card must not fall back to auth-missing.
    const { host, calls } = hostWith("console_session=s; auth=anon", (req) =>
      req.url === "https://opencode.ai/console/auth/session"
        ? { status: 200, headers: {}, body: "{}" }
        : { status: 200, headers: {}, body: 'actor of type "public"' },
    );
    await expect(fetchOpenCodeWeb(host, NOW)).resolves.toEqual({ live: true });
    // No workspace → none of the zen meter fetches run.
    expect(calls.some((c) => c.url.includes("/workspace/"))).toBe(false);
  });

  it("reads Go meters from the console API when there is no zen workspace", async () => {
    // Live evidence: migrated accounts have a dead `auth` cookie (zen probe
    // 500s) and a live `console_session`. The workspace path is unreachable, so
    // quota must come from /console/api/go/status + /console/api/billing/status.
    const goBody =
      '{"product":"go","access":{"meters":{' +
      '"fiveHour":{"startsAt":null,"resetsAt":null,"limitMicroCents":"1200000000","usedMicroCents":"0"},' +
      '"week":{"resetsAt":"2026-10-05T00:00:00.000Z","limitMicroCents":"3000000000","usedMicroCents":"0"},' +
      '"month":{"resetsAt":"2026-10-01T00:00:00.000Z","limitMicroCents":"6000000000","usedMicroCents":"3792192729"}}}}';
    const { host } = hostWith("auth=dead; console_session=s", (req) => {
      if (req.url === "https://opencode.ai/console/auth/session") {
        return { status: 200, headers: {}, body: '{"user":{"id":"acc_1"}}' };
      }
      if (req.url === "https://opencode.ai/console/api/orgs") {
        return { status: 200, headers: {}, body: '[{"id":"wrk_live"}]' };
      }
      if (req.url === "https://opencode.ai/console/api/go/status") {
        return { status: 200, headers: {}, body: goBody };
      }
      if (req.url === "https://opencode.ai/console/api/billing/status") {
        return { status: 200, headers: {}, body: '{"availableMicroCents":"0"}' };
      }
      // Zen workspace probe: migrated billing rejects the dead auth cookie.
      return { status: 500, headers: {}, body: "" };
    });
    const session = await fetchOpenCodeWeb(host, NOW);
    expect(session.live).toBe(true);
    expect(session.goWindows?.map((w) => w.id)).toEqual(["session-5h", "weekly", "monthly"]);
    expect(session.goWindows?.find((w) => w.id === "monthly")).toMatchObject({
      usedPercent: (3792192729 / 6000000000) * 100,
      resetsAt: Date.parse("2026-10-01T00:00:00.000Z"),
    });
    expect(session.balance).toBe(0);
  });

  it("still reports live when the console orgs call fails", async () => {
    const { host } = hostWith("console_session=s", (req) =>
      req.url === "https://opencode.ai/console/auth/session"
        ? { status: 200, headers: {}, body: "{}" }
        : req.url === "https://opencode.ai/console/api/orgs"
          ? { status: 401, headers: {}, body: '{"_tag":"Unauthorized"}' }
          : { status: 500, headers: {}, body: "" },
    );
    await expect(fetchOpenCodeWeb(host, NOW)).resolves.toEqual({ live: true });
  });

  it("does not call the console API for a zen-redirect session without console cookies", async () => {
    const { host, calls } = hostWith("auth=real", () => ({
      status: 302,
      headers: { location: "https://opencode.ai/console/login" },
      body: "",
    }));
    await expect(fetchOpenCodeWeb(host, NOW)).resolves.toEqual({ live: true });
    expect(calls.some((c) => c.url.includes("/console/api/"))).toBe(false);
  });

  it("reports live when the zen session redirects to the migrated console", async () => {
    const { host } = hostWith("auth=real", () => ({
      status: 302,
      headers: { location: "https://opencode.ai/console/login" },
      body: "",
    }));
    await expect(fetchOpenCodeWeb(host, NOW)).resolves.toEqual({ live: true });
  });

  it("reports not-live when every session surface rejects the cookie", async () => {
    const { host } = hostWith("auth=anon; console_session=s", () => ({
      status: 401,
      headers: {},
      body: '{"_tag":"SessionQueryFailed"}',
    }));
    await expect(fetchOpenCodeWeb(host, NOW)).resolves.toEqual({ live: false });
  });
});
