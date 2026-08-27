import { z } from "zod";
import { projectLocationSchema } from "./common";

/** Begin an isolated Grok device-auth login inside a pending managed GROK_HOME. */
export const grokProfileLoginCreatePayloadSchema = z.object({
  label: z.string().trim().min(1).max(120),
});
export type GrokProfileLoginCreatePayload = z.infer<
  typeof grokProfileLoginCreatePayloadSchema
>;

export const grokProfileLoginCreateResultSchema = z.object({
  pendingRef: z.string().min(1),
  label: z.string().min(1),
});
export type GrokProfileLoginCreateResult = z.infer<
  typeof grokProfileLoginCreateResultSchema
>;

export const grokProfileLoginPayloadSchema = z.object({
  pendingRef: z.string().min(1),
  shellId: z.string().min(1),
  projectLocation: projectLocationSchema,
  completionToken: z.string().regex(/^lc_[A-Za-z0-9_-]{1,180}$/u),
  windowsShellRuntime: z.enum(["preferred", "powershell"]).optional(),
});
export type GrokProfileLoginPayload = z.infer<typeof grokProfileLoginPayloadSchema>;

export const grokProfileLoginResultSchema = z.object({
  shellId: z.string().min(1),
  label: z.string().min(1),
  completionToken: z.string().min(1),
});
export type GrokProfileLoginResult = z.infer<typeof grokProfileLoginResultSchema>;

/** Import the official auth written into the pending home; requires an identity. */
export const grokProfileCompletePayloadSchema = z.object({
  pendingRef: z.string().min(1),
});
export type GrokProfileCompletePayload = z.infer<typeof grokProfileCompletePayloadSchema>;

/** Abandon a pending login without touching the AccountStore. */
export const grokProfileCancelPayloadSchema = z.object({
  pendingRef: z.string().min(1),
});
export type GrokProfileCancelPayload = z.infer<typeof grokProfileCancelPayloadSchema>;

/** Poll a pending Grok login for a freshly written official identity. */
export const grokProfilePollPayloadSchema = z.object({
  pendingRef: z.string().min(1),
});
export type GrokProfilePollPayload = z.infer<typeof grokProfilePollPayloadSchema>;

export const grokProfilePollResultSchema = z.object({
  done: z.boolean(),
  account: z.unknown().optional(),
});
export type GrokProfilePollResult = z.infer<typeof grokProfilePollResultSchema>;
