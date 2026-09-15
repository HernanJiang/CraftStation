import { z } from "zod";
import { projectLocationSchema } from "./common";

/** Account-scoped Kimi Code credential import. Raw credential material stays
 * in the Supervisor and is never represented by this contract. */
export const kimiProfileImportPayloadSchema = z.object({
  label: z.string().trim().min(1).max(120),
  profileRoot: z.string().min(1).optional(),
});
export type KimiProfileImportPayload = z.infer<typeof kimiProfileImportPayloadSchema>;

export const kimiProfileApiKeyPayloadSchema = z.object({
  label: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(1).max(4096),
});
export type KimiProfileApiKeyPayload = z.infer<typeof kimiProfileApiKeyPayloadSchema>;

export const kimiProfileCreatePayloadSchema = z.object({
  label: z.string().trim().min(1).max(120),
});
export type KimiProfileCreatePayload = z.infer<typeof kimiProfileCreatePayloadSchema>;

export const kimiProfileLoginPayloadSchema = z.object({
  accountId: z.string().min(1).max(160),
  shellId: z.string().min(1),
  projectLocation: projectLocationSchema,
  completionToken: z.string().regex(/^lc_[A-Za-z0-9_-]{1,180}$/u),
  windowsShellRuntime: z.enum(["preferred", "powershell"]).optional(),
});
export type KimiProfileLoginPayload = z.infer<typeof kimiProfileLoginPayloadSchema>;

export const kimiProfileLoginResultSchema = z.object({
  shellId: z.string().min(1),
  label: z.string().min(1),
  completionToken: z.string().min(1),
});
export type KimiProfileLoginResult = z.infer<typeof kimiProfileLoginResultSchema>;
