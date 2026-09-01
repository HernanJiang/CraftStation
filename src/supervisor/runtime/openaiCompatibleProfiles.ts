import { clearUsageSecret, getUsageSecret, setUsageSecret } from "@/shared/usageSecretStore";
import { AccountControlError, type AccountView } from "@/shared/contracts";
import {
  normalizeOpenAiCompatibleBaseUrl,
  openAiCompatibleModelsUrl,
  type HostPort,
} from "@craftstation/agents-usage";
import { AccountStore } from "./accountStore";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CraftStationCredentialVault } from "./credentialVault";

/**
 * OpenAI 兼容 API 多提供商号池。每个账号是一个用户自定义的第三方端点：
 * 提供商名称（卡片第一行）、Base URL、API Key、模型名称/展示名称。凭据整体
 * 隔离在 `openai-compatible:<accountId>` 密封桶里，添加即追加、删除只删自己。
 *
 * 额度展示按"能拿到什么显示什么"：/models 校验连通性；若该中转实现了
 * one-api/new-api 风格的 `/dashboard/billing/subscription` + `/usage`，
 * 折算成额度窗口；拿不到额度就留空窗口——卡片回退显示精确 Token 用量。
 */

const PROVIDER = "openai-compatible";
const STAGING_BUCKET = "openai-compatible:pending";

const BUNDLE_KEYS = ["baseUrl", "apiKey", "providerName", "model", "displayName"] as const;

export interface OpenAiCompatibleProfileServiceOptions {
  store: AccountStore;
  cacheDir: string;
}

interface ProfileBundle {
  baseUrl: string;
  apiKey: string;
  providerName?: string;
  model?: string;
  displayName?: string;
}

function readBundle(cacheDir: string, bucket: string): ProfileBundle | undefined {
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(getUsageSecret(cacheDir, bucket, "baseUrl"));
  const apiKey = getUsageSecret(cacheDir, bucket, "apiKey")?.trim();
  if (!baseUrl || !apiKey) return undefined;
  return {
    baseUrl,
    apiKey,
    ...(getUsageSecret(cacheDir, bucket, "providerName")?.trim()
      ? { providerName: getUsageSecret(cacheDir, bucket, "providerName")!.trim() }
      : {}),
    ...(getUsageSecret(cacheDir, bucket, "model")?.trim()
      ? { model: getUsageSecret(cacheDir, bucket, "model")!.trim() }
      : {}),
    ...(getUsageSecret(cacheDir, bucket, "displayName")?.trim()
      ? { displayName: getUsageSecret(cacheDir, bucket, "displayName")!.trim() }
      : {}),
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function safeAccountPathSegment(accountId: string): string {
  return accountId.replace(/[^A-Za-z0-9._-]/g, "_");
}

export class OpenAiCompatibleProfileService {
  private readonly vault: CraftStationCredentialVault;

  constructor(private readonly options: OpenAiCompatibleProfileServiceOptions) {
    this.vault = new CraftStationCredentialVault(options.cacheDir);
  }

  list(): AccountView[] {
    return this.options.store.list(PROVIDER);
  }

  bucketFor(accountId: string): string {
    return this.vault.accountBucket(PROVIDER, accountId);
  }

  /** 编辑表单回填：只暴露非机密字段。 */
  getConfig(accountId: string): {
    baseUrl?: string;
    model?: string;
    displayName?: string;
    providerName?: string;
  } {
    const bundle = readBundle(this.options.cacheDir, this.bucketFor(accountId));
    if (!bundle)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    return {
      ...(bundle.baseUrl ? { baseUrl: bundle.baseUrl } : {}),
      ...(bundle.model ? { model: bundle.model } : {}),
      ...(bundle.displayName ? { displayName: bundle.displayName } : {}),
      ...(bundle.providerName ? { providerName: bundle.providerName } : {}),
    };
  }

  /** 把暂存桶导入为号池账号：默认追加；给 accountId 则换绑该账号。 */
  importStaging(accountId?: string): AccountView {
    const cacheDir = this.options.cacheDir;
    const bundle = readBundle(cacheDir, STAGING_BUCKET);
    if (!bundle) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "未找到新的 OpenAI 兼容 API 配置；请先在表单中验证并保存。",
      );
    }
    const identity =
      bundle.providerName ??
      (() => {
        try {
          return new URL(bundle.baseUrl).host;
        } catch {
          return bundle.baseUrl;
        }
      })();
    const plan = bundle.displayName ?? bundle.model;

    if (accountId) {
      const account = this.options.store.getRecord(accountId);
      if (!account || account.provider !== PROVIDER) {
        throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
      }
      this.moveBundle(STAGING_BUCKET, this.bucketFor(accountId));
      this.options.store.updateProviderMetadata(accountId, {
        providerAccountId: identity,
        ...(plan ? { plan } : {}),
      });
      this.options.store.updateStatus(accountId, "available");
      return this.options.store.get(accountId)!;
    }

    const account = this.options.store.add({
      provider: PROVIDER,
      label: identity,
      maskedIdentity: identity,
      providerAccountId: identity,
      ...(plan ? { plan } : {}),
      enabled: true,
    });
    try {
      this.moveBundle(STAGING_BUCKET, this.bucketFor(account.accountId));
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

  destroyCredentials(accountId: string): void {
    this.vault.removeAccount(PROVIDER, accountId);
  }

  /**
   * Prepare an account-isolated official Codex app-server profile. The API key
   * is passed only via the child environment and is never written to disk.
   */
  prepareCodexRuntime(accountId: string): {
    codexHome: string;
    env: Record<string, string>;
  } {
    const bundle = readBundle(this.options.cacheDir, this.bucketFor(accountId));
    if (!bundle) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "OpenAI 兼容 API 配置缺失，请重新编辑并验证。",
      );
    }
    const codexHome = join(
      this.options.cacheDir,
      "openai-compatible-codex",
      safeAccountPathSegment(accountId),
    );
    mkdirSync(codexHome, { recursive: true });
    const config = [
      "# CraftStation OpenAI-compatible account profile",
      'model_provider = "craftstation_openai_compatible"',
      'sandbox_mode = "danger-full-access"',
      "",
      "[model_providers.craftstation_openai_compatible]",
      `name = ${tomlString(bundle.providerName ?? "OpenAI Compatible")}`,
      `base_url = ${tomlString(bundle.baseUrl)}`,
      'wire_api = "responses"',
      'env_key = "CRAFTSTATION_OPENAI_COMPATIBLE_API_KEY"',
      "requires_openai_auth = false",
      "supports_websockets = false",
      "",
      "[windows]",
      'sandbox = "unelevated"',
      "",
    ].join("\n");
    writeFileSync(join(codexHome, "config.toml"), config, { encoding: "utf8" });
    return {
      codexHome,
      env: { CRAFTSTATION_OPENAI_COMPATIBLE_API_KEY: bundle.apiKey },
    };
  }

  /** 该账号端点的可用模型 id 列表（/models）。 */
  async listModels(accountId: string): Promise<string[]> {
    const bundle = readBundle(this.options.cacheDir, this.bucketFor(accountId));
    if (!bundle) return [];
    try {
      const res = await fetch(openAiCompatibleModelsUrl(bundle.baseUrl), {
        headers: { Accept: "application/json", Authorization: `Bearer ${bundle.apiKey}` },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as unknown;
      const ids: string[] = [];
      if (body && typeof body === "object") {
        const data = (body as Record<string, unknown>).data;
        if (Array.isArray(data)) {
          for (const entry of data) {
            if (entry && typeof entry === "object") {
              const id = (entry as Record<string, unknown>).id;
              if (typeof id === "string" && id.trim()) ids.push(id.trim());
            }
          }
        }
        const models = (body as Record<string, unknown>).models;
        if (Array.isArray(models)) {
          for (const id of models) if (typeof id === "string" && id.trim()) ids.push(id.trim());
        } else if (models && typeof models === "object") {
          ids.push(...Object.keys(models));
        }
      }
      return [...new Set(ids)];
    } catch {
      return [];
    }
  }

  /**
   * 账号级连通性与额度：/models 校验 Key；若中转实现了 one-api/new-api 风格的
   * billing 端点则折算额度窗口，否则留空窗口（卡片回退显示 Token 用量）。
   */
  async collectQuota(accountId: string, host: HostPort): Promise<AccountView> {
    const account = this.options.store.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    const bundle = readBundle(this.options.cacheDir, this.bucketFor(accountId));
    if (!bundle) {
      return this.options.store.updateStatus(accountId, "auth-expired", {
        lastError: "OpenAI 兼容 API 配置缺失，需要重新填写。",
        lastQuotaAt: Date.now(),
      });
    }

    const requestJson = async (url: string): Promise<unknown | "auth-rejected" | "unavailable"> => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let status = 0;
        let body: string | undefined;
        try {
          const res = await host.http.request({
            method: "GET",
            url,
            headers: { Accept: "application/json", Authorization: `Bearer ${bundle.apiKey}` },
            timeoutMs: 12_000,
          });
          status = res.status;
          body = res.body;
        } catch {
          return "unavailable";
        }
        if (status === 401 || status === 403) return "auth-rejected";
        if (status < 200 || status >= 300) return "unavailable";
        try {
          return JSON.parse(body ?? "");
        } catch {
          return "unavailable";
        }
      }
      return "unavailable";
    };

    const identity = bundle.providerName ?? bundle.baseUrl;
    const withMetadata = this.options.store.updateProviderMetadata(accountId, {
      providerAccountId: identity,
    });

    const models = await requestJson(openAiCompatibleModelsUrl(bundle.baseUrl));
    if (models === "auth-rejected") {
      return this.options.store.updateStatus(accountId, "auth-expired", {
        lastError: "OpenAI 兼容 API Key 无效或已失效，请编辑更新。",
        lastQuotaAt: Date.now(),
      });
    }
    if (typeof models !== "object" || models === null) {
      return this.options.store.updateStatus(accountId, "unavailable", {
        lastError: "OpenAI 兼容 API 连接失败，请检查 Base URL。",
        lastQuotaAt: Date.now(),
      });
    }

    // 额度探测（可选中转端点）：subscription 给额度上限，usage 给已用（美分）。
    let usedPercent: number | undefined;
    let resetsAt: number | undefined;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    const fmt = (date: Date): string => date.toISOString().slice(0, 10);
    const subscription = await requestJson(
      `${bundle.baseUrl}/dashboard/billing/subscription`,
    ).catch(() => undefined);
    const usage = await requestJson(
      `${bundle.baseUrl}/dashboard/billing/usage?start_date=${fmt(start)}&end_date=${fmt(end)}`,
    ).catch(() => undefined);
    if (subscription && typeof subscription === "object" && usage && typeof usage === "object") {
      const limit =
        numeric((subscription as Record<string, unknown>).system_hard_limit_usd) ??
        numeric((subscription as Record<string, unknown>).hard_limit_usd);
      const totalUsage = numeric((usage as Record<string, unknown>).total_usage);
      if (limit !== undefined && limit > 0 && totalUsage !== undefined) {
        usedPercent = Math.min(100, Math.max(0, (totalUsage / (limit * 100)) * 100));
      }
      const accessUntil = numeric((subscription as Record<string, unknown>).access_until);
      if (accessUntil !== undefined && accessUntil > 0) {
        resetsAt = accessUntil * (accessUntil < 1e12 ? 1000 : 1);
      }
    }

    const status = usedPercent !== undefined && usedPercent >= 90 ? "quota-low" : "available";
    const updated = this.options.store.updateStatus(accountId, status, {
      lastQuotaAt: Date.now(),
    });
    const quotaWindows =
      usedPercent !== undefined
        ? [
            {
              id: "monthly",
              label: "额度",
              usedPercent,
              ...(resetsAt !== undefined ? { resetsAt } : {}),
            },
          ]
        : [];
    return this.options.store.updateQuota(accountId, quotaWindows) ?? withMetadata ?? updated;
  }
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
