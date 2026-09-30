import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allUsageProviderDescriptors } from "@craftstation/agents-usage";
import {
  getUsageSecret,
  hasUsageSecret,
  hasUsageSecretKey,
  setUsageSecret,
} from "@/shared/usageSecretStore";

vi.mock("electron", () => ({ clipboard: { writeText: vi.fn<(text: string) => void>() } }));
// Only the opencode cookie config references this; the device-flow tests don't.
vi.mock("./openCodeLoginProbe", () => ({
  isOpenCodeLoginCookieLive: vi.fn<(cookieHeader: string) => Promise<boolean>>(),
}));

const { UsageLoginManager } = await import("./UsageLoginManager");
const { isOpenCodeLoginCookieLive } = await import("./openCodeLoginProbe");
const opencodeLiveProbe = vi.mocked(isOpenCodeLoginCookieLive);

const DEVICE_CODE_URL = "/login/device/code";
const TOKEN_URL = "/login/oauth/access_token";

function makePanel() {
  return {
    createTab: vi.fn<() => Promise<{ tabId: string }>>(async () => ({ tabId: "tab-1" })),
    closeTab: vi.fn<(tabId: string) => Promise<void>>(async () => {}),
    showUsageLoginDeviceCode: vi.fn<(deviceCode: unknown) => void>(),
    clearUsageLoginDeviceCode: vi.fn<(providerId: string) => void>(),
    cancelLoginCapture: vi.fn<() => void>(),
    captureLoginCookies: vi.fn<(opts: unknown) => Promise<{ ok: boolean; cookie?: string }>>(
      async () => ({
        ok: true,
        cookie: "sso=abc",
      }),
    ),
    clearLoginCookies: vi.fn<(opts: unknown) => Promise<void>>(async () => {}),
  };
}

let cacheDir: string;
let tokenResponses: Array<Record<string, unknown>>;
let deviceExpiresIn: number;

type FakeResponse = { ok: boolean; json: () => Promise<Record<string, unknown>> };

function installFetch() {
  const fetchMock = vi.fn<(url: string) => Promise<FakeResponse>>(async (url: string) => {
    if (url.endsWith(DEVICE_CODE_URL)) {
      return {
        ok: true,
        json: async () => ({
          device_code: "dc",
          user_code: "WXYZ-1234",
          verification_uri: "https://github.com/login/device",
          interval: 5,
          expires_in: deviceExpiresIn,
        }),
      };
    }
    if (url.endsWith(TOKEN_URL)) {
      const next = tokenResponses.shift() ?? { error: "authorization_pending" };
      return { ok: true, json: async () => next };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  cacheDir = mkdtempSync(join(tmpdir(), "lc-login-"));
  tokenResponses = [];
  deviceExpiresIn = 900;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(cacheDir, { recursive: true, force: true });
});

function newManager(panel: ReturnType<typeof makePanel>) {
  return new UsageLoginManager({ cacheDir } as never, () => panel as never);
}

describe("UsageLoginManager provider catalog", () => {
  it("removes Devin CLI credentials as well as the captured usage session", async () => {
    const credentialFile = join(cacheDir, "devin", "credentials.toml");
    mkdirSync(join(cacheDir, "devin"), { recursive: true });
    writeFileSync(credentialFile, 'windsurf_api_key = "fixture-token"\n');
    const manager = new UsageLoginManager({ cacheDir } as never, () => makePanel() as never, {
      devinCredentialFiles: [credentialFile],
    } as never);
    await expect(manager.clearLogin("devin")).resolves.toEqual({ ok: true });
    expect(existsSync(credentialFile)).toBe(false);
  });

  it("does not report successful deletion when browser credentials cannot be cleared", async () => {
    const panel = makePanel();
    panel.clearLoginCookies.mockRejectedValue(new Error("cookie store unavailable"));
    await expect(newManager(panel).clearLogin("grok")).rejects.toThrow("cookie store unavailable");
  });

  it("keeps every login config backed by a canonical usage descriptor", () => {
    const manager = newManager(makePanel());
    const descriptorIds = new Set(allUsageProviderDescriptors().map((descriptor) => descriptor.id));

    expect(Object.keys(manager.getLoginState().stored).every((id) => descriptorIds.has(id))).toBe(
      true,
    );
  });

  it("reports antigravity signed-in when only pooled account buckets remain", () => {
    const manager = newManager(makePanel());
    // Host-login import moves the bundle into `antigravity:<id>` pool rows and
    // drains the plain bucket — the provider must still read as signed in.
    expect(manager.getLoginState().stored["antigravity"]).toBe(false);

    setUsageSecret(cacheDir, "antigravity:acct-1", "refreshToken", "refresh-1");

    expect(manager.getLoginState().stored["antigravity"]).toBe(true);
  });

  it("reports stepcode signed-in from the native auth.json file", () => {
    const home = mkdtempSync(join(tmpdir(), "lc-stepcode-home-"));
    const authFile = join(home, ".stepcode", "auth.json");
    mkdirSync(dirname(authFile), { recursive: true });
    writeFileSync(authFile, JSON.stringify({ step: { type: "oauth", access: "a" } }));
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("STEPCODE_AUTH_PATH", "");
    vi.stubEnv("STEPCODE_CONFIG_DIR", "");
    vi.stubEnv("STEP_CODING_AGENT_DIR", "");
    vi.stubEnv("STEP_API_KEY", "");

    const manager = newManager(makePanel());
    expect(manager.getLoginState().stored["stepcode"]).toBe(true);
  });

  it("reports stepcode signed-out when no credential file holds entries", () => {
    const home = mkdtempSync(join(tmpdir(), "lc-stepcode-home-"));
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("STEPCODE_AUTH_PATH", "");
    vi.stubEnv("STEPCODE_CONFIG_DIR", "");
    vi.stubEnv("STEP_CODING_AGENT_DIR", "");
    vi.stubEnv("STEP_API_KEY", "");

    const manager = newManager(makePanel());
    expect(manager.getLoginState().stored["stepcode"]).toBe(false);
  });
});

describe("UsageLoginManager cookie flow", () => {
  it("captures Grok cookies without a live usage probe gate", async () => {
    const panel = makePanel();
    const manager = newManager(panel);

    await expect(manager.startLogin("grok")).resolves.toEqual({ ok: true });

    expect(panel.captureLoginCookies).toHaveBeenCalledWith(
      expect.objectContaining({
        loginUrl: "https://grok.com/",
        cookieUrl: "https://grok.com/",
        authCookiePattern: /^sso(?:-rw)?$/i,
        providerLabel: "Grok",
      }),
    );
    expect(panel.captureLoginCookies.mock.calls[0]?.[0]).not.toHaveProperty("validateSession");
    expect(hasUsageSecret(cacheDir, "grok")).toBe(true);
  });

  it("captures an authenticated Alibaba console session for Qwen usage", async () => {
    const panel = makePanel();
    panel.captureLoginCookies.mockResolvedValue({
      ok: true,
      cookie: "login_aliyunid_ticket=ticket; login_aliyunid_pk=account",
    });
    const manager = newManager(panel);

    await expect(manager.startLogin("qwen")).resolves.toEqual({ ok: true });

    const options = panel.captureLoginCookies.mock.calls[0]?.[0] as {
      loginUrl: string;
      cookieUrl: string;
      authCookiePattern: RegExp;
      providerLabel: string;
      validateSession(cookieHeader: string): Promise<boolean>;
    };
    expect(options.loginUrl).toContain("modelstudio.console.alibabacloud.com");
    expect(options.cookieUrl).toBe("https://modelstudio.console.alibabacloud.com/");
    expect(options.authCookiePattern.test("login_aliyunid_ticket")).toBe(true);
    expect(options.providerLabel).toBe("Alibaba Token Plan");
    await expect(
      options.validateSession("login_aliyunid_ticket=t; login_aliyunid_pk=p"),
    ).resolves.toBe(true);
    await expect(options.validateSession("login_aliyunid_ticket=t")).resolves.toBe(false);
    expect(hasUsageSecret(cacheDir, "qwen")).toBe(true);
  });
});

describe("UsageLoginManager silent re-auth", () => {
  type JarCookie = { name: string; value: string };

  function newSilentManager(options: { jarCookies: () => JarCookie[]; onLoad?: () => void }) {
    const session = {
      cookies: {
        get: vi.fn<(filter?: unknown) => Promise<JarCookie[]>>(async () => options.jarCookies()),
      },
    };
    const win = {
      load: vi.fn<(url: string) => Promise<void>>(async (_url: string) => {
        options.onLoad?.();
      }),
      close: vi.fn<() => void>(),
    };
    const createReauthWindow = vi.fn<() => typeof win>(() => win);
    const manager = new UsageLoginManager({ cacheDir } as never, () => makePanel() as never, {
      cookieSession: session,
      createReauthWindow,
    } as never);
    return { manager, session, win, createReauthWindow };
  }

  it("returns true without touching the jar when the stored cookie is still live", async () => {
    setUsageSecret(cacheDir, "opencode", "cookie", "auth=stored");
    opencodeLiveProbe.mockResolvedValue(true);
    const { manager, session, createReauthWindow } = newSilentManager({
      jarCookies: () => [],
    });

    await expect(manager.attemptSilentReauth("opencode")).resolves.toBe(true);
    expect(session.cookies.get).not.toHaveBeenCalled();
    expect(createReauthWindow).not.toHaveBeenCalled();
  });

  it("re-seals from the live jar when the stored snapshot is dead", async () => {
    setUsageSecret(cacheDir, "opencode", "cookie", "auth=dead");
    opencodeLiveProbe.mockImplementation(async (header) => header.includes("auth=fresh"));
    const { manager, createReauthWindow } = newSilentManager({
      jarCookies: () => [{ name: "auth", value: "fresh" }],
    });

    await expect(manager.attemptSilentReauth("opencode")).resolves.toBe(true);
    expect(getUsageSecret(cacheDir, "opencode", "cookie")).toBe("auth=fresh");
    expect(createReauthWindow).not.toHaveBeenCalled();
  });

  it("replays the login flow in a hidden window to mint a fresh cookie", async () => {
    setUsageSecret(cacheDir, "opencode", "cookie", "auth=dead");
    opencodeLiveProbe.mockImplementation(async (header) => header.includes("auth=rotated"));
    let jarCookies: JarCookie[] = [{ name: "auth", value: "dead" }];
    const { manager, win } = newSilentManager({
      jarCookies: () => jarCookies,
      onLoad: () => {
        jarCookies = [{ name: "auth", value: "rotated" }];
      },
    });

    const promise = manager.attemptSilentReauth("opencode");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
    expect(win.load).toHaveBeenCalledWith("https://opencode.ai/auth");
    expect(win.close).toHaveBeenCalled();
    expect(getUsageSecret(cacheDir, "opencode", "cookie")).toBe("auth=rotated");
  });

  it("fails and cools down when the issuer session no longer trusts the device", async () => {
    setUsageSecret(cacheDir, "opencode", "cookie", "auth=dead");
    opencodeLiveProbe.mockResolvedValue(false);
    const { manager, win, createReauthWindow } = newSilentManager({
      jarCookies: () => [{ name: "auth", value: "dead" }],
    });

    const promise = manager.attemptSilentReauth("opencode");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(false);
    expect(win.close).toHaveBeenCalled();
    // Cooldown: an immediate retry resolves false without opening a window.
    await expect(manager.attemptSilentReauth("opencode")).resolves.toBe(false);
    expect(createReauthWindow).toHaveBeenCalledTimes(1);
  });

  it("skips providers that were never signed in", async () => {
    const { manager, session, createReauthWindow } = newSilentManager({
      jarCookies: () => [{ name: "auth", value: "fresh" }],
    });

    await expect(manager.attemptSilentReauth("opencode")).resolves.toBe(false);
    expect(session.cookies.get).not.toHaveBeenCalled();
    expect(createReauthWindow).not.toHaveBeenCalled();
  });

  it("skips cookie providers without a real liveness probe", async () => {
    setUsageSecret(cacheDir, "qwen", "cookie", "login_aliyunid_ticket=t; login_aliyunid_pk=p");
    const { manager, session, createReauthWindow } = newSilentManager({
      jarCookies: () => [{ name: "login_aliyunid_ticket", value: "fresh" }],
    });

    await expect(manager.attemptSilentReauth("qwen")).resolves.toBe(false);
    expect(session.cookies.get).not.toHaveBeenCalled();
    expect(createReauthWindow).not.toHaveBeenCalled();
  });

  it("resolves startLogin silently when re-auth succeeds, never opening a tab", async () => {
    setUsageSecret(cacheDir, "opencode", "cookie", "auth=stored");
    opencodeLiveProbe.mockResolvedValue(true);
    const panel = makePanel();
    const manager = new UsageLoginManager({ cacheDir } as never, () => panel as never, {
      cookieSession: {
        cookies: { get: vi.fn<(filter?: unknown) => Promise<JarCookie[]>>(async () => []) },
      },
    } as never);

    await expect(manager.startLogin("opencode")).resolves.toEqual({ ok: true });
    expect(panel.createTab).not.toHaveBeenCalled();
    expect(panel.captureLoginCookies).not.toHaveBeenCalled();
  });

  it("falls back to the interactive capture when silent re-auth fails", async () => {
    setUsageSecret(cacheDir, "opencode", "cookie", "auth=dead");
    opencodeLiveProbe.mockImplementation(async (header) => header.includes("auth=fresh"));
    const panel = makePanel();
    panel.captureLoginCookies.mockResolvedValue({ ok: true, cookie: "auth=fresh" });
    const { win } = {
      win: {
        load: vi.fn<(url: string) => Promise<void>>(async () => {}),
        close: vi.fn<() => void>(),
      },
    };
    const manager = new UsageLoginManager({ cacheDir } as never, () => panel as never, {
      cookieSession: {
        cookies: {
          get: vi.fn<(filter?: unknown) => Promise<JarCookie[]>>(async () => [
            { name: "auth", value: "dead" },
          ]),
        },
      },
      createReauthWindow: () => win,
    } as never);

    const promise = manager.startLogin("opencode");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ok: true });
    expect(panel.captureLoginCookies).toHaveBeenCalledOnce();
  });
});

describe("UsageLoginManager GitHub device flow", () => {
  it("polls past authorization_pending, stores the token, and cleans up", async () => {
    installFetch();
    tokenResponses = [{ error: "authorization_pending" }, { access_token: "gho_secret" }];
    const panel = makePanel();
    const manager = newManager(panel);

    const promise = manager.startLogin("copilot");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(hasUsageSecret(cacheDir, "copilot")).toBe(true);
    expect(panel.showUsageLoginDeviceCode).toHaveBeenCalledOnce();
    expect(panel.clearUsageLoginDeviceCode).toHaveBeenCalledWith("copilot");
    expect(panel.closeTab).toHaveBeenCalledWith("tab-1");
  });

  it("handles slow_down and still completes", async () => {
    installFetch();
    tokenResponses = [{ error: "slow_down" }, { access_token: "gho_secret" }];
    const panel = makePanel();
    const manager = newManager(panel);

    const promise = manager.startLogin("copilot");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ok: true });
    expect(hasUsageSecret(cacheDir, "copilot")).toBe(true);
  });

  it("times out when authorization never completes before expiry", async () => {
    installFetch();
    deviceExpiresIn = 10; // expires after ~10s of polling at a 5s interval
    tokenResponses = []; // always authorization_pending
    const panel = makePanel();
    const manager = newManager(panel);

    const promise = manager.startLogin("copilot");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ok: false, error: "Login timed out" });
    expect(hasUsageSecret(cacheDir, "copilot")).toBe(false);
  });
});

describe("UsageLoginManager API-key flow", () => {
  it("seals a pasted key and reports it stored", async () => {
    const manager = newManager(makePanel());
    await expect(manager.submitApiKey("zai", "  zai-secret  ")).resolves.toEqual({ ok: true });
    expect(hasUsageSecret(cacheDir, "zai")).toBe(true);
  });

  it("clears the CraftStation secret without deleting the official Grok auth.json", async () => {
    const {
      mkdirSync: fsMkdirSync,
      writeFileSync: fsWriteFileSync,
      existsSync: fsExistsSync,
    } = await import("node:fs");
    const grokHome = join(cacheDir, "grok-home");
    fsMkdirSync(grokHome, { recursive: true });
    fsWriteFileSync(join(grokHome, "auth.json"), JSON.stringify({ key: "stale" }), "utf8");
    const previous = process.env.GROK_HOME;
    process.env.GROK_HOME = grokHome;
    try {
      const manager = newManager(makePanel());
      await expect(manager.submitCookie("grok", "sso=abc")).resolves.toEqual({ ok: true });
      expect(hasUsageSecret(cacheDir, "grok")).toBe(true);
      await expect(manager.clearLogin("grok")).resolves.toEqual({ ok: true });
      expect(hasUsageSecret(cacheDir, "grok")).toBe(false);
      expect(fsExistsSync(join(grokHome, "auth.json"))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = previous;
    }
  });

  it("seals a pasted Kimi Code key and reports it stored", async () => {
    const manager = newManager(makePanel());
    await expect(manager.submitApiKey("kimi", "kimi-secret")).resolves.toEqual({ ok: true });
    expect(hasUsageSecret(cacheDir, "kimi")).toBe(true);
  });

  it("seals a pasted Devin API key and reports it stored", async () => {
    const manager = newManager(makePanel());
    await expect(manager.submitApiKey("devin", "cog_secret")).resolves.toEqual({ ok: true });
    expect(hasUsageSecret(cacheDir, "devin")).toBe(true);
  });

  it("keeps the API-key fallback for hybrid Alibaba Token Plan login", async () => {
    const manager = newManager(makePanel());
    await expect(manager.submitApiKey("qwen", "qwen-secret")).resolves.toEqual({ ok: true });
    expect(hasUsageSecret(cacheDir, "qwen")).toBe(true);
  });

  it("rejects an empty key without storing anything", async () => {
    const manager = newManager(makePanel());
    await expect(manager.submitApiKey("zai", "   ")).resolves.toMatchObject({ ok: false });
    expect(hasUsageSecret(cacheDir, "zai")).toBe(false);
  });

  it("rejects submitApiKey for a non-api-key provider", async () => {
    const manager = newManager(makePanel());
    await expect(manager.submitApiKey("grok", "x")).resolves.toMatchObject({ ok: false });
    expect(hasUsageSecret(cacheDir, "grok")).toBe(false);
  });

  it("startLogin on an api-key provider returns a guard error, no browser step", async () => {
    const panel = makePanel();
    const manager = newManager(panel);
    const result = await manager.startLogin("zai");
    expect(result.ok).toBe(false);
    expect(panel.captureLoginCookies).not.toHaveBeenCalled();
    expect(hasUsageSecret(cacheDir, "zai")).toBe(false);
  });

  it("clears a stored api-key secret on sign-out", async () => {
    const manager = newManager(makePanel());
    await manager.submitApiKey("zai", "zai-secret");
    expect(hasUsageSecret(cacheDir, "zai")).toBe(true);
    await expect(manager.clearLogin("zai")).resolves.toEqual({ ok: true });
    expect(hasUsageSecret(cacheDir, "zai")).toBe(false);
  });

  it("removes the Command Code CLI credential so authorization cannot reappear", async () => {
    const commandCodeHome = join(cacheDir, "commandcode-home");
    const authPath = join(commandCodeHome, "auth.json");
    mkdirSync(commandCodeHome, { recursive: true });
    writeFileSync(authPath, JSON.stringify({ apiKey: "cmd-secret" }), "utf8");
    const manager = new UsageLoginManager({ cacheDir } as never, () => makePanel() as never, {
      commandCodeAuthFile: authPath,
    });

    await expect(manager.clearLogin("commandcode")).resolves.toEqual({ ok: true });
    expect(existsSync(authPath)).toBe(false);
  });
});

describe("UsageLoginManager pasted-cookie flow (system-browser login)", () => {
  it("seals a pasted header carrying the provider auth cookie", async () => {
    const manager = newManager(makePanel());
    await expect(manager.submitCookie("grok", "sso=abc; other=1")).resolves.toEqual({
      ok: true,
    });
    expect(hasUsageSecret(cacheDir, "grok")).toBe(true);
  });

  it("rejects a pasted header without the auth cookie name", async () => {
    const manager = newManager(makePanel());
    const result = await manager.submitCookie("grok", "other=1");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cookie");
    expect(hasUsageSecret(cacheDir, "grok")).toBe(false);
  });

  it("rejects empty input and non-cookie providers without storing anything", async () => {
    const manager = newManager(makePanel());
    await expect(manager.submitCookie("grok", "   ")).resolves.toMatchObject({ ok: false });
    await expect(manager.submitCookie("zai", "sso=abc")).resolves.toMatchObject({
      ok: false,
    });
    expect(hasUsageSecret(cacheDir, "grok")).toBe(false);
    expect(hasUsageSecret(cacheDir, "zai")).toBe(false);
  });
});

describe("UsageLoginManager Volcengine and OpenAI-compatible flows", () => {
  it("fails closed on invalid Volcengine credentials without modifying stored secrets", async () => {
    const manager = newManager(makePanel());
    const result = await manager.submitVolcengineCredentials({
      apiKey: "ark-invalid",
    });
    expect(result.ok).toBe(false);
    expect(hasUsageSecret(cacheDir, "volcengine")).toBe(false);
  });

  it("returns the probe-accepted Ark model on successful Volcengine API-key login", async () => {
    const manager = newManager(makePanel());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      status: 200,
      text: async () => JSON.stringify({ id: "chat_1" }),
      headers: { forEach: () => undefined },
    })) as unknown as typeof fetch;
    try {
      const result = await manager.submitVolcengineCredentials({ apiKey: "ark-ok" });
      expect(result.ok).toBe(true);
      expect(result.arkModel).toBe("doubao-seed-2.0-code");
      expect(hasUsageSecret(cacheDir, "volcengine")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stores Ark API Key and AK/SK together and returns the probed model", async () => {
    const manager = newManager(makePanel());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          id: "chat_1",
          Result: { QuotaUsage: [{ Level: "session", Percent: 12 }] },
        }),
      headers: { forEach: () => undefined },
    })) as unknown as typeof fetch;
    try {
      const result = await manager.submitVolcengineCredentials({
        apiKey: "ark-ok",
        accessKeyId: "AKLTabc",
        secretAccessKey: "sk-test",
      });
      expect(result.ok).toBe(true);
      expect(result.code).toBeUndefined();
      expect(result.arkModel).toBe("doubao-seed-2.0-code");
      expect(hasUsageSecretKey(cacheDir, "volcengine", "apiKey")).toBe(true);
      expect(hasUsageSecretKey(cacheDir, "volcengine", "accessKeyId")).toBe(true);
      expect(hasUsageSecretKey(cacheDir, "volcengine", "secretAccessKey")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("requires the model API Key when Volcengine AK/SK are supplied", async () => {
    const manager = newManager(makePanel());
    const result = await manager.submitVolcengineCredentials({
      accessKeyId: "AKLTabc",
      secretAccessKey: "sk-test",
    });
    expect(result).toMatchObject({ ok: false, code: "model_key_required" });
    expect(result.error).toContain("Ark API Key");
    expect(hasUsageSecret(cacheDir, "volcengine")).toBe(false);
  });

  it("fails closed on invalid OpenAI-compatible credentials without modifying stored secrets", async () => {
    const manager = newManager(makePanel());
    const result = await manager.submitOpenAiCompatibleCredentials({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-invalid",
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("model_not_found");
    expect(hasUsageSecret(cacheDir, "openai-compatible")).toBe(false);
  });

  it("rejects a wrong API key as unauthorized (never as protocol-unsupported)", async () => {
    const manager = newManager(makePanel());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      status: 401,
      text: async () => JSON.stringify({ error: "invalid api key" }),
    })) as unknown as typeof fetch;
    try {
      const result = await manager.submitOpenAiCompatibleCredentials({
        baseUrl: "https://api.example.com",
        apiKey: "sk-wrong",
        model: "gpt-5.6-sol",
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("unauthorized");
      expect(hasUsageSecret(cacheDir, "openai-compatible:pending")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("verifies Responses-first and stages the validated protocol (no double /v1)", async () => {
    const manager = newManager(makePanel());
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      const target = String(url);
      seen.push(target);
      if (target.endsWith("/v1/models")) {
        return { status: 200, text: async () => JSON.stringify({ data: [{ id: "gpt-5.6-sol" }] }) };
      }
      if (target.endsWith("/v1/responses")) {
        return {
          status: 200,
          text: async () => JSON.stringify({ id: "resp_1", output: [{ type: "message" }] }),
        };
      }
      return { status: 404, text: async () => JSON.stringify({ error: "unknown endpoint" }) };
    }) as unknown as typeof fetch;
    try {
      const result = await manager.submitOpenAiCompatibleCredentials({
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-ok",
        model: "gpt-5.6-sol",
      });
      expect(result.ok).toBe(true);
      expect(result.validatedProtocol).toBe("responses");
      expect(seen.some((url) => url.includes("/v1/v1/"))).toBe(false);
      // The primary probe does NOT fall back to Chat; a separate
      // second-surface capability probe still asks /chat/completions once and
      // stages the definitive refusal so Auto routing skips Step Code.
      expect(seen.filter((url) => url.endsWith("/v1/chat/completions"))).toHaveLength(1);
      expect(getUsageSecret(cacheDir, "openai-compatible:pending", "chatCompletionsOk")).toBe(
        "false",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("UsageLoginManager OpenCode sign-out", () => {
  const ENV_KEYS = ["XDG_DATA_HOME", "APPDATA", "LOCALAPPDATA", "USERPROFILE"] as const;
  const savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined> = {
    XDG_DATA_HOME: undefined,
    APPDATA: undefined,
    LOCALAPPDATA: undefined,
    USERPROFILE: undefined,
  };
  const scratchDirs: string[] = [];

  function isolateHomeEnv(): void {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    // Point every host-home candidate at scratch dirs so the test can never
    // touch the developer's real opencode auth.json.
    const xdg = mkdtempSync(join(tmpdir(), "lc-opencode-xdg-"));
    const appData = mkdtempSync(join(tmpdir(), "lc-opencode-appdata-"));
    const home = mkdtempSync(join(tmpdir(), "lc-opencode-home-"));
    scratchDirs.push(xdg, appData, home);
    process.env.XDG_DATA_HOME = xdg;
    process.env.APPDATA = appData;
    process.env.LOCALAPPDATA = appData;
    process.env.USERPROFILE = home;
  }

  function restoreHomeEnv(): void {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  }

  it("removes the opencode-go and opencode entries from the CLI auth.json", async () => {
    const {
      mkdirSync: fsMkdirSync,
      readFileSync,
      writeFileSync: fsWriteFileSync,
    } = await import("node:fs");
    isolateHomeEnv();
    try {
      const authPath = join(process.env.XDG_DATA_HOME!, "opencode", "auth.json");
      fsMkdirSync(join(process.env.XDG_DATA_HOME!, "opencode"), { recursive: true });
      fsWriteFileSync(
        authPath,
        JSON.stringify({
          "opencode-go": { key: "go-key" },
          opencode: { key: "zen-key" },
          other: { name: "keep" },
        }),
        "utf8",
      );
      const manager = newManager(makePanel());
      await expect(manager.clearLogin("opencode")).resolves.toEqual({ ok: true });
      expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual({ other: { name: "keep" } });
    } finally {
      restoreHomeEnv();
    }
  });

  it("succeeds when no CLI auth.json exists", async () => {
    const { existsSync: fsExistsSync } = await import("node:fs");
    isolateHomeEnv();
    try {
      const manager = newManager(makePanel());
      await expect(manager.clearLogin("opencode")).resolves.toEqual({ ok: true });
      expect(fsExistsSync(join(process.env.XDG_DATA_HOME!, "opencode", "auth.json"))).toBe(false);
    } finally {
      restoreHomeEnv();
    }
  });
});
