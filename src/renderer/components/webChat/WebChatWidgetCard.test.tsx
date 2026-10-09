import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import { WebChatWidgetCard } from "./WebChatWidgetCard";

const bridge = vi.hoisted(() => ({
  webChatWidgetFrame: vi.fn<() => Promise<unknown>>(),
  webChatWidgetClose: vi.fn<() => Promise<void>>(),
  saveImageFile: vi.fn<(input: { data: Uint8Array; suggestedName: string }) => Promise<string>>(),
}));
vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridge }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("网页组件保存", () => {
  it("保存当前 PNG 字节，完成后显示已保存图片", async () => {
    bridge.webChatWidgetFrame.mockResolvedValue({
      frameId: "frame",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      width: 600,
      height: 360,
    });
    bridge.webChatWidgetClose.mockResolvedValue(undefined);
    bridge.saveImageFile.mockResolvedValue("C:\\fixture\\组件.png");
    renderWithI18n(
      <WebChatWidgetCard
        sessionId="session"
        widget={{ id: "calculator", title: "计算器", kind: "app" }}
        active
        onActivate={() => {}}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "保存图片" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "保存图片" }));
    await waitFor(() =>
      expect(bridge.saveImageFile).toHaveBeenCalledWith({
        data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        suggestedName: "ChatGPT-组件.png",
      }),
    );
    expect(await screen.findByRole("button", { name: "已保存图片" })).toBeInTheDocument();
  });
});
