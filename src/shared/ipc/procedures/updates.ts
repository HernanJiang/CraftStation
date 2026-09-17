import { z } from "zod";
import { defineIpcProcedure, defineNoArgProcedure } from "../core";

const checkForUpdateOptionsSchema = z.object({
  /**
   * Automatic checks (app launch, hourly poll, CLI-menu mount auto-check) stay
   * silent: failures report as "not available" instead of an error toast.
   * Omitted/false = user-initiated, surfaces real failures.
   */
  automatic: z.boolean().optional(),
});

export type CheckForUpdateOptions = z.infer<typeof checkForUpdateOptionsSchema>;

export const updatesProcedures = {
  checkForUpdate: defineIpcProcedure<
    [options?: CheckForUpdateOptions],
    CheckForUpdateOptions,
    void,
    "main-local"
  >("checkForUpdate", "main-local", checkForUpdateOptionsSchema, (options) =>
    checkForUpdateOptionsSchema.parse(options ?? {}),
  ),
  startUpdateDownload: defineNoArgProcedure<void, "main-local">(
    "startUpdateDownload",
    "main-local",
  ),
  installUpdate: defineNoArgProcedure<void, "main-local">("installUpdate", "main-local"),
} as const;
