import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  chatGptConversationUrl,
  isChatGptWebUrl,
  webChatSessionSchema,
  type WebChatSession,
  type WebChatConversation,
  type WebChatReasoning,
} from "@/shared/chatGptWeb";
import {
  chatGptPageScript,
  chatGptSubmitScript,
  chatGptLoginScript,
  type ChatGptPageSnapshot,
} from "./pageDriver";
import {
  chatGptConversationsScript,
  chatGptReasoningScript,
  chatGptDeleteScript,
} from "./pageManagement";
import type { BrowserPanelManager } from "../browser";

/** Browser execution is behind a narrow seam; tests exercise the same lifecycle. */
export interface WebChatBrowser {
  create(url: string, reveal: boolean): Promise<string>;
  exists(tabId: string): boolean;
  execute(tabId: string, script: string): Promise<unknown>;
  reveal(tabId: string): void;
  keepAlive(sessionId: string, active: boolean): void;
  close(tabId: string): Promise<void>;
}

export function embeddedWebChatBrowser(manager: BrowserPanelManager): WebChatBrowser {
  return {
    create: async (url, reveal) =>
      (await manager.createTab({ url, reveal, activate: reveal }, { awaitAttach: false })).tabId,
    exists: (id) => Boolean(manager.getTab(id)),
    execute: async (id, script) => {
      await manager.ensureTabReady(id);
      const tab = manager.getTab(id);
      if (!tab || !tab.isAttached()) throw new Error("WEB_DISCONNECTED：网页已关闭，请重新连接。");
      if (!isChatGptWebUrl(tab.webContents.getURL()))
        throw new Error("WEB_LOGIN_REQUIRED：请在网页中完成 ChatGPT 登录。");
      return tab.webContents.executeJavaScript(script, true);
    },
    reveal: (id) => {
      manager.setActiveTab(id);
      manager.revealForUserOpen();
    },
    keepAlive: (id, active) => {
      manager.setAutomationSession(`webchat:${id}`, active);
    },
    close: (id) => manager.closeTab(id),
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Turn = {
  startedAt: number;
  lastChange: number;
  lastText: string;
  users: number;
  assistantIds: Set<string>;
  accepted: boolean;
  stopped: boolean;
};

export class ChatGptWebRuntime {
  private readonly sessions = new Map<string, WebChatSession>();
  private readonly turns = new Map<string, Turn>();
  private readonly locks = new Set<string>();
  private readonly requestIds = new Set<string>();
  private readonly timer: ReturnType<typeof setInterval>;
  private polling = false;

  constructor(
    private readonly browser: WebChatBrowser,
    private readonly filePath?: string,
  ) {
    if (filePath && existsSync(filePath)) {
      try {
        const records = z
          .array(webChatSessionSchema)
          .safeParse(JSON.parse(readFileSync(filePath, "utf8")));
        if (records.success)
          for (const record of records.data) {
            if (!isChatGptWebUrl(record.url)) continue;
            this.sessions.set(record.id, {
              ...record,
              tabId: undefined,
              status: "connecting",
              error: undefined,
              reasoningLabel: undefined,
            });
          }
      } catch {
        console.warn("[webchat]", {
          phase: "session",
          operation: "restore",
          status: "failed",
          code: "WEB_HISTORY_INVALID",
        });
      }
    }
    this.timer = setInterval(() => {
      void this.poll();
    }, 300);
    this.timer.unref();
  }

  private get(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error("WEB_SESSION_NOT_FOUND：找不到这个网页会话。");
    return session;
  }
  private copy(session: WebChatSession): WebChatSession {
    return structuredClone(session);
  }
  list() {
    return [...this.sessions.values()].map((s) => this.copy(s));
  }
  private persist() {
    if (!this.filePath) return;
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, JSON.stringify(this.list()));
    renameSync(temp, this.filePath);
  }
  private log(session: WebChatSession, operation: string, status: string, code?: string) {
    console.info("[webchat]", {
      phase: "session",
      operation,
      status,
      sessionId: session.id,
      ...(code ? { code } : {}),
    });
  }
  private fail(session: WebChatSession, error: unknown) {
    const message =
      error instanceof Error ? error.message : "WEB_FAILED：同步失败，请打开网页检查。";
    const changed = session.error !== message;
    session.status = message.startsWith("WEB_LOGIN_REQUIRED") ? "login-required" : "error";
    session.error = message;
    this.turns.delete(session.id);
    this.browser.keepAlive(session.id, false);
    if (changed) {
      this.log(session, "sync", "failed", /^WEB_[A-Z_]+/.exec(session.error)?.[0] ?? "WEB_FAILED");
      this.persist();
    }
  }
  private async attach(session: WebChatSession, reveal: boolean) {
    if (!session.tabId || !this.browser.exists(session.tabId)) {
      if (this.turns.has(session.id))
        throw new Error(
          "WEB_DISCONNECTED：网页已关闭。请检查网页中的回复，已提交的消息不会自动重发。",
        );
      session.tabId = await this.browser.create(session.url, reveal);
      session.status = "connecting";
    } else if (reveal) this.browser.reveal(session.tabId);
    return session.tabId;
  }
  async create() {
    const session: WebChatSession = {
      id: randomUUID(),
      title: "新对话",
      url: "https://chatgpt.com/",
      status: "connecting",
      messages: [],
    };
    await this.attach(session, false);
    this.sessions.set(session.id, session);
    this.persist();
    this.log(session, "create", "ok");
    return this.copy(session);
  }
  async importConversation(value: string) {
    const url = chatGptConversationUrl(value);
    if (!url)
      throw new Error(
        "WEB_IMPORT_INVALID：请输入自己的 ChatGPT 对话链接，分享链接无法继续原对话。",
      );
    const existing = [...this.sessions.values()].find((s) => chatGptConversationUrl(s.url) === url);
    if (existing) {
      if (!this.turns.has(existing.id)) {
        existing.status = "connecting";
        existing.error = undefined;
      }
      await this.attach(existing, false);
      return this.copy(existing);
    }
    const session: WebChatSession = {
      id: randomUUID(),
      title: "导入的对话",
      url,
      status: "connecting",
      messages: [],
    };
    await this.attach(session, false);
    this.sessions.set(session.id, session);
    this.persist();
    this.log(session, "import", "connected");
    return this.copy(session);
  }

  private async manage<T>(
    id: string,
    operation: string,
    run: (session: WebChatSession, page: ChatGptPageSnapshot) => Promise<T>,
  ): Promise<T> {
    const session = this.get(id);
    const deadline = Date.now() + 10_000;
    while (this.locks.has(id) && !this.turns.has(id) && Date.now() < deadline) await sleep(30);
    if (this.locks.has(id) || this.turns.has(id)) throw new Error("WEB_BUSY：请等待当前回复完成。");
    this.locks.add(id);
    this.browser.keepAlive(id, true);
    try {
      const page = await this.page(session, "read");
      if (page.generating) throw new Error("WEB_BUSY：网页正在生成回复。");
      if (page.loginRequired || !page.ready)
        throw new Error("WEB_LOGIN_REQUIRED：请打开网页并登录 ChatGPT。");
      this.apply(session, page);
      const result = await run(session, page);
      this.log(session, operation, "ok");
      return result;
    } catch (error) {
      const code = error instanceof Error ? /^WEB_[A-Z_]+/.exec(error.message)?.[0] : undefined;
      this.log(session, operation, "failed", code ?? "WEB_MANAGEMENT_FAILED");
      throw error;
    } finally {
      this.locks.delete(id);
      this.browser.keepAlive(id, false);
    }
  }

  discover(id: string) {
    return this.manage(
      id,
      "discover",
      async (session) =>
        (await this.browser.execute(
          session.tabId!,
          chatGptConversationsScript,
        )) as WebChatConversation[],
    );
  }
  reasoning(id: string) {
    return this.manage(
      id,
      "reasoning-read",
      async (session) =>
        (await this.browser.execute(session.tabId!, chatGptReasoningScript())) as WebChatReasoning,
    );
  }
  setReasoning(id: string, option: WebChatReasoning["options"][number]) {
    return this.manage(id, "reasoning-set", async (session) => {
      await this.browser.execute(session.tabId!, chatGptReasoningScript(option));
      this.apply(session, await this.page(session, "read"));
      return this.copy(session);
    });
  }
  async deleteConversation(id: string, value: string) {
    const url = chatGptConversationUrl(value);
    if (!url || chatGptConversationUrl(this.get(id).url) !== url)
      throw new Error("WEB_PAGE_CHANGED：删除目标已变化，未执行删除。");
    return this.manage(id, "delete", async (session, page) => {
      if (chatGptConversationUrl(page.url) !== url || !page.title)
        throw new Error("WEB_PAGE_CHANGED：网页删除目标不一致，未执行删除。");
      for (const stage of ["open", "choose", "confirm"] as const) {
        await this.browser.execute(session.tabId!, chatGptDeleteScript(stage, url, page.title));
        await sleep(200);
      }
      // After the native confirmation there is no retry of any mutating click.
      // Keep local history until the webpage acknowledges the remote deletion.
      const deadline = Date.now() + 15_000;
      let deleted = false;
      while (Date.now() < deadline && !deleted) {
        try {
          deleted =
            (await this.browser.execute(
              session.tabId!,
              chatGptDeleteScript("state", url, page.title),
            )) === true;
        } catch {
          // Navigation can invalidate the page execution context; only observe.
        }
        if (!deleted) await sleep(300);
      }
      if (!deleted)
        throw new Error(
          "WEB_DELETE_UNCERTAIN：尚未确认网页删除结果。本地记录已保留，请打开网页检查，勿重复删除。",
        );
      this.sessions.delete(id);
      this.persist();
      try {
        await this.browser.close(session.tabId!);
      } catch {
        this.log(session, "close-deleted-tab", "failed", "WEB_TAB_CLOSE_FAILED");
      }
    });
  }
  async reveal(id: string) {
    const session = this.get(id);
    const needsLogin = session.status === "login-required";
    if (!this.turns.has(id)) {
      session.status = "connecting";
      session.error = undefined;
    }
    await this.attach(session, true);
    if (needsLogin) {
      try {
        await this.browser.execute(session.tabId!, chatGptLoginScript);
      } catch {
        // 原生登录跳转可能销毁执行上下文；页面已展开，让用户继续登录。
        this.log(session, "open-login", "skipped", "WEB_LOGIN_NAVIGATION");
      }
    }
  }
  private async page(session: WebChatSession, action: "read" | "send" | "stop", prompt?: string) {
    const tabId = await this.attach(session, false);
    const result = (await this.browser.execute(
      tabId,
      chatGptPageScript(action, prompt),
    )) as ChatGptPageSnapshot;
    if (!isChatGptWebUrl(result.url))
      throw new Error("WEB_PAGE_CHANGED：网页地址已变化，请重新连接。");
    return result;
  }
  private apply(session: WebChatSession, page: ChatGptPageSnapshot) {
    const turn = this.turns.get(session.id);
    const previousPath = new URL(session.url).pathname;
    const boundUrl = chatGptConversationUrl(session.url);
    if (boundUrl && chatGptConversationUrl(page.url) !== boundUrl && !page.loginRequired)
      throw new Error("WEB_PAGE_CHANGED：网页会话已切换，请打开原对话或导入这个会话。");
    const urlChanged = session.url !== page.url;
    session.url = page.url;
    session.reasoningLabel = page.reasoningLabel;
    if (chatGptConversationUrl(page.url) && page.title && page.title !== "ChatGPT")
      session.title = page.title;
    if (!turn && urlChanged && previousPath.startsWith("/c/")) session.messages = [];
    // Older turns may leave the webpage DOM while the latest response streams.
    const messages = [...session.messages];
    for (const message of page.messages) {
      const index = messages.findIndex((existing) => existing.id === message.id);
      if (index === -1) messages.push(message);
      else messages[index] = message;
    }
    const messagesChanged = JSON.stringify(session.messages) !== JSON.stringify(messages);
    if (messagesChanged) session.messages = messages;
    if (page.loginRequired) {
      if (turn)
        throw new Error(
          "WEB_LOGIN_REQUIRED：登录已失效，请在网页中重新登录。已提交的消息不会自动重发。",
        );
      session.status = "login-required";
      session.error = undefined;
      return;
    }
    if (page.error) throw new Error(`WEB_REPLY_FAILED：${page.error}`);
    if (turn) {
      const users = page.messages.filter((m) => m.role === "user");
      turn.accepted ||= users.length > turn.users || page.generating;
      const response = page.messages.filter(
        (m) => m.role === "assistant" && !turn.assistantIds.has(m.id),
      );
      const text = JSON.stringify(response);
      if (text !== turn.lastText) {
        turn.lastText = text;
        turn.lastChange = Date.now();
      }
      session.status = turn.accepted || page.generating ? "streaming" : "sending";
      if (!turn.accepted && Date.now() - turn.startedAt > 20_000)
        throw new Error("WEB_SUBMIT_UNCERTAIN：未确认网页接收。请打开网页检查，避免重复发送。");
      if (
        turn.accepted &&
        !page.generating &&
        page.ready &&
        (response.some((m) => m.text.length > 0) || turn.stopped) &&
        Date.now() - turn.lastChange > 1200
      ) {
        this.turns.delete(session.id);
        this.browser.keepAlive(session.id, false);
        session.status = "ready";
        this.persist();
        this.log(session, "turn", turn.stopped ? "cancelled" : "completed");
      } else if (Date.now() - turn.lastChange > 180_000 && !page.generating)
        throw new Error("WEB_REPLY_TIMEOUT：网页长时间没有返回回复，请打开网页检查。");
    } else {
      session.status = page.generating ? "streaming" : page.ready ? "ready" : "connecting";
      session.error = undefined;
    }
    if (urlChanged || (messagesChanged && !page.generating && !turn)) this.persist();
  }
  async read(id: string) {
    const session = this.get(id);
    if (session.status === "error") return this.copy(session);
    if (!this.turns.has(id) && !this.locks.has(id)) {
      this.locks.add(id);
      try {
        this.apply(session, await this.page(session, "read"));
      } catch (error) {
        this.fail(session, error);
      } finally {
        this.locks.delete(id);
      }
    }
    return this.copy(session);
  }
  async send(id: string, prompt: string, requestId: string) {
    const session = this.get(id);
    if (this.requestIds.has(requestId)) return this.copy(session);
    const deadline = Date.now() + 10_000;
    while (this.locks.has(id) && !this.turns.has(id) && Date.now() < deadline) await sleep(30);
    if (this.requestIds.has(requestId)) return this.copy(session);
    if (this.locks.has(id) || this.turns.has(id)) throw new Error("WEB_BUSY：请等待当前回复完成。");
    this.locks.add(id);
    this.requestIds.add(requestId);
    if (this.requestIds.size > 1000) this.requestIds.delete(this.requestIds.values().next().value!);
    this.browser.keepAlive(id, true);
    try {
      const baseline = await this.page(session, "read");
      this.apply(session, baseline);
      if (!baseline.ready || baseline.loginRequired)
        throw new Error("WEB_LOGIN_REQUIRED：请打开网页并登录 ChatGPT。");
      if (baseline.generating) throw new Error("WEB_BUSY：网页正在生成回复。");
      const filled = await this.page(session, "send", prompt);
      if (filled.action === "draft-exists")
        throw new Error("WEB_DRAFT_EXISTS：网页输入框已有草稿，请先处理草稿再发送。");
      if (filled.action !== "filled")
        throw new Error("WEB_EDITOR_CHANGED：无法输入，请打开网页检查输入框。");
      let clicked = false;
      const sendDeadline = Date.now() + 3000;
      while (!clicked && Date.now() < sendDeadline) {
        await sleep(100);
        clicked = (await this.browser.execute(session.tabId!, chatGptSubmitScript)) as boolean;
      }
      if (!clicked) throw new Error("WEB_SEND_UNAVAILABLE：发送按钮不可用，草稿保留在网页中。");
      this.turns.set(id, {
        startedAt: Date.now(),
        lastChange: Date.now(),
        lastText: "",
        users: baseline.messages.filter((m) => m.role === "user").length,
        assistantIds: new Set(
          baseline.messages.filter((m) => m.role === "assistant").map((m) => m.id),
        ),
        accepted: false,
        stopped: false,
      });
      session.title = prompt.slice(0, 32);
      session.status = "sending";
      session.error = undefined;
      this.persist();
      this.log(session, "send", "submitted");
    } catch (error) {
      this.fail(session, error);
      throw error;
    } finally {
      this.locks.delete(id);
    }
    return this.copy(session);
  }
  async stop(id: string) {
    const session = this.get(id);
    try {
      const page = await this.page(session, "stop");
      const turn = this.turns.get(id);
      if (turn) turn.stopped = true;
      else this.apply(session, page);
      this.log(session, "interrupt", "requested");
    } catch (error) {
      this.fail(session, error);
      throw error;
    }
    return this.copy(session);
  }
  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const id of this.turns.keys()) {
        if (this.locks.has(id)) continue;
        this.locks.add(id);
        const session = this.get(id);
        try {
          const page = await this.page(session, "read");
          if (this.turns.get(id)?.stopped && page.generating) await this.page(session, "stop");
          this.apply(session, page);
        } catch (error) {
          this.fail(session, error);
        } finally {
          this.locks.delete(id);
        }
      }
    } finally {
      this.polling = false;
    }
  }
  dispose() {
    clearInterval(this.timer);
    for (const id of this.sessions.keys()) this.browser.keepAlive(id, false);
  }
}
