import type { WebChatWidget } from "@/shared/chatGptWeb";

/** Runs only in the original page. No iframe source, auth state or script is copied. */
export function chatGptWidgets(
  action: "discover" | "locate",
  widgetId = "",
  expectedUrl = "",
  scroll = false,
) {
  if (location.origin !== "https://chatgpt.com")
    throw new Error("WEB_WIDGET_ORIGIN：网页地址已变化。");
  if (expectedUrl && new URL(expectedUrl).pathname !== location.pathname)
    throw new Error("WEB_PAGE_CHANGED：当前网页不是这个会话。");
  const oldNodes = [...document.querySelectorAll<HTMLElement>("[data-message-author-role]")];
  const nodes = oldNodes.length
    ? oldNodes
    : [
        ...document.querySelectorAll<HTMLElement>(
          '[data-user-message-bubble], [data-markdown-text-style="assistant-message"]',
        ),
      ];
  const widgets: Array<WebChatWidget & { messageId: string }> = [];
  const targets = new Map<string, HTMLElement>();
  nodes.forEach((node, index) => {
    const role =
      node.getAttribute("data-message-author-role") ??
      (node.hasAttribute("data-user-message-bubble") ? "user" : "assistant");
    if (role !== "assistant") return;
    const messageId =
      node.getAttribute("data-message-id") ??
      node.closest("[data-message-id]")?.getAttribute("data-message-id") ??
      node
        .querySelector("[data-dil-source-message-id]")
        ?.getAttribute("data-dil-source-message-id") ??
      node.closest("[data-turn-id]")?.getAttribute("data-turn-id")?.concat(`-${role}`) ??
      node
        .closest('[data-testid^="conversation-turn-"]')
        ?.getAttribute("data-testid")
        ?.concat(`-${role}`) ??
      `web-${index}`;
    // Components often sit beside .markdown rather than inside it. Scope to
    // this assistant turn, never the account sidebar or global page controls.
    const root =
      node.closest<HTMLElement>('[data-testid^="conversation-turn-"], [data-turn-id]') ?? node;
    const candidates = [
      ...root.querySelectorAll<HTMLElement>(
        '[data-dil-root], [data-dil-id], [data-testid*="visualization"], [data-testid*="widget"], [data-testid*="artifact"], iframe, canvas, svg[role="img"]',
      ),
    ].filter(
      (el) =>
        !el.closest('pre, .katex, [data-message-author-role="user"]') &&
        el.getBoundingClientRect().width >= 80 &&
        el.getBoundingClientRect().height >= 40,
    );
    const outer = candidates.filter(
      (el) => !candidates.some((parent) => parent !== el && parent.contains(el)),
    );
    const entries = outer.slice(0, 29).map((el, i) => ({
      el,
      id: `${messageId}:widget:${i}`,
      kind: (el.tagName === "CANVAS" || el.tagName === "svg"
        ? "chart"
        : "app") as WebChatWidget["kind"],
      title: (
        el.getAttribute("title") ||
        el.getAttribute("aria-label") ||
        el.querySelector("h1,h2,h3")?.textContent ||
        `交互组件 ${i + 1}`
      )
        .trim()
        .slice(0, 300),
    }));
    entries.push({ el: root, id: `${messageId}:response`, kind: "response", title: "原网页回复" });
    for (const { el, id, kind, title } of entries) {
      widgets.push({ id, messageId, kind, title });
      targets.set(id, el);
    }
  });
  if (action === "discover") return { widgets };
  const target = targets.get(widgetId);
  if (!target)
    throw new Error("WEB_WIDGET_MISSING：组件尚未加载或网页结构已变化，请刷新或打开原网页。");
  const before = target.getBoundingClientRect();
  if (
    scroll &&
    (before.top < 0 || before.bottom > innerHeight || before.left < 0 || before.right > innerWidth)
  )
    target.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
  const rect = target.getBoundingClientRect();
  const x = Math.max(0, Math.ceil(rect.x)),
    y = Math.max(0, Math.ceil(rect.y));
  const width = Math.floor(Math.min(rect.right, innerWidth, x + 1600) - x);
  const height = Math.floor(Math.min(rect.bottom, innerHeight, y + 1200) - y);
  if (width < 40 || height < 30)
    throw new Error("WEB_WIDGET_HIDDEN：组件不在可见区域，请打开原网页。");
  let token = target.getAttribute("data-craftstation-widget-token");
  if (!token) {
    token = crypto.randomUUID();
    target.setAttribute("data-craftstation-widget-token", token);
  }
  return { widgets, bounds: { x, y, width, height }, token, url: location.href };
}

export const chatGptWidgetScript = (
  action: "discover" | "locate",
  widgetId?: string,
  url?: string,
  scroll?: boolean,
) =>
  `(${chatGptWidgets.toString()})(${JSON.stringify(action)},${JSON.stringify(widgetId ?? "")},${JSON.stringify(url ?? "")},${Boolean(scroll)})`;
export type WebChatWidgetLocation = {
  bounds: { x: number; y: number; width: number; height: number };
  token: string;
  url: string;
};
