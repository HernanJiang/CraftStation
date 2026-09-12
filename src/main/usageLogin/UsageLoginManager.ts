import { clipboard } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserPanelManager } from "../browser";
import type { CraftStationPaths } from "@/shared/craftstationPaths";
import type { UsageLoginStateResponse } from "@/shared/contracts";
import {
  createCredentialProbeHost,
  validateVolcengineCredentials,
} from "@craftstation/agents-usage";
import {
  buildProbeUrls,
  normalizeApiRoot,
  openAiCompatibleApiBase,
  probeThirdPartyProvider,
  type ProbeFetch,
  type ThirdPartyProtocol,
  type ThirdPartyValidationErrorCode,
} from "@/shared/thirdPartyValidation";
import { clearUsageSecret, hasUsageSecret, setUsageSecret } from "@/shared/usageSecretStore";
import {
  PROVIDER_CONFIGS,
  USAGE_PROVIDER_BY_ID,
  usageProviderLabel,
  type GitHubDeviceLoginConfig,
  type LocalStorageLoginConfig,
  type ProviderLoginConfig,
} from "./providerLoginConfigs";
import { AntigravityOAuthManager } from "./AntigravityOAuthManager";
import { fetchHttpClient } from "./fetchHttpClient";

/**
 * Consent-gated, user-initiated browser login that captures a provider's web
 * session cookie or OAuth token for usage collection. It reuses the in-app
 * browser panel (so login opens as a normal tab, not a separate OS window), then
 * seals the captured secret with the shared safeStorage key (see
 * `src/shared/usageSecretStore.ts`). Secret values are never logged.
 */

export interface UsageLoginResult {
  ok: boolean;
  cancelled?: boolean;
  code?: string;
  error?: string;
  /**
   * Third-party OpenAI-compatible validation outcome (present only for the
   * openai-compatible form). The renderer gates Add/Save on `ok === true` and
   * surfaces the protocol badge from this field.
   */
  validatedProtocol?: ThirdPartyProtocol | undefined;
  /**
   * Volcengine Ark logins with an API key: the Ark model that passed the
   * credential probe. The renderer uses it to auto-provision a runnable
   * OpenAI-compatible channel (quota alone never needs it).
   */
  arkModel?: string | undefined;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

interface GitHubDeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

interface GitHubAccessTokenResponse {
  access_token?: string;
  error?: string;
}

export class UsageLoginManager {
  private readonly inFlight = new Map<string, Promise<UsageLoginResult>>();
  private readonly deviceLoginCancel = new Map<string, () => void>();
  private readonly antigravityOAuth: AntigravityOAuthManager;

  constructor(
    private readonly paths: CraftStationPaths,
    private readonly getBrowserPanel: () => BrowserPanelManager | null,
  ) {
    this.antigravityOAuth = new AntigravityOAuthManager(paths.cacheDir);
  }

  /**
   * Which login-capable providers currently have a captured secret on disk.
   * This is the persistent "signed in" signal the UI uses for the sign-in/out
   * affordance, so a failed or empty usage fetch never reads as a sign-out.
   */
  getLoginState(): UsageLoginStateResponse {
    const stored: Record<string, boolean> = {};
    for (const providerId of Object.keys(PROVIDER_CONFIGS)) {
      stored[providerId] = hasUsageSecret(this.paths.cacheDir, providerId);
    }
    return { stored };
  }

  /** Cancel an in-flight login (e.g. the user closed the browser overlay). */
  cancelLogin(providerId: string): void {
    if (providerId === "antigravity") this.antigravityOAuth.cancel();
    this.getBrowserPanel()?.cancelLoginCapture();
    this.deviceLoginCancel.get(providerId)?.();
  }

  async clearLogin(providerId: string): Promise<UsageLoginResult> {
    this.cancelLogin(providerId);
    if (providerId === "antigravity") this.antigravityOAuth.clear();
    else clearUsageSecret(this.paths.cacheDir, providerId);
    // Official CLI homes are independent import sources. Signing out of a
    // CraftStation provider clears only CraftStation-owned staging/session
    // state and must never log the user out of Grok, Command Code, or another
    // vendor CLI — with one deliberate exception below.
    if (providerId === "opencode") this.clearOpenCodeAuth();
    const config = PROVIDER_CONFIGS[providerId];
    if (config?.kind === "cookie") {
      await this.getBrowserPanel()
        ?.clearLoginCookies({
          cookieUrl: config.cookieUrl,
          authCookiePattern: config.authCookiePattern,
        })
        .catch((error) => {
          console.warn("[usage-login] failed to clear login cookies:", error);
        });
    }
    return { ok: true };
  }

  /**
   * OpenCode's authorization lives ONLY in the official CLI home
   * (`auth.json`): the Go subscription under the `opencode-go` entry and the
   * Zen login under the `opencode` entry — CraftStation keeps no separate
   * copy of either, so "delete authorization" must remove both entries or
   * the card resurrects on the next refresh. Other providers' entries in
   * the same file are preserved; the spend database (`opencode.db`) is
   * untouched. Candidate directories mirror `openCodeGoDb` (supervisor
   * side); this file stays `node:fs`-only so the main process never loads
   * the sqlite binding.
   */
  private clearOpenCodeAuth(): void {
    const home = homedir();
    const candidates: string[] = [];
    const xdgData = process.env.XDG_DATA_HOME?.trim();
    if (xdgData) candidates.push(join(xdgData, "opencode"));
    candidates.push(join(home, ".local", "share", "opencode"));
    if (process.platform === "darwin") {
      candidates.push(join(home, "Library", "Application Support", "opencode"));
    }
    if (process.platform === "win32") {
      for (const envVar of ["APPDATA", "LOCALAPPDATA"] as const) {
        const base = process.env[envVar]?.trim();
        if (base) candidates.push(join(base, "opencode"));
      }
    }
    for (const dir of [...new Set(candidates)]) {
      const authPath = join(dir, "auth.json");
      let parsed: unknown;
      try {
        if (!existsSync(authPath)) continue;
        parsed = JSON.parse(readFileSync(authPath, "utf8"));
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      const hasGo = Object.prototype.hasOwnProperty.call(record, "opencode-go");
      const hasZen = Object.prototype.hasOwnProperty.call(record, "opencode");
      if (!hasGo && !hasZen) continue;
      delete record["opencode-go"];
      delete record["opencode"];
      try {
        writeFileSync(authPath, JSON.stringify(record, null, 2), "utf8");
      } catch (error) {
        console.warn("[usage-login] failed to clear OpenCode auth:", error);
      }
    }
  }

  /**
   * Seal a user-pasted API key for an API-key or hybrid provider. The stored
   * secret is the persistent "signed in" signal; the collector validates the key
   * itself on the next fetch, so a bad key simply re-prompts via `auth-missing`.
   */
  submitApiKey(providerId: string, apiKey: string): Promise<UsageLoginResult> {
    const config = PROVIDER_CONFIGS[providerId];
    const descriptor = USAGE_PROVIDER_BY_ID.get(providerId);
    if (
      config?.kind !== "api-key" &&
      !(config?.kind === "cookie" && descriptor?.apiKeyFallback === true)
    ) {
      return Promise.resolve({ ok: false, error: `No API-key login for ${providerId}` });
    }
    const trimmed = apiKey.trim();
    if (!trimmed) return Promise.resolve({ ok: false, error: "API key is empty" });
    setUsageSecret(this.paths.cacheDir, providerId, "apiKey", trimmed);
    return Promise.resolve({ ok: true });
  }

  async submitVolcengineCredentials(input: {
    apiKey?: string | undefined;
    accessKeyId?: string | undefined;
    secretAccessKey?: string | undefined;
    region?: string | undefined;
  }): Promise<UsageLoginResult> {
    const apiKey = input.apiKey?.trim();
    const accessKeyId = input.accessKeyId?.trim();
    const secretAccessKey = input.secretAccessKey?.trim();
    const region = input.region?.trim() || "cn-beijing";
    if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
      return { ok: false, code: "credentials_incomplete", error: "AK 与 SK 必须同时填写。" };
    }
    if ((accessKeyId || secretAccessKey) && !apiKey) {
      return {
        ok: false,
        code: "model_key_required",
        error: "填写 AK/SK 时必须同时填写 Ark API Key；该 Key 用于调用模型。",
      };
    }
    if (!apiKey) {
      return {
        ok: false,
        code: "credentials_missing",
        error: "请输入 Ark API Key；如填写 AK/SK，三项凭据必须同时填写。",
      };
    }
    if (accessKeyId && !/^AKLT[\w-]+$/iu.test(accessKeyId)) {
      return { ok: false, code: "access_key_invalid", error: "Volcengine AK 格式无效。" };
    }
    if (!/^[a-z0-9-]{2,64}$/iu.test(region)) {
      return { ok: false, code: "region_invalid", error: "Volcengine Region 格式无效。" };
    }
    const validation = await validateVolcengineCredentials(
      createCredentialProbeHost(fetchHttpClient, {
        volcengine: { apiKey, accessKeyId, secretAccessKey, region },
      }),
      {
        ...(apiKey ? { apiKey } : {}),
        ...(accessKeyId ? { accessKeyId } : {}),
        ...(secretAccessKey ? { secretAccessKey } : {}),
        region,
      },
    );
    if (!validation.ok) {
      return {
        ok: false,
        code: validation.code === "rejected" ? "credentials_rejected" : "probe_failed",
        error:
          validation.code === "rejected"
            ? apiKey && accessKeyId
              ? "Ark API Key 或 AK/SK 验证失败。Key 用于调用模型，AK/SK 用于显示额度，请分别检查。"
              : "Ark 凭据不可用，请检查 API Key 或 AK/SK。"
            : "无法连接 Ark 验证接口，请检查网络与 Region 后重试。",
      };
    }

    // Validate first, then replace the previous sealed bucket atomically from
    // the user's point of view. A typo must never destroy a working account.
    clearUsageSecret(this.paths.cacheDir, "volcengine");
    if (apiKey) setUsageSecret(this.paths.cacheDir, "volcengine", "apiKey", apiKey);
    if (accessKeyId && secretAccessKey) {
      setUsageSecret(this.paths.cacheDir, "volcengine", "accessKeyId", accessKeyId);
      setUsageSecret(this.paths.cacheDir, "volcengine", "secretAccessKey", secretAccessKey);
      setUsageSecret(this.paths.cacheDir, "volcengine", "region", region);
    }
    return { ok: true, ...(validation.model ? { arkModel: validation.model } : {}) };
  }

  /**
   * OpenAI 兼容 API 表单：对 Base URL + Key + Model 执行一次真实的兼容性探测
   * （Responses 优先，不支持时才回退 Chat Completions；401/403/429/5xx 与超时
   * 永不伪装成 protocol 回退），通过后把整套配置（含已验证 protocol 与验证
   * 时间）写入暂存桶，由 supervisor 的 importOpenAiCompatibleProfile 导入为号池
   * 账号（支持多个提供商；API Key 永不回传渲染层、不写日志）。
   *
   * 注意：`GET /v1/models` 只做连通性/auth 提示（见 probeThirdPartyProvider），
   * 最终通过条件永远是一次最小真实 inference 探测。
   */
  async submitOpenAiCompatibleCredentials(input: {
    baseUrl: string;
    apiKey: string;
    providerName?: string;
    model?: string;
    displayName?: string;
  }): Promise<UsageLoginResult> {
    const apiRoot = normalizeApiRoot(input.baseUrl);
    if (!apiRoot) {
      return { ok: false, code: "invalid_base_url", error: "OpenAI 兼容 API Base URL 无效。" };
    }
    const apiKey = input.apiKey.trim();
    if (!apiKey) return { ok: false, code: "api_key_empty", error: "API Key 不能为空。" };
    const model = input.model?.trim() ?? "";
    if (!model) {
      return {
        ok: false,
        code: "model_not_found",
        error: "请填写 Model Name 并通过验证后才能添加。",
      };
    }
    const probe: ProbeFetch = async (url, init, timeoutMs) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: init.method,
          headers: init.headers,
          ...(init.body ? { body: init.body } : {}),
          signal: controller.signal,
        });
        return { status: res.status, bodyText: await res.text().catch(() => "") };
      } finally {
        clearTimeout(timer);
      }
    };
    // Secrets never enter logs: only the normalized root + model id are diagnosable.
    const validation = await probeThirdPartyProvider({
      baseUrl: apiRoot,
      apiKey,
      model,
      fetchImpl: probe,
    }).catch(() => undefined);
    if (!validation || !validation.ok) {
      const failure = validation as
        | { code: ThirdPartyValidationErrorCode; message: string }
        | undefined;
      return {
        ok: false,
        code: failure?.code ?? "probe_failed",
        error: failure?.message ?? "Base URL 或 API Key 不可用，请检查后重试。",
      };
    }
    // 验证通过再整体替换暂存桶：失败的提交不会破坏已暂存内容。
    // Canonical `baseUrl` keeps the existing convention: bare roots get `/v1`
    // appended (quota collector's `openAiCompatibleModelsUrl` adds `/models`),
    // while already-versioned roots (Volcengine Ark `/api/v3`) stay intact.
    const canonicalBaseUrl = openAiCompatibleApiBase(apiRoot);
    // Touch the probe-URL builder so a future convention drift fails loudly here.
    void buildProbeUrls(apiRoot);
    clearUsageSecret(this.paths.cacheDir, "openai-compatible:pending");
    setUsageSecret(this.paths.cacheDir, "openai-compatible:pending", "baseUrl", canonicalBaseUrl);
    setUsageSecret(this.paths.cacheDir, "openai-compatible:pending", "apiKey", apiKey);
    const providerName = input.providerName?.trim();
    if (providerName)
      setUsageSecret(
        this.paths.cacheDir,
        "openai-compatible:pending",
        "providerName",
        providerName,
      );
    setUsageSecret(this.paths.cacheDir, "openai-compatible:pending", "model", model);
    const displayName = input.displayName?.trim();
    if (displayName)
      setUsageSecret(this.paths.cacheDir, "openai-compatible:pending", "displayName", displayName);
    // Persist the verified protocol + timestamp: downstream routing must use
    // the probed protocol instead of re-guessing per prompt.
    setUsageSecret(
      this.paths.cacheDir,
      "openai-compatible:pending",
      "validatedProtocol",
      validation.validatedProtocol,
    );
    setUsageSecret(
      this.paths.cacheDir,
      "openai-compatible:pending",
      "validatedAt",
      String(validation.validatedAt),
    );
    return { ok: true, validatedProtocol: validation.validatedProtocol };
  }

  /**
   * Seal a user-pasted Cookie header for a cookie provider whose sign-in
   * happens in the user's own browser (system browser via shell.openExternal,
   * then paste — the token-monitor flow). The header must carry the provider's
   * auth cookie name; configs with a live probe additionally verify the
   * session against the real API before sealing so an expired paste is
   * rejected instead of silently stored.
   */
  async submitCookie(providerId: string, cookie: string): Promise<UsageLoginResult> {
    const config = PROVIDER_CONFIGS[providerId];
    if (config?.kind !== "cookie") {
      return { ok: false, error: `No cookie login for ${providerId}` };
    }
    const header = cookie.trim();
    if (!header) return { ok: false, error: "Cookie is empty" };
    const names = header
      .split(";")
      .map((part) => part.split("=")[0]?.trim() ?? "")
      .filter((name) => name.length > 0);
    if (!names.some((name) => config.authCookiePattern.test(name))) {
      return {
        ok: false,
        error:
          "未找到有效的登录 Cookie：请粘贴完整的 Cookie 请求头，或至少包含会话 Cookie 的 name=value 对",
      };
    }
    if (config.validateSession && !(await config.validateSession(header))) {
      return { ok: false, error: "Cookie 已过期或会话无效，请在自己的浏览器中重新登录后再粘贴" };
    }
    setUsageSecret(this.paths.cacheDir, providerId, "cookie", header);
    return { ok: true };
  }

  startLogin(providerId: string): Promise<UsageLoginResult> {
    if (providerId === "antigravity") return this.antigravityOAuth.startLogin();
    const existing = this.inFlight.get(providerId);
    if (existing) return existing;
    const config = PROVIDER_CONFIGS[providerId];
    if (!config) {
      return Promise.resolve({ ok: false, error: `No usage login for ${providerId}` });
    }
    if (config.kind === "api-key") {
      // API-key providers have no browser step; the renderer calls submitApiKey.
      return Promise.resolve({
        ok: false,
        error: `${usageProviderLabel(providerId)} uses a pasted API key`,
      });
    }
    if (config.kind === "native-oauth") {
      return Promise.resolve({ ok: false, error: `No native OAuth handler for ${providerId}` });
    }
    const panel = this.getBrowserPanel();
    if (!panel) {
      return Promise.resolve({ ok: false, error: "Browser panel is not available" });
    }
    const run = this.runLogin(providerId, config, panel).finally(() => {
      this.inFlight.delete(providerId);
    });
    this.inFlight.set(providerId, run);
    return run;
  }

  private async runLogin(
    providerId: string,
    config: ProviderLoginConfig,
    panel: BrowserPanelManager,
  ): Promise<UsageLoginResult> {
    if (config.kind === "github-device") {
      return this.runGitHubDeviceLogin(providerId, config, panel);
    }
    if (config.kind === "local-storage") {
      return this.runLocalStorageLogin(providerId, config, panel);
    }
    if (config.kind === "api-key") {
      // Unreachable: startLogin returns before calling runLogin for api-key
      // providers. Present only to narrow the union to CookieLoginConfig below.
      throw new Error(`runLogin reached for api-key provider ${providerId}`);
    }
    if (config.kind === "native-oauth") {
      throw new Error(`runLogin reached for native OAuth provider ${providerId}`);
    }

    const result = await panel.captureLoginCookies({
      loginUrl: config.loginUrl,
      cookieUrl: config.cookieUrl,
      authCookiePattern: config.authCookiePattern,
      timeoutMs: LOGIN_TIMEOUT_MS,
      providerLabel: usageProviderLabel(providerId),
      ...(config.validateSession ? { validateSession: config.validateSession } : {}),
    });
    if (!result.ok || !result.cookie) {
      return {
        ok: false,
        ...(result.cancelled ? { cancelled: true } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
    }
    setUsageSecret(this.paths.cacheDir, providerId, "cookie", result.cookie);
    return { ok: true };
  }

  private async runLocalStorageLogin(
    providerId: string,
    config: LocalStorageLoginConfig,
    panel: BrowserPanelManager,
  ): Promise<UsageLoginResult> {
    const result = await panel.captureLoginLocalStorage({
      loginUrl: config.loginUrl,
      keys: Object.keys(config.store),
      requiredKey: config.requiredKey,
      timeoutMs: LOGIN_TIMEOUT_MS,
      providerLabel: usageProviderLabel(providerId),
    });
    if (!result.ok || !result.values) {
      return {
        ok: false,
        ...(result.cancelled ? { cancelled: true } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
    }
    for (const [storageKey, secretKey] of Object.entries(config.store)) {
      const value = result.values[storageKey];
      if (value) setUsageSecret(this.paths.cacheDir, providerId, secretKey, value);
    }
    return { ok: true };
  }

  private async runGitHubDeviceLogin(
    providerId: string,
    config: GitHubDeviceLoginConfig,
    panel: BrowserPanelManager,
  ): Promise<UsageLoginResult> {
    const device = await requestGitHubDeviceCode(config);
    if (!device.device_code || !device.user_code || !device.verification_uri) {
      return { ok: false, error: "GitHub did not return a device code" };
    }

    const url = device.verification_uri_complete ?? device.verification_uri;
    let tabId: string | undefined;
    try {
      tabId = (await panel.createTab({ url, activate: true })).tabId;
    } catch (err) {
      return { ok: false, error: (err as Error).message ?? "Failed to open login tab" };
    }

    const providerLabel = usageProviderLabel(providerId);
    clipboard.writeText(device.user_code);
    panel.showUsageLoginDeviceCode({
      providerId,
      providerLabel,
      code: device.user_code,
    });

    return await new Promise((resolve) => {
      let settled = false;
      let pollTimer: NodeJS.Timeout | undefined;
      const tokenUrl = `https://${config.host}/login/oauth/access_token`;
      const expiresAt = Date.now() + (device.expires_in ?? 900) * 1000;
      let intervalMs = Math.max(1, device.interval ?? 5) * 1000;

      const finish = (result: UsageLoginResult): void => {
        if (settled) return;
        settled = true;
        this.deviceLoginCancel.delete(providerId);
        if (pollTimer) clearTimeout(pollTimer);
        if (tabId)
          void panel.closeTab(tabId).catch((error) => {
            console.warn("[usage-login] failed to close login tab:", error);
          });
        panel.clearUsageLoginDeviceCode(providerId);
        resolve(result);
      };
      this.deviceLoginCancel.set(providerId, () => finish({ ok: false, cancelled: true }));

      const schedulePoll = (): void => {
        const delay = Math.min(intervalMs, Math.max(0, expiresAt - Date.now()));
        pollTimer = setTimeout(() => void poll(), delay);
      };

      const poll = async (): Promise<void> => {
        if (settled) return;
        if (Date.now() >= expiresAt) {
          finish({ ok: false, error: "Login timed out" });
          return;
        }
        try {
          const response = await requestGitHubAccessToken(
            tokenUrl,
            config.clientId,
            device.device_code!,
          );
          if (response.access_token) {
            setUsageSecret(this.paths.cacheDir, providerId, "token", response.access_token);
            finish({ ok: true });
            return;
          }
          if (response.error === "authorization_pending") {
            schedulePoll();
            return;
          }
          if (response.error === "slow_down") {
            intervalMs += 5_000;
            schedulePoll();
            return;
          }
          finish({ ok: false, error: "GitHub login failed" });
        } catch {
          finish({ ok: false, error: "GitHub login failed" });
        }
      };

      schedulePoll();
    });
  }
}

async function requestGitHubDeviceCode(
  config: GitHubDeviceLoginConfig,
): Promise<GitHubDeviceCodeResponse> {
  const response = await fetch(`https://${config.host}/login/device/code`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      scope: config.scope,
    }).toString(),
  });
  if (!response.ok) return {};
  return (await response.json()) as GitHubDeviceCodeResponse;
}

async function requestGitHubAccessToken(
  url: string,
  clientId: string,
  deviceCode: string,
): Promise<GitHubAccessTokenResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }).toString(),
  });
  return (await response.json()) as GitHubAccessTokenResponse;
}
