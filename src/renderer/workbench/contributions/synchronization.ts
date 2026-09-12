import { useAppStore } from '@/renderer/state/appStore';
import { useExperimentStore } from '@/renderer/state/experimentStore';
import { useGitReadModelStore } from '@/renderer/state/gitReadModelStore';
import { applyExternalSharedSettings } from '@/renderer/state/sharedSettingsStore';
import { normalizeSharedSettings } from '@/shared/settings';
import { installRemoteGitSummaryPublisher } from '@/renderer/remoteGitSummaries';
import { installRemoteProjectWorkspaceSync } from '@/renderer/state/remoteServersStore';
import type { WorkbenchContribution } from '../lifecycle';
import type { WorkbenchServices } from '../services';

export const synchronizationContribution: WorkbenchContribution<WorkbenchServices> = {
 id: 'project.settings-git-sync', phase: 'starting',
 activate({services, scope}) {
      // Settings rewritten outside this renderer (remote clients editing desktop
      // settings over the remote API) 鈥?apply without echoing a persist.
      scope.add(services.bridge.onSharedSettingsChanged((settings) => {
        applyExternalSharedSettings(normalizeSharedSettings(settings));
      }));
      // Main-process project mutations must reach this whole-store snapshot
      // before its next dbSyncAll persistence write.
      scope.add(services.bridge.onProjectStateChanged(({ projects }) => {
        useAppStore.setState({ projects });
        useExperimentStore
          .getState()
          .reconcileExperiments(new Set(projects.map((project) => project.id)));
      }));
      scope.add(services.bridge.onGitStateChanged((patch) => {
        useGitReadModelStore.getState().applyPatch(patch);
      }));

 scope.add(installRemoteGitSummaryPublisher());
 scope.add(installRemoteProjectWorkspaceSync());
 }
};
