import { z } from "zod";

/**
 * Provider usage contracts. The canonical usage vocabulary (UsageSnapshot etc.)
 * is owned by the standalone `@poracode/agents-usage` package and re-exported
 * here so the renderer and supervisor share one set of types without the
 * renderer importing a collector (which would drag fetch/child_process into the
 * browser bundle). Only the IPC request payload needs a runtime Zod schema; the
 * response is a plain typed result.
 */

export type {
  UsageSnapshot,
  UsageWindow,
  UsageWindowId,
  UsageStatus,
  UsageUnit,
  UsageCost,
  UsageCostPeriod,
  UsageTokens,
  UsageCredits,
  UsageMechanism,
  UsageProviderDescriptor,
} from "@poracode/agents-usage";

import type { UsageSnapshot } from "@poracode/agents-usage";

export const providerUsagePayloadSchema = z.object({
  /** Restrict collection to these provider ids; omitted = all known providers. */
  providerIds: z.array(z.string()).optional(),
  /**
   * When true, drain any in-flight refresh for the same id-set first, then start
   * a new collection. Use after credential changes (login / API key / sign-out)
   * so a concurrent background poll that started with the previous secret cannot
   * be coalesced and returned as the "fresh" result.
   */
  force: z.boolean().optional(),
});
export type ProviderUsagePayload = z.infer<typeof providerUsagePayloadSchema>;

export interface ProviderUsageResponse {
  snapshots: UsageSnapshot[];
  /** True when the snapshots came from the on-disk cache (a refresh may be in flight). */
  fromCache: boolean;
}

export const usageLoginPayloadSchema = z.object({
  /** Provider to launch the browser-overlay cookie login for (e.g. "grok"). */
  providerId: z.string(),
});
export type UsageLoginPayload = z.infer<typeof usageLoginPayloadSchema>;

export const usageApiKeyPayloadSchema = z.object({
  /** Provider whose pasted API key is being stored (e.g. "zai"). */
  providerId: z.string(),
  /** The API key the user pasted into the in-app sign-in. */
  apiKey: z.string().min(1),
});
export type UsageApiKeyPayload = z.infer<typeof usageApiKeyPayloadSchema>;

export const volcengineCredentialsPayloadSchema = z
  .object({
    apiKey: z.string().optional(),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    region: z.string().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.apiKey?.trim()) ||
      (Boolean(value.accessKeyId?.trim()) && Boolean(value.secretAccessKey?.trim())),
    "Provide an Ark API Key or both AK and SK",
  );
export type VolcengineCredentialsPayload = z.infer<typeof volcengineCredentialsPayloadSchema>;

export const openAiCompatibleCredentialsPayloadSchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  /** 用户自定义提供商名称（卡片第一行）；缺省用 Base URL 域名。 */
  providerName: z.string().trim().max(120).optional(),
  /** 要使用的模型 id。 */
  model: z.string().trim().max(200).optional(),
  /** 模型展示名称（卡片第二行）；缺省用模型 id。 */
  displayName: z.string().trim().max(200).optional(),
});
export type OpenAiCompatibleCredentialsPayload = z.infer<
  typeof openAiCompatibleCredentialsPayloadSchema
>;

/** 读取一个 OpenAI 兼容号池账号的非机密配置（编辑表单回填；Key 永不回传）。 */
export const openAiCompatibleProfileQueryPayloadSchema = z.object({
  accountId: z.string().min(1).max(160),
});
export type OpenAiCompatibleProfileQueryPayload = z.infer<
  typeof openAiCompatibleProfileQueryPayloadSchema
>;

export const openAiCompatibleProfileConfigSchema = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  displayName: z.string().optional(),
  providerName: z.string().optional(),
});
export type OpenAiCompatibleProfileConfig = z.infer<typeof openAiCompatibleProfileConfigSchema>;

export const openAiCompatibleProfileImportPayloadSchema = z.object({
  /** 编辑/重授权已有账号；缺省为追加新账号。 */
  accountId: z.string().min(1).max(160).optional(),
});
export type OpenAiCompatibleProfileImportPayload = z.infer<
  typeof openAiCompatibleProfileImportPayloadSchema
>;

export const channelModelsPayloadSchema = z.object({
  provider: z.string().min(1),
  accountId: z.string().min(1).max(160).optional(),
});
export type ChannelModelsPayload = z.infer<typeof channelModelsPayloadSchema>;

export const channelModelsResponseSchema = z.object({
  models: z.array(z.string()),
});
export type ChannelModelsResponse = z.infer<typeof channelModelsResponseSchema>;

export const usageCookiePayloadSchema = z.object({
  /** Provider whose pasted session cookie is being stored (e.g. "commandcode"). */
  providerId: z.string(),
  /**
   * Cookie header the user pasted after signing in in their own browser — a
   * full `a=1; b=2` header or a single `name=value` pair carrying the
   * provider's session cookie.
   */
  cookie: z.string().min(1),
});
export type UsageCookiePayload = z.infer<typeof usageCookiePayloadSchema>;

export interface UsageLoginResult {
  ok: boolean;
  /** True when the user closed the login window before completing. */
  cancelled?: boolean;
  /** Stable machine-readable failure code for native/provider login flows. */
  code?: string;
  error?: string;
}

export interface UsageLogoutResult {
  ok: boolean;
}

export const usageLoginStatePayloadSchema = z.object({});
export type UsageLoginStatePayload = z.infer<typeof usageLoginStatePayloadSchema>;

export interface UsageLoginStateResponse {
  /**
   * Per-provider: whether a login secret (cookie/token) is currently stored.
   * The persistent source of truth for "signed in", so the UI doesn't infer
   * sign-out from a failed/empty usage fetch.
   */
  stored: Record<string, boolean>;
}

export const usageLoginConfirmationActionSchema = z.enum(["use", "change", "cancel"]);
export type UsageLoginConfirmationAction = z.infer<typeof usageLoginConfirmationActionSchema>;

export interface UsageLoginConfirmationRequest {
  requestId: string;
  providerLabel: string;
}

export interface UsageLoginDeviceCode {
  providerId: string;
  providerLabel: string;
  code: string;
}

export const usageLoginConfirmationPayloadSchema = z.object({
  requestId: z.string().min(1),
  action: usageLoginConfirmationActionSchema,
});
export type UsageLoginConfirmationPayload = z.infer<typeof usageLoginConfirmationPayloadSchema>;
/** Provider-neutral live counters consumed by renderer monitoring surfaces. */
export interface SessionMetrics {
  weeklyQuotaPercent?: number | null;
  fiveHourQuotaPercent: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheHitRatePercent: number | null;
}
