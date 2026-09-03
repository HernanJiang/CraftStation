import { z } from "zod";
import { nativeProfileSpecSchema } from "./nativeProfile";

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
  nativeProfile: nativeProfileSpecSchema.optional(),
});
export type AccountBinding = z.infer<typeof accountBindingSchema>;
