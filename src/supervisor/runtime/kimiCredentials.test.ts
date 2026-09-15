import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseKimiCliCredential,
  parseKimiEnv,
  resolveKimiManagedHomeToken,
  resolveKimiToken,
} from "./kimiCredentials";

const NOW = 1_700_000_000_000;

describe("parseKimiEnv", () => {
  it("returns undefined when no API key is set", () => {
    expect(parseKimiEnv({})).toBeUndefined();
    expect(parseKimiEnv({ KIMI_CODE_BASE_URL: "https://proxy.test" })).toBeUndefined();
  });

  it("reads the API key and strips wrapping quotes/whitespace", () => {
    expect(parseKimiEnv({ KIMI_CODE_API_KEY: '  "kimi-key"  ' })).toEqual({
      accessToken: "kimi-key",
    });
  });

  it("carries the base-URL override on raw without polluting it when absent", () => {
    expect(parseKimiEnv({ KIMI_CODE_API_KEY: "k" })).toEqual({ accessToken: "k" });
    expect(
      parseKimiEnv({ KIMI_CODE_API_KEY: "k", KIMI_CODE_BASE_URL: "https://proxy.test" }),
    ).toEqual({ accessToken: "k", raw: { baseUrl: "https://proxy.test" } });
  });
});

describe("parseKimiCliCredential", () => {
  const freshExpiry = Math.floor(NOW / 1000) + 3600;

  it("returns a fresh access token with its expiry in epoch ms", () => {
    const content = JSON.stringify({
      access_token: "cli-token",
      refresh_token: "never-used",
      expires_at: freshExpiry,
    });
    expect(parseKimiCliCredential(content, NOW)).toEqual({
      accessToken: "cli-token",
      expiresAt: freshExpiry * 1000,
    });
  });

  it("accepts camelCase keys and millisecond expiries", () => {
    const content = JSON.stringify({ accessToken: "t", expiresAt: NOW + 3_600_000 });
    expect(parseKimiCliCredential(content, NOW)).toEqual({
      accessToken: "t",
      expiresAt: NOW + 3_600_000,
    });
  });

  it("rejects expired, near-expiry, and expiry-less tokens (read-only, no refresh)", () => {
    const expired = JSON.stringify({
      access_token: "t",
      expires_at: Math.floor(NOW / 1000) - 10,
    });
    expect(parseKimiCliCredential(expired, NOW)).toBeUndefined();

    const nearExpiry = JSON.stringify({
      access_token: "t",
      expires_at: Math.floor((NOW + 30_000) / 1000),
    });
    expect(parseKimiCliCredential(nearExpiry, NOW)).toBeUndefined();

    const noExpiry = JSON.stringify({ access_token: "t" });
    expect(parseKimiCliCredential(noExpiry, NOW)).toBeUndefined();
  });

  it("rejects malformed content", () => {
    expect(parseKimiCliCredential("not json", NOW)).toBeUndefined();
    expect(parseKimiCliCredential("[]", NOW)).toBeUndefined();
    expect(parseKimiCliCredential(JSON.stringify({ expires_at: 1 }), NOW)).toBeUndefined();
  });
});

describe("managed Kimi credential resolution", () => {
  const FUTURE = Date.now() + 3600_000;

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["CRAFTSTATION_ACCOUNTS_DIR"];
    vi.restoreAllMocks();
  });

  async function seedAccountsRoot(profiles: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "cs-kimi-accounts-"));
    for (const [profile, content] of Object.entries(profiles)) {
      const dir = join(root, profile, "credentials");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "kimi-code.json"), content, { encoding: "utf8" });
    }
    process.env["CRAFTSTATION_ACCOUNTS_DIR"] = root;
    return root;
  }

  it("resolves a fresh managed credential without touching the host home", async () => {
    await seedAccountsRoot({
      "profile-test": JSON.stringify({
        access_token: "managed-access",
        refresh_token: "managed-refresh",
        expires_at: Math.floor(FUTURE / 1000),
      }),
    });
    const token = await resolveKimiToken();
    expect(token?.accessToken).toBe("managed-access");
  });

  it("refreshes a stale managed credential and writes rotated tokens back", async () => {
    const root = await seedAccountsRoot({
      "profile-test": JSON.stringify({
        access_token: "stale-access",
        refresh_token: "stale-refresh",
        expires_at: Math.floor(Date.now() / 1000) - 100,
      }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "rotated-refresh",
            expires_in: 900,
          }),
          { status: 200 },
        );
      }),
    );

    const token = await resolveKimiToken();
    expect(token?.accessToken).toBe("fresh-access");
    const written = JSON.parse(
      await readFile(join(root, "profile-test", "credentials", "kimi-code.json"), "utf8"),
    );
    expect(written.access_token).toBe("fresh-access");
    expect(written.refresh_token).toBe("rotated-refresh");
  });

  it("returns undefined when no kimi credential exists anywhere", async () => {
    await seedAccountsRoot({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const token = await resolveKimiToken();
    expect(token).toBeUndefined();
  });
});

describe("resolveKimiManagedHomeToken", () => {
  const FUTURE = Date.now() + 3600_000;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function seedHome(content: unknown): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), "cs-kimi-home-"));
    await mkdir(join(home, "credentials"), { recursive: true });
    await writeFile(join(home, "credentials", "kimi-code.json"), JSON.stringify(content), {
      encoding: "utf8",
    });
    return home;
  }

  it("returns the home's fresh token without touching any other home", async () => {
    const home = await seedHome({
      access_token: "home-access",
      refresh_token: "home-refresh",
      expires_at: Math.floor(FUTURE / 1000),
    });
    const token = await resolveKimiManagedHomeToken(home);
    expect(token?.accessToken).toBe("home-access");
  });

  it("refreshes a stale home token and writes the rotation back to that home", async () => {
    const home = await seedHome({
      access_token: "stale-access",
      refresh_token: "stale-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 100,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "rotated-refresh",
            expires_in: 900,
          }),
          { status: 200 },
        );
      }),
    );
    const token = await resolveKimiManagedHomeToken(home);
    expect(token?.accessToken).toBe("fresh-access");
    const written = JSON.parse(await readFile(join(home, "credentials", "kimi-code.json"), "utf8"));
    expect(written.access_token).toBe("fresh-access");
    expect(written.refresh_token).toBe("rotated-refresh");
  });

  it("returns undefined for a missing home and for a stale token without refresh", async () => {
    const missing = join(await mkdtemp(join(tmpdir(), "cs-kimi-empty-")), "absent-home");
    expect(await resolveKimiManagedHomeToken(missing)).toBeUndefined();
    const stale = await seedHome({
      access_token: "stale-access",
      expires_at: Math.floor(Date.now() / 1000) - 100,
    });
    expect(await resolveKimiManagedHomeToken(stale)).toBeUndefined();
  });

  it("accepts a long-lived API key with no expiry or refresh token", async () => {
    const home = await seedHome({ access_token: "kimi-api-key", token_type: "api_key" });
    const token = await resolveKimiManagedHomeToken(home);
    expect(token).toEqual({ accessToken: "kimi-api-key" });
  });
});
