import { homedir } from "node:os";
import type { ProjectLocation } from "@/shared/contracts";
import { getWindowsSystemCommand, getWslCommand } from "../../agents/base";
import { isLaunchableWindowsBinary, type WindowsShellPreference } from "../../shellPreference";

/**
 * Resolve the command/args (and cwd) that spawn a plain interactive shell for a
 * project. WSL projects land in the distro (home or worktree); native projects
 * use the configured Windows shell preference or the login shell on posix.
 * Extracted from `ThreadSessionManager`.
 */
export function buildShellCommand(
  location: ProjectLocation,
  windowsShell: WindowsShellPreference,
  options?: { startInHome?: boolean; cwdOverride?: string },
): {
  command: string;
  args: string[];
  cwd?: string;
} {
  const startInHome = options?.startInHome === true;
  const cwdOverride = options?.cwdOverride?.trim();
  if (location.kind === "wsl") {
    // `wsl --cd ~` lands in the distro's Linux home; otherwise the worktree.
    return {
      command: getWslCommand(),
      args: ["-d", location.distro, "--cd", startInHome ? "~" : location.linuxPath],
    };
  }

  if (process.platform === "win32") {
    return {
      command: windowsShell.shell,
      args: [...windowsShell.args],
      cwd: cwdOverride || (startInHome ? homedir() : location.path),
    };
  }

  const shell = process.env.SHELL || "/bin/bash";
  return {
    command: shell,
    args: ["-l"],
    cwd: cwdOverride || (startInHome ? homedir() : location.path),
  };
}

/**
 * If the preferred Windows shell is missing or unspawnable (stale PowerShell 7
 * path is the usual case), keep login/install overlays alive with Windows
 * PowerShell 5.1 and then cmd.exe.
 */
export function windowsShellSpawnFallbacks(
  primary: WindowsShellPreference,
  pathExists: (path: string) => boolean = isLaunchableWindowsBinary,
): WindowsShellPreference[] {
  const seen = new Set([primary.shell.replaceAll("/", "\\").toLowerCase()]);
  const extras: WindowsShellPreference[] = [];
  const add = (pref: WindowsShellPreference) => {
    const key = pref.shell.replaceAll("/", "\\").toLowerCase();
    if (seen.has(key) || !pathExists(pref.shell)) return;
    seen.add(key);
    extras.push(pref);
  };
  add({
    shell: getWindowsSystemCommand("WindowsPowerShell\\v1.0\\powershell.exe"),
    kind: "powershell",
    args: ["-NoLogo"],
  });
  add({
    shell: getWindowsSystemCommand("cmd.exe"),
    kind: "cmd",
    args: [],
  });
  return extras;
}
