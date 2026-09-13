import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProjectLocation } from "@/shared/contracts";
import { normalizeWslListOutput, toWslUncPath, windowsPathToWslLinuxPath } from "@/shared/wsl";
import { getWslCommand } from "../base/shellBasics";

const execFileAsync = promisify(execFile);

/**
 * Meta does not ship a Windows `muse` binary. On a Windows project, launch
 * the WSL install instead and keep the Windows folder mounted at `/mnt/<drive>`.
 */
export function windowsLocationAsWsl(
  location: Extract<ProjectLocation, { kind: "windows" }>,
  distro: string,
): ProjectLocation | undefined {
  const linuxPath = windowsPathToWslLinuxPath(location.path);
  if (!linuxPath) return undefined;
  return {
    kind: "wsl",
    distro,
    linuxPath,
    uncPath: toWslUncPath(distro, linuxPath),
    ...(location.remoteServerId ? { remoteServerId: location.remoteServerId } : {}),
  };
}

export async function listWslDistroNames(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await execFileAsync(getWslCommand(), ["-l", "-q"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8_000,
    });
    return normalizeWslListOutput(stdout ?? "");
  } catch {
    return [];
  }
}

export async function resolveWindowsMuseLaunchLocation(
  location: ProjectLocation,
): Promise<ProjectLocation | undefined> {
  if (location.kind === "wsl") return location;
  if (location.kind !== "windows") return undefined;
  const distro = (await listWslDistroNames())[0];
  if (!distro) return undefined;
  return windowsLocationAsWsl(location, distro);
}
