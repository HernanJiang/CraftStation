import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptWebRuntime, type WebChatBrowser } from "./runtime";
import { chatGptPageScript, type ChatGptPageSnapshot } from "./pageDriver";
import { chatGptConversationUrl, isChatGptWebUrl, webChatDeleteSchema } from "@/shared/chatGptWeb";

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
    close: vi.fn<WebChatBrowser["close"]>(async () => {
      attached = false;
    }),
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

function managementFixture(
  f: ReturnType<typeof fixture>,
  labels = ["即时", "中", "高", "极高", "Pro"],
) {
  const { document } = f.dom.window;
  f.dom.reconfigure({ url: "https://chatgpt.com/c/test-conversation" });
  document.title = "测试对话";
  document.body.insertAdjacentHTML(
    "afterbegin",
    '<nav><a href="/c/test-conversation">测试对话</a><a href="/c/older-conversation">旧对话</a><a href="/c/older-conversation">重复</a><a href="/share/shared-conversation">分享</a><a href="https://example.com/c/other-conversation">外站</a></nav>',
  );
  f.messages.insertAdjacentHTML(
    "afterbegin",
    '<header><button aria-label="更多" aria-haspopup="menu">更多</button></header>',
  );
  const more = document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')!;
  let deletions = 0;
  let acknowledgeDeletion = true;
  more.onclick = () => {
    more.setAttribute("aria-controls", "conversation-menu");
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="menu" id="conversation-menu"><div role="menuitem">删除</div></div>',
    );
    document.querySelector<HTMLElement>("#conversation-menu [role=menuitem]")!.onclick = () => {
      document.querySelector("#conversation-menu")!.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="dialog" aria-modal="true"><h2>删除聊天？</h2><p>永久删除“${document.title}”</p><button>取消</button><button type="submit">删除聊天</button></div>`,
      );
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      dialog.querySelector<HTMLButtonElement>("button")!.onclick = () => dialog.remove();
      dialog.querySelector<HTMLButtonElement>('[type="submit"]')!.onclick = () => {
        deletions++;
        dialog.remove();
        if (!acknowledgeDeletion) return;
        document.querySelector('nav a[href="/c/test-conversation"]')!.remove();
        f.dom.window.history.replaceState({}, "", "/");
      };
    };
  };
  document.body.insertAdjacentHTML(
    "beforeend",
    '<button data-codex-intelligence-trigger aria-haspopup="menu" aria-expanded="false">中</button>',
  );
  const trigger = document.querySelector<HTMLButtonElement>("[data-codex-intelligence-trigger]")!;
  let index = 1;
  trigger.onclick = () => {
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", "reasoning-menu");
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="menu" id="reasoning-menu"><span role="status" id="effort-status">${labels[index]}, 第 ${index + 1} 项</span><div role="menuitem" data-reasoning-slider aria-describedby="effort-status"><span aria-hidden="true" role="slider" aria-valuemin="0" aria-valuemax="${labels.length - 1}" aria-valuenow="${index}"></span></div></div>`,
    );
    const menu = document.querySelector<HTMLElement>("#reasoning-menu")!;
    menu.onkeydown = (e) => {
      if (e.key === "Escape") {
        menu.remove();
        trigger.setAttribute("aria-expanded", "false");
        return;
      }
      if (!e.target || !(e.target as HTMLElement).hasAttribute("data-reasoning-slider")) return;
      index = Math.min(labels.length - 1, Math.max(0, index + (e.key === "ArrowRight" ? 1 : -1)));
      menu.querySelector('[role="slider"]')!.setAttribute("aria-valuenow", String(index));
      menu.querySelector('[role="status"]')!.textContent = `${labels[index]}, 第 ${index + 1} 项`;
      trigger.textContent = labels[index]!;
    };
  };
  return {
    deletions: () => deletions,
    index: () => index,
    loseAcknowledgement: () => {
      acknowledgeDeletion = false;
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
  it("新建与导入默认在后台打开官方页面，只有显式打开才展开浏览器", async () => {
    const draft = await runtime.create();
    expect(f.browser.create).toHaveBeenCalledWith("https://chatgpt.com/", false);
    expect(f.browser.reveal).not.toHaveBeenCalled();
    managementFixture(f);
    const imported = await runtime.importConversation("https://chatgpt.com/c/test-conversation");
    await runtime.importConversation(imported.url);
    expect(f.browser.create).toHaveBeenLastCalledWith(imported.url, false);
    expect(f.browser.reveal).not.toHaveBeenCalled();
    await runtime.reveal(draft.id);
    expect(f.browser.reveal).toHaveBeenCalledTimes(1);
  });
  it("只接入自己的对话链接，重复导入复用会话，读取原历史后可继续发送", async () => {
    expect(chatGptConversationUrl("https://chatgpt.com/g/project/c/test-conversation?x=1")).toBe(
      "https://chatgpt.com/c/test-conversation",
    );
    for (const url of [
      "https://chatgpt.com/share/test-conversation",
      "https://chatgpt.com.evil.test/c/test-conversation",
      "https://user@chatgpt.com/c/test-conversation",
      "https://chatgpt.com:444/c/test-conversation",
    ]) {
      await expect(runtime.importConversation(url)).rejects.toThrow("WEB_IMPORT_INVALID");
    }
    managementFixture(f);
    f.messages.insertAdjacentHTML(
      "beforeend",
      '<div data-message-author-role="assistant" data-message-id="old">旧回复</div>',
    );
    const s = await runtime.importConversation("https://chatgpt.com/c/test-conversation");
    expect((await runtime.read(s.id)).messages[0]?.text).toBe("旧回复");
    expect((await runtime.importConversation(`${s.url}?source=web`)).id).toBe(s.id);
    expect(runtime.list()).toHaveLength(1);
    expect(f.browser.create).toHaveBeenCalledTimes(1);
    expect(await runtime.discover(s.id)).toEqual([
      { title: "测试对话", url: s.url },
      { title: "旧对话", url: "https://chatgpt.com/c/older-conversation" },
    ]);
    await submit(s.id);
    expect(f.count()).toBe(1);
    await expect(runtime.reasoning(s.id)).rejects.toThrow("WEB_BUSY");
  });
  it("思考档位来自原生滑杆，读取后恢复偏好，设置后核实标签", async () => {
    const native = managementFixture(f);
    const s = await runtime.importConversation("https://chatgpt.com/c/test-conversation");
    const reading = runtime.reasoning(s.id);
    await vi.advanceTimersByTimeAsync(1800);
    const options = await reading;
    expect(options.options.map((o) => o.label)).toEqual(["即时", "中", "高", "极高", "Pro"]);
    expect(options.value).toBe("1");
    expect(native.index()).toBe(1);
    const setting = runtime.setReasoning(s.id, { id: "3", label: "极高" });
    await vi.advanceTimersByTimeAsync(500);
    expect((await setting).reasoningLabel).toBe("极高");
    expect(native.index()).toBe(3);
    const invalid = runtime
      .setReasoning(s.id, { id: "0", label: "虚构档位" })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await invalid).toHaveProperty(
      "message",
      expect.stringContaining("WEB_REASONING_CHANGED"),
    );
    expect(native.index()).toBe(3);
    expect(f.count()).toBe(0);
  });
  it("删除须显式确认，核对 URL 与原生对话框后只提交一次，确认成功才移除历史", async () => {
    expect(
      webChatDeleteSchema.safeParse({
        sessionId: "00000000-0000-4000-8000-000000000000",
        url: "https://chatgpt.com/c/test-conversation",
      }).success,
    ).toBe(false);
    const native = managementFixture(f);
    const s = await runtime.importConversation("https://chatgpt.com/c/test-conversation");
    await expect(
      runtime.deleteConversation(s.id, "https://chatgpt.com/c/older-conversation"),
    ).rejects.toThrow("WEB_PAGE_CHANGED");
    expect(native.deletions()).toBe(0);
    const deleting = runtime.deleteConversation(s.id, s.url);
    await vi.advanceTimersByTimeAsync(1000);
    await deleting;
    expect(native.deletions()).toBe(1);
    expect(runtime.list()).toHaveLength(0);
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it("手动切换网页后拒绝删除，原会话记录和目标都保留", async () => {
    const native = managementFixture(f);
    const s = await runtime.importConversation("https://chatgpt.com/c/test-conversation");
    f.dom.reconfigure({ url: "https://chatgpt.com/c/older-conversation" });
    await expect(runtime.deleteConversation(s.id, s.url)).rejects.toThrow("WEB_PAGE_CHANGED");
    expect(native.deletions()).toBe(0);
    expect(runtime.list()[0]?.url).toBe(s.url);
  });
  it("网页删除结果不明确时保留记录，绝不再次点击删除", async () => {
    const native = managementFixture(f);
    native.loseAcknowledgement();
    const s = await runtime.importConversation("https://chatgpt.com/c/test-conversation");
    const deleting = runtime.deleteConversation(s.id, s.url).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(17_000);
    expect(await deleting).toHaveProperty(
      "message",
      expect.stringContaining("WEB_DELETE_UNCERTAIN"),
    );
    expect(native.deletions()).toBe(1);
    expect(runtime.list()[0]?.id).toBe(s.id);
    expect(f.browser.close).not.toHaveBeenCalled();
  });
  it("网页没有原生思考控件时明确拒绝，不提供虚构选项", async () => {
    const s = await runtime.create();
    await expect(runtime.reasoning(s.id)).rejects.toThrow("WEB_REASONING_UNAVAILABLE");
    expect(f.count()).toBe(0);
  });
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
    expect(f.browser.keepAlive).toHaveBeenCalledWith(s.id, false);
    expect(f.browser.keepAlive).toHaveBeenLastCalledWith(`view:${s.id}`, true);
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
    let loginClicks = 0;
    f.dom.window.document
      .querySelector('a[href="/auth/login"]')!
      .addEventListener("click", (event) => {
        event.preventDefault();
        loginClicks++;
      });
    await runtime.reveal(s.id);
    expect((await runtime.read(s.id)).status).toBe("login-required");
    await expect(runtime.send(s.id, "新消息", "request-2")).rejects.toThrow("WEB_LOGIN_REQUIRED");
    await runtime.reveal(s.id);
    expect(loginClicks).toBe(1);
    expect(f.count()).toBe(0);
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
