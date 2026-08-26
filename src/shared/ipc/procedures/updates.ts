import { defineNoArgProcedure } from "../core";

export const updatesProcedures = {
  checkForUpdate: defineNoArgProcedure<void, "main-local">("checkForUpdate", "main-local"),
  startUpdateDownload: defineNoArgProcedure<void, "main-local">(
    "startUpdateDownload",
    "main-local",
  ),
  installUpdate: defineNoArgProcedure<void, "main-local">("installUpdate", "main-local"),
} as const;
