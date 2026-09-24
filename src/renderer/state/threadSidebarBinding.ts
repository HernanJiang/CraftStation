import { resolveActivePaneId } from "@/renderer/actions/currentProject";
import { useAppStore, type AppStoreState } from "@/renderer/state/appStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";

function focusedThreadId(state: AppStoreState): string | null {
  if (state.view.kind !== "thread") return null;
  return resolveActivePaneId(state.view.panes, state.focusedPaneId);
}

/**
 * Park and restore the right sidebar with the thread that is actually on
 * screen. Open files, the Files project, and which tool tabs are open all
 * belong to that thread. A click that never becomes the focused thread must
 * not take the previous thread's PDF with it.
 */
export function installThreadSidebarBinding(): () => void {
  const currentThreadId = focusedThreadId(useAppStore.getState());
  if (currentThreadId) useFileEditorStore.getState().bindLiveThread(currentThreadId);

  return useAppStore.subscribe((state, previous) => {
    if (!previous) return;
    const nextId = focusedThreadId(state);
    const previousId = focusedThreadId(previous);
    if (nextId === previousId) return;
    if (previousId) {
      usePanelStore.getState().captureThreadAuxiliaryPanel(previousId);
      useFileEditorStore.getState().captureThreadSession(previousId);
    }
    if (nextId) {
      usePanelStore.getState().restoreThreadAuxiliaryPanel(nextId);
      useFileEditorStore.getState().restoreThreadSession(nextId);
    }
  });
}
