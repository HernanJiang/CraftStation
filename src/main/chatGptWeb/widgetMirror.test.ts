import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatGptWebRuntime, type WebChatBrowser } from "./runtime";
import { chatGptWidgets } from "./pageWidgets";
import { webChatWidgetInputSchema } from "@/shared/chatGptWeb";

const owned: ChatGptWebRuntime[] = [];
afterEach(() => {
  owned.splice(0).forEach((r) => r.dispose());
  vi.useRealTimers();
});
async function setup() {
  const dom = new JSDOM(
    '<textarea id="prompt-textarea"></textarea><main><div data-testid="conversation-turn-1"><div data-message-author-role="assistant" data-message-id="answer-1"><div class="markdown">这是计算器</div></div><iframe title="计算器"></iframe></div></main>',
    { url: "https://chatgpt.com/c/widget-fixture", runScripts: "outside-only" },
  );
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    value() {
      return { x: 20, y: 40, top: 40, left: 20, width: 500, height: 300, right: 520, bottom: 340 };
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
    value() {
      return [{}];
    },
  });
  dom.window.HTMLElement.prototype.scrollIntoView = vi.fn<() => void>();
  dom.window.document.elementFromPoint = () => dom.window.document.querySelector("iframe");
  const input = vi.fn<WebChatBrowser["input"] & {}>().mockResolvedValue(undefined);
  const browser: WebChatBrowser = {
    create: async () => "tab-1",
    exists: () => true,
    execute: async (_id, script) => dom.window.eval(script),
    reveal: vi.fn<(id: string) => void>(),
    keepAlive: vi.fn<(id: string, active: boolean) => void>(),
    close: async () => {},
    capture: async () => "data:image/png;base64,AA==",
    input,
  };
  const runtime = new ChatGptWebRuntime(browser);
  owned.push(runtime);
  const session = await runtime.importConversation("https://chatgpt.com/c/widget-fixture");
  const ready = await runtime.read(session.id);
  return {
    runtime,
    session: ready,
    dom,
    browser,
    input,
    widget: ready.messages[0]!.widgets!.find((w) => w.kind !== "response")!,
  };
}
describe("ChatGPT 交互组件映射", () => {
  it("已完成会话的查看保活独立于回合保活，离开后自动释放", async () => {
    vi.useFakeTimers();
    const { runtime, session, browser } = await setup();
    await runtime.read(session.id);
    expect(browser.keepAlive).toHaveBeenCalledWith(`view:${session.id}`, true);
    expect(browser.keepAlive).not.toHaveBeenCalledWith(`view:${session.id}`, false);
    await vi.advanceTimersByTimeAsync(4100);
    expect(browser.keepAlive).toHaveBeenCalledWith(`view:${session.id}`, false);
  });
  it("找到 Markdown 旁边的跨域组件并保留纯文字回退", async () => {
    const { session, widget } = await setup();
    expect(widget).toMatchObject({ title: "计算器", kind: "app" });
    expect(session.messages[0]?.text).toContain("这是计算器");
    expect(session.messages[0]?.widgets).toHaveLength(2);
  });
  it("输入只投递给当前截图中的组件，同一几何下拖动不中断", async () => {
    const { runtime, session, widget, input, dom } = await setup();
    const frame = await runtime.widgets.frame(session.id, widget.id);
    expect(dom.window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    const next = await runtime.widgets.frame(session.id, widget.id);
    expect(next.frameId).toBe(frame.frameId);
    await runtime.widgets.input(session.id, widget.id, frame.frameId, {
      kind: "pointer",
      phase: "down",
      x: 0.5,
      y: 0.5,
      pressed: true,
    });
    expect(input).toHaveBeenCalledWith("tab-1", expect.any(Object), { x: 270, y: 190 });
    await expect(
      runtime.widgets.input(session.id, "other-session-widget", frame.frameId, {
        kind: "text",
        text: "x",
      }),
    ).rejects.toThrow("WEB_WIDGET_MISSING");
    expect(input).toHaveBeenCalledTimes(1);
  });
  it("网页更换会话、节点更换、遮挡与截图过期均拒绝旧输入", async () => {
    const { runtime, session, widget, dom, input } = await setup();
    const frame = await runtime.widgets.frame(session.id, widget.id);
    dom.window.history.pushState({}, "", "/c/other-fixture");
    await expect(
      runtime.widgets.input(session.id, widget.id, frame.frameId, { kind: "text", text: "x" }),
    ).rejects.toThrow("WEB_PAGE_CHANGED");
    dom.window.history.pushState({}, "", "/c/widget-fixture");
    dom.window.document.querySelector("iframe")!.removeAttribute("data-craftstation-widget-token");
    await expect(
      runtime.widgets.input(session.id, widget.id, frame.frameId, { kind: "text", text: "x" }),
    ).rejects.toThrow("WEB_WIDGET_STALE");
    const fresh = await runtime.widgets.frame(session.id, widget.id);
    dom.window.document.elementFromPoint = () => dom.window.document.querySelector("textarea");
    await expect(
      runtime.widgets.input(session.id, widget.id, fresh.frameId, {
        kind: "pointer",
        phase: "down",
        x: 0.5,
        y: 0.5,
        pressed: true,
      }),
    ).rejects.toThrow("WEB_WIDGET_FOCUS");
    vi.spyOn(Date, "now").mockReturnValueOnce(Date.now() + 5000);
    await expect(
      runtime.widgets.input(session.id, widget.id, fresh.frameId, { kind: "text", text: "x" }),
    ).rejects.toThrow("WEB_WIDGET_STALE");
    vi.restoreAllMocks();
    expect(input).not.toHaveBeenCalled();
  });
  it("旧组件关闭不会关闭新组件，停止后释放浏览器保活", async () => {
    const { runtime, session, widget, browser } = await setup();
    await runtime.widgets.frame(session.id, widget.id);
    runtime.widgets.close(session.id, "old-widget");
    expect(browser.keepAlive).not.toHaveBeenCalledWith(`widget:${session.id}`, false);
    runtime.widgets.close(session.id, widget.id);
    expect(browser.keepAlive).toHaveBeenCalledWith(`widget:${session.id}`, false);
  });
  it("拒绝任意脚本、快捷命令与越界坐标", () => {
    for (const input of [
      { kind: "eval", js: "alert(1)" },
      { kind: "key", key: "F12" },
      { kind: "pointer", phase: "down", x: 2, y: 0, pressed: true },
    ])
      expect(
        webChatWidgetInputSchema.safeParse({
          sessionId: "11111111-1111-4111-8111-111111111111",
          widgetId: "w",
          frameId: "11111111-1111-4111-8111-111111111111",
          input,
        }).success,
      ).toBe(false);
  });
  it("定位脚本在其他源拒绝执行", () => {
    const dom = new JSDOM("", { url: "https://example.com", runScripts: "outside-only" });
    expect(() => dom.window.eval(`(${chatGptWidgets.toString()})("discover")`)).toThrow(
      "WEB_WIDGET_ORIGIN",
    );
  });
});
