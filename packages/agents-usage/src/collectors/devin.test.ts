import { describe, expect, it } from "vitest";
import { createFakeHost, FAKE_NOW_MS } from "../testHost";
import {
  collectDevin,
  DEVIN_ME_ENDPOINT,
  DEVIN_PROVIDER_ID,
  DEVIN_USAGE_ENDPOINT,
  parseDevinUsage,
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
