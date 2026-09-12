import { toast } from '@heroui/react';
import { msg as linguiMsg } from '@lingui/core/macro';
import { i18n } from '@/renderer/i18n/i18n';
import { useAppStore } from '@/renderer/state/appStore';
import { openThread } from '@/renderer/actions/threadActions';
import { startThreadFromDraft } from '@/renderer/actions/threadLaunchActions';
import type { WorkbenchContribution } from '../lifecycle';
import type { WorkbenchServices } from '../services';

export const threadRequestsContribution: WorkbenchContribution<WorkbenchServices> = {
 id: 'thread.requests', phase: 'starting',
 activate({services, scope}) {
      scope.add(services.bridge.onThreadOpenRequested(({ threadId, source }) => {
        openThread(threadId, {
          focusComposer: true,
          ...(source === "notification" ? { switchWorkspace: true } : {}),
        });
      }));
      scope.add(services.bridge.onQuickComposerSubmit((submission) => {
        void (async () => {
          if (!useAppStore.persist.hasHydrated()) await useAppStore.persist.rehydrate();
          if (scope.signal.aborted) return;
          const project = useAppStore
            .getState()
            .projects.find((candidate) => candidate.id === submission.projectId);
          if (!project) {
            toast.warning(i18n._(linguiMsg`Add a project to start`));
            return;
          }
          await startThreadFromDraft(project, submission.input, { preserveActiveGroup: false });
        })().catch((error: unknown) => services.reportError('quick-composer.submit', error));
      }));

 }
};
