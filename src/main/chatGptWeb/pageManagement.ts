/** Public DOM only. These functions are serialized into the logged-in webview. */
function conversations() {
  if (location.origin !== "https://chatgpt.com") throw new Error("WEB_PAGE_CHANGED");
  const seen = new Set<string>();
  return [...document.querySelectorAll<HTMLAnchorElement>("nav a[href], aside a[href]")].flatMap(
    (link) => {
      const url = new URL(link.href);
      const id = /^(?:\/g\/[^/]+)?\/c\/([a-zA-Z0-9-]{8,})\/?$/.exec(url.pathname)?.[1];
      if (url.origin !== location.origin || !id || seen.has(id)) return [];
      seen.add(id);
      return [
        {
          url: `${location.origin}/c/${id}`,
          title: link.innerText?.trim() || link.textContent?.trim() || id,
        },
      ];
    },
  );
}

async function reasoning(option?: { id: string; label: string }) {
  if (location.origin !== "https://chatgpt.com") throw new Error("WEB_PAGE_CHANGED");
  const visible = (el: Element) =>
    el.getClientRects().length > 0 && !el.closest('[inert], [aria-hidden="true"]');
  const trigger = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-codex-intelligence-trigger]"),
  ].find(visible);
  if (!trigger || trigger.disabled || trigger.getAttribute("aria-disabled") === "true")
    throw new Error(
      "WEB_REASONING_UNAVAILABLE：当前网页未开放思考强度，请在网页中检查模型和账号权限。",
    );
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 100));
  if (trigger.getAttribute("aria-expanded") === "true")
    throw new Error("WEB_MENU_BUSY：请先关闭网页中已打开的模型菜单。");
  trigger.click();
  await pause();
  const menu = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  const control = menu?.querySelector<HTMLElement>("[data-reasoning-slider]");
  const slider = control?.querySelector<HTMLElement>('[role="slider"]');
  const escape = () =>
    menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  if (!menu || !control || !slider || !visible(control)) {
    escape();
    throw new Error("WEB_REASONING_UNAVAILABLE：网页思考强度控件已变化，请打开网页调整。");
  }
  const current = () => Number(slider.getAttribute("aria-valuenow"));
  const min = Number(slider.getAttribute("aria-valuemin"));
  const max = Number(slider.getAttribute("aria-valuemax"));
  const original = current();
  const label = () => {
    const statusId = control.getAttribute("aria-describedby")?.split(/\s+/)[0];
    return (
      slider.getAttribute("aria-valuetext") ||
      (statusId && document.getElementById(statusId)?.textContent) ||
      ""
    )
      .split(/[,，]/)[0]!
      .trim();
  };
  if (
    ![min, max, original].every(Number.isInteger) ||
    max - min > 10 ||
    min > original ||
    original > max
  ) {
    escape();
    throw new Error("WEB_REASONING_CHANGED：无法识别网页思考强度范围。");
  }
  const move = async (index: number) => {
    for (let n = 0; current() !== index && n < 12; n++) {
      const before = current();
      control.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: index > before ? "ArrowRight" : "ArrowLeft",
          bubbles: true,
        }),
      );
      await pause();
      if (current() === before) throw new Error("WEB_REASONING_CHANGED：网页未响应思考强度调整。");
    }
    if (current() !== index) throw new Error("WEB_REASONING_CHANGED：网页未确认思考强度。");
  };
  let keepSelection = false;
  try {
    if (option) {
      const index = Number(option.id);
      if (!Number.isInteger(index) || index < min || index > max)
        throw new Error("WEB_REASONING_CHANGED：该档位已不可用。");
      await move(index);
      if (label() !== option.label)
        throw new Error("WEB_REASONING_CHANGED：网页档位已变化，请重新打开思考强度菜单。");
      keepSelection = true;
      return { value: option.id, options: [{ ...option }] };
    }
    // The web slider exposes each label through its live announcement. Read it
    // using the native keyboard control, then restore the original preference.
    const options: { id: string; label: string }[] = [];
    for (let index = min; index <= max; index++) {
      await move(index);
      const text = label();
      if (!text) throw new Error("WEB_REASONING_CHANGED：无法读取网页档位名称。");
      options.push({ id: String(index), label: text });
    }
    return { value: String(original), options };
  } finally {
    try {
      if (!keepSelection) await move(original);
    } finally {
      escape();
    }
  }
}

function deletion(
  stage: "open" | "choose" | "confirm" | "state",
  expectedUrl: string,
  title: string,
) {
  if (location.origin !== "https://chatgpt.com") throw new Error("WEB_PAGE_CHANGED");
  const path = new URL(expectedUrl).pathname;
  const visible = (el: Element) =>
    el.getClientRects().length > 0 && !el.closest('[inert], [aria-hidden="true"]');
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"]',
    ),
  ].filter(visible);
  if (stage === "state") {
    const error = [...document.querySelectorAll<HTMLElement>('[role="alert"]')].find(
      visible,
    )?.textContent;
    if (error) throw new Error(`WEB_DELETE_FAILED：${error}`);
    return (
      location.pathname === "/" &&
      !dialogs.length &&
      ![...document.querySelectorAll<HTMLAnchorElement>("nav a[href], aside a[href]")].some((a) =>
        new URL(a.href).pathname.endsWith(path),
      )
    );
  }
  if (!location.pathname.endsWith(path))
    throw new Error("WEB_PAGE_CHANGED：网页会话已切换，未执行删除。");
  const triggers = [
    ...document.querySelectorAll<HTMLButtonElement>(
      'main header button[aria-haspopup="menu"], header button[data-testid="conversation-options-button"]',
    ),
  ].filter(
    (b) =>
      visible(b) &&
      /^(更多|More|Open conversation options)$/.test(b.getAttribute("aria-label") ?? ""),
  );
  const trigger = triggers.length === 1 ? triggers[0] : undefined;
  if (stage === "open") {
    if (
      dialogs.length ||
      !trigger ||
      trigger.disabled ||
      trigger.getAttribute("aria-expanded") === "true"
    )
      throw new Error("WEB_DELETE_UNAVAILABLE：请关闭网页弹窗，并检查当前对话的操作菜单。");
    trigger.click();
    return true;
  }
  if (stage === "choose") {
    const menu = trigger && document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    const item =
      menu &&
      [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (el) => visible(el) && /^(删除|Delete|Delete chat)$/.test(el.textContent?.trim() ?? ""),
      );
    if (!item || item.getAttribute("aria-disabled") === "true")
      throw new Error("WEB_DELETE_UNAVAILABLE：网页删除菜单不可用。");
    item.click();
    return true;
  }
  const dialog = dialogs.find(
    (d) =>
      /删除|Delete/i.test(d.querySelector("h2")?.textContent ?? "") &&
      title &&
      d.textContent?.includes(title),
  );
  const confirm =
    dialog &&
    [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => visible(b) && /^(删除聊天|删除|Delete chat|Delete)$/.test(b.textContent?.trim() ?? ""),
    );
  if (!confirm || confirm.disabled)
    throw new Error("WEB_DELETE_UNAVAILABLE：未确认网页删除目标，未执行删除。");
  confirm.click();
  return true;
}

export const chatGptConversationsScript = `(${conversations.toString()})()`;
export const chatGptReasoningScript = (option?: { id: string; label: string }) =>
  `(${reasoning.toString()})(${JSON.stringify(option)})`;
export const chatGptDeleteScript = (
  stage: Parameters<typeof deletion>[0],
  url: string,
  title: string,
) =>
  `(${deletion.toString()})(${JSON.stringify(stage)}, ${JSON.stringify(url)}, ${JSON.stringify(title)})`;
