import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import type { WebChatSession, WebChatConversation } from "@/shared/chatGptWeb";
import type { BrowserState } from "@/shared/ipc";
import { ChatGptWebPage } from "./ChatGptWebPage";
import { useWebChatStore, WEB_REMOTE_SCOPE } from "@/renderer/state/webChatStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { WEB_CHAT_HEADER_PORTAL_ID } from "@/renderer/components/layout/layoutHeaderPortals";

const bridge = vi.hoisted(() => ({
  webChatList: vi.fn<() => Promise<WebChatSession[]>>(),
  browserGetState: vi.fn<() => Promise<BrowserState>>(),
  browserReload: vi.fn<(request: { tabId: string }) => Promise<void>>(),
  webChatCreate: vi.fn<() => Promise<WebChatSession>>(),
  webChatRead:
    vi.fn<
      (request: {
        sessionId: string;
        restoreBinding?: boolean;
        followNavigation?: boolean;
      }) => Promise<WebChatSession>
    >(),
  webChatSend: vi.fn<() => Promise<WebChatSession>>(),
  webChatDiscover: vi.fn<(request: { sessionId: string }) => Promise<WebChatConversation[]>>(),
  webChatImport: vi.fn<(request: { url: string }) => Promise<WebChatSession>>(),
  webChatReveal: vi.fn<(request: { sessionId: string }) => Promise<void>>(),
  webChatRefresh:
    vi.fn<
      (request: { sessionId: string; followNavigation?: boolean }) => Promise<WebChatSession>
    >(),
  webChatDelete: vi.fn<() => Promise<void>>(),
}));

beforeEach(() => {
  useWebChatStore.setState({ nativeView: false, open: false, navigationKey: "" });
  const header = document.createElement("div");
  header.id = WEB_CHAT_HEADER_PORTAL_ID;
  document.body.append(header);
  HTMLElement.prototype.scrollIntoView = vi.fn<() => void>();
  bridge.webChatDiscover.mockResolvedValue([]);
  bridge.browserGetState.mockResolvedValue({ tabs: [], activeTabId: null });
  bridge.browserReload.mockResolvedValue(undefined);
  bridge.webChatReveal.mockResolvedValue(undefined);
});
vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridge }));
vi.mock("@/renderer/hooks/uiSelectors", () => ({ useCurrentProjectId: () => undefined }));
vi.mock("@/renderer/components/thread/ThreadComposer", () => ({
  ThreadComposer: (props: {
    prompt: string;
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
  }) => (
    <div>
      <input
        aria-label="测试输入"
        value={props.prompt}
        onChange={(e) => props.onPromptChange(e.target.value)}
      />
      <button type="button" onClick={props.onSubmit}>
        测试发送
      </button>
    </div>
  ),
}));
vi.mock("@/renderer/components/thread/UniversalDockedChatInput", () => ({
  UniversalDockedChatInput: ({
    children,
    rightActions,
    afterContextBar,
  }: {
    children: ReactNode;
    rightActions: ReactNode;
    afterContextBar: ReactNode;
  }) => (
    <div>
      {rightActions}
      {afterContextBar}
      {children}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  document.getElementById(WEB_CHAT_HEADER_PORTAL_ID)?.remove();
  vi.resetAllMocks();
  useWebChatStore.setState({ sessions: [], selectedSessionId: undefined, isDraft: false });
});

it("发送遇到断连后，下一次同步成功会清除旧的连接错误并保留输入", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn<() => void>();
  const session: WebChatSession = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "测试网页",
    url: "https://chatgpt.com/",
    status: "ready",
    messages: [],
  };
  let failed = false;
  let recover!: (value: WebChatSession) => void;
  const recovered = new Promise<WebChatSession>((resolve) => {
    recover = resolve;
  });
  bridge.webChatList.mockResolvedValue([session]);
  bridge.webChatRead.mockImplementation(async () => (failed ? recovered : session));
  bridge.webChatSend.mockImplementation(async () => {
    failed = true;
    throw new Error("WEB_DISCONNECTED：网页暂时断开");
  });
  useWebChatStore.setState({ sessions: [session], selectedSessionId: session.id, isDraft: false });
  renderWithI18n(<ChatGptWebPage />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Connected|已连接/));
  fireEvent.change(screen.getByRole("textbox", { name: "测试输入" }), {
    target: { value: "保留这条草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "测试发送" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("WEB_DISCONNECTED");
  recover(session);
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("textbox", { name: "测试输入" })).toHaveValue("保留这条草稿");
  expect(bridge.webChatSend).toHaveBeenCalledTimes(1);
});

const connected: WebChatSession = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "当前对话",
  url: "https://chatgpt.com/c/current-conversation",
  status: "ready",
  messages: [],
};

it("原样网页新建会话，不显示下方输入框、控制栏或视图切换按钮", async () => {
  useWebChatStore.setState({
    nativeView: true,
    isDraft: true,
    sessions: [],
    selectedSessionId: undefined,
  });
  bridge.webChatList.mockResolvedValue([]);
  bridge.webChatCreate.mockResolvedValue({ ...connected, tabId: "native-tab" });
  bridge.webChatRead.mockResolvedValue({ ...connected, tabId: "native-tab" });
  renderWithI18n(<ChatGptWebPage />);
  await waitFor(() => expect(bridge.webChatCreate).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("webchat-native-view")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "测试输入" })).not.toBeInTheDocument();
  await waitFor(() => expect(useWebChatStore.getState().selectedSessionId).toBe(connected.id));
  expect(screen.queryByTestId("webchat-view-toggle")).not.toBeInTheDocument();
  expect(screen.queryByTestId("webchat-controls")).not.toBeInTheDocument();
  expect(screen.getByTestId("chatgpt-web-page").querySelector("footer")).toBeNull();
  expect(bridge.webChatCreate).toHaveBeenCalledTimes(1);
  expect(bridge.webChatSend).not.toHaveBeenCalled();
});

it("原样网页同步失败或停在生成状态时，刷新仍直接重载当前网页", async () => {
  const session = { ...connected, tabId: "native-tab", status: "streaming" as const };
  useWebChatStore.setState({
    nativeView: true,
    sessions: [session],
    selectedSessionId: session.id,
  });
  bridge.webChatList.mockResolvedValue([session]);
  bridge.webChatRead.mockRejectedValue(new Error("WEB_PAGE_CHANGED：网页结构已变化"));
  renderWithI18n(<ChatGptWebPage />);
  const button = await screen.findByTestId("webchat-header-refresh");
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(bridge.browserReload).toHaveBeenCalledWith({ tabId: session.tabId }));
  expect(bridge.webChatRefresh).not.toHaveBeenCalled();
  expect(useWebChatStore.getState().selectedSessionId).toBe(session.id);
});

it("原样网页右上角使用刷新按钮，刷新当前绑定并同步新名称", async () => {
  const session = { ...connected, tabId: "native-tab" };
  const renamed = { ...session, title: "网页上的新名称" };
  useWebChatStore.setState({
    nativeView: true,
    sessions: [session],
    selectedSessionId: session.id,
  });
  bridge.webChatList.mockResolvedValue([session]);
  bridge.webChatRead.mockResolvedValue(session);
  bridge.browserReload.mockImplementation(async () => {
    bridge.webChatRead.mockResolvedValue(renamed);
  });
  renderWithI18n(<ChatGptWebPage />);
  const button = await screen.findByRole("button", { name: /刷新网页|Refresh webpage/ });
  expect(screen.queryByTestId("webchat-conversations-toggle")).toBeNull();
  expect(button.closest(`#${WEB_CHAT_HEADER_PORTAL_ID}`)).not.toBeNull();
  fireEvent.click(button);
  await waitFor(() => expect(bridge.browserReload).toHaveBeenCalledWith({ tabId: session.tabId }));
  await waitFor(() => expect(useWebChatStore.getState().sessions[0]?.title).toBe(renamed.title));
  expect(useWebChatStore.getState().selectedSessionId).toBe(session.id);
  expect(bridge.webChatCreate).not.toHaveBeenCalled();
  expect(bridge.webChatReveal).not.toHaveBeenCalled();
});

it("已打开的新建网页再次点击顶部入口，保留当前线程并继续同步名称", async () => {
  const blank = { ...connected, url: "https://chatgpt.com/", title: "新对话", tabId: "native-tab" };
  useWebChatStore.setState({ nativeView: true, sessions: [blank], selectedSessionId: blank.id });
  useWebChatStore.getState().openSession(blank.id);
  bridge.webChatList.mockResolvedValue([blank]);
  bridge.webChatRead.mockResolvedValue(blank);
  renderWithI18n(<ChatGptWebPage />);
  await waitFor(() => expect(bridge.webChatRead).toHaveBeenCalledTimes(1));
  act(() => useWebChatStore.getState().setOpen(true));
  expect(useWebChatStore.getState().selectedSessionId).toBe(blank.id);
  bridge.webChatRead.mockResolvedValue({ ...blank, url: connected.url, title: "网页生成的名称" });
  await waitFor(() =>
    expect(useWebChatStore.getState().sessions.find((s) => s.id === blank.id)?.title).toBe(
      "网页生成的名称",
    ),
  );
  expect(bridge.webChatCreate).not.toHaveBeenCalled();
});

it("刷新结果晚于左侧线程切换时，只更新原线程，不抢回选中项", async () => {
  const other = {
    ...connected,
    id: "00000000-0000-4000-8000-000000000002",
    title: "另一对话",
    tabId: "other-tab",
  };
  let finish!: (session: WebChatSession) => void;
  const result = new Promise<WebChatSession>((resolve) => {
    finish = resolve;
  });
  useWebChatStore.setState({
    nativeView: true,
    sessions: [connected, other],
    selectedSessionId: connected.id,
  });
  bridge.webChatList.mockResolvedValue([connected, other]);
  bridge.webChatRead.mockImplementation(async ({ sessionId }) =>
    sessionId === other.id ? other : connected,
  );
  bridge.webChatRefresh.mockReturnValue(result);
  renderWithI18n(<ChatGptWebPage />);
  fireEvent.click(await screen.findByTestId("webchat-header-refresh"));
  await waitFor(() => expect(bridge.webChatRefresh).toHaveBeenCalledTimes(1));
  useWebChatStore.getState().openSession(other.id);
  finish({ ...connected, title: "原对话更新" });
  await waitFor(() =>
    expect(useWebChatStore.getState().sessions.find((s) => s.id === connected.id)?.title).toBe(
      "原对话更新",
    ),
  );
  expect(useWebChatStore.getState().selectedSessionId).toBe(other.id);
  expect(useWebChatStore.getState().sessions.find((s) => s.id === other.id)?.title).toBe(
    other.title,
  );
});

it("默认复用侧边浏览器已打开的对话并选中对应远程线程，不创建空白页", async () => {
  const blank = { ...connected, url: "https://chatgpt.com/" };
  useWebChatStore.setState({
    nativeView: true,
    isDraft: true,
    sessions: [blank],
    selectedSessionId: blank.id,
  });
  useWebChatStore.getState().setOpen(true);
  bridge.webChatList.mockResolvedValue([blank]);
  bridge.browserGetState.mockResolvedValue({
    activeTabId: "verified-tab",
    tabs: [
      {
        tabId: "verified-tab",
        url: connected.url,
        title: connected.title,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        devToolsOpen: false,
      },
    ],
  });
  const imported = { ...connected, tabId: "verified-tab" };
  bridge.webChatImport.mockResolvedValue(imported);
  bridge.webChatRead.mockResolvedValue(imported);
  renderWithI18n(<ChatGptWebPage />);
  await waitFor(() => expect(useWebChatStore.getState().selectedSessionId).toBe(connected.id));
  expect(bridge.webChatImport).toHaveBeenCalledWith({ url: connected.url, tabId: "verified-tab" });
  expect(bridge.webChatCreate).not.toHaveBeenCalled();
});

it("删除最后一个线程会清除选中绑定，不再轮询已经删除的会话", async () => {
  let deleted = false;
  bridge.webChatList.mockImplementation(async () => (deleted ? [] : [connected]));
  bridge.webChatRead.mockImplementation(async () => {
    if (deleted) throw new Error("WEB_SESSION_NOT_FOUND");
    return connected;
  });
  bridge.webChatDelete.mockImplementation(async () => {
    deleted = true;
  });
  useWebChatStore.setState({
    nativeView: false,
    sessions: [connected],
    selectedSessionId: connected.id,
    isDraft: false,
  });
  renderWithI18n(<ChatGptWebPage />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Connected|已连接/));
  useWebChatStore.getState().openSession(connected.id, true);
  fireEvent.click(
    await screen.findByRole("button", { name: /Delete original conversation|删除原对话/ }),
  );
  await waitFor(() => expect(useWebChatStore.getState().selectedSessionId).toBeUndefined());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("左侧明确选择的线程优先于其他网页，旧线程迟到的读取不能改回选中项", async () => {
  const other = {
    ...connected,
    id: "00000000-0000-4000-8000-000000000002",
    title: "另一线程",
    url: "https://chatgpt.com/c/another-conversation",
    tabId: "other-tab",
  };
  let resolveOld!: (value: WebChatSession) => void;
  const oldRead = new Promise<WebChatSession>((resolve) => {
    resolveOld = resolve;
  });
  useWebChatStore.setState({
    nativeView: true,
    sessions: [connected, other],
    selectedSessionId: connected.id,
  });
  bridge.webChatList.mockResolvedValue([connected, other]);
  bridge.webChatRead.mockImplementation(({ sessionId }) =>
    sessionId === connected.id ? oldRead : Promise.resolve(other),
  );
  renderWithI18n(<ChatGptWebPage />);
  await waitFor(() =>
    expect(bridge.webChatRead).toHaveBeenCalledWith({
      sessionId: connected.id,
      restoreBinding: true,
      followNavigation: true,
    }),
  );
  useWebChatStore.getState().openSession(other.id);
  resolveOld(connected);
  await waitFor(() =>
    expect(bridge.webChatRead).toHaveBeenCalledWith({
      sessionId: other.id,
      restoreBinding: true,
      followNavigation: true,
    }),
  );
  expect(useWebChatStore.getState().selectedSessionId).toBe(other.id);
  expect(bridge.webChatImport).not.toHaveBeenCalled();
  expect(bridge.webChatCreate).not.toHaveBeenCalled();
});

it("发送前快照仍为 ready、提交发现已退出登录时，打开对应登录页并保留草稿", async () => {
  bridge.webChatList.mockResolvedValue([connected]);
  bridge.webChatRead.mockResolvedValue(connected);
  bridge.webChatSend.mockRejectedValue(new Error("WEB_LOGIN_REQUIRED：请打开网页并登录 ChatGPT。"));
  useWebChatStore.setState({
    sessions: [connected],
    selectedSessionId: connected.id,
    isDraft: false,
  });
  renderWithI18n(<ChatGptWebPage />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Connected|已连接/));
  fireEvent.change(screen.getByRole("textbox", { name: "测试输入" }), {
    target: { value: "保留登录前草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "测试发送" }));
  await waitFor(() => expect(bridge.webChatSend).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(bridge.webChatReveal).toHaveBeenCalledWith({ sessionId: connected.id }),
  );
  expect(screen.getByRole("textbox", { name: "测试输入" })).toHaveValue("保留登录前草稿");
  expect(bridge.webChatSend).toHaveBeenCalledTimes(1);
});

it("打开与刷新紧邻底部连接状态，移除新对话按钮，点击展开远程线程且刷新保留草稿", async () => {
  bridge.webChatList.mockResolvedValue([connected]);
  bridge.webChatRead.mockResolvedValue(connected);
  bridge.webChatRefresh.mockResolvedValue(connected);
  useWebChatStore.setState({
    sessions: [connected],
    selectedSessionId: connected.id,
    isDraft: false,
  });
  renderWithI18n(<ChatGptWebPage />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Connected|已连接/));
  expect(screen.getByTestId("webchat-reveal").closest("footer")).not.toBeNull();
  expect(screen.getByTestId("webchat-refresh").closest("footer")).not.toBeNull();
  expect(screen.getByTestId("webchat-reveal")).toHaveTextContent(
    /Open original remote web conversation|打开原远程网页对话/,
  );
  expect(screen.getByTestId("webchat-refresh")).toHaveTextContent(/Refresh webpage|刷新网页/);
  expect(document.getElementById(WEB_CHAT_HEADER_PORTAL_ID)).toContainElement(
    screen.getByTestId("webchat-conversations-toggle"),
  );
  const controls = screen.getByTestId("webchat-controls");
  expect(controls).toContainElement(screen.getByRole("status"));
  expect(controls.lastElementChild).toBe(screen.getByRole("status"));
  expect(screen.queryByRole("button", { name: /New conversation|新对话/ })).not.toBeInTheDocument();
  expect(document.querySelector("header select")).toBeNull();
  expect(
    screen.queryByText(/Import an existing conversation|导入已有对话/),
  ).not.toBeInTheDocument();
  useSidebarUiStore.getState().setProjectCollapsed(WEB_REMOTE_SCOPE, true);
  fireEvent.click(screen.getByTestId("webchat-reveal"));
  await waitFor(() =>
    expect(bridge.webChatReveal).toHaveBeenCalledWith({ sessionId: connected.id }),
  );
  expect(useSidebarUiStore.getState().collapsedProjects[WEB_REMOTE_SCOPE]).toBe(false);
  fireEvent.change(screen.getByRole("textbox", { name: "测试输入" }), {
    target: { value: "保留草稿" },
  });
  useSidebarUiStore.getState().setProjectCollapsed(WEB_REMOTE_SCOPE, true);
  fireEvent.click(screen.getByTestId("webchat-refresh"));
  await waitFor(() =>
    expect(bridge.webChatRefresh).toHaveBeenCalledWith({ sessionId: connected.id }),
  );
  expect(useSidebarUiStore.getState().collapsedProjects[WEB_REMOTE_SCOPE]).toBe(false);
  expect(screen.getByRole("textbox", { name: "测试输入" })).toHaveValue("保留草稿");
  expect(bridge.webChatSend).not.toHaveBeenCalled();
});

it("右上角胶囊默认关闭，展开后读取对话，点击导入跳到网页并收起，显示 ID 且不重复创建线程", async () => {
  const imported: WebChatSession = {
    ...connected,
    id: "00000000-0000-4000-8000-000000000002",
    title: "旧对话",
    url: "https://chatgpt.com/c/older-conversation",
  };
  bridge.webChatList.mockResolvedValue([connected]);
  bridge.webChatRead.mockImplementation(async ({ sessionId }) =>
    sessionId === imported.id ? imported : connected,
  );
  bridge.webChatDiscover.mockResolvedValue([{ title: imported.title, url: imported.url }]);
  bridge.webChatImport.mockResolvedValue(imported);
  useWebChatStore.setState({
    sessions: [connected],
    selectedSessionId: connected.id,
    isDraft: false,
  });
  renderWithI18n(<ChatGptWebPage />);
  expect(screen.getByTestId("webchat-conversations-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(screen.queryByTestId("webchat-conversations-list")).not.toBeInTheDocument();
  expect(bridge.webChatDiscover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("webchat-conversations-toggle"));
  const item = await screen.findByRole("button", { name: /旧对话.*older-conversation/ });
  expect(bridge.webChatDiscover).toHaveBeenCalledWith({ sessionId: connected.id });
  useSidebarUiStore.getState().setProjectCollapsed(WEB_REMOTE_SCOPE, true);
  fireEvent.click(item);
  await waitFor(() =>
    expect(bridge.webChatReveal).toHaveBeenCalledWith({ sessionId: imported.id }),
  );
  expect(bridge.webChatImport).toHaveBeenCalledWith({ url: imported.url });
  expect(useWebChatStore.getState().selectedSessionId).toBe(imported.id);
  expect(useSidebarUiStore.getState().collapsedProjects[WEB_REMOTE_SCOPE]).toBe(false);
  expect(screen.queryByTestId("webchat-conversations-list")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("webchat-conversations-toggle"));
  fireEvent.click(screen.getByRole("button", { name: /旧对话.*older-conversation/ }));
  await waitFor(() => expect(bridge.webChatImport).toHaveBeenCalledTimes(2));
  expect(useWebChatStore.getState().sessions.filter((s) => s.id === imported.id)).toHaveLength(1);
});
