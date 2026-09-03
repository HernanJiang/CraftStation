import { z } from "zod";

/**
 * Isolated profile specification for native AI CLI / Harness execution.
 *
 * Each managed account owns an opaque filesystem root and process-level
 * isolation variables (e.g. GROK_HOME + GROK_LEADER_SOCKET, CODEX_HOME,
 * KIMI_CODE_HOME) so that official CLI binaries spawned by the Supervisor
 * run in independent namespaces without leaking or stealing credentials.
 */
export const nativeProfileSpecSchema = z.object({
  providerId: z.string().min(1).max(64),
  accountId: z.string().min(1).max(160),
  profilePath: z.string().min(1),
  env: z.record(z.string(), z.string()),
  credentialScope: z.string().max(240).optional(),
  runtimeIsolation: z
    .object({
      ipcPath: z.string().optional(),
      socketPath: z.string().optional(),
    })
    .optional(),
});

export type NativeProfileSpec = z.infer<typeof nativeProfileSpecSchema>;
