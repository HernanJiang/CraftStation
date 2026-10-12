import { create } from "zustand";
import { useAppStore } from "./appStore";
import { usePanelStore } from "./panelStore";
import { useSidebarUiStore } from "./sidebarUiStore";
import { useSidebarOverlayStore } from "./sidebarOverlayStore";
import { chatGptConversationUrl, type WebChatSession } from "@/shared/chatGptWeb";

export const webChatNavigationKey = () => JSON.stringify(useAppStore.getState().view);
export const WEB_REMOTE_SCOPE = "__craftstation_web_remote__";

function revealRemoteSession() {
  useSidebarUiStore.getState().setProjectCollapsed(WEB_REMOTE_SCOPE, false);
  if (!useSidebarOverlayStore.getState().isNarrow)
    useSidebarOverlayStore.getState().setCollapsed(false);
}

function hideBrowser() {
  const panels = usePanelStore.getState();
  panels.setBrowserPanelOpen(false);
  panels.setBrowserOverlayOpen(false);
}

export const useWebChatStore = create<{
  open: boolean;
  navigationKey: string;
  projectId: string | undefined;
  draftVersion: number;
  isDraft: boolean;
  inheritLocalDraft: boolean;
  nativeView: boolean;
  setNativeView: (nativeView: boolean) => void;
  sessions: WebChatSession[];
  selectedSessionId: string | undefined;
  sessionOpenVersion: number;
  deleteRequestId: string | undefined;
  setSessions: (sessions: WebChatSession[]) => void;
  selectSession: (id: string) => void;
  openSession: (id: string, requestDelete?: boolean) => void;
  clearDeleteRequest: () => void;
  setOpen: (open: boolean) => void;
  startDraft: (projectId?: string, inheritLocalDraft?: boolean) => void;
  setProjectId: (projectId: string) => void;
  finishDraft: () => void;
}>((set) => ({
  open: false,
  navigationKey: "",
  projectId: undefined,
  draftVersion: 0,
  isDraft: false,
  inheritLocalDraft: false,
  nativeView: true,
  setNativeView: (nativeView) => {
    if (nativeView) hideBrowser();
    set({ nativeView });
  },
  sessions: [],
  selectedSessionId: undefined,
  sessionOpenVersion: 0,
  deleteRequestId: undefined,
  setSessions: (sessions) => set({ sessions }),
  selectSession: (selectedSessionId) => {
    revealRemoteSession();
    set({ selectedSessionId, isDraft: false });
  },
  openSession: (selectedSessionId, requestDelete = false) => {
    hideBrowser();
    revealRemoteSession();
    set((state) => ({
      open: true,
      selectedSessionId,
      sessionOpenVersion: state.sessionOpenVersion + 1,
      isDraft: false,
      deleteRequestId: requestDelete ? selectedSessionId : undefined,
      navigationKey: webChatNavigationKey(),
    }));
  },
  clearDeleteRequest: () => set({ deleteRequestId: undefined }),
  setOpen: (open) => {
    if (open) hideBrowser();
    const navigationKey = webChatNavigationKey();
    set((state) => ({
      open,
      navigationKey,
      ...(open
        ? {
            isDraft: false,
            selectedSessionId: state.sessions.some(
              (s) =>
                s.id === state.selectedSessionId &&
                (chatGptConversationUrl(s.url) ||
                  (state.open && state.navigationKey === navigationKey)),
            )
              ? state.selectedSessionId
              : undefined,
          }
        : {}),
    }));
  },
  startDraft: (projectId, inheritLocalDraft = false) => {
    hideBrowser();
    set((state) => ({
      open: true,
      projectId,
      isDraft: true,
      inheritLocalDraft,
      selectedSessionId: undefined,
      draftVersion: state.draftVersion + 1,
      navigationKey: webChatNavigationKey(),
    }));
  },
  setProjectId: (projectId) => set({ projectId }),
  finishDraft: () => set({ isDraft: false }),
}));
