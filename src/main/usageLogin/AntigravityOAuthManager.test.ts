import { get } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUsageSecret } from "@/shared/usageSecretStore";

vi.mock("electron", () => ({ shell: { openExternal: vi.fn<() => Promise<void>>() } }));

const { AntigravityOAuthManager } = await import("./AntigravityOAuthManager");

let cacheDir: string;

function visit(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject);
  });
}

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "craftstation-antigravity-oauth-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("AntigravityOAuthManager", () => {
  it("uses the system browser, validates loopback state, exchanges with PKCE, and seals tokens", async () => {
    let exchangedBody: URLSearchParams | undefined;
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(
      async (url: string, init?: RequestInit) => {
        if (url === "https://oauth2.googleapis.com/token") {
          exchangedBody = new URLSearchParams(String(init?.body ?? ""));
          return {
            ok: true,
            json: async () => ({
              access_token: "access-secret",
              refresh_token: "refresh-secret",
              expires_in: 3600,
              token_type: "Bearer",
            }),
          };
        }
        if (url.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
          return { ok: true, json: async () => ({ email: "full.user@example.com" }) };
        }
        if (url.includes("loadCodeAssist")) {
          return {
            ok: true,
            json: async () => ({ cloudaicompanionProject: "project-123" }),
          };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    let callbackBody = "";
    let callbackDone: Promise<void> | undefined;
    let parsedAuthorizationUrl: URL | undefined;
    const openExternal = vi.fn<(authorizationUrl: string) => Promise<void>>(
      async (rawAuthorizationUrl: string) => {
        parsedAuthorizationUrl = new URL(rawAuthorizationUrl);
        const redirectUri = parsedAuthorizationUrl.searchParams.get("redirect_uri");
        const state = parsedAuthorizationUrl.searchParams.get("state");
        if (!redirectUri || !state)
          throw new Error("authorization URL missing callback parameters");
        callbackDone = visit(`${redirectUri}?code=oauth-code&state=${state}`).then((body) => {
          callbackBody = body;
        });
      },
    );

    await expect(new AntigravityOAuthManager(cacheDir, openExternal).startLogin()).resolves.toEqual(
      {
        ok: true,
      },
    );
    await callbackDone;

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(parsedAuthorizationUrl?.origin).toBe("https://accounts.google.com");
    expect(parsedAuthorizationUrl?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsedAuthorizationUrl?.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{40,}$/u,
    );
    expect(parsedAuthorizationUrl?.searchParams.get("redirect_uri")).toBe(
      "http://localhost:51121/oauth-callback",
    );
    expect(exchangedBody?.get("redirect_uri")).toBe("http://localhost:51121/oauth-callback");
    expect(exchangedBody?.get("code")).toBe("oauth-code");
    expect(exchangedBody?.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{40,}$/u);
    expect(callbackBody).toContain("授权成功");
    expect(getUsageSecret(cacheDir, "antigravity", "accessToken")).toBe("access-secret");
    expect(getUsageSecret(cacheDir, "antigravity", "refreshToken")).toBe("refresh-secret");
    expect(getUsageSecret(cacheDir, "antigravity", "email")).toBe("full.user@example.com");
    expect(getUsageSecret(cacheDir, "antigravity", "projectId")).toBe("project-123");
  });

  it("fails closed on a mismatched callback state without exchanging a code", async () => {
    const fetchMock = vi.fn<() => void>();
    vi.stubGlobal("fetch", fetchMock);
    const openExternal = vi.fn<(authorizationUrl: string) => Promise<void>>(
      async (authorizationUrl: string) => {
        const redirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri");
        if (!redirectUri) throw new Error("authorization URL missing redirect URI");
        await visit(`${redirectUri}?code=oauth-code&state=wrong-state`);
      },
    );

    await expect(new AntigravityOAuthManager(cacheDir, openExternal).startLogin()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "state_mismatch",
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getUsageSecret(cacheDir, "antigravity", "accessToken")).toBeUndefined();
  });

  it("does not tell the browser authorization succeeded when the code exchange fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<() => Promise<{ ok: false; json: () => Promise<Record<string, never>> }>>(async () => ({
        ok: false,
        json: async () => ({}),
      })),
    );
    let callbackBody = "";
    let callbackDone: Promise<void> | undefined;
    const openExternal = vi.fn<(authorizationUrl: string) => Promise<void>>(
      async (authorizationUrl: string) => {
        const url = new URL(authorizationUrl);
        callbackDone = visit(
          `${url.searchParams.get("redirect_uri")}?code=oauth-code&state=${url.searchParams.get("state")}`,
        ).then((body) => {
          callbackBody = body;
        });
      },
    );

    await expect(new AntigravityOAuthManager(cacheDir, openExternal).startLogin()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "exchange_failed",
      }),
    );
    await callbackDone;
    expect(callbackBody).toContain("授权失败");
    expect(callbackBody).not.toContain("授权成功");
  });
});
