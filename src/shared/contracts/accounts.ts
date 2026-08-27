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

/** Renderer-safe account metadata. Credential material is intentionally absent. */
export const accountViewSchema = z.object({
  accountId: z.string().min(1).max(160),
  provider: accountProviderSchema,
  label: z.string().min(1).max(120),
  maskedIdentity: z.string().max(160).optional(),
  plan: z.string().max(120).optional(),
  createdAt: z.number().int().nonnegative(),
  enabled: z.boolean(),
  selected: z.boolean(),
  order: z.number().int().nonnegative(),
  status: accountStatusSchema,
  lastError: z.string().max(1000).optional(),
  lastQuotaAt: z.number().int().nonnegative().optional(),
  credentialScopeRef: z.string().min(1).max(240),
  /** Provider-visible identity may be updated after a quota/identity probe. */
  providerAccountId: z.string().max(160).optional(),
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

export const accountResolutionModeSchema = z.enum(["explicit", "selected", "auto"]);
export type AccountResolutionMode = z.infer<typeof accountResolutionModeSchema>;

export const accountResolutionRequestSchema = z.object({
  provider: accountProviderSchema,
  mode: accountResolutionModeSchema.default("auto"),
  explicitAccountId: z.string().min(1).optional(),
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
  reason: "explicit" | "selected" | "priority-fallback";
  candidates: AccountResolutionCandidate[];
}

export type AccountErrorCode =
  | "ACCOUNT_UNAVAILABLE"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_PATH_INVALID"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_CORRUPT"
  | "ACCOUNT_PROJECTION_FAILED"
  | "ACCOUNT_RUNTIME_UNSUPPORTED";

export const accountProviderPayloadSchema = z.object({
  provider: accountProviderSchema.optional(),
});
export type AccountProviderPayload = z.infer<typeof accountProviderPayloadSchema>;

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
