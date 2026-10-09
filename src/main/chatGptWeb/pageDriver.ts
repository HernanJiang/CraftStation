import { chatGptWidgetScript } from "./pageWidgets";
import type { WebChatWidget } from "@/shared/chatGptWeb";
/** Executed in the page's isolated browser context. Keep this function self-contained. */
export function chatGptPage(action: "read" | "send" | "stop", prompt = "") {
  if (location.origin !== "https://chatgpt.com")
    return {
      url: location.href,
      title: "",
      reasoningLabel: undefined as string | undefined,
      messages: [] as { id: string; role: "user" | "assistant"; text: string }[],
      generating: false,
      ready: false,
      loginRequired: false,
      error: "网页地址已变化",
      action: "wrong-origin",
    };
  const visible = (el: Element) => el.getClientRects().length > 0;
  const find = (selector: string) =>
    [...document.querySelectorAll<HTMLElement>(selector)].find(visible);
  const editor = find(
    '#prompt-textarea, #pending-home-input, textarea[name="prompt-textarea"], .ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"]',
  );
  const stop = find(
    '[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="停止生成"], button[aria-label="停止"], button[aria-label="Stop"]',
  );
  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/([\\`*[\]])/g, "\\$1");
  const markdown = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? "");
    if (!(node instanceof Element)) return "";
    const tag = node.tagName.toLowerCase();
    if (["button", "script", "style", "svg"].includes(tag)) return "";
    const math =
      node.matches(".katex, math") &&
      node.querySelector('annotation[encoding="application/x-tex"]');
    if (math)
      return `${node.closest(".katex-display") ? "\n\n$$\n" : "$"}${math.textContent}${node.closest(".katex-display") ? "\n$$\n\n" : "$"}`;
    if (node.getAttribute("aria-hidden") === "true") return "";
    if (tag === "pre") {
      const code = node.querySelector("code") ?? node;
      const text = code.textContent ?? "";
      const language = /language-([\w+-]+)/.exec(code.className)?.[1] ?? "";
      const fence = "`".repeat(
        Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
      );
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    }
    if (tag === "code") {
      const text = node.textContent ?? "";
      const fence = "`".repeat(
        Math.max(1, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
      );
      return `${fence} ${text} ${fence}`;
    }
    if (tag === "table") {
      const rows = [...node.querySelectorAll("tr")].map((row) =>
        [...row.children].map((cell) =>
          markdown(cell).trim().replace(/\|/g, "\\|").replace(/\n/g, "<br>"),
        ),
      );
      const count = Math.max(0, ...rows.map((row) => row.length));
      const line = (row: string[]) =>
        `| ${Array.from({ length: count }, (_, i) => row[i] ?? "").join(" | ")} |`;
      return rows.length
        ? `\n\n${line(rows[0]!)}\n${line(Array<string>(count).fill("---"))}\n${rows.slice(1).map(line).join("\n")}\n\n`
        : "";
    }
    const inner = [...node.childNodes].map(markdown).join("");
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${inner}**`;
    if (tag === "em" || tag === "i") return `*${inner}*`;
    if (tag === "a") {
      const href = node.getAttribute("href") ?? "";
      try {
        const url = new URL(href, location.href);
        return /^https?:$/.test(url.protocol)
          ? `[${inner || escape(url.hostname)}](${url.href.replace(/\(/g, "%28").replace(/\)/g, "%29")})`
          : inner;
      } catch {
        return inner;
      }
    }
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${inner}\n\n`;
    if (tag === "li") {
      const ordered = node.parentElement?.tagName === "OL";
      const index = node.parentElement ? [...node.parentElement.children].indexOf(node) + 1 : 1;
      return `\n${ordered ? `${index}.` : "-"} ${inner.trim().replace(/\n/g, "\n  ")}`;
    }
    if (tag === "blockquote")
      return `\n\n${inner
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    if (tag === "hr") return "\n\n---\n\n";
    if (["p", "div", "ul", "ol", "section"].includes(tag)) return `\n\n${inner}\n\n`;
    return inner;
  };
  const oldMessages = [...document.querySelectorAll<HTMLElement>("[data-message-author-role]")];
  const messageNodes = oldMessages.length
    ? oldMessages
    : [
        ...document.querySelectorAll<HTMLElement>(
          '[data-user-message-bubble], [data-markdown-text-style="assistant-message"]',
        ),
      ];
  const messages = messageNodes.flatMap((el, index) => {
    const role =
      el.getAttribute("data-message-author-role") ??
      (el.hasAttribute("data-user-message-bubble") ? "user" : "assistant");
    if (role !== "user" && role !== "assistant") return [];
    const body = el.querySelector(".markdown, .whitespace-pre-wrap") ?? el;
    const id =
      el.getAttribute("data-message-id") ??
      el.closest("[data-message-id]")?.getAttribute("data-message-id") ??
      el
        .querySelector("[data-dil-source-message-id]")
        ?.getAttribute("data-dil-source-message-id") ??
      el.closest("[data-turn-id]")?.getAttribute("data-turn-id")?.concat(`-${role}`) ??
      el
        .closest('[data-testid^="conversation-turn-"]')
        ?.getAttribute("data-testid")
        ?.concat(`-${role}`) ??
      `web-${index}`;
    return [
      {
        id,
        role: role as "user" | "assistant",
        text: markdown(body)
          .replace(/\n{3,}/g, "\n\n")
          .trim(),
      },
    ];
  });
  const reasoningTrigger = find("[data-codex-intelligence-trigger]");
  const snapshot = {
    url: location.href,
    title: document.title.replace(/\s*[-–]\s*ChatGPT$/, ""),
    reasoningLabel: (reasoningTrigger?.innerText || reasoningTrigger?.textContent)?.trim(),
    messages,
    generating: Boolean(stop),
    ready: Boolean(editor),
    loginRequired:
      Boolean(
        find(
          '[data-testid="login-button"], a[href*="/auth/login"], button[data-testid="login-button"]',
        ),
      ) || /^\/auth\//.test(location.pathname),
    error: [...document.querySelectorAll<HTMLElement>('[role="alert"], [data-dil-render-failed]')]
      .filter(visible)
      .map((el) => el.innerText || el.textContent)
      .filter(Boolean)
      .join("\n"),
  };
  if (action === "stop") {
    if (stop) stop.click();
    return { ...snapshot, action: stop ? "stopping" : "idle" };
  }
  if (action === "send") {
    if (!editor || stop) return { ...snapshot, action: "unavailable" };
    const draft = editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText;
    if (draft.trim()) return { ...snapshot, action: "draft-exists" };
    editor.focus();
    if (editor instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        editor,
        prompt,
      );
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const selection = getSelection();
      selection?.selectAllChildren(editor);
      if (!document.execCommand("insertText", false, prompt))
        return { ...snapshot, action: "editor-unsupported" };
    }
    // Readiness is checked again by the caller after React has processed input.
    return { ...snapshot, action: "filled" };
  }
  return { ...snapshot, action: "read" };
}

export type ChatGptPageSnapshot = Omit<ReturnType<typeof chatGptPage>, "messages"> & {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    widgets?: WebChatWidget[];
  }>;
};
export const chatGptPageScript = (action: "read" | "send" | "stop", prompt?: string) =>
  `(() => { const snapshot = (${chatGptPage.toString()})(${JSON.stringify(action)}, ${JSON.stringify(prompt ?? "")}); if (location.origin === "https://chatgpt.com") { const result = ${chatGptWidgetScript("discover")}; snapshot.messages = snapshot.messages.map(m => ({...m, widgets: result.widgets.filter(w => w.messageId === m.id).map(({messageId, ...w}) => w)})); } return snapshot; })()`;

/** A separate click after the input event; never retry a possibly accepted click. */
export const chatGptSubmitScript = `(() => {
  if (location.origin !== 'https://chatgpt.com') return false;
  const editor = document.querySelector('#prompt-textarea, #pending-home-input, textarea[name="prompt-textarea"], .ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"]');
  const button = [...document.querySelectorAll('[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="发送提示"], button[aria-label="发送"], button[aria-label="Send"]')].find(el => el.getClientRects().length > 0);
  if (!editor || !button || button.disabled) return false;
  button.click(); return true;
})()`;

/** 用户请求登录时，使用官网自己的入口，不读取或填写凭据。 */
export const chatGptLoginScript = `(() => {
  if (location.origin !== 'https://chatgpt.com') return false;
  const button = [...document.querySelectorAll('[data-testid="login-button"], a[href*="/auth/login"], button')].find(el => el.getClientRects().length > 0 && (el.matches('[data-testid="login-button"], a[href*="/auth/login"]') || /^(Log in|Login|登录)$/i.test((el.textContent || '').trim())));
  if (!button) return false;
  button.click(); return true;
})()`;
