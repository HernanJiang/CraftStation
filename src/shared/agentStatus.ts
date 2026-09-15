import type { AgentStatus, ProjectLocation, ThreadPresentationMode } from "./contracts";

export function resolveAgentPresentationMode(
  capabilities: {
    presentationMode?: ThreadPresentationMode | undefined;
    presentationModes?: readonly ThreadPresentationMode[] | undefined;
  },
  requested: ThreadPresentationMode | undefined,
): ThreadPresentationMode {
  const fallback = capabilities.presentationMode ?? "gui";
  const supported = capabilities.presentationModes ?? [fallback];
  if (requested && supported.includes(requested)) return requested;
  if (supported.includes(fallback)) return fallback;
  return supported[0] ?? "gui";
}

/**
 * Windows has no `muse` binary. A Windows project can still spawn the WSL
 * Muse install (see `resolveWindowsMuseLaunchLocation`). Other WSL-only
 * CLIs stay out of the Windows project list.
 */
export const WINDOWS_WSL_LAUNCH_FALLBACK_KINDS = ["muse"] as const;

export function getProjectAgentStatuses(
  location: ProjectLocation,
  windowsStatuses: AgentStatus[],
  wslStatuses: AgentStatus[],
): AgentStatus[] {
  if (location.kind !== "wsl") {
    return windowsStatuses;
  }

  const exactMatch = wslStatuses.filter((status) => status.envDistro === location.distro);
  if (exactMatch.length > 0) {
    return exactMatch;
  }

  return wslStatuses.filter((status) => status.envDistro === undefined);
}

/**
 * Agent statuses a project can actually launch, including WSL-only Muse on a
 * Windows folder. Use this for draft pickers and spawn targeting so a Muse
 * Spark pick does not silently fall back to OpenCode.
 */
export function getLaunchableAgentStatuses(
  location: ProjectLocation,
  windowsStatuses: AgentStatus[],
  wslStatuses: AgentStatus[],
): AgentStatus[] {
  const project = getProjectAgentStatuses(location, windowsStatuses, wslStatuses);
  if (location.kind !== "windows") return project;
  const merged = [...project];
  const seen = new Set(project.filter((status) => status.installed).map((status) => status.kind));
  for (const status of wslStatuses) {
    if (!status.installed || seen.has(status.kind)) continue;
    if (!(WINDOWS_WSL_LAUNCH_FALLBACK_KINDS as readonly string[]).includes(status.kind)) {
      continue;
    }
    seen.add(status.kind);
    merged.push(status);
  }
  return merged;
}

/**
 * Build the Settings > Agents navigation list. Native installations take
 * precedence when a provider exists in both native and WSL; WSL-only providers
 * are appended afterward so they remain reachable in the sidebar.
 */
export function getSettingsInstalledAgents(
  windowsStatuses: readonly AgentStatus[],
  wslStatuses: readonly AgentStatus[],
): AgentStatus[] {
  const installedNative = windowsStatuses.filter((status) => status.installed);
  const merged = [...installedNative];
  const seenKinds = new Set(installedNative.map((status) => status.kind));

  for (const status of wslStatuses) {
    if (!status.installed || seenKinds.has(status.kind)) continue;
    seenKinds.add(status.kind);
    merged.push(status);
  }

  return merged;
}
