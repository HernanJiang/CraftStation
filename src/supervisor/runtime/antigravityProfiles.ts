import {
  clearUsageSecret,
  getUsageSecret,
  reportUndecryptableSecret,
  setUsageSecret,
} from "@/shared/usageSecretStore";
import { AccountControlError, type AccountView } from "@/shared/contracts";
import {
  antigravityModelsFromFetchAvailableModels,
  antigravityPoolWindows,
  type HostPort,
} from "@craftstation/agents-usage";
import { AccountStore } from "./accountStore";
import { CraftStationCredentialVault } from "./credentialVault";
import {
  antigravityAdcCredentialPath,
  clearAntigravityAdcCredential,
  materializeAntigravityAdcCredential,
  readAdcRefreshToken,
  refreshStoredAntigravityToken,
  resolveStoredAntigravityToken,
} from "./antigravityCredentials";
import {
  buildAntigravityHostCredentialPayload,
  hostCredentialRefreshToken,
  readAntigravityHostCredential,
  writeAntigravityHostCredential,
} from "./antigravityHostLogin";

/**
 * Managed Antigravity account pool. The host sign-in writes one Google OAuth
 * bundle into the legacy "antigravity" bucket; each "add account" run must land
 * in its OWN pool row instead of overwriting the previous one. Import moves the
 * bundle into an isolated `antigravity:<accountId>` bucket (email, quota, and
 * status stay per account), so the pool behaves like the Grok account pool.
 * Quota reads `v1internal:fetchAvailableModels` on cloudcode-pa with the
 * account's own token — the same OAuth-only surface the Antigravity language
 * server proxies (verified working in CodexRouter), which is what makes quota
 * readable on CLI-only machines with no IDE/LS running.
 */

/** Bucket keys copied verbatim from the host login bundle. */
const BUNDLE_KEYS = [
  "accessToken",
  "refreshToken",
  "idToken",
  "tokenType",
  "expiresAt",
  "email",
  "projectId",
  "plan",
] as const;

const CLOUDCODE_BASES = [
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.googleapis.com",
] as const;

const LOAD_CODE_ASSIST_BODY = JSON.stringify({
  metadata: { ideType: "GEMINI_CLI", pluginType: "GEMINI" },
});

/**
 * Resolve the account's Cloud Code project id via `loadCodeAssist` — the same
 * OAuth-only surface the Gemini CLI collector uses for its tier lookup, which
 * also names the `cloudaicompanionProject` the quota endpoints scope against.
 */
async function discoverAntigravityProjectId(
  accessToken: string,
  host: HostPort,
): Promise<string | undefined> {
  for (const base of CLOUDCODE_BASES) {
    let body: string | undefined;
    try {
      const res = await host.http.request({
        method: "POST",
        url: `${base}/v1internal:loadCodeAssist`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: LOAD_CODE_ASSIST_BODY,
        timeoutMs: 15_000,
      });
      if (res.status < 200 || res.status >= 300) continue;
      body = res.body;
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(body ?? "") as { cloudaicompanionProject?: unknown };
      if (
        typeof parsed.cloudaicompanionProject === "string" &&
        parsed.cloudaicompanionProject.trim()
      ) {
        return parsed.cloudaicompanionProject.trim();
      }
    } catch {
      // Malformed body — try the next base.
    }
  }
  return undefined;
}

export interface AntigravityProfileServiceOptions {
  store: AccountStore;
  /** safeStorage cacheDir for the sealed credential buckets. */
  cacheDir: string;
}

export class AntigravityProfileService {
  private readonly provider = "antigravity";
  private readonly vault: CraftStationCredentialVault;

  constructor(private readonly options: AntigravityProfileServiceOptions) {
    this.vault = new CraftStationCredentialVault(options.cacheDir);
  }

  list(): AccountView[] {
    return this.options.store.list(this.provider);
  }

  bucketFor(accountId: string): string {
    return this.vault.accountBucket(this.provider, accountId);
  }

  /**
   * Whether the account's sealed bundle still holds a refresh token — the pool
   * schedulability signal for chat/craft session resolution (see
   * `SupervisorRuntime.hasManagedCredential`). Access tokens alone cannot keep
   * an `agy` session alive: they expire within the hour.
   */
  hasRefreshToken(accountId: string): boolean {
    return Boolean(this.readAccountRefreshToken(accountId));
  }

  /**
   * Vault first, then the durable ADC file. Presence of an unreadable sealed
   * blob must not hide a still-valid per-account file written at login.
   */
  private readAccountRefreshToken(accountId: string): string | undefined {
    const fromVault = getUsageSecret(
      this.options.cacheDir,
      this.bucketFor(accountId),
      "refreshToken",
    )?.trim();
    if (fromVault) return fromVault;
    try {
      return readAdcRefreshToken(
        antigravityAdcCredentialPath(this.options.store.credentialRoot(accountId)),
      );
    } catch {
      return undefined;
    }
  }

  /** Re-seal the vault from the durable ADC file when the sealed value is gone or unreadable. */
  private plantAdcIntoVaultIfNeeded(accountId: string): void {
    const cacheDir = this.options.cacheDir;
    const bucket = this.bucketFor(accountId);
    if (getUsageSecret(cacheDir, bucket, "refreshToken")?.trim()) return;
    const adcRefresh = this.readAccountRefreshToken(accountId);
    if (!adcRefresh) return;
    setUsageSecret(cacheDir, bucket, "refreshToken", adcRefresh);
  }

  /** Keep the Grok-style ADC file in sync whenever the vault holds a refresh token. */
  private persistAccountAdc(accountId: string): void {
    let credentialRoot: string;
    try {
      credentialRoot = this.options.store.credentialRoot(accountId);
    } catch {
      return;
    }
    materializeAntigravityAdcCredential(
      this.options.cacheDir,
      this.bucketFor(accountId),
      credentialRoot,
    );
  }

  /**
   * Publish the account's refresh token as the authorized_user ADC file inside
   * its managed profile directory, ready for an `AGY_ADC_AUTH=1` session spawn
   * (env comes from `prepareAntigravityProfile`). Throws the user-facing
   * account-control error when the bundle has no refresh token, so a session
   * start fails with a reason instead of popping the CLI's browser OAuth.
   */
  materializeSessionCredential(accountId: string): string {
    const account = this.options.store.getRecord(accountId);
    if (!account || account.provider !== this.provider) {
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    }
    this.plantAdcIntoVaultIfNeeded(accountId);
    const path = materializeAntigravityAdcCredential(
      this.options.cacheDir,
      this.bucketFor(accountId),
      this.options.store.credentialRoot(accountId),
    );
    if (!path) {
      throw new AccountControlError(
        "ACCOUNT_UNAVAILABLE",
        "Antigravity 授权缺失，无法为该账号启动会话；请重新登录该账号。",
        { accountId },
      );
    }
    return path;
  }

  /**
   * Self-heal a pool row whose sealed bundle is gone or unreadable
   * (update/restart orphaned the vault) from the account's own ADC file. The
   * ADC file is the Grok-style credential: a plain per-account file under the
   * managed profile directory, written at login, that update flows never
   * touch. The planted refresh token is verified with a real Google refresh
   * before trusting it — a dead token is removed again so the row settles to
   * clean auth-missing instead of retrying forever. An unreadable sealed blob
   * is garbage for this identity and is replaced (re-sealed under the current
   * key) rather than left blocking recovery.
   */
  private async rescueSessionCredential(
    accountId: string,
    host: HostPort,
  ): Promise<{ accessToken: string } | undefined> {
    const cacheDir = this.options.cacheDir;
    const bucket = this.bucketFor(accountId);
    if (getUsageSecret(cacheDir, bucket, "refreshToken")?.trim()) return undefined;
    this.plantAdcIntoVaultIfNeeded(accountId);
    if (!getUsageSecret(cacheDir, bucket, "refreshToken")?.trim()) return undefined;
    try {
      const refreshed = await refreshStoredAntigravityToken(cacheDir, bucket, host.http);
      if (!refreshed?.accessToken) {
        clearUsageSecret(cacheDir, bucket, "refreshToken");
        try {
          clearAntigravityAdcCredential(this.options.store.credentialRoot(accountId));
        } catch {
          // ignore
        }
        return undefined;
      }
      this.persistAccountAdc(accountId);
      console.log(
        `[antigravity] re-sealed pool row ${accountId} from its session credential after sealed-bundle loss.`,
      );
      return refreshed;
    } catch {
      clearUsageSecret(cacheDir, bucket, "refreshToken");
      return undefined;
    }
  }

  /**
   * Move the freshly signed-in host bundle into the pool: append a new account
   * (default) or refresh an existing account's credential. The legacy bucket is
   * always drained, so the next "add account" can never overwrite this one.
   */
  importHostLogin(accountId?: string): AccountView {
    const cacheDir = this.options.cacheDir;
    const accessToken = getUsageSecret(
      cacheDir,
      "antigravity",
      "accessToken",
      reportUndecryptableSecret,
    )?.trim();
    const refreshToken = getUsageSecret(
      cacheDir,
      "antigravity",
      "refreshToken",
      reportUndecryptableSecret,
    )?.trim();
    if (!accessToken && !refreshToken) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "未找到新的 Antigravity 授权；请先完成浏览器登录。",
      );
    }
    const email = getUsageSecret(
      cacheDir,
      "antigravity",
      "email",
      reportUndecryptableSecret,
    )?.trim();
    const plan = getUsageSecret(cacheDir, "antigravity", "plan", reportUndecryptableSecret)?.trim();

    if (accountId) {
      // Re-authorize: swap the bundle in place; the identity/email may rotate.
      const account = this.options.store.getRecord(accountId);
      if (!account || account.provider !== this.provider) {
        throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
      }
      this.moveBundle("antigravity", this.bucketFor(accountId));
      this.persistAccountAdc(accountId);
      this.options.store.updateProviderMetadata(accountId, {
        ...(email ? { providerAccountId: email } : {}),
        ...(plan ? { plan } : {}),
      });
      this.options.store.updateStatus(accountId, "available");
      return this.options.store.get(accountId)!;
    }

    // Append: the pool contract — one new row per completed sign-in.
    const account = this.options.store.add({
      provider: this.provider,
      label: "New Antigravity",
      ...(email ? { maskedIdentity: email, providerAccountId: email } : {}),
      ...(plan ? { plan } : {}),
      enabled: true,
    });
    try {
      this.moveBundle("antigravity", this.bucketFor(account.accountId));
      this.persistAccountAdc(account.accountId);
      return this.options.store.updateStatus(account.accountId, "available");
    } catch (error) {
      this.options.store.remove(account.accountId);
      throw error;
    }
  }

  private moveBundle(fromBucket: string, toBucket: string): void {
    const cacheDir = this.options.cacheDir;
    for (const key of BUNDLE_KEYS) {
      const value = getUsageSecret(cacheDir, fromBucket, key, reportUndecryptableSecret);
      if (value !== undefined) setUsageSecret(cacheDir, toBucket, key, value);
    }
    clearUsageSecret(cacheDir, fromBucket);
  }

  /** 渠道可用模型 id 列表（fetchAvailableModels；用第一个可用账号的 token）。 */
  async listModels(): Promise<string[]> {
    const cacheDir = this.options.cacheDir;
    for (const account of this.options.store.records(this.provider)) {
      const token = await resolveStoredAntigravityToken(
        cacheDir,
        this.bucketFor(account.accountId),
      ).catch(() => undefined);
      if (!token?.accessToken) continue;
      for (const base of CLOUDCODE_BASES) {
        try {
          const res = await fetch(`${base}/v1internal:fetchAvailableModels`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
              "Content-Type": "application/json",
              "User-Agent": "antigravity",
            },
            body: "{}",
            signal: AbortSignal.timeout(12_000),
          });
          if (!res.ok) continue;
          const models = antigravityModelsFromFetchAvailableModels(await res.json());
          if (models.length > 0) return models.map((model) => model.label);
        } catch {
          continue;
        }
      }
    }
    return [];
  }

  /** Remove an account's sealed bundle and durable ADC file (pool-row deletion). */
  destroyCredentials(accountId: string): void {
    this.vault.removeAccount(this.provider, accountId);
    try {
      clearAntigravityAdcCredential(this.options.store.credentialRoot(accountId));
    } catch {
      // The account row may already be gone with the pool directory.
    }
  }

  /**
   * Apply a pool account as the host `agy` CLI login ("设为本机登录",
   * mirrors `agm switch --target agy`). The pool keeps all rows untouched;
   * only the single OS-credential-store login is overwritten, so host and
   * ambient sessions run as this account with a full model catalog. Tokens
   * never leave this service: only the sealed vault is read and the payload
   * goes straight to the OS store writer.
   */
  async applyAccountToHostLogin(
    accountId: string,
    writer: typeof writeAntigravityHostCredential = writeAntigravityHostCredential,
  ): Promise<{ email?: string }> {
    const email = await this.publishAccountToHostLogin(accountId, writer);
    return email ? { email } : {};
  }

  /** Shared core: resolve a row's tokens and publish them as the host login. */
  private async publishAccountToHostLogin(
    accountId: string,
    writer: typeof writeAntigravityHostCredential,
  ): Promise<string | undefined> {
    const account = this.options.store.getRecord(accountId);
    if (!account || account.provider !== this.provider) {
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    }
    const cacheDir = this.options.cacheDir;
    this.plantAdcIntoVaultIfNeeded(account.accountId);
    const token = await resolveStoredAntigravityToken(
      cacheDir,
      this.bucketFor(account.accountId),
    ).catch(() => undefined);
    if (!token?.accessToken || !token?.refreshToken) {
      throw new AccountControlError(
        "ACCOUNT_UNAVAILABLE",
        "该账号缺少有效授权，无法设为本机登录；请先重新登录该账号。",
        { accountId },
      );
    }
    await writer(
      buildAntigravityHostCredentialPayload({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        ...(token.tokenType ? { tokenType: token.tokenType } : {}),
        ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
      }),
    );
    return token.email?.trim() || account.providerAccountId || account.maskedIdentity || undefined;
  }

  /**
   * Ensure the host `agy` login follows the given pool row (B-mode: sessions
   * execute on the shared host identity). No-op when the host already holds
   * this row's refresh token. Concurrent callers converge: writes carry full
   * blobs via a single atomic CredWrite.
   */
  async ensureHostFollowsAccount(
    accountId: string,
    writer: typeof writeAntigravityHostCredential = writeAntigravityHostCredential,
    reader: typeof readAntigravityHostCredential = readAntigravityHostCredential,
  ): Promise<{ applied: boolean; accountId: string }> {
    const account = this.options.store.getRecord(accountId);
    if (!account || account.provider !== this.provider) {
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    }
    this.plantAdcIntoVaultIfNeeded(account.accountId);
    const rowRefresh = this.readAccountRefreshToken(account.accountId);
    if (!rowRefresh) {
      throw new AccountControlError(
        "ACCOUNT_UNAVAILABLE",
        "该账号缺少有效授权，无法设为本机登录；请先重新登录该账号。",
        { accountId },
      );
    }
    const hostRaw = await reader().catch(() => null);
    if (hostCredentialRefreshToken(hostRaw) === rowRefresh) {
      return { applied: false, accountId };
    }
    await this.publishAccountToHostLogin(account.accountId, writer);
    return { applied: true, accountId };
  }

  /**
   * Rotate-after-failure for the host login (the `agm auto-switch` /
   * `rotate-after-failure` equivalent): when the just-failed pool row is also
   * what the host `agy` login currently holds, publish the next usable pool
   * row as the host login so follow-up host/ambient sessions keep working.
   * Conservative by design: unknown host identity, missing failed-row secret,
   * or no next candidate all resolve to "no rotation" instead of guessing.
   */
  async rotateHostAfterFailure(
    failedAccountId: string,
    pickNext: () => { accountId: string } | undefined,
    writer: typeof writeAntigravityHostCredential = writeAntigravityHostCredential,
    reader: typeof readAntigravityHostCredential = readAntigravityHostCredential,
  ): Promise<{ rotated: boolean; accountId?: string }> {
    const cacheDir = this.options.cacheDir;
    const failedRefresh = getUsageSecret(
      cacheDir,
      this.bucketFor(failedAccountId),
      "refreshToken",
      reportUndecryptableSecret,
    )?.trim();
    if (!failedRefresh) return { rotated: false };
    const hostRaw = await reader().catch(() => null);
    if (hostCredentialRefreshToken(hostRaw) !== failedRefresh) return { rotated: false };
    let next: { accountId: string } | undefined;
    try {
      next = pickNext();
    } catch {
      return { rotated: false };
    }
    if (!next || next.accountId === failedAccountId) return { rotated: false };
    const applied = await this.applyAccountToHostLogin(next.accountId, writer).catch(
      () => undefined,
    );
    if (!applied) return { rotated: false };
    return { rotated: true, accountId: next.accountId };
  }

  /**
   * Account-scoped quota via the OAuth-only cloudcode surface. Never touches
   * the language server: this path exists precisely for CLI-only machines.
   */
  async collectQuota(accountId: string, host: HostPort): Promise<AccountView> {
    const account = this.options.store.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    const bucket = this.bucketFor(accountId);
    const cacheDir = this.options.cacheDir;
    // resolveStoredAntigravityToken already refreshes near-expiry tokens.
    let token = await resolveStoredAntigravityToken(cacheDir, bucket, host.http).catch(
      () => undefined,
    );
    if (!token?.accessToken) {
      // A bucket can hold sealed values that no known app key opens (stale
      // identity after an update/restart). That is a local key problem, not a
      // revoked Google grant. Try the durable ADC file first — an unreadable
      // blob must not block recovery. Only surface the re-save copy when
      // rescue also fails.
      let storedButUnreadable = false;
      getUsageSecret(cacheDir, bucket, "refreshToken", () => {
        storedButUnreadable = true;
      });
      token = await this.rescueSessionCredential(accountId, host).catch(() => undefined);
      if (!token?.accessToken) {
        if (storedButUnreadable) {
          reportUndecryptableSecret({ providerId: bucket, key: "refreshToken" });
        }
        return this.options.store.updateStatus(accountId, "auth-expired", {
          lastError: storedButUnreadable
            ? "本地保存的授权解不开了（应用更新/重启导致），数据仍在；请对该账号点“登录授权”重新保存一次。"
            : "Antigravity 授权缺失，需要重新登录。",
          lastQuotaAt: Date.now(),
        });
      }
    }

    let projectId = getUsageSecret(
      cacheDir,
      bucket,
      "projectId",
      reportUndecryptableSecret,
    )?.trim();
    if (!projectId) {
      // Accounts authorized in-app (never captured from a host IDE login)
      // carry no projectId, and `fetchAvailableModels` without one answers
      // against a default project whose buckets always read full — the quota
      // panel then sticks at 0% forever. Discover the account's Cloud Code
      // project via `loadCodeAssist` (the same surface the Gemini collector
      // uses) and persist it so later polls skip the extra round trip.
      projectId = await discoverAntigravityProjectId(token.accessToken, host).catch(
        () => undefined,
      );
      if (projectId) {
        setUsageSecret(cacheDir, bucket, "projectId", projectId);
      }
    }
    const requestBody = projectId ? JSON.stringify({ project: projectId }) : "{}";
    const readModels = async (accessToken: string): Promise<unknown | "auth-rejected"> => {
      for (const base of CLOUDCODE_BASES) {
        let status = 0;
        let body: string | undefined;
        try {
          const res = await host.http.request({
            method: "POST",
            url: `${base}/v1internal:fetchAvailableModels`,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "User-Agent": "antigravity",
              Accept: "application/json",
            },
            body: requestBody,
            timeoutMs: 15_000,
          });
          status = res.status;
          body = res.body;
        } catch {
          continue;
        }
        if (status === 401 || status === 403) return "auth-rejected";
        if (status < 200 || status >= 300) continue;
        try {
          return JSON.parse(body ?? "");
        } catch {
          continue;
        }
      }
      return "unreachable";
    };

    let parsed = await readModels(token.accessToken);
    if (parsed === "auth-rejected") {
      // Force a token refresh in the account's own bucket, then retry once.
      const refreshed = await refreshStoredAntigravityToken(cacheDir, bucket, host.http).catch(
        () => undefined,
      );
      if (!refreshed?.accessToken) {
        return this.options.store.updateStatus(accountId, "auth-expired", {
          lastError: "Antigravity 授权已过期，需要重新登录。",
          lastQuotaAt: Date.now(),
        });
      }
      token = refreshed;
      parsed = await readModels(token.accessToken);
      if (parsed === "auth-rejected") {
        return this.options.store.updateStatus(accountId, "auth-expired", {
          lastError: "Antigravity 授权已过期，需要重新登录。",
          lastQuotaAt: Date.now(),
        });
      }
    }
    if (typeof parsed !== "object" || parsed === null) {
      return this.options.store.updateStatus(accountId, "unavailable", {
        lastError: "Antigravity 额度接口不可达，请检查网络。",
        lastQuotaAt: Date.now(),
      });
    }

    this.persistAccountAdc(accountId);
    const windows = antigravityPoolWindows(antigravityModelsFromFetchAvailableModels(parsed));
    const email = token.email?.trim();
    const withMetadata = this.options.store.updateProviderMetadata(accountId, {
      ...(email ? { providerAccountId: email } : {}),
    });
    if (windows.length === 0) {
      const updated = this.options.store.updateStatus(accountId, "unavailable", {
        lastError: "Antigravity 额度响应中没有可用模型。",
        lastQuotaAt: Date.now(),
      });
      return this.options.store.updateQuota(accountId, []) ?? withMetadata ?? updated;
    }
    const status = windows.some((window) => window.usedPercent >= 90) ? "quota-low" : "available";
    const updated = this.options.store.updateStatus(accountId, status, {
      lastQuotaAt: Date.now(),
    });
    return (
      this.options.store.updateQuota(
        accountId,
        windows.map((window) => ({
          id: window.id,
          label: window.label,
          usedPercent: window.usedPercent,
          ...(window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {}),
        })),
      ) ??
      withMetadata ??
      updated
    );
  }
}
