import { create } from "zustand";
import { useAppStore } from "./appStore";
import { usePanelStore } from "./panelStore";
import type { WebChatSession } from "@/shared/chatGptWeb";

export const webChatNavigationKey = () => JSON.stringify(useAppStore.getState().view);

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
  sessions: WebChatSession[];
  selectedSessionId: string | undefined;
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
  sessions: [],
  selectedSessionId: undefined,
  deleteRequestId: undefined,
  setSessions: (sessions) => set({ sessions }),
  selectSession: (selectedSessionId) => set({ selectedSessionId, isDraft: false }),
  openSession: (selectedSessionId, requestDelete = false) => {
    hideBrowser();
    set({
      open: true,
      selectedSessionId,
      isDraft: false,
      deleteRequestId: requestDelete ? selectedSessionId : undefined,
      navigationKey: webChatNavigationKey(),
    });
  },
  clearDeleteRequest: () => set({ deleteRequestId: undefined }),
  setOpen: (open) => {
    if (open) hideBrowser();
    set({ open, navigationKey: webChatNavigationKey() });
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
