import { mkdirSync } from "node:fs";
import type { ProjectLocation } from "@/shared/contracts";
import { isHomeScopeLocation } from "@/shared/homeScope";
import { toWslUncPath } from "@/shared/wsl";

/**
 * Ensure a projectless thread's isolated working directory exists before a
 * provider process receives it as cwd. Real project locations are never
 * created implicitly; a missing real project must remain an explicit error.
 */
export function ensureThreadWorkspace(location: ProjectLocation, workspace: string): void {
  if (!isHomeScopeLocation(location)) return;
  const nativePath =
    location.kind === "wsl" && process.platform === "win32"
      ? toWslUncPath(location.distro, workspace)
      : workspace;
  mkdirSync(nativePath, { recursive: true });
}
