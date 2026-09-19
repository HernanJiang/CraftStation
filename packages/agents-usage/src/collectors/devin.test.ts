import { describe, expect, it } from "vitest";
import { createFakeHost, FAKE_NOW_MS } from "../testHost";
import {
  collectDevin,
  DEVIN_ME_ENDPOINT,
  DEVIN_PROVIDER_ID,
  DEVIN_USAGE_ENDPOINT,
  DEVIN_USER_STATUS_ENDPOINT,
  identityFromUserStatus,
  parseDevinUsage,
  windowsFromUserStatus,
} from "./devin";

describe("parseDevinUsage", () => {
  it("maps identity and a monthly ACU window", () => {
    const snapshot = parseDevinUsage(
      { user: { email: "dev@cognition.ai", plan: "Teams" } },
      { usage: { used: 12, limit: 100, resetAt: "2026-10-01T00:00:00Z" } },
      FAKE_NOW_MS,
    );
    expect(snapshot).toMatchObject({
      providerId: DEVIN_PROVIDER_ID,
      status: "ok",
      authenticatedAs: "dev@cognition.ai",
      plan: "Teams",
    });
    expect(snapshot.windows).toEqual([
      expect.objectContaining({
        id: "monthly",
        used: 12,
        limit: 100,
        usedPercent: 12,
        unit: "credits",
      }),
    ]);
  });

  it("keeps a live token configured even without quota payload", () => {
    const snapshot = parseDevinUsage(undefined, undefined, FAKE_NOW_MS, {
      authenticatedAs: "dev@cognition.ai",
    });
    expect(snapshot.status).toBe("ok");
    expect(snapshot.authenticatedAs).toBe("dev@cognition.ai");
    expect(snapshot.windows).toEqual([]);
  });

  it("maps daily/weekly/monthly windows from nested objects", () => {
    const snapshot = parseDevinUsage(
      undefined,
      {
        usage: {
          daily: { used: 4, limit: 20 },
          weekly: { used: 30, limit: 100, resetAt: "2026-09-21T00:00:00Z" },
          monthly: { used: 120, limit: 500 },
        },
      },
      FAKE_NOW_MS,
    );
    expect(snapshot.windows.map((window) => window.id)).toEqual(["daily", "weekly", "monthly"]);
    expect(snapshot.windows[0]).toMatchObject({ used: 4, limit: 20, usedPercent: 20 });
    expect(snapshot.windows[1]).toMatchObject({ used: 30, limit: 100, usedPercent: 30 });
    expect(snapshot.windows[2]).toMatchObject({ used: 120, limit: 500, usedPercent: 24 });
  });

  it("maps flat prefixed fields and keeps legacy unscoped monthly", () => {
    const snapshot = parseDevinUsage(
      undefined,
      { daily_used: 2, daily_limit: 10, weekly_used: 5, used: 50, limit: 200 },
      FAKE_NOW_MS,
    );
    expect(snapshot.windows.map((window) => window.id)).toEqual(["daily", "weekly", "monthly"]);
    expect(snapshot.windows[0]).toMatchObject({ id: "daily", used: 2, limit: 10 });
    expect(snapshot.windows[1]).toMatchObject({ id: "weekly", used: 5 });
    expect(snapshot.windows[2]).toMatchObject({ id: "monthly", used: 50, limit: 200 });
  });

  it("lets the usage endpoint win per window and fills gaps from me", () => {
    const snapshot = parseDevinUsage(
      { monthly: { used: 1, limit: 10 } },
      { usage: { monthly: { used: 7, limit: 10 }, daily: { used: 1, limit: 5 } } },
      FAKE_NOW_MS,
    );
    expect(snapshot.windows.map((window) => window.id)).toEqual(["daily", "monthly"]);
    expect(snapshot.windows.find((window) => window.id === "monthly")).toMatchObject({ used: 7 });
  });
});

describe("collectDevin", () => {
  it("returns auth-missing without a token", async () => {
    const snapshot = await collectDevin(createFakeHost());
    expect(snapshot).toMatchObject({ providerId: "devin", status: "auth-missing" });
  });

  it("uses the pasted API key and parses the usage API", async () => {
    const host = createFakeHost({
      secrets: { devin: { apiKey: "cog_pasted" } },
      routes: {
        [DEVIN_ME_ENDPOINT]: { status: 200, body: JSON.stringify({ email: "me@devin.ai" }) },
        [DEVIN_USAGE_ENDPOINT]: {
          status: 200,
          body: JSON.stringify({ credits: { used: 3, total: 10 } }),
        },
      },
    });
    const snapshot = await collectDevin(host);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.authenticatedAs).toBe("me@devin.ai");
    expect(snapshot.windows[0]).toMatchObject({ used: 3, limit: 10 });
  });

  it("falls back to CLI token identity when the usage API is missing", async () => {
    const host = createFakeHost({
      tokens: { devin: { accessToken: "cog_cli", email: "cli@devin.ai" } },
      routes: {
        [DEVIN_ME_ENDPOINT]: { status: 404, body: "" },
        [DEVIN_USAGE_ENDPOINT]: { status: 404, body: "" },
      },
    });
    const snapshot = await collectDevin(host);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.authenticatedAs).toBe("cli@devin.ai");
    expect(snapshot.windows).toEqual([]);
  });
});

/** Observed GetUserStatus shape for a QUOTA-billed Devin Pro CLI account. */
const USER_STATUS_QUOTA = {
  userStatus: {
    pro: true,
    email: "user@example.com",
    teamId: "devin-team$account-x",
    planStatus: {
      planInfo: {
        teamsTier: "TEAMS_TIER_DEVIN_PRO",
        planName: "Pro",
        isDevin: true,
        billingStrategy: "BILLING_STRATEGY_QUOTA",
      },
      planStart: "2026-09-16T02:53:38Z",
      planEnd: "2026-10-16T02:53:38Z",
      availablePromptCredits: -1,
      overageBalanceMicros: "-3282891",
      dailyQuotaResetAtUnix: "1789891200",
      weeklyQuotaResetAtUnix: "1789891200",
    },
  },
  planInfo: { planName: "Pro" },
};

describe("windowsFromUserStatus", () => {
  it("builds daily/weekly reset windows from the observed QUOTA shape", () => {
    const windows = windowsFromUserStatus(USER_STATUS_QUOTA);
    expect(windows.map((window) => window.id)).toEqual(["daily", "weekly"]);
    expect(windows[0]).toMatchObject({ label: "Daily", usedPercent: 0, resetsAt: 1789891200000 });
    expect(windows[1]).toMatchObject({ label: "Weekly", usedPercent: 0, resetsAt: 1789891200000 });
  });

  it("converts a reported remaining percent into usedPercent", () => {
    const windows = windowsFromUserStatus({
      userStatus: {
        planStatus: {
          dailyRemainingPercent: 70.5,
          weeklyQuotaRemainingPercent: 40,
          dailyResetAtUnix: 1789891200,
        },
      },
    });
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ id: "daily", usedPercent: 29.5 });
    expect(windows[1]).toMatchObject({ id: "weekly", usedPercent: 60 });
  });

  it("returns empty for a body without planStatus", () => {
    expect(windowsFromUserStatus({})).toEqual([]);
    expect(windowsFromUserStatus(undefined)).toEqual([]);
  });
});

describe("identityFromUserStatus", () => {
  it("reads email and planName from the observed shape", () => {
    expect(identityFromUserStatus(USER_STATUS_QUOTA)).toEqual({
      authenticatedAs: "user@example.com",
      plan: "Pro",
    });
  });
});

describe("collectDevin GetUserStatus", () => {
  it("routes the CLI session token straight to GetUserStatus (v3 404s for it)", async () => {
    const requestedUrls: string[] = [];
    const host = createFakeHost({
      tokens: { devin: { accessToken: "devin-session-token$abc.sig", email: "cli@x.ai" } },
      routes: {
        [DEVIN_USER_STATUS_ENDPOINT]: {
          status: 200,
          body: JSON.stringify(USER_STATUS_QUOTA),
        },
      },
      onRequest: (req) => requestedUrls.push(req.url),
    });
    const snapshot = await collectDevin(host);
    expect(requestedUrls).toEqual([DEVIN_USER_STATUS_ENDPOINT]);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.plan).toBe("Pro");
    expect(snapshot.authenticatedAs).toBe("user@example.com");
    expect(snapshot.windows.map((window) => window.id)).toEqual(["daily", "weekly"]);
    expect(snapshot.windows[0]?.resetsAt).toBe(1789891200000);
  });

  it("falls back to GetUserStatus for an API key when v3 carries no windows", async () => {
    const host = createFakeHost({
      secrets: { devin: { apiKey: "cog_pasted" } },
      routes: {
        [DEVIN_ME_ENDPOINT]: { status: 200, body: JSON.stringify({ email: "me@devin.ai" }) },
        [DEVIN_USAGE_ENDPOINT]: { status: 404, body: "" },
        [DEVIN_USER_STATUS_ENDPOINT]: {
          status: 200,
          body: JSON.stringify(USER_STATUS_QUOTA),
        },
      },
    });
    const snapshot = await collectDevin(host);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.authenticatedAs).toBe("user@example.com");
    expect(snapshot.plan).toBe("Pro");
    expect(snapshot.windows.map((window) => window.id)).toEqual(["daily", "weekly"]);
  });
});
