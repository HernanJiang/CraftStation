import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountControlError } from "@/shared/contracts";
import { AccountStore } from "./accountStore";
import { collectGrok, type HostPort, type UsageSnapshot } from "@craftstation/agents-usage";
import { parseGrokCookie } from "./grokCredentials";

vi.mock("@craftstation/agents-usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@craftstation/agents-usage")>();
  return {
    ...actual,
    collectGrok: vi.fn<(host: HostPort) => Promise<UsageSnapshot>>().mockResolvedValue({
      providerId: "grok",
      status: "ok",
      windows: [{ id: "weekly", label: "Weekly", usedPercent: 95 }],
      fetchedAt: 1234,
    }),
  };
});
import {
  buildGrokLoginScript,
  defaultGrokAccountLabel,
  GrokProfileService,
  managedGrokLoginCwd,
  managedGrokProcessEnvironment,
} from "./grokProfiles";
import {
  NativeGrokQuotaRpcError,
  nativeGrokQuotaRpcMethod,
  parseNativeGrokBilling,
  probeNativeGrokBilling,
} from "./grokQuotaNative";
import { collectManagedGrokTokenQuota, type GrokTokenQuotaResult } from "./grokQuotaTokenFallback";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

const roots: string[] = [];

class FakeGrokProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  constructor(
    private readonly onRequest: (
      request: Record<string, unknown>,
      process: FakeGrokProcess,
    ) => void,
  ) {
    super();
    this.stdin.on("data", (chunk) => {
      const request = JSON.parse(String(chunk)) as Record<string, unknown>;
      this.onRequest(request, this);
    });
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function fakeGrokSpawn(factory: () => FakeGrokProcess): typeof import("node:child_process").spawn {
  return (() => factory()) as unknown as typeof import("node:child_process").spawn;
}

const rejectNativeQuotaProbe: typeof probeNativeGrokBilling = async () => {
  throw new NativeGrokQuotaRpcError("Method not found", -32601);
};

const skipTokenQuotaProbe: typeof collectManagedGrokTokenQuota =
  async (): Promise<GrokTokenQuotaResult> => ({
    ok: false,
    errorClass: "network",
    error: "test fallback not provided",
  });

function removeManagedBearer(
  service: GrokProfileService,
  accountId: string,
  identity: string,
): void {
  writeFileSync(
    join(service.managedGrokHome(accountId), "auth.json"),
    JSON.stringify({ "https://auth.x.ai::test-client": { email: identity } }),
    "utf8",
  );
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "craftstation-grok-"));
  roots.push(root);
  return root;
}

function officialAuthJson(identity: Record<string, string>): string {
  return JSON.stringify({
    "https://auth.x.ai::test-client": {
      key: "access-token",
      refresh_token: "refresh-token",
      expires_at: "9999999999999",
      ...identity,
    },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("GrokProfileService", () => {
  it("uses the first three local-part characters as the default label", () => {
    expect(defaultGrokAccountLabel("hernanjiang@example.com")).toBe("her");
    expect(defaultGrokAccountLabel("a@example.com")).toBe("a");
  });

  it("does not insert an account without an official identity", () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({ store });
    const pendingHome = createRoot();
    writeFileSync(join(pendingHome, "auth.json"), officialAuthJson({}), "utf8");

    expect(() =>
      service.importAuthJson({ label: "No identity", profileRoot: pendingHome }),
    ).toThrow(AccountControlError);
    expect(store.list("grok")).toEqual([]);
  });

  it("imports an official identity and projects GROK_HOME inside the managed root", () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({ store });
    const pendingHome = createRoot();
    writeFileSync(
      join(pendingHome, "auth.json"),
      officialAuthJson({ email: "person@example.com", principal_id: "principal-42" }),
      "utf8",
    );

    const account = service.importAuthJson({ label: "New Grok", profileRoot: pendingHome });
    expect(account.provider).toBe("grok");
    expect(account.status).toBe("available");
    // 邮箱全称 contract: the full email stays visible on the Grok row.
    expect(account.maskedIdentity).toBe("person@example.com");
    // v0.5 default alias contract: placeholder labels become "<Provider> Account N".
    expect(account.label).toBe("Grok 1");
    expect(account).not.toHaveProperty("credentialRoot");

    const managedHome = service.managedGrokHome(account.accountId);
    expect(managedHome.startsWith(store.managedRoot)).toBe(true);
    const envPath = join(managedHome, "environment.json");
    expect(JSON.parse(readFileSync(envPath, "utf8"))).toEqual({ GROK_HOME: managedHome });
    expect(JSON.parse(readFileSync(join(managedHome, "auth.json"), "utf8"))).toEqual(
      JSON.parse(officialAuthJson({ email: "person@example.com", principal_id: "principal-42" })),
    );
  });

  it("keeps A and B GROK_HOME roots independent and rejects cross-home projection", () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({ store });
    const pendingA = createRoot();
    const pendingB = createRoot();
    writeFileSync(join(pendingA, "auth.json"), officialAuthJson({ email: "a@example.com" }));
    writeFileSync(join(pendingB, "auth.json"), officialAuthJson({ email: "b@example.com" }));

    const a = service.importAuthJson({ label: "A", profileRoot: pendingA });
    const b = service.importAuthJson({ label: "B", profileRoot: pendingB });
    const homeA = service.managedGrokHome(a.accountId);
    const homeB = service.managedGrokHome(b.accountId);

    expect(homeA).not.toBe(homeB);
    expect(() =>
      store.projectCredential({
        accountId: a.accountId,
        provider: "grok",
        environment: { GROK_HOME: homeB },
      }),
    ).toThrow(/GROK_HOME/);
  });
});

describe("managedGrokProcessEnvironment", () => {
  it("pins GROK_HOME and blanks CLIProxy/Router/API-key overrides", () => {
    const root = createRoot();
    const env = managedGrokProcessEnvironment(root, {
      GROK_HOME: "C:\\old-grok",
      GROK_API_KEY: "secret",
      XAI_API_KEY: "secret",
      CLIPROXY_HOME: "router",
      CODEX_ROUTER_HOME: "router",
      MODEL_CATALOG_PATH: "catalog",
      KEEP_ME: "value",
    });

    expect(env.GROK_HOME).toBe(root);
    expect(env.GROK_LEADER_SOCKET).toContain("leader.sock");
    expect(env.GROK_API_KEY).toBe("");
    expect(env.XAI_API_KEY).toBe("");
    expect(env.CLIPROXY_HOME).toBe("");
    expect(env.CODEX_ROUTER_HOME).toBe("");
    expect(env.MODEL_CATALOG_PATH).toBe("");
    expect(env.KEEP_ME).toBe("value");
  });

  it("overwrites seeded host API-key / Router vars after the ACP process.env merge", () => {
    const root = createRoot();
    const hostEnv = {
      GROK_API_KEY: "host-leak",
      XAI_API_KEY: "host-xai",
      CLIPROXY_HOME: "host-cli",
      CODEX_ROUTER_HOME: "host-router",
      MODEL_CATALOG_PATH: "host-catalog",
      GROK_HOME: "C:\\host-grok",
      OTHER: "kept",
    };
    const isolated = managedGrokProcessEnvironment(root, hostEnv);

    // ACP spawn does `{ ...process.env, ...command.env }`; blanking wins.
    const merged = { ...hostEnv, ...isolated };
    expect(merged.GROK_HOME).toBe(root);
    expect(merged.GROK_API_KEY).toBe("");
    expect(merged.XAI_API_KEY).toBe("");
    expect(merged.CLIPROXY_HOME).toBe("");
    expect(merged.CODEX_ROUTER_HOME).toBe("");
    expect(merged.MODEL_CATALOG_PATH).toBe("");
    expect(merged.OTHER).toBe("kept");
  });
});

describe("native Grok billing probe", () => {
  it("maps official x.ai/billing windows without exposing credential material", () => {
    const parsed = parseNativeGrokBilling(
      {
        windows: [
          { id: "session-5h", label: "5h", usedPercent: 0.25, resetsAt: 1_800_000_000 },
          { id: "weekly", label: "Weekly", used: 40, limit: 100 },
        ],
        accessToken: "must-not-be-projected",
      },
      1234,
    );

    expect(parsed).toEqual({
      fetchedAt: 1234,
      windows: [
        { id: "session-5h", label: "5h", usedPercent: 25, resetsAt: 1_800_000_000_000 },
        { id: "weekly", label: "Weekly", usedPercent: 40 },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("must-not-be-projected");
  });

  it("uses managed GROK_HOME and x.ai/billing over official grok agent stdio", async () => {
    const requests: Record<string, unknown>[] = [];
    const child = new FakeGrokProcess((request, process) => {
      requests.push(request);
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "initialize"
              ? { protocolVersion: 1 }
              : { windows: [{ id: "session-5h", usedPercent: 17 }] },
        }) + "\n",
      );
    });
    const result = await probeNativeGrokBilling({
      home: "C:\\managed\\grok-a",
      cwd: "C:\\managed\\grok-a",
      executable: "grok",
      env: { GROK_HOME: "C:\\managed\\grok-a", GROK_API_KEY: "" },
      spawnProcess: fakeGrokSpawn(() => child),
      timeoutMs: 100,
      attempts: 1,
    });

    expect(result.windows).toEqual([{ id: "session-5h", label: "session-5h", usedPercent: 17 }]);
    expect(requests.map((request) => request.method)).toEqual([
      "initialize",
      nativeGrokQuotaRpcMethod,
    ]);
    expect(child.killed).toBe(true);
  });

  it("retries one transient native billing failure and does not retry permanent failures", async () => {
    let spawnCount = 0;
    const result = await probeNativeGrokBilling({
      home: "C:\\managed\\grok-b",
      cwd: "C:\\managed\\grok-b",
      executable: "grok",
      env: { GROK_HOME: "C:\\managed\\grok-b" },
      spawnProcess: fakeGrokSpawn(() => {
        spawnCount += 1;
        return new FakeGrokProcess((request, process) => {
          if (spawnCount === 1) {
            process.emit("error", new Error("fetch failed while connecting to Grok"));
            return;
          }
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result:
                request.method === "initialize"
                  ? { protocolVersion: 1 }
                  : { windows: [{ id: "weekly", usedPercent: 33 }] },
            }) + "\n",
          );
        });
      }),
      timeoutMs: 100,
      attempts: 2,
    });

    expect(spawnCount).toBe(2);
    expect(result.windows[0]).toMatchObject({ id: "weekly", usedPercent: 33 });
  });

  it("does not retry an unsupported x.ai/billing method", async () => {
    let spawnCount = 0;
    await expect(
      probeNativeGrokBilling({
        home: "C:\\managed\\grok-unsupported",
        cwd: "C:\\managed\\grok-unsupported",
        executable: "grok",
        env: { GROK_HOME: "C:\\managed\\grok-unsupported" },
        spawnProcess: fakeGrokSpawn(() => {
          spawnCount += 1;
          return new FakeGrokProcess((request, process) => {
            process.stdout.write(
              JSON.stringify(
                request.method === "initialize"
                  ? { jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1 } }
                  : {
                      jsonrpc: "2.0",
                      id: request.id,
                      error: { code: -32601, message: "Method not found" },
                    },
              ) + "\n",
            );
          });
        }),
        timeoutMs: 100,
        attempts: 3,
      }),
    ).rejects.toMatchObject({ name: "NativeGrokQuotaRpcError", rpcCode: -32601 });
    expect(spawnCount).toBe(1);
  });
});

describe("buildGrokLoginScript", () => {
  it("runs the official device-auth flow inside the managed GROK_HOME", () => {
    const posix = buildGrokLoginScript("posix", "lc_grok_test");
    expect(posix).toContain("grok login --device-auth");
    expect(posix).toContain('"$GROK_HOME"');
    expect(posix).toContain("GROK_LEADER_SOCKET");
    expect(posix).toContain("lc_grok_test");

    const windows = buildGrokLoginScript("windows", "lc_grok_test");
    expect(windows).toContain("grok login --device-auth");
    expect(windows).toContain("$env:GROK_HOME");
    expect(windows).toContain("GROK_LEADER_SOCKET");
    expect(windows).toContain("lc_grok_test");
  });

  it("ensures the managed login cwd exists", () => {
    const root = createRoot();
    const cwd = managedGrokLoginCwd(root);
    expect(cwd).toBe(root);
    mkdirSync(root, { recursive: true });
  });

  it("collects account-scoped Grok quota from the managed GROK_HOME only (v0.5 T07)", async () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({
      store,
      nativeQuotaProbe: rejectNativeQuotaProbe,
      tokenQuotaProbe: skipTokenQuotaProbe,
    });
    const pendingHome = createRoot();
    writeFileSync(
      join(pendingHome, "auth.json"),
      officialAuthJson({ email: "quota@example.com", principal_id: "principal-quota" }),
      "utf8",
    );
    const account = service.importAuthJson({ label: "Grok quota", profileRoot: pendingHome });
    removeManagedBearer(service, account.accountId, "quota@example.com");
    vi.mocked(collectGrok).mockClear();

    const host = {
      now: () => 0,
      credentials: { getOAuthToken: async () => undefined, getSecret: async () => undefined },
    };
    const result = await service.collectQuota(account.accountId, host as never);
    expect(result).toMatchObject({ accountId: account.accountId, status: "quota-low" });
    expect(collectGrok).toHaveBeenCalled();
    // The scoped host carries the managed credential seam.
    expect(collectGrok).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: expect.anything() }),
    );
  });

  it("provides managed cookie and refresh seams without exposing host credentials", async () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({
      store,
      nativeQuotaProbe: rejectNativeQuotaProbe,
      tokenQuotaProbe: skipTokenQuotaProbe,
    });
    const pendingHome = createRoot();
    const authContent = officialAuthJson({
      email: "scoped@example.com",
      principal_id: "principal-scoped",
      cookie: "sso=fake-cookie; session=fake-session",
    });
    writeFileSync(join(pendingHome, "auth.json"), authContent, "utf8");
    const account = service.importAuthJson({ label: "Scoped", profileRoot: pendingHome });

    vi.mocked(collectGrok).mockClear();
    await service.collectQuota(account.accountId, {
      now: () => 0,
      credentials: {
        getOAuthToken: async () => undefined,
        getSecret: async () => "host-secret-must-not-leak",
      },
    } as unknown as HostPort);

    const scopedHost = vi.mocked(collectGrok).mock.calls.at(-1)?.[0] as HostPort | undefined;
    expect(scopedHost).toBeDefined();
    expect(await scopedHost!.credentials.getSecret("grok", "cookie")).toBe(
      "sso=fake-cookie; session=fake-session",
    );
    expect(await scopedHost!.credentials.getSecret("codex", "cookie")).toBeUndefined();
    expect(scopedHost!.credentials.refreshOAuthToken).toEqual(expect.any(Function));
    expect(parseGrokCookie(authContent)).toBe("sso=fake-cookie; session=fake-session");
  });

  it("writes a token-billing fallback window to only the managed account", async () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const tokenQuotaProbe = vi.fn<typeof collectManagedGrokTokenQuota>().mockResolvedValue({
      ok: true,
      source: "grpc-web",
      fetchedAt: 4321,
      windows: [{ id: "monthly", label: "Credits", usedPercent: 12.5 }],
    });
    const service = new GrokProfileService({
      store,
      nativeQuotaProbe: rejectNativeQuotaProbe,
      tokenQuotaProbe,
    });
    const pendingHome = createRoot();
    writeFileSync(
      join(pendingHome, "auth.json"),
      officialAuthJson({ email: "token-fallback@example.com" }),
      "utf8",
    );
    const account = service.importAuthJson({ label: "Token fallback", profileRoot: pendingHome });
    const other = store.add({ provider: "grok", label: "Other" });

    const result = await service.collectQuota(account.accountId, {
      http: { request: async () => ({ status: 500, headers: {}, body: "" }) },
      now: () => 4321,
      credentials: {
        getOAuthToken: async () => undefined,
        getSecret: async () => undefined,
      },
    });

    expect(result).toMatchObject({
      accountId: account.accountId,
      status: "available",
      quotaWindows: [{ id: "monthly", usedPercent: 12.5 }],
      lastQuotaAt: 4321,
    });
    expect(tokenQuotaProbe).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.objectContaining({ accessToken: "access-token" }),
      }),
    );
    expect(store.get(other.accountId)).not.toMatchObject({
      quotaWindows: [{ id: "monthly", usedPercent: 12.5 }],
    });
  });

  it("persists the real managed account subscription tier after quota refresh", async () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const tokenQuotaProbe = vi.fn<typeof collectManagedGrokTokenQuota>().mockResolvedValue({
      ok: true,
      source: "proxy",
      fetchedAt: 4321,
      windows: [{ id: "weekly", label: "Weekly credits", usedPercent: 12.5 }],
    });
    const service = new GrokProfileService({
      store,
      nativeQuotaProbe: rejectNativeQuotaProbe,
      tokenQuotaProbe,
    });
    const pendingHome = createRoot();
    writeFileSync(
      join(pendingHome, "auth.json"),
      officialAuthJson({ email: "plan@example.com" }),
      "utf8",
    );
    const account = service.importAuthJson({ label: "Plan", profileRoot: pendingHome });

    const settingsRequests: string[] = [];
    const result = await service.collectQuota(account.accountId, {
      http: {
        request: async (request) => {
          settingsRequests.push(request.url);
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({ subscription_tier_display: "SuperGrok" }),
          };
        },
      },
      now: () => 4321,
      credentials: {
        getOAuthToken: async () => undefined,
        getSecret: async () => undefined,
      },
    });

    expect(result).toMatchObject({
      accountId: account.accountId,
      plan: "SuperGrok",
      quotaWindows: [{ id: "weekly", usedPercent: 12.5 }],
    });
    expect(store.get(account.accountId)).toMatchObject({ plan: "SuperGrok" });
    expect(settingsRequests).toEqual(["https://cli-chat-proxy.grok.com/v1/settings"]);
  });

  it("keeps native Method not found visible when token billing also fails", async () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({
      store,
      nativeQuotaProbe: rejectNativeQuotaProbe,
      tokenQuotaProbe: async () => ({
        ok: false,
        errorClass: "network",
        error: "fetch failed",
      }),
    });
    const pendingHome = createRoot();
    writeFileSync(
      join(pendingHome, "auth.json"),
      officialAuthJson({ email: "unsupported-method@example.com" }),
      "utf8",
    );
    const account = service.importAuthJson({ label: "Unsupported", profileRoot: pendingHome });

    const result = await service.collectQuota(account.accountId, {
      http: { request: async () => ({ status: 500, headers: {}, body: "" }) },
      now: () => 4321,
      credentials: {
        getOAuthToken: async () => undefined,
        getSecret: async () => undefined,
      },
    });

    expect(result.status).toBe("unavailable");
    expect(result.lastError).toContain("Grok billing RPC unsupported");
    expect(result.lastError).toContain("network: fetch failed");
    expect(result.lastError).not.toBe("Grok quota request failed (network)");
  });

  it("preserves and classifies a timeout from an empty Grok quota response", async () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({ store, nativeQuotaProbe: rejectNativeQuotaProbe });
    const pendingHome = createRoot();
    writeFileSync(
      join(pendingHome, "auth.json"),
      officialAuthJson({ email: "timeout@example.com" }),
      "utf8",
    );
    const account = service.importAuthJson({ label: "Timeout", profileRoot: pendingHome });
    removeManagedBearer(service, account.accountId, "timeout@example.com");

    vi.mocked(collectGrok).mockImplementationOnce(async (scopedHost) => {
      await expect(
        scopedHost.http.request({ url: "https://example.test/billing", timeoutMs: 1 }),
      ).rejects.toThrow("timed out");
      return {
        providerId: "grok",
        status: "error",
        windows: [],
        fetchedAt: 1234,
        error: "grok billing check failed (network error)",
      };
    });
    const timeout = new Error("The operation timed out");
    timeout.name = "TimeoutError";
    const result = await service.collectQuota(account.accountId, {
      http: { request: async () => Promise.reject(timeout) },
      now: () => 1234,
      credentials: {
        getOAuthToken: async () => undefined,
        getSecret: async () => undefined,
      },
    });

    expect(result).toMatchObject({
      status: "unavailable",
      quotaWindows: [],
      lastError: expect.stringContaining("timed out"),
    });
  });

  it("preserves the HTTP status when Grok quota transport returns an error", async () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({ store, nativeQuotaProbe: rejectNativeQuotaProbe });
    const pendingHome = createRoot();
    writeFileSync(
      join(pendingHome, "auth.json"),
      officialAuthJson({ email: "http@example.com" }),
      "utf8",
    );
    const account = service.importAuthJson({ label: "HTTP", profileRoot: pendingHome });
    removeManagedBearer(service, account.accountId, "http@example.com");

    vi.mocked(collectGrok).mockImplementationOnce(async (scopedHost) => {
      await scopedHost.http.request({ url: "https://example.test/billing" });
      return {
        providerId: "grok",
        status: "error",
        windows: [],
        fetchedAt: 1234,
        error: "grok billing check failed (network error)",
      };
    });
    const result = await service.collectQuota(account.accountId, {
      http: {
        request: async () => ({
          status: 503,
          headers: {},
          body: "",
        }),
      },
      now: () => 1234,
      credentials: {
        getOAuthToken: async () => undefined,
        getSecret: async () => undefined,
      },
    });

    expect(result.lastError).toContain("HTTP 503");
  });

  it("keeps auth-missing distinct from an unavailable transport", async () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({ store, nativeQuotaProbe: rejectNativeQuotaProbe });
    const pendingHome = createRoot();
    writeFileSync(
      join(pendingHome, "auth.json"),
      officialAuthJson({ email: "auth@example.com" }),
      "utf8",
    );
    const account = service.importAuthJson({ label: "Auth", profileRoot: pendingHome });
    removeManagedBearer(service, account.accountId, "auth@example.com");

    vi.mocked(collectGrok).mockResolvedValueOnce({
      providerId: "grok",
      status: "auth-missing",
      windows: [],
      fetchedAt: 1234,
    });
    const result = await service.collectQuota(account.accountId, {
      http: { request: async () => ({ status: 401, headers: {}, body: "" }) },
      now: () => 1234,
      credentials: {
        getOAuthToken: async () => undefined,
        getSecret: async () => undefined,
      },
    });

    expect(result).toMatchObject({
      status: "auth-expired",
      lastError: "Grok authentication required",
    });
  });
});
