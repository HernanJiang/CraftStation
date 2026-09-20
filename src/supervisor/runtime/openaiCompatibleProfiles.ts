import {
  prepareCodexEndpointRuntime,
  prepareKimiEndpointRuntime,
  vendorEndpointEnv,
} from "./compatibleEndpointRuntime";
import { clearUsageSecret, getUsageSecret, setUsageSecret } from "@/shared/usageSecretStore";
import { AccountControlError, type AccountView } from "@/shared/contracts";
import {
  normalizeThirdPartyModelId,
  THIRD_PARTY_OPENCODE_PROVIDER_ID,
} from "@/shared/thirdPartyRouting";
import { stripModelProviderPrefix } from "@/shared/harnessCompatibility";
import {
  isVolcengineArkApiRoot,
  normalizeApiRoot,
  probeThirdPartyProvider,
  type ProbeFetch,
  type ThirdPartyProtocol,
} from "@/shared/thirdPartyValidation";
import {
  normalizeOpenAiCompatibleBaseUrl,
  openAiCompatibleModelsUrl,
  type HostPort,
} from "@craftstation/agents-usage";
import { AccountStore } from "./accountStore";
import { readSupervisorSharedSettings } from "./supervisorSharedSettings";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CraftStationCredentialVault } from "./credentialVault";
import { buildMuseForeignChildEnv } from "../agents/muse/foreignEndpoint";

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

const BUNDLE_KEYS = [
  "baseUrl",
  "apiKey",
  "providerName",
  "model",
  "displayName",
  "validatedProtocol",
  "validatedAt",
] as const;

export interface OpenAiCompatibleProfileServiceOptions {
  store: AccountStore;
  cacheDir: string;
  /**
   * Shared settings file (optional). When present, every custom-model catalog
   * row bound to an account is projected into that account's isolated
   * opencode.json, so a pooled `opencode serve` can serve any of the account's
   * models without a config reload.
   */
  settingsPath?: string;
}

interface ProfileBundle {
  baseUrl: string;
  apiKey: string;
  providerName?: string;
  model?: string;
  displayName?: string;
  /**
   * Real-probe outcome (Responses-first, see shared/thirdPartyValidation).
   * Absent on bundles staged before validation existed — such bundles must
   * re-verify before import (importStaging rejects them).
   */
  validatedProtocol?: "responses" | "chat_completions" | undefined;
  validatedAt?: number | undefined;
}

function readValidatedProtocol(value: string | undefined): ProfileBundle["validatedProtocol"] {
  const trimmed = value?.trim();
  return trimmed === "responses" || trimmed === "chat_completions" ? trimmed : undefined;
}

function readValidatedAt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
    ...(readValidatedProtocol(getUsageSecret(cacheDir, bucket, "validatedProtocol"))
      ? {
          validatedProtocol: readValidatedProtocol(
            getUsageSecret(cacheDir, bucket, "validatedProtocol"),
          )!,
        }
      : {}),
    ...(readValidatedAt(getUsageSecret(cacheDir, bucket, "validatedAt")) !== undefined
      ? { validatedAt: readValidatedAt(getUsageSecret(cacheDir, bucket, "validatedAt"))! }
      : {}),
  };
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

  /**
   * Every custom-model catalog row bound to this account (id + display name),
   * normalized to bare model ids. Returns an empty list when no settings file
   * is wired (tests, legacy construction).
   */
  private listAccountModelEntries(accountId: string): Array<{ id: string; name: string }> {
    const settingsPath = this.options.settingsPath;
    if (!settingsPath) return [];
    const settings = readSupervisorSharedSettings(settingsPath);
    const entries = new Map<string, { id: string; name: string }>();
    for (const row of settings.customModels) {
      if (row.accountId !== accountId) continue;
      const id = normalizeThirdPartyModelId(row.modelId);
      if (!id) continue;
      const name = row.displayName?.trim() || id;
      if (!entries.has(id)) entries.set(id, { id, name });
    }
    return [...entries.values()];
  }

  /** 编辑表单回填：只暴露非机密字段。 */
  getConfig(accountId: string): {
    baseUrl?: string;
    model?: string;
    displayName?: string;
    providerName?: string;
    validatedProtocol?: "responses" | "chat_completions";
    validatedAt?: number;
  } {
    const bundle = readBundle(this.options.cacheDir, this.bucketFor(accountId));
    if (!bundle)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    return {
      ...(bundle.baseUrl ? { baseUrl: bundle.baseUrl } : {}),
      ...(bundle.model ? { model: bundle.model } : {}),
      ...(bundle.displayName ? { displayName: bundle.displayName } : {}),
      ...(bundle.providerName ? { providerName: bundle.providerName } : {}),
      ...(bundle.validatedProtocol ? { validatedProtocol: bundle.validatedProtocol } : {}),
      ...(bundle.validatedAt !== undefined ? { validatedAt: bundle.validatedAt } : {}),
    };
  }

  /**
   * Routing descriptor for a validated third-party account: model id +
   * verified protocol + normalized base URL. Never includes the API key —
   * the key stays in the sealed bucket and is only projected into the
   * harness child-process env at spawn time.
   */
  getDescriptor(accountId: string):
    | {
        accountId: string;
        baseUrl: string;
        model?: string;
        validatedProtocol?: "responses" | "chat_completions";
        validatedAt?: number;
      }
    | undefined {
    const bundle = readBundle(this.options.cacheDir, this.bucketFor(accountId));
    if (!bundle) return undefined;
    return {
      accountId,
      baseUrl: bundle.baseUrl,
      ...(bundle.model ? { model: bundle.model } : {}),
      ...(bundle.validatedProtocol ? { validatedProtocol: bundle.validatedProtocol } : {}),
      ...(bundle.validatedAt !== undefined ? { validatedAt: bundle.validatedAt } : {}),
    };
  }

  /**
   * Channel rows that can serve `modelId` right now, in pool row order.
   * Eligibility mirrors the launch-time channel match
   * (`resolveThirdPartyAccountForLaunch`): the account must be enabled,
   * schedulable (`available`/`quota-low`), credentialed (sealed bundle with
   * key), protocol-verified, and carry a custom-model catalog row for the
   * model. Protocol must agree when both sides know it (a Responses-only
   * Codex route can never run on a chat_completions channel). Excluded rows
   * (same-turn tried set) never come back.
   */
  channelAccountsServingModel(input: {
    modelId: string;
    protocol?: "responses" | "chat_completions" | undefined;
    excludedAccountIds?: readonly string[] | undefined;
  }): string[] {
    const excluded = new Set(input.excludedAccountIds ?? []);
    const wanted = normalizeThirdPartyModelId(input.modelId.trim());
    const wantedStripped = stripModelProviderPrefix(wanted);
    if (!wanted) return [];
    const matchesModel = (entryId: string) => {
      const stripped = stripModelProviderPrefix(entryId);
      return entryId === wanted || stripped === wanted || stripped === wantedStripped;
    };
    const eligible: string[] = [];
    const rows = this.options.store
      .records(PROVIDER)
      .slice()
      .sort((a, b) => a.order - b.order);
    for (const row of rows) {
      if (excluded.has(row.accountId)) continue;
      if (!row.enabled) continue;
      if (row.status !== "available" && row.status !== "quota-low") continue;
      const descriptor = this.getDescriptor(row.accountId);
      if (!descriptor?.validatedProtocol) continue;
      if (
        input.protocol &&
        descriptor.validatedProtocol &&
        descriptor.validatedProtocol !== input.protocol
      ) {
        continue;
      }
      const servesModel = this.listAccountModelEntries(row.accountId).some((entry) =>
        matchesModel(entry.id),
      );
      if (!servesModel) continue;
      eligible.push(row.accountId);
    }
    return eligible;
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
    // No verification → no catalog entry. A bundle staged before real-probe
    // validation existed (or with wiped validation keys) must re-verify.
    if (!bundle.validatedProtocol) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "该配置尚未通过真实兼容性验证；请先验证 Base URL + API Key + Model，验证通过后才能添加。",
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
    return prepareCodexEndpointRuntime({
      directory: codexHome,
      baseUrl: bundle.baseUrl,
      apiKey: bundle.apiKey,
      ...(bundle.providerName ? { name: bundle.providerName } : {}),
    });
  }

  /**
   * Prepare an isolated official OpenCode server profile for a third-party
   * OpenAI-compatible account. GLM and other models without an official
   * Harness run here. The API key stays in the isolated config file under
   * the supervisor cache — never the user's ~/.config/opencode.
   */
  prepareOpenCodeRuntime(
    accountId: string,
    modelId?: string,
  ): {
    configDir: string;
    env: Record<string, string>;
  } {
    const bundle = readBundle(this.options.cacheDir, this.bucketFor(accountId));
    if (!bundle) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "OpenAI 兼容 API 配置缺失，请重新编辑并验证。",
      );
    }
    const configDir = join(
      this.options.cacheDir,
      "openai-compatible-opencode",
      safeAccountPathSegment(accountId),
    );
    mkdirSync(configDir, { recursive: true });
    const model = normalizeThirdPartyModelId(modelId ?? bundle.model ?? "default") || "default";
    const providerId = THIRD_PARTY_OPENCODE_PROVIDER_ID;
    // The opencode serve pool reuses idle servers without reloading config, so
    // the isolated config must list every model bound to this account, not
    // only the one being launched right now.
    const models: Record<string, { name: string }> = {};
    for (const entry of this.listAccountModelEntries(accountId)) {
      models[entry.id] = { name: entry.name };
    }
    const bundleModel = bundle.model ? normalizeThirdPartyModelId(bundle.model) : "";
    if (bundleModel && !models[bundleModel]) {
      models[bundleModel] = { name: bundle.displayName ?? bundleModel };
    }
    models[model] = models[model] ?? { name: bundle.displayName ?? model };
    const document = {
      $schema: "https://opencode.ai/config.json",
      provider: {
        [providerId]: {
          name: bundle.providerName ?? "OpenAI Compatible",
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: bundle.baseUrl,
            apiKey: bundle.apiKey,
          },
          models,
        },
      },
    };
    const serialized = JSON.stringify(document, null, 2);
    writeFileSync(join(configDir, "opencode.json"), serialized, { encoding: "utf8" });
    // Native OpenCode transport derives OPENCODE_CONFIG_DIR from the managed
    // account root (`<root>/config/opencode`). Mirror the file there so the
    // craft-lane resolver does not need a reserved env key.
    const nativeConfigDir = join(
      this.options.store.credentialRoot(accountId),
      "config",
      "opencode",
    );
    mkdirSync(nativeConfigDir, { recursive: true });
    writeFileSync(join(nativeConfigDir, "opencode.json"), serialized, { encoding: "utf8" });
    return {
      configDir,
      env: {
        OPENCODE_CONFIG_DIR: configDir,
        CRAFTSTATION_OPENCODE_PROVIDER: providerId,
      },
    };
  }

  /**
   * Prepare an isolated Muse Code child that talks to this account's Responses
   * endpoint. The API key is child-env only (`META_API_KEY`); XDG homes are
   * redirected so the launch cannot read or write `~/.config/muse`.
   */
  prepareMuseRuntime(accountId: string): {
    isolationDir: string;
    env: Record<string, string>;
  } {
    const bundle = readBundle(this.options.cacheDir, this.bucketFor(accountId));
    if (!bundle) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "OpenAI 兼容 API 配置缺失，请重新编辑并验证。",
      );
    }
    const isolationDir = join(
      this.options.cacheDir,
      "openai-compatible-muse",
      safeAccountPathSegment(accountId),
    );
    return {
      isolationDir,
      env: buildMuseForeignChildEnv({
        apiKey: bundle.apiKey,
        baseUrl: bundle.baseUrl,
        isolationDir,
      }),
    };
  }

  /**
   * Project a third-party OpenAI-compatible Base URL + key into a native
   * vendor CLI (Kimi Code / Grok Build / DeepSeek Harness) via child env only.
   */
  prepareVendorCompatRuntime(
    accountId: string,
    harness: "kimi" | "grok" | "deepseek",
    modelId?: string,
    /**
     * Wire-type override for the Kimi provider table (`responses` →
     * `openai_responses`, anything else → `openai`). Used by same-channel
     * protocol failover when the validated type 400s on the real workload
     * (e.g. Volcengine Ark coding rejects Kimi CLI's Responses payload while
     * answering the same model over chat completions). Grok/DeepSeek project
     * protocol-agnostic env and ignore it.
     */
    protocolOverride?: "responses" | "chat_completions" | undefined,
  ): { env: Record<string, string> } {
    const bundle = readBundle(this.options.cacheDir, this.bucketFor(accountId));
    if (!bundle) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "OpenAI 兼容 API 配置缺失，请重新编辑并验证。",
      );
    }
    if (harness === "kimi") {
      // Volcengine Ark coding/inference hosts speak Chat Completions, not
      // Responses: a stale `responses` validation would otherwise project a
      // provider table Kimi CLI 400s on (`400 A parameter specified in the
      // request is not valid`). Force chat for Ark regardless of the bundle;
      // an explicit same-channel flip override still wins.
      const protocol =
        protocolOverride ??
        (bundle.baseUrl && isVolcengineArkApiRoot(bundle.baseUrl)
          ? ("chat_completions" as const)
          : bundle.validatedProtocol);
      return prepareKimiEndpointRuntime({
        directory: join(
          this.options.cacheDir,
          "openai-compatible-kimi",
          safeAccountPathSegment(accountId),
          // Model-scoped homes prevent concurrent models overwriting each other's aliases.
          Buffer.from(modelId ?? bundle.model ?? "", "utf8").toString("base64url"),
        ),
        baseUrl: bundle.baseUrl,
        apiKey: bundle.apiKey,
        model: modelId ?? bundle.model ?? "",
        ...(protocol ? { protocol } : {}),
      });
    }
    return { env: vendorEndpointEnv(harness, bundle.baseUrl, bundle.apiKey) };
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
              if (typeof id === "string" && id.trim()) ids.push(normalizeThirdPartyModelId(id));
            }
          }
        }
        const models = (body as Record<string, unknown>).models;
        if (Array.isArray(models)) {
          for (const id of models)
            if (typeof id === "string" && id.trim()) ids.push(normalizeThirdPartyModelId(id));
        } else if (models && typeof models === "object") {
          ids.push(...Object.keys(models).map(normalizeThirdPartyModelId));
        }
      }
      return [...new Set(ids)];
    } catch {
      return [];
    }
  }

  /**
   * Per-model add-time gate: run the real Responses-first inference probe for
   * one model id with the account's sealed key (the key never leaves the
   * supervisor). `/models` listing alone never passes. Returns the verified
   * protocol; throws AccountControlError with a user-facing message otherwise.
   */
  async verifyModel(
    accountId: string,
    model: string,
    fetchImpl?: ProbeFetch | undefined,
  ): Promise<{ validatedProtocol: ThirdPartyProtocol; validatedAt: number }> {
    const bundle = readBundle(this.options.cacheDir, this.bucketFor(accountId));
    if (!bundle) {
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    }
    const apiRoot = normalizeApiRoot(bundle.baseUrl);
    if (!apiRoot) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "该账号的 Base URL 无效，请重新编辑并验证。",
        { accountId },
      );
    }
    const probe: ProbeFetch =
      fetchImpl ??
      (async (url, init, timeoutMs) => {
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
      });
    const result = await probeThirdPartyProvider({
      baseUrl: apiRoot,
      apiKey: bundle.apiKey,
      model: normalizeThirdPartyModelId(model),
      fetchImpl: probe,
    });
    if (!result.ok) {
      throw new AccountControlError("ACCOUNT_PROJECTION_FAILED", result.message, {
        accountId,
        code: result.code,
      });
    }
    return { validatedProtocol: result.validatedProtocol, validatedAt: result.validatedAt };
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
