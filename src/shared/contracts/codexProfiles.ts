import { z } from "zod";
import { projectLocationSchema } from "./common";

export const codexProfileImportPayloadSchema = z.object({
  label: z.string().trim().min(1).max(120),
  /** Absolute Codex home to import. Omit to use the host ~/.codex (dev reuse). */
  profileRoot: z.string().min(1).optional(),
});
export type CodexProfileImportPayload = z.infer<typeof codexProfileImportPayloadSchema>;

export const codexProfileCreatePayloadSchema = z.object({
  label: z.string().trim().min(1).max(120),
});
export type CodexProfileCreatePayload = z.infer<typeof codexProfileCreatePayloadSchema>;

export const codexProfileLoginPayloadSchema = z.object({
  accountId: z.string().min(1).max(160),
  shellId: z.string().min(1),
  projectLocation: projectLocationSchema,
  completionToken: z.string().regex(/^lc_[A-Za-z0-9_-]{1,180}$/u),
  windowsShellRuntime: z.enum(["preferred", "powershell"]).optional(),
});
export type CodexProfileLoginPayload = z.infer<typeof codexProfileLoginPayloadSchema>;

export const codexProfileLoginResultSchema = z.object({
  shellId: z.string().min(1),
  label: z.string().min(1),
  completionToken: z.string().min(1),
});
export type CodexProfileLoginResult = z.infer<typeof codexProfileLoginResultSchema>;

export const antigravityProfileImportPayloadSchema = z.object({
  /** Existing pool account to re-authorize; omit to append a new account. */
  accountId: z.string().min(1).max(160).optional(),
});
export type AntigravityProfileImportPayload = z.infer<typeof antigravityProfileImportPayloadSchema>;
