import { z } from "zod";

/**
 * Account binding reason (v0.5). `explicit` is a per-session override that
 * never silently falls back; `priority`/`round-robin`/`random` are provider-pool
 * scheduling picks. Legacy `selected` is kept only for backward-compatible reads.
 */
export const accountBindingSchema = z.object({
  accountId: z.string().min(1).max(160),
  provider: z.string().min(1).max(64),
  credentialScopeRef: z.string().min(1).max(240),
  reason: z.enum(["explicit", "selected", "priority", "round-robin", "random"]),
  boundAt: z.number().int().nonnegative(),
  /** Provider-visible identity used by the Supervisor's native gate. */
  providerAccountId: z.string().max(160).optional(),
  maskedIdentity: z.string().max(160).optional(),
});
export type AccountBinding = z.infer<typeof accountBindingSchema>;
