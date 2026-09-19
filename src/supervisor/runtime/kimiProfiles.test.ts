import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostPort } from "@craftstation/agents-usage";
import { AccountStore } from "./accountStore";
import {
  KimiProfileService,
  buildKimiLoginScript,
  kimiCredentialIdentities,
  managedKimiProcessEnvironment,
  readManagedKimiApiKey,
} from "./kimiProfiles";

function tempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeCredential(root: string, value: unknown): string {
  const directory = join(root, "credentials");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "kimi-code.json");
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  return path;
}

describe("Kimi managed profile runtime", () => {
  it("extracts provider identity and isolates routing environment", () => {
    expect(
      kimiCredentialIdentities({ access_token: "SECRET", user: { email: "a@kimi.test" } }),
    ).toEqual(["a@kimi.test"]);
    const env = managedKimiProcessEnvironment("C:\\managed\\kimi", {
      KIMI_CODE_HOME: "C:\\global",
      KIMI_CODE_API_KEY: "SENTINEL_API_KEY",
      CLIPROXY_HOME: "SENTINEL_PROXY",
      PATH: "C:\\bin",
    });
    expect(env.KIMI_CODE_HOME).toBe("C:\\managed\\kimi");
    expect(env.KIMI_CODE_API_KEY).toBe("");
    expect(env.CLIPROXY_HOME).toBe("");
    expect(env.PATH).toBe("C:\\bin");
  });

  it("copies a valid global credential into an account-owned root", () => {
    const root = tempRoot("craftstation-kimi-service-");
    const globalRoot = tempRoot("craftstation-kimi-global-");
    writeCredential(globalRoot, {
      access_token: "SECRET_TOKEN",
      account: { email: "a@kimi.test" },
    });
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });

    const account = service.importCredential({ label: "Kimi A", profileRoot: globalRoot });
    expect(account.status).toBe("available");
    expect(account.providerAccountId).toBe("a@kimi.test");
    const managedPath = join(
      service.managedKimiHome(account.accountId),
      "credentials",
      "kimi-code.json",
    );
    expect(readFileSync(managedPath, "utf8")).toContain("SECRET_TOKEN");
    expect(existsSync(join(globalRoot, "credentials", "kimi-code.json"))).toBe(true);
    expect(account).not.toHaveProperty("credentialRoot");
  });

  it("creates a restart-safe Kimi Code API-key profile in config.toml", () => {
    const root = tempRoot("craftstation-kimi-apikey-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const account = service.importApiKey({ label: "New Kimi", apiKey: "sk-kimi-pasted" });
    expect(account.status).toBe("available");
    expect(account.providerAccountId).toMatch(/^New Kimi · [0-9a-f]{6}$/);
    const home = service.managedKimiHome(account.accountId);
    expect(readManagedKimiApiKey(home)).toBe("sk-kimi-pasted");
    const config = readFileSync(join(home, "config.toml"), "utf8");
    expect(config).toContain("[providers.kimi-code]");
    expect(config).toContain('type = "kimi"');
    expect(config).toContain('base_url = "https://api.kimi.com/coding/v1"');
    expect(config).toContain('api_key = "sk-kimi-pasted"');
    expect(config).toContain('default_model = "kimi-code/kimi-for-coding"');
    expect(config).toContain('[models."kimi-code/kimi-for-coding"]');
    expect(config).toContain('[models."kimi-code/k3"]');
    const env = managedKimiProcessEnvironment(home, { KIMI_CODE_API_KEY: "SENTINEL_API_KEY" });
    expect(env.KIMI_CODE_API_KEY).toBe("");
    expect(env.KIMI_CODE_HOME).toBe(home);
  });

  it("makes an imported OAuth credential usable in an isolated CLI home", () => {
    const source = tempRoot("craftstation-kimi-oauth-source-");
    writeCredential(source, {
      access_token: "OAUTH_ACCESS_SENTINEL",
      refresh_token: "OAUTH_REFRESH_SENTINEL",
      token_type: "Bearer",
      expires_at: 1,
    });
    const service = new KimiProfileService({
      store: new AccountStore(tempRoot("craftstation-kimi-oauth-store-")),
    });
    const account = service.importCredential({ label: "OAuth", profileRoot: source });
    const home = service.managedKimiHome(account.accountId);
    const config = readFileSync(join(home, "config.toml"), "utf8");
    expect(config).toContain('[providers."managed:kimi-code".oauth]');
    expect(config).toContain('storage = "file"');
    expect(config).toContain('key = "oauth/kimi-code"');
    expect(config).toContain('provider = "managed:kimi-code"');
    expect(config).toContain('[models."kimi-code/k3-256k"]');
    expect(config).not.toContain("OAUTH_ACCESS_SENTINEL");
    expect(config).not.toContain("OAUTH_REFRESH_SENTINEL");
    expect(existsSync(join(source, "config.toml"))).toBe(false);
    expect(readManagedKimiApiKey(home)).toBeUndefined();
  });

  it("repairs a legacy OAuth home on spawn without replacing existing CLI settings", () => {
    const home = tempRoot("craftstation-kimi-oauth-legacy-");
    writeCredential(home, {
      access_token: "OAUTH_ACCESS_SENTINEL",
      refresh_token: "OAUTH_REFRESH_SENTINEL",
      token_type: "Bearer",
    });
    managedKimiProcessEnvironment(home, {});
    expect(readFileSync(join(home, "config.toml"), "utf8")).toContain('key = "oauth/kimi-code"');
    const customized =
      'default_model = "custom"\n# Preserve official CLI region and user settings.\n';
    writeFileSync(join(home, "config.toml"), customized);
    managedKimiProcessEnvironment(home, {});
    expect(readFileSync(join(home, "config.toml"), "utf8")).toBe(customized);
  });

  it("replaces an expired managed account API key without creating a duplicate row", () => {
    const root = tempRoot("craftstation-kimi-rekey-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const original = service.importApiKey({ label: "Kimi A", apiKey: "sk-old" });

    const updated = service.importApiKey({
      accountId: original.accountId,
      label: original.label,
      apiKey: "sk-new",
    });

    expect(updated.accountId).toBe(original.accountId);
    expect(store.list()).toHaveLength(1);
    expect(readManagedKimiApiKey(service.managedKimiHome(original.accountId))).toBe("sk-new");
  });

  it("migrates an existing API-key account to the durable provider config on spawn", () => {
    const home = tempRoot("craftstation-kimi-legacy-apikey-");
    writeCredential(home, { access_token: "sk-existing", token_type: "api_key" });
    writeFileSync(join(home, "config.toml"), '[providers.moonshot]\napi_key = "sk-existing"\n');

    managedKimiProcessEnvironment(home, {});

    const config = readFileSync(join(home, "config.toml"), "utf8");
    expect(config).toContain("[providers.kimi-code]");
    expect(config).toContain('type = "kimi"');
    expect(config).toContain('base_url = "https://api.kimi.com/coding/v1"');
  });

  it("imports an api-key-style credential with a label-hash fallback identity", () => {
    const root = tempRoot("craftstation-kimi-fallback-");
    const source = tempRoot("craftstation-kimi-fallback-source-");
    writeCredential(source, { access_token: "SECRET_TOKEN" });
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const account = service.importCredential({ label: "本机 Kimi", profileRoot: source });
    expect(account.status).toBe("available");
    expect(account.providerAccountId).toMatch(/^本机 Kimi · [0-9a-f]{6}$/);
  });

  it.each([
    ["missing", undefined, "ACCOUNT_PROJECTION_FAILED"],
    ["malformed", "not-json", "ACCOUNT_PROJECTION_FAILED"],
    [
      "empty OAuth tokens",
      '{"access_token":"","refresh_token":"","expires_at":0}',
      "ACCOUNT_PROJECTION_FAILED",
    ],
    [
      "whitespace tokens",
      '{"access_token":"  ","refresh_token":"  "}',
      "ACCOUNT_PROJECTION_FAILED",
    ],
    [
      "metadata only",
      '{"account":{"email":"not-logged-in@kimi.test"}}',
      "ACCOUNT_PROJECTION_FAILED",
    ],
    ["non-object JSON", "[]", "ACCOUNT_PROJECTION_FAILED"],
  ])("fails closed for %s credentials", (_name, content, code) => {
    const root = tempRoot("craftstation-kimi-invalid-");
    const source = tempRoot("craftstation-kimi-source-");
    if (content !== undefined) writeCredential(source, content);
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    expect(() => service.importCredential({ label: "Invalid", profileRoot: source })).toThrow(
      expect.objectContaining({ code }),
    );
    expect(store.list()).toEqual([]);
  });

  it("rejects a re-login that changes the selected account identity", () => {
    const root = tempRoot("craftstation-kimi-mismatch-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const account = store.add({
      provider: "kimi",
      label: "Kimi A",
      providerAccountId: "a@kimi.test",
      maskedIdentity: "a@kimi.test",
    });
    writeCredential(service.managedKimiHome(account.accountId), {
      account: { email: "b@kimi.test" },
    });
    expect(() => service.completeLogin(account.accountId)).toThrow(
      expect.objectContaining({ code: "PROFILE_IDENTITY_MISMATCH" }),
    );
  });

  it("promotes a metadata-only row only after identity is present", () => {
    const root = tempRoot("craftstation-kimi-promote-");
    const emptyHost = tempRoot("craftstation-kimi-empty-host-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store, hostKimiHome: emptyHost });
    const account = service.createEmpty("Kimi New");
    expect(account.status).toBe("unavailable");
    expect(() => service.completeLogin(account.accountId)).toThrow(
      expect.objectContaining({ code: "ACCOUNT_IDENTITY_UNAVAILABLE" }),
    );
    expect(store.list()).toHaveLength(1);
    writeCredential(service.managedKimiHome(account.accountId), {
      userId: "kimi-user-1",
      access_token: "SECRET",
    });
    expect(service.completeLogin(account.accountId)).toMatchObject({
      status: "available",
      providerAccountId: "kimi-user-1",
    });
  });

  it("does not promote a completed login with empty credential tokens", () => {
    const store = new AccountStore(tempRoot("craftstation-kimi-empty-login-"));
    const service = new KimiProfileService({ store });
    const account = service.createEmpty("Kimi Empty");
    writeCredential(service.managedKimiHome(account.accountId), {
      access_token: "",
      refresh_token: "",
      token_type: "Bearer",
      expires_at: 0,
    });
    expect(() => service.completeLogin(account.accountId)).toThrow(
      expect.objectContaining({ code: "ACCOUNT_PROJECTION_FAILED" }),
    );
    expect(store.get(account.accountId)?.status).toBe("unavailable");
  });

  it("preserves refresh-only OAuth credentials and their isolated provider declaration", () => {
    const source = tempRoot("craftstation-kimi-refresh-source-");
    writeCredential(source, { access_token: "", refresh_token: "REFRESH_SENTINEL", expires_at: 0 });
    const service = new KimiProfileService({
      store: new AccountStore(tempRoot("craftstation-kimi-refresh-store-")),
    });
    const account = service.importCredential({ label: "Refreshable", profileRoot: source });
    expect(account.status).toBe("available");
    expect(
      readFileSync(join(service.managedKimiHome(account.accountId), "config.toml"), "utf8"),
    ).toContain('key = "oauth/kimi-code"');
  });
});

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return encode({ alg: "none", typ: "JWT" }) + "." + encode(payload) + ".sig";
}

describe("Kimi official OAuth credential identity", () => {
  it("reads user_id/sub from official access_token JWTs", () => {
    const token = unsignedJwt({
      user_id: "cqjgchqlnl93au7a75f0",
      sub: "cqjgchqlnl93au7a75f0",
      iss: "kimi-auth",
      type: "access",
    });
    expect(
      kimiCredentialIdentities({
        access_token: token,
        refresh_token: unsignedJwt({
          user_id: "cqjgchqlnl93au7a75f0",
          sub: "cqjgchqlnl93au7a75f0",
          type: "refresh",
        }),
        expires_at: 1788501901,
        scope: "kimi-code",
        token_type: "Bearer",
      }),
    ).toEqual(["cqjgchqlnl93au7a75f0"]);
  });

  it("prefers nested email over JWT subject", () => {
    expect(
      kimiCredentialIdentities({
        access_token: unsignedJwt({ sub: "jwt-sub", user_id: "jwt-user" }),
        user: { email: "a@kimi.test" },
      }),
    ).toEqual(["a@kimi.test", "jwt-user", "jwt-sub"]);
  });

  it("imports an official token-only host credential", () => {
    const root = tempRoot("craftstation-kimi-jwt-service-");
    const globalRoot = tempRoot("craftstation-kimi-jwt-global-");
    const token = unsignedJwt({ user_id: "cqjgchqlnl93au7a75f0", sub: "cqjgchqlnl93au7a75f0" });
    writeCredential(globalRoot, {
      access_token: token,
      refresh_token: unsignedJwt({ user_id: "cqjgchqlnl93au7a75f0" }),
      token_type: "Bearer",
    });
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const account = service.importCredential({ label: "Host Kimi", profileRoot: globalRoot });
    expect(account).toMatchObject({
      status: "available",
      providerAccountId: "cqjgchqlnl93au7a75f0",
      maskedIdentity: "cqj***5f0",
    });
  });

  it("promotes a login after official JWT credential is written", () => {
    const root = tempRoot("craftstation-kimi-jwt-promote-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const account = service.createEmpty("Kimi New");
    writeCredential(service.managedKimiHome(account.accountId), {
      access_token: unsignedJwt({ user_id: "cqjgchqlnl93au7a75f0", sub: "cqjgchqlnl93au7a75f0" }),
      refresh_token: unsignedJwt({ user_id: "cqjgchqlnl93au7a75f0" }),
      token_type: "Bearer",
    });
    expect(service.completeLogin(account.accountId)).toMatchObject({
      status: "available",
      providerAccountId: "cqjgchqlnl93au7a75f0",
    });
  });

  it("recovers a host CLI credential when managed login home is empty", () => {
    const root = tempRoot("craftstation-kimi-host-fallback-");
    const hostRoot = tempRoot("craftstation-kimi-host-home-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store, hostKimiHome: hostRoot });
    const account = service.createEmpty("Kimi New");
    writeCredential(hostRoot, {
      access_token: unsignedJwt({ user_id: "cqjgchqlnl93au7a75f0", sub: "cqjgchqlnl93au7a75f0" }),
      refresh_token: unsignedJwt({ user_id: "cqjgchqlnl93au7a75f0" }),
      token_type: "Bearer",
    });
    expect(service.completeLogin(account.accountId)).toMatchObject({
      status: "available",
      providerAccountId: "cqjgchqlnl93au7a75f0",
    });
    const managedPath = join(
      service.managedKimiHome(account.accountId),
      "credentials",
      "kimi-code.json",
    );
    expect(existsSync(managedPath)).toBe(true);
  });
  it("pins KIMI_CODE_HOME in the isolated login script", () => {
    const profilePath = [
      "C:",
      "Users",
      "demo",
      ".craftstation",
      "craftstation-accounts",
      "profile-kimi",
    ].join("\\");
    const windows = buildKimiLoginScript("windows", "token", profilePath);
    expect(windows).toContain("$env:KIMI_CODE_HOME = '" + profilePath + "'");
    expect(windows).toContain("kimi acp --login");
    const posix = buildKimiLoginScript("posix", "token", "/tmp/kimi-home");
    expect(posix).toContain("export KIMI_CODE_HOME=/tmp/kimi-home");
    expect(posix).toContain("kimi acp --login");
  });
});

describe("Kimi account-scoped quota collection", () => {
  const FUTURE = Date.now() + 3600_000;

  function usageBody(): string {
    return JSON.stringify({
      usage: { limit: "100", used: "2" },
      limits: [
        {
          detail: { limit: "100", used: "0" },
          window: { duration: 5, timeUnit: "TIME_UNIT_HOUR" },
        },
      ],
      user: { membership: { level: "LEVEL_INTERMEDIATE" } },
    });
  }

  function quotaHost(seenAuth: string[]): HostPort {
    return {
      now: () => Date.now(),
      http: {
        request: (async (request: { headers?: Record<string, string> }) => {
          seenAuth.push(request.headers?.Authorization ?? "");
          return { status: 200, headers: {}, body: usageBody() };
        }) as HostPort["http"]["request"],
      },
      credentials: {
        getOAuthToken: async () => ({ accessToken: "ambient-token" }),
        refreshOAuthToken: async () => undefined,
        getSecret: async () => undefined,
      },
    } as unknown as HostPort;
  }

  it("probes with the row's own managed token, never the ambient one", async () => {
    const root = tempRoot("craftstation-kimi-scoped-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const account = store.add({
      provider: "kimi",
      label: "Kimi A",
      providerAccountId: "a@kimi.test",
      maskedIdentity: "a@kimi.test",
    });
    writeCredential(service.managedKimiHome(account.accountId), {
      access_token: "managed-bearer",
      refresh_token: "managed-refresh",
      expires_at: Math.floor(FUTURE / 1000),
    });
    const seenAuth: string[] = [];
    const view = await service.collectQuota(account.accountId, quotaHost(seenAuth));

    expect(seenAuth).toEqual(["Bearer managed-bearer"]);
    expect(view.status).toBe("available");
    const record = store.getRecord(account.accountId)!;
    expect(record.quotaWindows?.map((window) => window.id).sort()).toEqual([
      "session-5h",
      "weekly",
    ]);
  });

  it("refreshes an imported refresh-only account before its own quota query", async () => {
    const source = tempRoot("craftstation-kimi-refresh-quota-source-");
    writeCredential(source, {
      access_token: "",
      refresh_token: "refresh-only",
      expires_at: FUTURE,
    });
    const service = new KimiProfileService({
      store: new AccountStore(tempRoot("craftstation-kimi-refresh-quota-")),
    });
    const account = service.importCredential({ label: "Refresh", profileRoot: source });
    const refresh = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-managed-bearer",
          refresh_token: "rotated-managed-refresh",
          expires_in: 900,
        }),
        { status: 200 },
      ),
    );
    try {
      const seenAuth: string[] = [];
      const view = await service.collectQuota(account.accountId, quotaHost(seenAuth));
      expect(refresh).toHaveBeenCalledOnce();
      expect(seenAuth).toEqual(["Bearer new-managed-bearer"]);
      expect(view.status).toBe("available");
      const written = JSON.parse(
        readFileSync(
          join(service.managedKimiHome(account.accountId), "credentials", "kimi-code.json"),
          "utf8",
        ),
      );
      expect(written.refresh_token).toBe("rotated-managed-refresh");
      expect(
        JSON.parse(readFileSync(join(source, "credentials", "kimi-code.json"), "utf8"))
          .access_token,
      ).toBe("");
    } finally {
      refresh.mockRestore();
    }
  });

  it("keeps a fresh inference-exhaustion mark across a healthy quota poll", async () => {
    const root = tempRoot("craftstation-kimi-marked-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const account = store.add({
      provider: "kimi",
      label: "Kimi Marked",
      providerAccountId: "marked@kimi.test",
      maskedIdentity: "marked@kimi.test",
    });
    writeCredential(service.managedKimiHome(account.accountId), {
      access_token: "managed-bearer",
      refresh_token: "managed-refresh",
      expires_at: Math.floor(FUTURE / 1000),
    });
    // Simulate the prompt-error write-back landing just now.
    store.updateStatus(account.accountId, "quota-exhausted", {
      lastError: "Kimi 额度已耗尽",
      lastQuotaAt: Date.now(),
    });
    const seenAuth: string[] = [];
    const view = await service.collectQuota(account.accountId, quotaHost(seenAuth));

    expect(view.status).toBe("quota-exhausted");
    const record = store.getRecord(account.accountId)!;
    expect(record.status).toBe("quota-exhausted");
    expect(record.lastError).toBe("Kimi 额度已耗尽");
    expect(record.quotaWindows?.map((window) => window.id).sort()).toEqual([
      "session-5h",
      "weekly",
    ]);
  });

  it("marks auth-expired when the managed home has no credential", async () => {
    const root = tempRoot("craftstation-kimi-scoped-missing-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const account = store.add({ provider: "kimi", label: "Kimi B" });
    const seenAuth: string[] = [];
    const view = await service.collectQuota(account.accountId, quotaHost(seenAuth));

    expect(seenAuth).toEqual([]);
    expect(view.status).toBe("auth-expired");
  });
});
