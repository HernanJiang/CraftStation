import { randomUUID } from "node:crypto";
import type { WebChatSession, WebChatWidgetFrame, WebChatWidgetInput } from "@/shared/chatGptWeb";
import { chatGptWidgetScript, type WebChatWidgetLocation } from "./pageWidgets";
import type { WebChatBrowser } from "./runtime";

type Frame = WebChatWidgetLocation & { id: string; widgetId: string; capturedAt: number };

/** One live component per session. Input is scoped to the exact captured node. */
export class WebChatWidgetMirror {
  private frames = new Map<string, Frame>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private queue = new Map<string, Promise<void>>();
  constructor(
    private browser: WebChatBrowser,
    private session: (id: string) => WebChatSession,
  ) {}
  private async run<T>(
    id: string,
    widgetId: string,
    operation: string,
    work: (session: WebChatSession, tabId: string) => Promise<T>,
  ) {
    const previous = this.queue.get(id) ?? Promise.resolve();
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queue.set(id, pending);
    await previous;
    try {
      const session = this.session(id);
      if (!session.tabId || !this.browser.exists(session.tabId))
        throw new Error("WEB_DISCONNECTED：请重新连接网页会话。");
      if (!session.messages.some((m) => m.widgets?.some((w) => w.id === widgetId)))
        throw new Error("WEB_WIDGET_MISSING：找不到这个会话中的组件。");
      this.browser.keepAlive(`widget:${id}`, true);
      const old = this.timers.get(id);
      if (old) clearTimeout(old);
      const timer = setTimeout(() => this.close(id), 6000);
      timer.unref();
      this.timers.set(id, timer);
      try {
        return await work(session, session.tabId);
      } catch (error) {
        console.warn("[webchat]", {
          phase: "widget",
          operation,
          status: "failed",
          sessionId: id,
          code:
            error instanceof Error
              ? (/^WEB_[A-Z_]+/.exec(error.message)?.[0] ?? "WEB_WIDGET_FAILED")
              : "WEB_WIDGET_FAILED",
        });
        throw error;
      }
    } finally {
      release();
      if (this.queue.get(id) === pending) this.queue.delete(id);
    }
  }
  frame(id: string, widgetId: string): Promise<WebChatWidgetFrame> {
    return this.run(id, widgetId, "capture", async (session, tabId) => {
      if (!this.browser.capture)
        throw new Error("WEB_WIDGET_UNSUPPORTED：当前浏览器无法映射交互组件。");
      let location = (await this.browser.execute(
        tabId,
        chatGptWidgetScript(
          "locate",
          widgetId,
          session.url,
          this.frames.get(id)?.widgetId !== widgetId,
        ),
      )) as WebChatWidgetLocation;
      if (!location.bounds || !location.token)
        throw new Error("WEB_WIDGET_MISSING：无法定位组件。");
      let dataUrl = "";
      // A hidden webview may receive its final viewport size during capture.
      // Bind the returned pixels only after that layout has settled.
      for (let attempt = 0; attempt < 3; attempt++) {
        dataUrl = await this.browser.capture(tabId, location.bounds);
        const after = (await this.browser.execute(
          tabId,
          chatGptWidgetScript("locate", widgetId, session.url, false),
        )) as WebChatWidgetLocation;
        if (
          after.token === location.token &&
          after.url === location.url &&
          JSON.stringify(after.bounds) === JSON.stringify(location.bounds)
        )
          break;
        if (attempt === 2) {
          console.info("[webchat]", {
            phase: "widget",
            operation: "capture-layout",
            status: "skipped",
            code: "WEB_WIDGET_RESIZING",
            sessionId: id,
            previousBounds: location.bounds,
            currentBounds: after.bounds,
            sameNode: after.token === location.token,
          });
          throw new Error("WEB_WIDGET_RESIZING：组件正在调整大小，请稍后刷新。");
        }
        location = after;
      }
      // Reusing the frame id while the target/geometry is identical avoids
      // invalidating a pointer drag when the next frame arrives.
      const previous = this.frames.get(id);
      const same =
        previous?.widgetId === widgetId &&
        previous.token === location.token &&
        previous.url === location.url &&
        JSON.stringify(previous.bounds) === JSON.stringify(location.bounds);
      const frameId = same ? previous.id : randomUUID();
      this.frames.set(id, { ...location, id: frameId, widgetId, capturedAt: Date.now() });
      return { frameId, dataUrl, width: location.bounds.width, height: location.bounds.height };
    });
  }
  input(id: string, widgetId: string, frameId: string, input: WebChatWidgetInput): Promise<void> {
    return this.run(id, widgetId, "input", async (session, tabId) => {
      const frame = this.frames.get(id);
      if (
        !frame ||
        frame.id !== frameId ||
        frame.widgetId !== widgetId ||
        Date.now() - frame.capturedAt > 4000
      )
        throw new Error("WEB_WIDGET_STALE：组件画面已变化，请刷新后重试。");
      const location = (await this.browser.execute(
        tabId,
        chatGptWidgetScript("locate", widgetId, session.url, false),
      )) as WebChatWidgetLocation;
      if (
        location.token !== frame.token ||
        location.url !== frame.url ||
        JSON.stringify(location.bounds) !== JSON.stringify(frame.bounds)
      ) {
        console.info("[webchat]", {
          phase: "widget",
          operation: "validate-input",
          status: "skipped",
          code: "WEB_WIDGET_STALE",
          sessionId: id,
          frameId,
          previousBounds: frame.bounds,
          currentBounds: location.bounds,
          sameNode: location.token === frame.token,
        });
        throw new Error("WEB_WIDGET_STALE：组件位置已变化，未发送操作。");
      }
      if (!this.browser.input) throw new Error("WEB_WIDGET_UNSUPPORTED：当前浏览器不支持交互。");
      const point =
        "x" in input
          ? {
              x: frame.bounds.x + Math.min(frame.bounds.width - 1, input.x * frame.bounds.width),
              y: frame.bounds.y + Math.min(frame.bounds.height - 1, input.y * frame.bounds.height),
            }
          : undefined;
      const guard = `(() => { const token=${JSON.stringify(frame.token)}; const target=[...document.querySelectorAll('[data-craftstation-widget-token]')].find(el => el.getAttribute('data-craftstation-widget-token')===token); const hit=${point ? `document.elementFromPoint(${point.x},${point.y})` : "document.activeElement"}; return Boolean(target && hit && (target===hit || target.contains(hit))); })()`;
      if (!(await this.browser.execute(tabId, guard)))
        throw new Error("WEB_WIDGET_FOCUS：请先点击组件内的输入控件。");
      await this.browser.input(tabId, input, point);
    });
  }
  close(id: string, widgetId?: string) {
    if (widgetId && this.frames.get(id)?.widgetId !== widgetId) return;
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.frames.delete(id);
    this.browser.keepAlive(`widget:${id}`, false);
  }
  dispose() {
    for (const id of this.timers.keys()) this.close(id);
  }
}
