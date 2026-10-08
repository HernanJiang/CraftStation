import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptWebRuntime, type WebChatBrowser } from "./runtime";
import { chatGptPageScript, type ChatGptPageSnapshot } from "./pageDriver";
import { isChatGptWebUrl } from "@/shared/chatGptWeb";

function fixture() {
  const dom = new JSDOM(
    '<main id="messages"></main><textarea id="pending-home-input"></textarea><button aria-label="发送" disabled>Send</button>',
    { url: "https://chatgpt.com/", runScripts: "outside-only" },
  );
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    value() {
      return this.hidden ? [] : [{}];
    },
  });
  const editor = window.document.querySelector("textarea")!;
  const send = window.document.querySelector("button")!;
  const messages = window.document.querySelector("main")!;
  let count = 0;
  editor.addEventListener("input", () => {
    send.disabled = !editor.value.trim();
  });
  send.addEventListener("click", () => {
    count++;
    const user = window.document.createElement("div");
    user.dataset.messageAuthorRole = "user";
    user.dataset.messageId = `user-${count}`;
    user.textContent = editor.value;
    messages.append(user);
    editor.value = "";
    send.disabled = true;
    const assistant = window.document.createElement("div");
    assistant.dataset.messageAuthorRole = "assistant";
    assistant.dataset.messageId = `assistant-${count}`;
    assistant.innerHTML = '<div class="markdown"><p>第一段</p></div>';
    messages.append(assistant);
    const stop = window.document.createElement("button");
    stop.setAttribute("aria-label", "停止");
    stop.addEventListener("click", () => {
      stop.remove();
      send.disabled = false;
    });
    window.document.body.append(stop);
  });
  let attached = true;
  const browser: WebChatBrowser = {
    create: vi.fn<WebChatBrowser["create"]>(async () => {
      attached = true;
      return "test-tab";
    }),
    exists: () => attached,
    execute: vi.fn<WebChatBrowser["execute"]>(
      async (_id, script) => window.eval(script) as unknown,
    ),
    reveal: vi.fn<WebChatBrowser["reveal"]>(),
    keepAlive: vi.fn<WebChatBrowser["keepAlive"]>(),
  };
  return {
    dom,
    browser,
    editor,
    messages,
    count: () => count,
    detach: () => {
      attached = false;
    },
    complete: () => {
      window.document.querySelector('button[aria-label="停止"]')?.remove();
      send.disabled = false;
    },
  };
}

describe("ChatGPT 网页同步", () => {
  let f: ReturnType<typeof fixture>;
  let runtime: ChatGptWebRuntime;
  const tempDirs: string[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    f = fixture();
    runtime = new ChatGptWebRuntime(f.browser);
  });
  afterEach(() => {
    runtime.dispose();
    f.dom.window.close();
    vi.useRealTimers();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const submit = async (id: string, requestId = "request-1", prompt = "你好") => {
    const promise = runtime.send(id, prompt, requestId);
    await vi.advanceTimersByTimeAsync(150);
    return promise;
  };
  it("将中文和多行文字发送一次，持续替换回复快照，并在网页结束后完成", async () => {
    const s = await runtime.create();
    expect((await runtime.read(s.id)).status).toBe("ready");
    await submit(s.id, "request-1", "中文\n第二行 `code`");
    await vi.advanceTimersByTimeAsync(350);
    expect((await runtime.read(s.id)).status).toBe("streaming");
    expect(runtime.list()[0]?.messages[0]?.text).toContain("中文\n第二行");
    f.messages.querySelector(".markdown")!.innerHTML = "<p>第一段完成</p><p>第二段</p>";
    await vi.advanceTimersByTimeAsync(350);
    expect(runtime.list()[0]?.messages.at(-1)?.text).toBe("第一段完成\n\n第二段");
    await runtime.send(s.id, "重复调用", "request-1");
    expect(f.count()).toBe(1);
    f.complete();
    await vi.advanceTimersByTimeAsync(1800);
    expect((await runtime.read(s.id)).status).toBe("ready");
    expect(f.browser.keepAlive).toHaveBeenLastCalledWith(s.id, false);
    await submit(s.id, "request-2", "继续");
    expect(f.count()).toBe(2);
  });
  it("停止点击网页按钮，保留部分回复且不重试", async () => {
    const s = await runtime.create();
    await submit(s.id);
    await vi.advanceTimersByTimeAsync(350);
    await runtime.stop(s.id);
    await vi.advanceTimersByTimeAsync(1800);
    expect(runtime.list()[0]?.status).toBe("ready");
    expect(runtime.list()[0]?.messages.at(-1)?.text).toBe("第一段");
    expect(f.count()).toBe(1);
  });
  it("关闭网页使活动回合失败，不新建网页也不重发", async () => {
    const s = await runtime.create();
    await submit(s.id);
    f.detach();
    await vi.advanceTimersByTimeAsync(500);
    expect(runtime.list()[0]?.error).toContain("WEB_DISCONNECTED");
    expect(f.browser.create).toHaveBeenCalledTimes(1);
    expect(f.count()).toBe(1);
  });
  it("已有网页草稿时拒绝覆盖，未登录时提示登录", async () => {
    const s = await runtime.create();
    f.editor.value = "用户网页草稿";
    await expect(runtime.send(s.id, "新消息", "request-1")).rejects.toThrow("WEB_DRAFT_EXISTS");
    expect(f.editor.value).toBe("用户网页草稿");
    expect(f.count()).toBe(0);
    f.editor.remove();
    f.dom.window.document.body.insertAdjacentHTML("beforeend", '<a href="/auth/login">登录</a>');
    await runtime.reveal(s.id);
    expect((await runtime.read(s.id)).status).toBe("login-required");
    await expect(runtime.send(s.id, "新消息", "request-2")).rejects.toThrow("WEB_LOGIN_REQUIRED");
  });
  it("消息提交后无法确认时超时，绝不再次点击发送", async () => {
    const s = await runtime.create();
    await submit(s.id);
    f.messages.replaceChildren();
    f.complete();
    await vi.advanceTimersByTimeAsync(21_000);
    expect(runtime.list()[0]?.error).toContain("WEB_SUBMIT_UNCERTAIN");
    expect(f.count()).toBe(1);
  });
  it("保留代码、表格、公式和引用链接，排除网页操作按钮", () => {
    f.messages.innerHTML = `<div data-message-author-role="assistant" data-message-id="a"><div class="markdown"><h2>说明</h2><p><strong>加粗</strong>与<a href="https://example.com/source">来源</a></p><pre><code class="language-js">const x = 1;\n\u0060\u0060\u0060</code><button>Copy</button></pre><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><span class="katex"><span aria-hidden="true">乱码</span><annotation encoding="application/x-tex">x^2</annotation></span></div></div>`;
    const result = f.dom.window.eval(chatGptPageScript("read")) as ChatGptPageSnapshot;
    const text = result.messages[0]!.text;
    expect(text).toContain("## 说明");
    expect(text).toContain("**加粗**");
    expect(text).toContain("[来源](https://example.com/source)");
    expect(text).toContain("````js\nconst x = 1;");
    expect(text).not.toContain("Copy");
    expect(text).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(text).toContain("$x^2$");
    expect(text).not.toContain("乱码");
  });
  it("支持当前网页消息结构，识别网页自身的回复渲染失败", () => {
    f.messages.innerHTML =
      '<div data-user-message-bubble="true">测试问题</div><div data-markdown-text-style="assistant-message"><div data-dil-source-message-id="answer-1"><div role="status" data-dil-render-failed>无法加载此回复</div></div></div>';
    const page = f.dom.window.eval(chatGptPageScript("read")) as ChatGptPageSnapshot;
    expect(page.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(page.messages.at(-1)?.id).toBe("answer-1");
    expect(page.error).toBe("无法加载此回复");
  });
  it("网页移除较早的 DOM 后仍保留已同步历史，生成信号仍能确认提交", async () => {
    const s = await runtime.create();
    await submit(s.id);
    await vi.advanceTimersByTimeAsync(350);
    f.complete();
    await vi.advanceTimersByTimeAsync(1800);
    await submit(s.id, "request-2", "第二轮");
    f.messages.querySelector('[data-message-id="user-1"]')!.remove();
    f.messages.querySelector('[data-message-id="assistant-1"]')!.remove();
    await vi.advanceTimersByTimeAsync(21_000);
    expect(runtime.list()[0]?.status).toBe("streaming");
    expect(runtime.list()[0]?.messages.map((m) => m.id)).toEqual([
      "user-1",
      "assistant-1",
      "user-2",
      "assistant-2",
    ]);
    f.complete();
    await vi.advanceTimersByTimeAsync(1800);
    expect(runtime.list()[0]?.status).toBe("ready");
    expect(f.count()).toBe(2);
  });
  it("网页纯文本中的 HTML 保持字面显示，消息身份沿用网页回合编号", () => {
    f.messages.innerHTML =
      '<article data-turn-id="turn-a"><div data-user-message-bubble="true"></div></article>';
    f.messages.querySelector("[data-user-message-bubble]")!.textContent =
      "<button>按钮 & 文本</button>";
    const page = f.dom.window.eval(chatGptPageScript("read")) as ChatGptPageSnapshot;
    expect(page.messages[0]?.id).toBe("turn-a-user");
    expect(page.messages[0]?.text).toBe("&lt;button&gt;按钮 &amp; 文本&lt;/button&gt;");
  });
  it("重启后恢复历史和网页地址，绝不自动发送未完成的消息", async () => {
    const dir = mkdtempSync(join(tmpdir(), "craftstation-webchat-"));
    tempDirs.push(dir);
    const file = join(dir, "sessions.json");
    runtime.dispose();
    runtime = new ChatGptWebRuntime(f.browser, file);
    const s = await runtime.create();
    await submit(s.id);
    await vi.advanceTimersByTimeAsync(350);
    f.complete();
    await vi.advanceTimersByTimeAsync(1800);
    runtime.dispose();
    expect(JSON.parse(readFileSync(file, "utf8"))[0].messages).toHaveLength(2);
    runtime = new ChatGptWebRuntime(f.browser, file);
    expect(runtime.list()[0]?.messages).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.count()).toBe(1);
    runtime.dispose();
    writeFileSync(file, "损坏的 JSON");
    runtime = new ChatGptWebRuntime(f.browser, file);
    expect(runtime.list()).toEqual([]);
  });
  it("只允许正式 ChatGPT HTTPS 页面", () => {
    expect(isChatGptWebUrl("https://chatgpt.com/c/123")).toBe(true);
    for (const url of [
      "http://chatgpt.com/",
      "https://chatgpt.com.evil.test/",
      "file:///etc/passwd",
      "data:text/html,x",
    ])
      expect(isChatGptWebUrl(url)).toBe(false);
  });
});
