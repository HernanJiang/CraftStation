import type { WebChatSession } from "@/shared/chatGptWeb";
import { readBridge } from "@/renderer/bridge";
import { openThread } from "@/renderer/actions/threadActions";
import { undockPanelTab } from "@/renderer/actions/panelActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useWebChatStore } from "@/renderer/state/webChatStore";
import { remoteOwner } from "@/renderer/state/remoteProjection";

const siblingTabs = new Map<string, string>();

function showSidebar(tabId: string) {
  useBrowserPanelStore.getState().setActive(tabId);
  undockPanelTab("browser");
  const panels = usePanelStore.getState();
  panels.setBrowserOverlayOpen(false);
  panels.setBrowserPanelOpen(true);
  panels.setRightPanelTab("browser");
  panels.setAuxiliaryPanelPlacement("right");
}

/** Open an independent browser beside the remote page, preserving its live guest. */
export async function openWebChatBeside(session: WebChatSession) {
  const bridge = readBridge();
  const browser = await bridge.browserGetState();
  const url = browser.tabs.find((tab) => tab.tabId === session.tabId)?.url ?? session.url;
  const tab =
    browser.tabs.find((item) => item.tabId === siblingTabs.get(session.id) && item.url === url) ??
    (await bridge.browserCreateTab({ url, activate: true, reveal: false }));
  siblingTabs.set(session.id, tab.tabId);
  await bridge.browserActivateTab({ tabId: tab.tabId });
  showSidebar(tab.tabId);
}

/** Move the current live page beside an existing local thread through normal navigation. */
export async function openWebChatForLocalThread(session: WebChatSession, threadId: string) {
  const thread = useAppStore.getState().threads.find((item) => item.id === threadId);
  if (!thread || thread.archived || remoteOwner(thread)) throw new Error("所选本地对话已不可用。");
  const bridge = readBridge();
  const bound = await bridge.webChatRead({
    sessionId: session.id,
    restoreBinding: true,
    followNavigation: true,
  });
  if (!bound.tabId) throw new Error("网页尚未打开，请稍后重试。");
  const web = useWebChatStore.getState();
  web.setSessions(web.sessions.map((item) => (item.id === bound.id ? bound : item)));
  await bridge.browserActivateTab({ tabId: bound.tabId });
  // Keep the guest mounted while openThread's deferred navigation restores the target sidebar.
  showSidebar(bound.tabId);
  await new Promise<void>((resolve, reject) => {
    const tabId = bound.tabId!;
    const opened = () => {
      const app = useAppStore.getState();
      return (
        app.view.kind === "thread" &&
        app.view.panes.includes(threadId) &&
        app.focusedPaneId === threadId
      );
    };
    const finish = () => {
      if (!opened()) return;
      unsubscribe();
      clearTimeout(timer);
      showSidebar(tabId);
      resolve();
    };
    const unsubscribe = useAppStore.subscribe(finish);
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("本地对话未能打开，请重试。"));
    }, 15_000);
    openThread(threadId, { focusComposer: false, switchWorkspace: true });
    finish();
  });
}
