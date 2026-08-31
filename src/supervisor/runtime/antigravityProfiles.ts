import { clearUsageSecret, getUsageSecret, setUsageSecret } from "@/shared/usageSecretStore";
import { AccountControlError, type AccountView } from "@/shared/contracts";
import {
  antigravityModelsFromFetchAvailableModels,
  antigravityPoolWindows,
  type HostPort,
} from "@poracode/agents-usage";
import { AccountStore } from "./accountStore";
import { CraftStationCredentialVault } from "./credentialVault";
import {
  refreshStoredAntigravityToken,
  resolveStoredAntigravityToken,
} from "./antigravityCredentials";

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
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
] as const;

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
   * Move the freshly signed-in host bundle into the pool: append a new account
   * (default) or refresh an existing account's credential. The legacy bucket is
   * always drained, so the next "add account" can never overwrite this one.
   */
  importHostLogin(accountId?: string): AccountView {
    const cacheDir = this.options.cacheDir;
    const accessToken = getUsageSecret(cacheDir, "antigravity", "accessToken")?.trim();
    const refreshToken = getUsageSecret(cacheDir, "antigravity", "refreshToken")?.trim();
    if (!accessToken && !refreshToken) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "未找到新的 Antigravity 授权；请先完成浏览器登录。",
      );
    }
    const email = getUsageSecret(cacheDir, "antigravity", "email")?.trim();
    const plan = getUsageSecret(cacheDir, "antigravity", "plan")?.trim();

    if (accountId) {
      // Re-authorize: swap the bundle in place; the identity/email may rotate.
      const account = this.options.store.getRecord(accountId);
      if (!account || account.provider !== this.provider) {
        throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
      }
      this.moveBundle("antigravity", this.bucketFor(accountId));
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
      return this.options.store.updateStatus(account.accountId, "available");
    } catch (error) {
      this.options.store.remove(account.accountId);
      throw error;
    }
  }

  private moveBundle(fromBucket: string, toBucket: string): void {
    const cacheDir = this.options.cacheDir;
    for (const key of BUNDLE_KEYS) {
      const value = getUsageSecret(cacheDir, fromBucket, key);
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

  /** Remove an account's sealed bundle (pool-row deletion). */
  destroyCredentials(accountId: string): void {
    this.vault.removeAccount(this.provider, accountId);
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
      return this.options.store.updateStatus(accountId, "auth-expired", {
        lastError: "Antigravity 授权缺失，需要重新登录。",
        lastQuotaAt: Date.now(),
      });
    }

    const projectId = getUsageSecret(cacheDir, bucket, "projectId")?.trim();
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
