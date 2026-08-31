import { describe, expect, it, vi } from "vitest";
import type { HostPort, HttpRequest, HttpResponse, OAuthToken } from "@poracode/agents-usage";
import { scanAntigravityUsage } from "./antigravityUsageScanner";

vi.mock("./antigravityProcessScan", () => ({
  resolveAntigravityLsEndpoints: vi.fn<() => Promise<{ ports: number[]; csrfTokens: string[] }>>(
    async () => ({ ports: [], csrfTokens: [] }),
  ),
}));

function hostWithEmail(
  email: string,
  responder?: (req: HttpRequest) => HttpResponse | undefined,
): HostPort {
  return {
    http: {
      request: vi.fn<(req: HttpRequest) => Promise<HttpResponse>>(async (req) => {
        const response = responder?.(req);
        if (response === undefined) throw new Error("unreachable");
        return response;
      }),
    },
    credentials: {
      getOAuthToken: vi.fn<(providerId: string) => Promise<OAuthToken | undefined>>(async () => ({
        accessToken: "token",
        email,
      })),
      getSecret: vi.fn<(providerId: string, key: string) => Promise<string | undefined>>(
        async () => undefined,
      ),
    },
    now: () => 1_717_000_000_000,
  };
}

function modelsResponse(): HttpResponse {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify({
      models: {
        "gemini-3-pro-high": {
          displayName: "Gemini 3.1 Pro (High)",
          quotaInfo: { remainingFraction: 0.8, resetTime: "2026-08-30T16:00:00Z" },
        },
        "gemini-3-flash": {
          displayName: "Gemini Flash",
          quotaInfo: { remainingFraction: "0.5", resetTime: "2026-08-30T16:00:00Z" },
        },
      },
    }),
  };
}

describe("scanAntigravityUsage stored identity fallback", () => {
  it("reads quota via the OAuth cloudcode endpoint when no language server exists", async () => {
    const snapshot = await scanAntigravityUsage(
      1_717_000_000_000,
      [],
      hostWithEmail("poise.johnson@gmail.com", () => modelsResponse()),
    );
    expect(snapshot.providerId).toBe("antigravity");
    expect(snapshot.status).toBe("ok");
    expect(snapshot.authenticatedAs).toBe("poise.johnson@gmail.com");
    // Per-model pools: Gemini Pro (1 - 0.8) and Gemini Flash (1 - 0.5).
    expect(snapshot.windows).toHaveLength(2);
    expect(snapshot.windows.map((window) => window.usedPercent).sort((a, b) => a - b)).toEqual([
      20, 50,
    ]);
  });

  it("keeps the stored Google email visible when neither the LS nor the quota endpoint answers", async () => {
    const snapshot = await scanAntigravityUsage(
      1_717_000_000_000,
      [],
      hostWithEmail("poise.johnson@gmail.com"),
    );
    expect(snapshot.providerId).toBe("antigravity");
    expect(snapshot.status).toBe("ok");
    expect(snapshot.authenticatedAs).toBe("poise.johnson@gmail.com");
    expect(snapshot.windows).toEqual([]);
    expect(snapshot.error).toBeTruthy();
  });

  it("reports auth-missing when the stored token is rejected after a refresh attempt", async () => {
    const host = hostWithEmail("poise.johnson@gmail.com", () => ({
      status: 401,
      headers: {},
      body: "",
    }));
    const snapshot = await scanAntigravityUsage(1_717_000_000_000, [], host);
    expect(snapshot.providerId).toBe("antigravity");
    expect(snapshot.status).toBe("auth-missing");
  });

  it("reports app-not-running when no language server and no stored session exist", async () => {
    const snapshot = await scanAntigravityUsage(1_717_000_000_000, []);
    expect(snapshot).toMatchObject({
      providerId: "antigravity",
      status: "app-not-running",
      windows: [],
    });
  });
});
