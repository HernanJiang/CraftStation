import { useEffect, useMemo } from "react";
import { isHomeProject } from "@/shared/homeScope";
import { isProjectInWorkspace } from "@/shared/contracts";
import { useLiveBackgroundThreadIds } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { useActiveWorkspaceId } from "@/renderer/state/workspaceStore";
import { partitionWorkspaceInbox } from "./workspaceInbox";

/** Active-workspace threads that belong in the Workspace section right now. */
export function useWorkspaceInboxThreads() {
  const threads = useAppStore((state) => state.threads);
  const projects = useAppStore((state) => state.projects);
  const dismissedIds = useSidebarUiStore((state) => state.dismissedWorkspaceInboxIds);
  const homeScopeEnabled = useSharedSettings((state) => state.homeScopeEnabled);
  const workspaces = useSharedSettings((state) => state.workspaces);
  const activeWorkspaceId = useActiveWorkspaceId();
  const liveThreadIds = useLiveBackgroundThreadIds(threads);

  const partition = useMemo(() => {
    const knownWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    const allowedProjectIds = new Set<string>();
    for (const project of projects) {
      if (isHomeProject(project)) {
        if (homeScopeEnabled) allowedProjectIds.add(project.id);
        continue;
      }
      if (!isProjectInWorkspace(project, activeWorkspaceId, knownWorkspaceIds)) continue;
      if (project.disabled) continue;
      allowedProjectIds.add(project.id);
    }
    return partitionWorkspaceInbox(threads, { allowedProjectIds, dismissedIds, liveThreadIds });
  }, [
    threads,
    projects,
    dismissedIds,
    homeScopeEnabled,
    workspaces,
    activeWorkspaceId,
    liveThreadIds,
  ]);

  const staleKey = partition.staleDismissalIds.join("\0");
  useEffect(() => {
    if (!staleKey) return;
    useSidebarUiStore.getState().forgetWorkspaceInboxDismissals(staleKey.split("\0"));
  }, [staleKey]);

  return partition.visible;
}
