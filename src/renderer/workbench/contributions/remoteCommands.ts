import { msg as linguiMsg } from '@lingui/core/macro';
import { useAppStore } from '@/renderer/state/appStore';
import { acknowledgeThread, archiveThread, deleteThread, renameThread, toggleMarkThreadDone, toggleStarThread } from '@/renderer/actions/threadActions';
import { deleteWorktreeGroup } from '@/renderer/actions/worktreeActions';
import { primeWorktreeGitState, runWorktreeSetupScript } from '@/renderer/actions/worktreeLaunchActions';
import { getProjectAgentStatuses } from '@/shared/agentStatus';
import { titlePromptFromSegments } from '@/shared/threadTitle';
import { i18n } from '@/renderer/i18n/i18n';
import { generateTitleAsync } from '@/renderer/utils/titleGen';
import { useAgentStatusesStore } from '@/renderer/state/agentStatusesStore';
import type { WorkbenchContribution } from '../lifecycle';
import type { WorkbenchServices } from '../services';

export const remoteCommandsContribution: WorkbenchContribution<WorkbenchServices> = {
 id: 'remote.commands', phase: 'starting',
 activate({services}) { return services.bridge.onRemoteThreadCommand((command) => {
        if (command.kind === "delete-worktree-group") {
          deleteWorktreeGroup(command.projectId, command.worktreePath, command.threadIds);
          return;
        }
        if (command.kind === "prepare-worktree") {
          const project = useAppStore
            .getState()
            .projects.find((entry) => entry.id === command.projectId);
          if (!project) return;
          void primeWorktreeGitState(project, command.worktreePath);
          const setupScript = project.scripts?.setupScript;
          if (setupScript) {
            void runWorktreeSetupScript(project, command.worktreePath, setupScript, {
              openTerminalPanel: false,
            });
          }
          return;
        }
        if (command.kind === "start") {
          const store = useAppStore.getState();
          if (store.threads.some((t) => t.id === command.threadId)) return;
          const project = store.projects.find((p) => p.id === command.projectId);
          if (!project) return;
          const titlePrompt =
            titlePromptFromSegments(command.prompt, command.segments).trim() ||
            i18n._(linguiMsg`New thread`);
          const thread = store.createThread({
            threadId: command.threadId,
            projectId: project.id,
            agentKind: command.agentKind,
            ...(command.agentInstanceId ? { agentInstanceId: command.agentInstanceId } : {}),
            config: command.config,
            prompt: titlePrompt,
            ...(command.title ? { title: command.title } : {}),
            ...(command.presentationMode ? { presentationMode: command.presentationMode } : {}),
            ...(command.worktreePath ? { worktreePath: command.worktreePath } : {}),
            ...(command.worktreeBranch ? { worktreeBranch: command.worktreeBranch } : {}),
            ...(command.prNumber !== undefined ? { prNumber: command.prNumber } : {}),
            ...(command.focus === false ? { focus: false } : {}),
            ...(command.parentThreadId ? { parentThreadId: command.parentThreadId } : {}),
            ...(command.groupId ? { groupId: command.groupId } : {}),
            ...(command.groupName ? { groupName: command.groupName } : {}),
          });
          if (command.launchRuntime !== false) {
            if (command.userMessageItemId) {
              store.queueThreadLaunch(
                thread.id,
                command.prompt,
                command.segments,
                command.userMessageItemId,
              );
            } else {
              store.queueThreadLaunch(thread.id, command.prompt, command.segments);
            }
          }
          const { agentStatuses, wslAgentStatuses } = useAgentStatusesStore.getState();
          const projectAgentStatuses = getProjectAgentStatuses(
            project.location,
            agentStatuses,
            wslAgentStatuses,
          );
          // An explicit title (e.g. an orchestrator-provided ticket key) is
          // authoritative 鈥?don't let AI title generation overwrite it.
          if (!command.title) {
            generateTitleAsync(thread.id, project.location, projectAgentStatuses, titlePrompt);
          }
          if (command.worktreePath) {
            void primeWorktreeGitState(project, command.worktreePath);
          }
          return;
        }
        const thread = useAppStore.getState().threads.find((t) => t.id === command.threadId);
        if (!thread) return;
        switch (command.kind) {
          case "acknowledge":
            acknowledgeThread(command.threadId);
            break;
          case "rename":
            renameThread(command.threadId, command.title);
            break;
          case "set-done":
            if (thread.done !== command.done) toggleMarkThreadDone(command.threadId);
            break;
          case "set-starred":
            if ((thread.starred ?? false) !== command.starred) toggleStarThread(command.threadId);
            break;
          // Orchestrator grouping: pulls the parent thread into the sidebar
          // group its children are created in.
          case "set-group":
            useAppStore.setState((state) => ({
              threads: state.threads.map((t) =>
                t.id === command.threadId
                  ? { ...t, groupId: command.groupId, groupName: command.groupName }
                  : t,
              ),
            }));
            break;
          case "set-worktree": {
            useAppStore
              .getState()
              .setThreadWorktree(command.threadId, command.worktreePath, command.worktreeBranch);
            // A freshly-created remote worktree needs the same desktop-side follow-up
            // a local "new thread in worktree" gets: prime its git state and run the
            // project setup script.
            if (command.isNewWorktree) {
              const project = useAppStore
                .getState()
                .projects.find((p) => p.id === thread.projectId);
              if (project) {
                void primeWorktreeGitState(project, command.worktreePath);
                const setupScript = project.scripts?.setupScript;
                if (setupScript) {
                  void runWorktreeSetupScript(project, command.worktreePath, setupScript, {
                    openTerminalPanel: false,
                  });
                }
              }
            }
            break;
          }
          case "archive":
            archiveThread(command.threadId);
            break;
          case "unarchive":
            useAppStore.getState().unarchiveThread(command.threadId);
            break;
          case "delete":
            // Thread-only delete: remote clients never trigger worktree removal.
            deleteThread(command.threadId);
            break;
        }
      }); }
};
