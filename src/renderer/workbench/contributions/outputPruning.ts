import { useAppStore } from '@/renderer/state/appStore';
import { useDevTerminalStore } from '@/renderer/state/devTerminalStore';
import { useThreadOutputStore } from '@/renderer/state/threadOutputStore';
import type { WorkbenchContribution } from '../lifecycle';
import type { WorkbenchServices } from '../services';

function installThreadOutputPruning(): () => void {
  const retainActiveOutputs = () => {
    const threadIds = new Set(useAppStore.getState().threads.map((thread) => thread.id));
    for (const tab of useDevTerminalStore.getState().tabs) {
      if (tab.runActionId) threadIds.add(tab.id);
    }
    useThreadOutputStore.getState().retainOutputs(threadIds);
  };
  const unsubscribeThreads = useAppStore.subscribe((state, previousState) => {
    if (state.threads !== previousState.threads) retainActiveOutputs();
  });
  const unsubscribeTerminals = useDevTerminalStore.subscribe((state, previousState) => {
    if (state.tabs !== previousState.tabs) retainActiveOutputs();
  });
  return () => {
    unsubscribeThreads();
    unsubscribeTerminals();
  };
}


export const outputPruningContribution: WorkbenchContribution<WorkbenchServices> = {
 id: 'runtime.output-pruning', phase: 'starting', activate: installThreadOutputPruning,
};
