import { z } from "zod";

export const accountBindingSchema = z.object({
  accountId: z.string().min(1).max(160),
  provider: z.string().min(1).max(64),
  credentialScopeRef: z.string().min(1).max(240),
  reason: z.enum(["explicit", "selected", "priority-fallback"]),
  boundAt: z.number().int().nonnegative(),
});
export type AccountBinding = z.infer<typeof accountBindingSchema>;
