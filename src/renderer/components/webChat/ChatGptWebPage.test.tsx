import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import type { WebChatSession } from "@/shared/chatGptWeb";
import { ChatGptWebPage } from "./ChatGptWebPage";
import { useWebChatStore } from "@/renderer/state/webChatStore";

const bridge = vi.hoisted(() => ({
  webChatList: vi.fn<() => Promise<WebChatSession[]>>(),
  webChatRead: vi.fn<() => Promise<WebChatSession>>(),
  webChatSend: vi.fn<() => Promise<WebChatSession>>(),
}));
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
  }: {
    children: ReactNode;
    rightActions: ReactNode;
  }) => (
    <div>
      {rightActions}
      {children}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
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
