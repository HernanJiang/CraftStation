import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { MAIN_CONTENT_DIALOG_PORTAL_ID } from "@/renderer/components/layout/layoutHeaderPortals";
import type { BrowserState } from "@/shared/ipc";
import type { WebChatSession } from "@/shared/chatGptWeb";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { useWebChatStore, WEB_REMOTE_SCOPE } from "@/renderer/state/webChatStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { WebChatRemoteDialog } from "./WebChatRemoteDialog";

const mocks = vi.hoisted(() => ({
  newChat: vi.fn<() => void>(),
  browserGetState: vi.fn<() => Promise<BrowserState>>(),
  browserCreateTab:
    vi.fn<(request: { url: string; activate: boolean }) => Promise<{ tabId: string }>>(),
  browserActivateTab: vi.fn<(request: { tabId: string }) => Promise<void>>(),
  webChatImport: vi.fn<() => Promise<WebChatSession>>(),
  webChatReveal: vi.fn<(request: { sessionId: string }) => Promise<void>>(),
}));
vi.mock("@/renderer/bridge", () => ({ readBridge: () => mocks }));
vi.mock("@/renderer/actions/threadActions", () => ({ openNewWebChat: mocks.newChat }));
vi.mock("@/renderer/actions/panelActions", () => ({
  undockPanelTab: vi.fn<(tab: string) => void>(),
}));
const state: BrowserState = {
  activeTabId: "source-tab",
  tabs: [
    {
      tabId: "source-tab",
      url: "https://chatgpt.com/c/selected-conversation",
      title: "选择的会话",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
  ],
};
const session: WebChatSession = {
  id: "00000000-0000-4000-8000-000000000002",
  url: state.tabs[0]!.url,
  title: "选择的会话",
  status: "ready",
  tabId: "source-tab",
  messages: [],
};

beforeEach(() => {
  const target = document.createElement("div");
  target.id = MAIN_CONTENT_DIALOG_PORTAL_ID;
  document.body.append(target);
  mocks.browserGetState.mockResolvedValue(state);
  mocks.browserActivateTab.mockResolvedValue(undefined);
  mocks.browserCreateTab.mockResolvedValue({ tabId: "new-browser-tab" });
  mocks.webChatImport.mockResolvedValue(session);
  mocks.webChatReveal.mockResolvedValue(undefined);
  useBrowserPanelStore.getState().setState(state);
  useWebChatStore.setState({
    open: false,
    sessions: [],
    selectedSessionId: undefined,
    nativeView: false,
  });
  usePanelStore.setState({ browserPanelOpen: false, auxiliaryPanelPlacement: "hidden" });
});
afterEach(() => {
  cleanup();
  document.getElementById(MAIN_CONTENT_DIALOG_PORTAL_ID)?.remove();
  vi.resetAllMocks();
});

it("先选择创建方式，取消不创建；新建使用现有网页草稿入口", () => {
  const close = vi.fn<() => void>();
  render(<WebChatRemoteDialog onClose={close} />);
  expect(screen.getByTestId("webchat-remote-new")).toBeInTheDocument();
  expect(screen.getByTestId("webchat-remote-sync")).toBeInTheDocument();
  expect(mocks.browserGetState).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("webchat-remote-new"));
  expect(mocks.newChat).toHaveBeenCalledTimes(1);
  expect(mocks.webChatImport).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});

it("同步打开右侧源网页，左侧引导不阻止网页操作；确认后才导入并展开选中远程线程", async () => {
  const close = vi.fn<() => void>();
  render(<WebChatRemoteDialog onClose={close} />);
  fireEvent.click(screen.getByTestId("webchat-remote-sync"));
  await waitFor(() => expect(screen.getByTestId("webchat-import-current")).toBeEnabled());
  expect(screen.getByTestId("webchat-import-guide")).toHaveAttribute("aria-modal", "false");
  expect(mocks.browserActivateTab).toHaveBeenCalledWith({ tabId: "source-tab" });
  expect(usePanelStore.getState().auxiliaryPanelPlacement).toBe("right");
  expect(usePanelStore.getState().browserPanelOpen).toBe(true);
  expect(mocks.webChatImport).not.toHaveBeenCalled();
  useSidebarUiStore.getState().setProjectCollapsed(WEB_REMOTE_SCOPE, true);
  fireEvent.click(screen.getByTestId("webchat-import-current"));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(mocks.webChatImport).toHaveBeenCalledWith({ url: session.url, tabId: "source-tab" });
  expect(mocks.webChatReveal).toHaveBeenCalledWith({ sessionId: session.id });
  expect(useWebChatStore.getState().selectedSessionId).toBe(session.id);
  expect(useSidebarUiStore.getState().collapsedProjects[WEB_REMOTE_SCOPE]).toBe(false);
});

it("无会话时打开登录页并等待；导入重新检查当前网页，拒绝过期预览", async () => {
  mocks.browserGetState.mockResolvedValueOnce({ tabs: [], activeTabId: null });
  useBrowserPanelStore.getState().setState({ tabs: [], activeTabId: null });
  render(<WebChatRemoteDialog onClose={vi.fn<() => void>()} />);
  fireEvent.click(screen.getByTestId("webchat-remote-sync"));
  await waitFor(() =>
    expect(mocks.browserCreateTab).toHaveBeenCalledWith({
      url: "https://chatgpt.com/",
      activate: true,
    }),
  );
  expect(screen.getByTestId("webchat-import-current")).toBeDisabled();
  useBrowserPanelStore.getState().setState(state);
  await waitFor(() => expect(screen.getByTestId("webchat-import-current")).toBeEnabled());
  mocks.browserGetState.mockResolvedValue({
    ...state,
    tabs: [{ ...state.tabs[0]!, url: "https://chatgpt.com/" }],
  });
  fireEvent.click(screen.getByTestId("webchat-import-current"));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(mocks.webChatImport).not.toHaveBeenCalled();
  expect(useWebChatStore.getState().sessions).toHaveLength(0);
});

it("原样视图确认导入后把源网页移入主卡片，不再次展开右侧栏", async () => {
  useWebChatStore.setState({ nativeView: true });
  const close = vi.fn<() => void>();
  render(<WebChatRemoteDialog onClose={close} />);
  fireEvent.click(screen.getByTestId("webchat-remote-sync"));
  await waitFor(() => expect(screen.getByTestId("webchat-import-current")).toBeEnabled());
  fireEvent.click(screen.getByTestId("webchat-import-current"));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(mocks.webChatImport).toHaveBeenCalledWith({ url: session.url, tabId: "source-tab" });
  expect(mocks.webChatReveal).not.toHaveBeenCalled();
  expect(usePanelStore.getState().browserPanelOpen).toBe(false);
  expect(useWebChatStore.getState().selectedSessionId).toBe(session.id);
});

it("导入失败保留引导并可重试，重复同步复用已有线程", async () => {
  useWebChatStore.setState({ sessions: [session] });
  mocks.webChatImport.mockRejectedValueOnce(new Error("WEB_IMPORT_PAGE_CHANGED"));
  const close = vi.fn<() => void>();
  render(<WebChatRemoteDialog onClose={close} />);
  fireEvent.click(screen.getByTestId("webchat-remote-sync"));
  await waitFor(() => expect(screen.getByTestId("webchat-import-current")).toBeEnabled());
  fireEvent.click(screen.getByTestId("webchat-import-current"));
  expect(await screen.findByRole("alert")).toHaveTextContent("WEB_IMPORT_PAGE_CHANGED");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("webchat-import-current"));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(useWebChatStore.getState().sessions).toHaveLength(1);
});
