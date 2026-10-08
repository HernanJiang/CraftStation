#!/usr/bin/env node
// 真实 renderer → preload → main → webview；网页响应使用本地固定内容。
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { resolveDebugConnection } from "./craftstation-debug-session.mjs";
import { inspectCdpWindowTargets } from "./craftstation-cdp-target.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, i, all) =>
        value.startsWith("--") ? [...pairs, [value.slice(2), all[i + 1]]] : pairs,
      [],
    ),
);
const connection = await resolveDebugConnection({
  session: args.session,
  repoRoot: resolve(import.meta.dirname, "../../../.."),
  allowedPurposes: ["debug", "smoke"],
});
if (connection.mode !== "mock")
  throw new Error("固定网页测试只允许隔离的 mock 会话，禁止改动真实浏览器会话。");
const outDir = args.outDir ?? join(connection.root ?? resolve("ai_workspace"), "webchat-smoke");
await mkdir(outDir, { recursive: true });
const targets = await inspectCdpWindowTargets({ port: connection.port, appUrl: connection.appUrl });
const app = await connect(targets.ready[0]);
let page;
const checks = [];
const errors = [];
let session;
const fixture = `<!doctype html><meta charset="utf-8"><title>ChatGPT 同步测试网页</title><style>body{font:16px sans-serif;color:#eee;background:#171717}.ProseMirror{width:80%;height:60px}button{padding:10px}</style><main></main><div class="ProseMirror" contenteditable="true" role="textbox"></div><button data-testid="send-button" disabled>发送</button><script>
const editor=document.querySelector('.ProseMirror'),send=document.querySelector('button'),main=document.querySelector('main');window.webchatSends=0;window.webchatStops=0;
editor.oninput=()=>send.disabled=!editor.innerText.trim();
send.onclick=()=>{window.webchatSends++;const n=window.webchatSends;const user=document.createElement('div');user.dataset.userMessageBubble='true';user.textContent=editor.innerText;main.append(user);editor.innerHTML='';send.disabled=true;const answer=document.createElement('div');answer.dataset.markdownTextStyle='assistant-message';answer.innerHTML='<div data-dil-source-message-id="answer-'+n+'"><p>第一段正在生成 '+n+'</p></div>';main.append(answer);const stop=document.createElement('button');stop.setAttribute('aria-label','停止');stop.textContent='停止';document.body.append(stop);const timer=setTimeout(()=>{answer.innerHTML='<div data-dil-source-message-id="answer-'+n+'"><p>第一段完成</p><p>第二段完成</p><pre><code class="language-js">const x = 1;</code></pre><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span></div>';stop.remove();send.disabled=false},1800);stop.onclick=()=>{window.webchatStops++;clearTimeout(timer);stop.remove();send.disabled=false};};
</script>`;

try {
  await app.send("Runtime.enable");
  app.on("Runtime.exceptionThrown", (e) => errors.push(e.exceptionDetails.text));
  await evalApp(
    "window.craftstation.browserGetState().then(async s=>{for(const tab of s.tabs)await window.craftstation.browserCloseTab({tabId:tab.tabId})})",
    true,
  );
  await click('[data-testid="titlebar-chatgpt-web"]');
  await wait(async () =>
    Boolean(await evalApp("document.querySelector('[data-testid=chatgpt-web-page]') !== null")),
  );
  const previousIds = new Set(
    (await evalApp("window.craftstation.webChatList()", true)).map((s) => s.id),
  );
  await evalApp(
    "[...document.querySelectorAll('[data-testid=chatgpt-web-page] button')].find(b=>/新对话|New conversation/.test(b.textContent)).click()",
  );
  await wait(async () => {
    const list = await evalApp("window.craftstation.webChatList()", true);
    session = list.find((s) => !previousIds.has(s.id));
    return Boolean(session?.tabId);
  });
  let browserTarget;
  await wait(async () => {
    const tabs = await (await fetch(`http://127.0.0.1:${connection.port}/json/list`)).json();
    browserTarget = tabs.find((t) => t.url.startsWith("https://chatgpt.com"));
    return Boolean(browserTarget);
  });
  page = await connect(browserTarget);
  page.on("Fetch.requestPaused", (event) => {
    void page.send("Fetch.fulfillRequest", {
      requestId: event.requestId,
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
      body: Buffer.from(fixture).toString("base64"),
    });
  });
  await page.send("Fetch.enable", {
    patterns: [
      { urlPattern: "https://chatgpt.com/*", resourceType: "Document", requestStage: "Request" },
    ],
  });
  await page.send("Page.navigate", { url: "https://chatgpt.com/c/craftstation-webchat-fixture" });
  await wait(async () => await evalPage("Boolean(document.querySelector('.ProseMirror'))"));
  // 首次导航可能触发登录/连接提示；显式重新连接。
  await evalApp(
    `window.craftstation.webChatReveal({sessionId:${JSON.stringify(session.id)}})`,
    true,
  );
  await wait(
    async () =>
      (
        await evalApp(
          `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
          true,
        )
      ).status === "ready",
  );
  await input("第一轮中文测试");
  await click('[data-testid="chatgpt-web-page"] button.craftstation-composer-send');
  await wait(async () =>
    (await evalApp("document.querySelector('[data-testid=chatgpt-web-page]').innerText")).includes(
      "第一段正在生成",
    ),
  );
  checks.push("输入框 → 网页提交 → 第一段实时回显");
  await wait(
    async () =>
      (
        await evalApp(
          `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
          true,
        )
      ).status === "ready",
  );
  await wait(async () =>
    Boolean(
      await evalApp(
        "Boolean(document.querySelector('[data-testid=chatgpt-web-page] table') && [...document.querySelectorAll('[data-testid=chatgpt-web-page] .katex-html')].some(el=>el.textContent.includes('x') && el.getBoundingClientRect().height>0))",
      ),
    ),
  );
  if ((await evalPage("window.webchatSends")) !== 1) throw new Error("重复发送");
  const text = await evalApp("document.querySelector('[data-testid=chatgpt-web-page]').innerText");
  if (text.includes("第一段正在生成")) throw new Error("流式快照被追加，没有替换");
  checks.push("完整回复替换快照，代码、表格、公式正常渲染；发送一次");
  await wait(
    async () =>
      await evalApp(
        "Boolean(document.querySelector('[data-testid=chatgpt-web-page] button.craftstation-composer-send[aria-label=\"Send\"]'))",
      ),
  );
  const shot = await app.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outDir, "chatgpt-web-complete.png"), Buffer.from(shot.data, "base64"));
  await evalPage(
    "document.body.insertAdjacentHTML('beforeend','<div role=\"status\" data-dil-render-failed>无法加载此回复</div>')",
  );
  await wait(
    async () =>
      (
        await evalApp(
          `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
          true,
        )
      ).status === "error",
  );
  await wait(async () =>
    (await evalApp("document.querySelector('[data-testid=chatgpt-web-page]').innerText")).includes(
      "无法加载此回复",
    ),
  );
  await evalPage("document.querySelector('[data-dil-render-failed]').remove()");
  await evalApp(
    `window.craftstation.webChatReveal({sessionId:${JSON.stringify(session.id)}})`,
    true,
  );
  await wait(
    async () =>
      (
        await evalApp(
          `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
          true,
        )
      ).status === "ready",
  );
  if ((await evalPage("window.webchatSends")) !== 1) throw new Error("重连重复发送");
  checks.push("网页回复加载失败显示为错误；显式重连后恢复且不重发");
  await input("第二轮停止测试");
  await click('[data-testid="chatgpt-web-page"] button.craftstation-composer-send');
  await wait(
    async () => await evalPage("Boolean(document.querySelector('button[aria-label=\"停止\"]'))"),
  );
  await wait(async () =>
    Boolean(
      await evalApp(
        "Boolean(document.querySelector('[data-testid=chatgpt-web-page] button[aria-label=\"Stop response\"]'))",
      ),
    ),
  );
  await click('[data-testid="chatgpt-web-page"] button[aria-label="Stop response"]');
  await wait(
    async () =>
      (
        await evalApp(
          `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
          true,
        )
      ).status === "ready",
  );
  if ((await evalPage("window.webchatStops")) !== 1) throw new Error("停止没有传递到网页");
  if ((await evalPage("window.webchatSends")) !== 2) throw new Error("第二轮重复发送");
  checks.push("第二轮对话、真实停止按钮、部分回复保留");
  await input("第三轮断线测试");
  await click('[data-testid="chatgpt-web-page"] button.craftstation-composer-send');
  await wait(
    async () => await evalPage("Boolean(document.querySelector('button[aria-label=\"停止\"]'))"),
  );
  await evalApp(
    `window.craftstation.browserCloseTab({tabId:${JSON.stringify(session.tabId)}})`,
    true,
  );
  await wait(
    async () =>
      (
        await evalApp(
          `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
          true,
        )
      ).status === "error",
  );
  const tabsAfter = await evalApp("window.craftstation.browserGetState()", true);
  if (tabsAfter.tabs.some((t) => t.tabId === session.tabId)) throw new Error("关闭失败");
  checks.push("活动回合关闭网页 → 断线提示，不自动重发");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ status: "passed", mode: "fixture", checks, errors }, null, 2));
  await writeFile(
    join(outDir, "report.json"),
    JSON.stringify({ status: "passed", mode: "fixture", checks, errors }, null, 2),
  );
} finally {
  await evalApp(
    "document.querySelector('[data-testid=chatgpt-web-page] header button')?.click()",
  ).catch(() => undefined);
  page?.close();
  app.close();
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    ws.onopen = done;
    ws.onerror = reject;
  });
  const pending = new Map();
  const listeners = new Map();
  let seq = 0;
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method) listeners.get(message.method)?.(message.params);
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    clearTimeout(p.timer);
    if (message.error) p.reject(new Error(JSON.stringify(message.error)));
    else p.resolve(message.result);
  });
  return {
    on: (name, listener) => listeners.set(name, listener),
    send: (method, params = {}) =>
      new Promise((done, reject) => {
        const id = ++seq;
        pending.set(id, {
          resolve: done,
          reject,
          timer: setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP timeout: ${method}`));
          }, 10_000),
        });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => ws.close(),
  };
}
async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
function evalApp(expression, awaitPromise) {
  return evaluate(app, expression, awaitPromise);
}
function evalPage(expression, awaitPromise) {
  return evaluate(page, expression, awaitPromise);
}
async function wait(check) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error("等待网页同步检查超时");
}
async function click(selector) {
  const rect = await evalApp(
    `(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('缺少按钮');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await app.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    ...rect,
  });
  await app.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    ...rect,
  });
}
async function input(text) {
  await evalApp("document.querySelector('[data-testid=chatgpt-web-page] textarea').focus()");
  await app.send("Input.insertText", { text });
  await wait(
    async () =>
      await evalApp(
        "(() => {const b=document.querySelector('[data-testid=chatgpt-web-page] button.craftstation-composer-send');return Boolean(b && !b.disabled && /^(Send|发送)$/.test(b.getAttribute('aria-label')));})()",
      ),
  );
}
