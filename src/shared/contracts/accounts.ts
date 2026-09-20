import { z } from "zod";

export const accountStatusSchema = z.enum([
  "available",
  "quota-low",
  "quota-exhausted",
  "auth-expired",
  "unavailable",
  "disabled",
  "error",
]);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const accountProviderSchema = z.string().min(1).max(64);

/**
 * Provider-pool scheduling contract (v0.5). Each provider pool owns one mode.
 * `priority` follows Account Row order; `round-robin` advances a persisted
 * cursor; `random` picks from the usable pool. Defaults to priority.
 */
export const accountSchedulingModeSchema = z.enum(["priority", "round-robin", "random"]);
export type AccountSchedulingMode = z.infer<typeof accountSchedulingModeSchema>;

/** Persisted per-provider pool scheduling state (renderer-safe; no secrets). */
export interface ProviderPoolConfig {
  scheduling: AccountSchedulingMode;
  /** accountId of the last round-robin pick; undefined until first pick. */
  roundRobinCursor?: string;
}

/** Non-secret quota data captured for one managed account. */
export interface AccountQuotaWindow {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt?: number | undefined;
  /**
   * Optional absolute amounts for balance-style providers (e.g. StepFun
   * prepaid `balance`/`total_*` from `/v1/accounts`): `remaining` is the
   * currently spendable amount, `limit` the total granted credit, `used`
   * the consumed amount — all in `currency` (ISO 4217, e.g. "CNY").
   */
  used?: number | undefined;
  limit?: number | undefined;
  remaining?: number | undefined;
  currency?: string | undefined;
}

export const providerPoolConfigSchema = z.object({
  scheduling: accountSchedulingModeSchema,
  roundRobinCursor: z.string().min(1).max(160).optional(),
});

/** Renderer-safe account metadata. Credential material is intentionally absent. */
export const accountViewSchema = z.object({
  accountId: z.string().min(1).max(160),
  provider: accountProviderSchema,
  label: z.string().min(1).max(120),
  maskedIdentity: z.string().max(160).optional(),
  plan: z.string().max(120).optional(),
  createdAt: z.number().int().nonnegative(),
  enabled: z.boolean(),
  /**
   * Deprecated since v0.5: legacy `selected`/首选 semantics were replaced by
   * provider-pool scheduling + explicit per-session override. Kept only for
   * backward-compatible reads; new code must not set or rely on it.
   */
  selected: z.boolean(),
  order: z.number().int().nonnegative(),
  status: accountStatusSchema,
  lastError: z.string().max(1000).optional(),
  lastQuotaAt: z.number().int().nonnegative().optional(),
  credentialScopeRef: z.string().min(1).max(240),
  /** Provider-visible identity may be updated after a quota/identity probe. */
  providerAccountId: z.string().max(160).optional(),
  /** Account-scoped quota only; provider-wide snapshots must not be copied here. */
  quotaWindows: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string(),
        usedPercent: z.number().min(0).max(100),
        resetsAt: z.number().int().nonnegative().optional(),
        /** Absolute balance amounts (see AccountQuotaWindow). */
        used: z.number().nonnegative().optional(),
        limit: z.number().nonnegative().optional(),
        remaining: z.number().optional(),
        currency: z.string().max(8).optional(),
      }),
    )
    .optional(),
});
export type AccountView = z.infer<typeof accountViewSchema>;

export interface AccountRecord extends AccountView {
  /** Internal-only path to the isolated credential scope. Never serialized in AccountView. */
  credentialRoot: string;
}

export interface AccountMutationInput {
  provider: string;
  label: string;
  maskedIdentity?: string;
  plan?: string;
  providerAccountId?: string;
  credentialScopeRef?: string;
  enabled?: boolean;
}

export interface AccountCredentialProjection {
  accountId: string;
  provider: string;
  /** Raw material is accepted only by supervisor-side projection adapters. */
  authJson?: string;
  environment?: Record<string, string>;
}

/**
 * Resolution mode (v0.5): `explicit` honours an explicit account override and
 * never silently falls back (Session-sticky resume); `auto` follows the
 * provider-pool scheduling mode; `preferred` tries the explicit account first
 * but falls back to the pool when it is exhausted/disabled (NEW session
 * launches must not hard-fail on the user's stale pick). Legacy `selected` is
 * accepted for compatibility but treated as auto+priority with the legacy
 * selected marker; new code should use auto, explicit or preferred.
 */
export const accountResolutionModeSchema = z.enum(["explicit", "selected", "auto", "preferred"]);
export type AccountResolutionMode = z.infer<typeof accountResolutionModeSchema>;

export const accountResolutionRequestSchema = z.object({
  provider: accountProviderSchema,
  mode: accountResolutionModeSchema.default("auto"),
  explicitAccountId: z.string().min(1).optional(),
  /**
   * Optional per-call scheduling override. When absent the provider-pool
   * persisted mode from AccountStore is used.
   */
  scheduling: accountSchedulingModeSchema.optional(),
  /**
   * Pool accounts to skip for this resolution (same-turn failover's tried
   * set). Applies to pool scheduling only — explicit/selected direct hits
   * are never silently rerouted. When every usable account is excluded the
   * pool honestly reports ACCOUNT_POOL_EXHAUSTED.
   */
  excludedAccountIds: z.array(z.string().min(1)).optional(),
  /** Deprecated since v0.5; kept for backward-compatible IPC reads. */
  selectedAccountId: z.string().min(1).optional(),
});
export type AccountResolutionRequest = z.infer<typeof accountResolutionRequestSchema>;

export interface AccountResolutionCandidate {
  accountId: string;
  status: AccountStatus;
  eligible: boolean;
  reason: string;
}

export interface AccountResolution {
  account: AccountView;
  reason: "explicit" | "selected" | "priority" | "round-robin" | "random";
  candidates: AccountResolutionCandidate[];
  /** Effective scheduling mode used for auto resolution. */
  scheduling: AccountSchedulingMode;
}

export type AccountErrorCode =
  | "ACCOUNT_UNAVAILABLE"
  | "ACCOUNT_POOL_EXHAUSTED"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_PATH_INVALID"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_CORRUPT"
  | "ACCOUNT_PROJECTION_FAILED"
  | "ACCOUNT_RUNTIME_UNSUPPORTED"
  | "PROFILE_IDENTITY_MISMATCH"
  | "ACCOUNT_IDENTITY_UNAVAILABLE"
  | "THIRD_PARTY_HARNESS_INCOMPATIBLE";

export const accountProviderPayloadSchema = z.object({
  provider: accountProviderSchema.optional(),
});
export type AccountProviderPayload = z.infer<typeof accountProviderPayloadSchema>;

export const accountPoolConfigPayloadSchema = z.object({
  provider: accountProviderSchema,
  scheduling: accountSchedulingModeSchema,
});
export type AccountPoolConfigPayload = z.infer<typeof accountPoolConfigPayloadSchema>;

export const accountAddPayloadSchema = z.object({
  provider: accountProviderSchema,
  label: z.string().trim().min(1).max(120),
  maskedIdentity: z.string().max(160).optional(),
  plan: z.string().max(120).optional(),
  providerAccountId: z.string().max(160).optional(),
  credentialScopeRef: z.string().max(240).optional(),
  enabled: z.boolean().optional(),
});
export type AccountAddPayload = z.infer<typeof accountAddPayloadSchema>;

export const accountIdPayloadSchema = z.object({ accountId: z.string().min(1).max(160) });
export type AccountIdPayload = z.infer<typeof accountIdPayloadSchema>;

export const accountEnabledPayloadSchema = accountIdPayloadSchema.extend({ enabled: z.boolean() });
export type AccountEnabledPayload = z.infer<typeof accountEnabledPayloadSchema>;

export const accountRenamePayloadSchema = accountIdPayloadSchema.extend({
  label: z.string().trim().min(1).max(120),
});
export type AccountRenamePayload = z.infer<typeof accountRenamePayloadSchema>;

export const accountReorderPayloadSchema = z.object({
  provider: accountProviderSchema,
  orderedAccountIds: z.array(z.string().min(1).max(160)).min(1),
});
export type AccountReorderPayload = z.infer<typeof accountReorderPayloadSchema>;

/**
 * Result of applying a pool Antigravity account as the host `agy` login.
 * Renderer-safe: identity email at most, never credential material.
 */
export const antigravityHostLoginResultSchema = z.object({
  applied: z.literal(true),
  email: z.string().max(160).optional(),
});
export type AntigravityHostLoginResult = z.infer<typeof antigravityHostLoginResultSchema>;

export class AccountControlError extends Error {
  readonly code: AccountErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AccountErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AccountControlError";
    this.code = code;
    if (details !== undefined) this.details = details;
    Object.setPrototypeOf(this, AccountControlError.prototype);
  }
}
