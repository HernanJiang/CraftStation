#!/usr/bin/env node
// 真实 renderer → preload → main → webview；网页响应使用本地固定内容。
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { resolveDebugConnection } from "./craftstation-debug-session.mjs";
import { inspectCdpWindowTargets } from "./craftstation-cdp-target.mjs";
import { runWidgetChecks } from "./webchat-widget-fixture.mjs";

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
await app.send("Emulation.clearDeviceMetricsOverride");
await app.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await app.send("Page.setWebLifecycleState", { state: "active" });
await evaluate(app, "window.craftstation.focusWindow()", true);
let page;
const checks = [];
const errors = [];
let failed = false;
let session;
const fixture = `<!doctype html><meta charset="utf-8"><title>ChatGPT 同步测试网页</title><style>body{font:16px sans-serif;color:#eee;background:#171717}.ProseMirror{width:80%;height:60px}button{padding:10px}</style><main></main><div class="ProseMirror" contenteditable="true" role="textbox"></div><button data-testid="send-button" disabled>发送</button><script>
const editor=document.querySelector('.ProseMirror'),send=document.querySelector('button'),main=document.querySelector('main');window.webchatSends=0;window.webchatStops=0;
editor.oninput=()=>send.disabled=!editor.innerText.trim();
send.onclick=()=>{window.webchatSends++;const n=window.webchatSends;const user=document.createElement('div');user.dataset.userMessageBubble='true';user.textContent=editor.innerText;main.append(user);editor.innerHTML='';send.disabled=true;const answer=document.createElement('div');answer.dataset.markdownTextStyle='assistant-message';answer.innerHTML='<div data-dil-source-message-id="answer-'+n+'"><p>第一段正在生成 '+n+'</p></div>';main.append(answer);const stop=document.createElement('button');stop.setAttribute('aria-label','停止');stop.textContent='停止';document.body.append(stop);const timer=setTimeout(()=>{answer.innerHTML='<div data-dil-source-message-id="answer-'+n+'"><p>第一段完成</p><p>第二段完成</p><pre><code class="language-js">const x = 1;</code></pre><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span></div>';stop.remove();send.disabled=false},1800);stop.onclick=()=>{window.webchatStops++;clearTimeout(timer);stop.remove();send.disabled=false};};
document.body.insertAdjacentHTML('afterbegin','<nav><a href="'+location.pathname+'">ChatGPT 同步测试网页</a><a href="/c/older-conversation">历史对话</a></nav>');
main.insertAdjacentHTML('afterbegin','<header><button aria-label="更多" aria-haspopup="menu">更多</button></header>');
const more=document.querySelector('button[aria-label="更多"]');window.webchatDeletes=0;
more.onclick=()=>{more.setAttribute('aria-controls','conversation-menu');document.body.insertAdjacentHTML('beforeend','<div role="menu" id="conversation-menu"><div role="menuitem">删除</div></div>');document.querySelector('#conversation-menu [role=menuitem]').onclick=()=>{document.querySelector('#conversation-menu').remove();document.body.insertAdjacentHTML('beforeend','<div role="dialog" aria-modal="true"><h2>删除聊天？</h2><p>永久删除“ChatGPT 同步测试网页”</p><button>取消</button><button type="submit">删除聊天</button></div>');const dialog=document.querySelector('[role=dialog]');dialog.querySelector('[type=submit]').onclick=()=>{window.webchatDeletes++;document.querySelector('nav a').remove();dialog.remove();history.replaceState({},'', '/');};};};
document.body.insertAdjacentHTML('beforeend','<button data-codex-intelligence-trigger aria-haspopup="menu" aria-expanded="false">中</button>');
const reasoning=document.querySelector('[data-codex-intelligence-trigger]'),labels=['即时','中','高','极高','Pro'];window.webchatEffort=1;
reasoning.onclick=()=>{reasoning.setAttribute('aria-expanded','true');reasoning.setAttribute('aria-controls','reasoning-menu');document.body.insertAdjacentHTML('beforeend','<div role="menu" id="reasoning-menu"><span role="status" id="effort-status">'+labels[window.webchatEffort]+', 第 '+(window.webchatEffort+1)+' 项</span><div role="menuitem" data-reasoning-slider aria-describedby="effort-status"><span aria-hidden="true" role="slider" aria-valuemin="0" aria-valuemax="4" aria-valuenow="'+window.webchatEffort+'"></span></div></div>');const menu=document.querySelector('#reasoning-menu');menu.onkeydown=e=>{if(e.key==='Escape'){menu.remove();reasoning.setAttribute('aria-expanded','false');return;}if(!e.target.hasAttribute('data-reasoning-slider'))return;window.webchatEffort=Math.max(0,Math.min(4,window.webchatEffort+(e.key==='ArrowRight'?1:-1)));menu.querySelector('[role=slider]').setAttribute('aria-valuenow',String(window.webchatEffort));menu.querySelector('[role=status]').textContent=labels[window.webchatEffort]+', 第 '+(window.webchatEffort+1)+' 项';reasoning.textContent=labels[window.webchatEffort];};};
</script>`;

try {
  await app.send("Runtime.enable");
  app.on("Runtime.exceptionThrown", (e) => errors.push(e.exceptionDetails.text));
  await evalApp(
    "window.craftstation.browserGetState().then(async s=>{for(const tab of s.tabs)await window.craftstation.browserCloseTab({tabId:tab.tabId})})",
    true,
  );
  await press('[aria-label="CraftStation"]', "^New$|^新增$");
  await selectMenuOption("新增网页对话|New web conversation");
  await selectMenuOption("ChatGPT 网页对话|ChatGPT web conversation");
  await wait(async () =>
    Boolean(
      await evalApp(
        "Boolean(document.querySelector('[data-testid=chatgpt-web-page] [data-universal-docked-chat-input] [data-draft-context-bar]'))",
      ),
    ),
  );
  const layout = await evalApp(
    "(()=>{const p=document.querySelector('[data-testid=chatgpt-web-page]');const b=p.querySelector('[data-testid=webchat-thinking]');return {thinkingBelow:Boolean(b?.closest('.craftstation-composer-toolbar')),quota:Boolean(p.querySelector('[data-testid=context-quota-ring]')),remote:p.innerText.includes('Web remote')||p.innerText.includes('网页远程')};})()",
  );
  if (!layout.thinkingBelow || layout.quota || !layout.remote)
    throw Error("网页输入框布局或虚构上下文额度");
  if (await browserVisible()) throw Error("新增网页对话自动打开了浏览器");
  checks.push("新增 → 网页对话 → ChatGPT；共享输入框与网页远程标识，底部思考强度，无上下文环");
  await click('[data-testid=chatgpt-web-page] button[aria-label="Conversation runtime"]');
  await selectMenuOption("^Local$|^本地$");
  await wait(
    async () =>
      !(await evalApp("Boolean(document.querySelector('[data-testid=chatgpt-web-page]'))")),
  );
  await wait(async () =>
    Boolean(
      await evalApp(
        "Boolean(document.querySelector('[data-draft-context-bar] button[aria-label=\"Conversation runtime\"]'))",
      ),
    ),
  );
  const editor = await evalApp(
    "Boolean(document.querySelector('.craftstation-mention-input[contenteditable=true]'))",
  );
  if (editor) {
    await evalApp(
      "document.querySelector('.craftstation-mention-input[contenteditable=true]').focus()",
    );
    await app.send("Input.insertText", { text: "切换运行方式保留草稿" });
  }
  await click('[data-draft-context-bar] button[aria-label="Conversation runtime"]');
  await selectMenuOption("^Web remote$|^网页远程$");
  await wait(async () =>
    Boolean(
      await evalApp("Boolean(document.querySelector('[data-testid=chatgpt-web-page] textarea'))"),
    ),
  );
  if (editor)
    await wait(
      async () =>
        (await evalApp(
          "document.querySelector('[data-testid=chatgpt-web-page] textarea').value",
        )) === "切换运行方式保留草稿",
    );
  checks.push("未发送页面可双向切换本地 / 网页远程，保留已有文字草稿");
  await press("[data-testid=chatgpt-web-page] header", "新对话|New conversation");
  // 用户显式打开网页时，必须展示同一账号的官方页面。
  const previousIds = new Set(
    (await evalApp("window.craftstation.webChatList()", true)).map((s) => s.id),
  );
  await press("[data-testid=chatgpt-web-page] header", "打开网页|Open website");
  await wait(async () => {
    session = (await evalApp("window.craftstation.webChatList()", true)).find(
      (s) => !previousIds.has(s.id),
    );
    return Boolean(session?.tabId);
  });
  await attachFixture("https://chatgpt.com/c/craftstation-webchat-fixture");
  await hideBrowser();
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
  await evalPage(
    "document.body.insertAdjacentHTML('beforeend','<button data-testid=\"login-button\">登录</button>')",
  );
  await click('[data-testid="chatgpt-web-page"] button.craftstation-composer-send');
  await wait(async () => await browserVisible());
  if (
    (await evalPage("window.webchatSends")) !== 0 ||
    (await evalApp("document.querySelector('[data-testid=chatgpt-web-page] textarea').value")) !==
      "第一轮中文测试"
  )
    throw Error("未登录时发送或丢失草稿");
  await evalPage("document.querySelector('[data-testid=login-button]').remove()");
  await hideBrowser();
  await wait(
    async () =>
      (
        await evalApp(
          `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
          true,
        )
      ).status === "ready",
  );
  if ((await evalPage("window.webchatSends")) !== 0) throw Error("登录恢复后擅自发送草稿");
  checks.push("未登录时打开官方侧边网页且保留输入；登录后等待用户发送，不自动重发");
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
  await runWidgetChecks({
    evalPage,
    evalApp,
    app,
    wait,
    click,
    press,
    checks,
    session,
    outDir,
    writeFile,
    join,
  });
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
  await wait(
    async () =>
      await evalApp(
        `Boolean(document.querySelector('[data-testid=sidebar-web-remote] [data-webchat-sidebar-session="${session.id}"]'))`,
      ),
  );
  const row = await evalApp(
    `(()=>{const e=document.querySelector('[data-testid=sidebar-web-remote] [data-webchat-sidebar-session="${session.id}"]');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,text:e.innerText};})()`,
  );
  if (!row.text.includes("Remote")) throw Error("远程行缺少固定标识");
  await app.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "right",
    clickCount: 1,
    x: row.x,
    y: row.y,
  });
  await app.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "right",
    clickCount: 1,
    x: row.x,
    y: row.y,
  });
  await selectMenuOption("^Pin$|^置顶$");
  await wait(
    async () =>
      await evalApp(
        `Boolean(document.querySelector('section[aria-label=Pinned] [data-webchat-sidebar-session="${session.id}"]'))`,
      ),
  );
  checks.push("新网页会话归入远程，Remote 标识固定显示，右键置顶进入全局置顶区");
  await hideBrowser();
  await app.send("Emulation.setDeviceMetricsOverride", {
    width: 480,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await input("第二轮停止测试");
  // Electron applies the viewport resize asynchronously. Wait for the same
  // visibility and native hit-test assertions instead of checking the old frame.
  await wait(async () => {
    const geometry = await evalApp(
      "(()=>{const p=document.querySelector('[data-testid=chatgpt-web-page]');const b=p.querySelector('button.craftstation-composer-send');const r=b.getBoundingClientRect(),pr=p.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {inside:r.right<=pr.right&&r.left>=pr.left,hit:hit===b||b.contains(hit)};})()",
    );
    return geometry.inside && geometry.hit;
  }, "窄窗口发送按钮被挤掉或遮挡");
  const narrow = await app.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outDir, "chatgpt-web-narrow.png"), Buffer.from(narrow.data, "base64"));
  checks.push("480px 窄窗口发送按钮完整可见且可点击");
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
  await app.send("Emulation.clearDeviceMetricsOverride");
  await wait(
    async () =>
      await evalApp(
        "document.querySelector('[data-testid=chatgpt-web-page]').getBoundingClientRect().width > 480",
      ),
  );
  await evalApp("new Promise(done=>setTimeout(done,300))", true);

  await press("[data-testid=chatgpt-web-page] footer", "^中$");
  await wait(async () => await evalApp("Boolean(document.querySelector('[role=dialog] select'))"));
  const choices = await evalApp(
    "[...document.querySelectorAll('[role=dialog] select option')].map(o=>o.textContent)",
  );
  if (choices.join(",") !== "即时,中,高,极高,Pro" || (await evalPage("window.webchatEffort")) !== 1)
    throw new Error("网页选项读取或原档位恢复失败");
  await evalApp(
    "(()=>{const select=document.querySelector('[role=dialog] select');select.value='3';select.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await press("[role=dialog]", "应用到网页|Apply to website");
  await wait(async () => (await evalPage("window.webchatEffort")) === 3);
  await wait(async () => await evalApp("!document.querySelector('[role=dialog] select')"));
  checks.push("网页真实滑杆选项 → 本地选择 → 网页档位变更并核实；读取恢复原偏好");
  await press(
    "[data-testid=chatgpt-web-page] header",
    "导入已有对话|Import an existing conversation",
  );
  await wait(
    async () =>
      await evalApp(
        "[...document.querySelectorAll('[role=dialog] button')].some(b=>b.textContent.includes('ChatGPT 同步测试网页'))",
      ),
  );
  await press("[role=dialog]", "ChatGPT 同步测试网页");
  await wait(async () => await evalApp("!document.querySelector('[role=dialog] input')"));
  const list = await evalApp("window.craftstation.webChatList()", true);
  if (
    list.filter((s) => s.url === "https://chatgpt.com/c/craftstation-webchat-fixture").length !== 1
  )
    throw new Error("重复导入创建了重复会话");
  checks.push("本地导入列表读取网页已有对话，重复导入打开原记录");
  await click(
    '[data-testid=chatgpt-web-page] header button[aria-label="Delete account conversation"]',
  );
  await wait(async () => await evalApp("Boolean(document.querySelector('[role=alertdialog]'))"));
  await press("[role=alertdialog]", "Cancel|取消");
  if ((await evalPage("window.webchatDeletes")) !== 0) throw new Error("取消后仍执行远端删除");
  await click(
    '[data-testid=chatgpt-web-page] header button[aria-label="Delete account conversation"]',
  );
  await wait(async () => await evalApp("Boolean(document.querySelector('[role=alertdialog]'))"));
  await press("[role=alertdialog]", "Delete original conversation|删除原对话");
  await wait(
    async () =>
      !(await evalApp("window.craftstation.webChatList()", true)).some((s) => s.id === session.id),
  );
  checks.push("删除取消不操作网页；确认后原生删除成功，移除本地记录与网页标签");
  page.close();
  const existingIds = new Set(
    (await evalApp("window.craftstation.webChatList()", true)).map((s) => s.id),
  );
  await press("[data-testid=chatgpt-web-page] header", "新对话|New conversation");
  await press("[data-testid=chatgpt-web-page] header", "打开网页|Open website");
  await wait(async () => {
    session = (await evalApp("window.craftstation.webChatList()", true)).find(
      (s) => !existingIds.has(s.id),
    );
    return Boolean(session?.tabId);
  });
  await attachFixture("https://chatgpt.com/c/craftstation-disconnect-fixture");
  await wait(
    async () =>
      (
        await evalApp(
          `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
          true,
        )
      ).status === "ready",
  );
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
} catch (error) {
  failed = true;
  await writeFile(
    join(outDir, "report.json"),
    JSON.stringify(
      { status: "failed", mode: "fixture", checks, errors, error: String(error) },
      null,
      2,
    ),
  );
  const shot = await app.send("Page.captureScreenshot", { format: "png" }).catch(() => undefined);
  if (shot) await writeFile(join(outDir, "failed.png"), Buffer.from(shot.data, "base64"));
  throw error;
} finally {
  if (!(failed && args.holdOnFailure))
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
async function attachFixture(url) {
  let target;
  const marker = `webchat-fixture-${session.id}`;
  await wait(
    async () =>
      await evalApp(
        `(async()=>{const el=document.querySelector('webview[data-tab-id="${session.tabId}"]');if(!el)return false;try {await el.executeJavaScript(${JSON.stringify(`window.craftstationFixtureOwner=${JSON.stringify(marker)};true`)});return true;}catch{return false;}})()`,
        true,
      ),
  );
  await wait(async () => {
    const tabs = await (await fetch(`http://127.0.0.1:${connection.port}/json/list`)).json();
    for (const candidate of tabs.filter((t) => t.url.startsWith("https://chatgpt.com"))) {
      const client = await connect(candidate);
      try {
        if (await evaluate(client, `window.craftstationFixtureOwner===${JSON.stringify(marker)}`))
          target = candidate;
      } finally {
        client.close();
      }
      if (target) break;
    }
    return Boolean(target);
  });
  page = await connect(target);
  // Wait for the original webview's main-process attachment before replacing
  // its document. Otherwise a late initial navigation can replace the fixture.
  await evalApp(`window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`, true);
  await page.send("Page.stopLoading");
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
  await page.send("Page.navigate", { url });
  await wait(async () => await evalPage("Boolean(document.querySelector('.ProseMirror'))"));
  await evalApp(
    `window.craftstation.webChatReveal({sessionId:${JSON.stringify(session.id)}})`,
    true,
  );
}
async function wait(check, message = "等待网页同步检查超时") {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(message);
}
async function click(selector) {
  await wait(
    async () =>
      await evalApp(
        `(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e || e.disabled)return false;const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===e || e.contains(hit);})()`,
      ),
  );
  await evalApp("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))", true);
  const rect = await evalApp(
    `(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('缺少按钮');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...rect });
  await app.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    ...rect,
  });
  await new Promise((done) => setTimeout(done, 80));
  await app.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
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

async function press(scope, pattern) {
  await wait(
    async () =>
      await evalApp(
        `(() => {const b=[...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(b=>new RegExp(${JSON.stringify(pattern)}).test(b.textContent));if(!b || b.disabled)return false;b.dataset.smokePress='true';return true;})()`,
      ),
  );
  await click('button[data-smoke-press="true"]');
  await evalApp(
    "document.querySelector('button[data-smoke-press]')?.removeAttribute('data-smoke-press')",
  );
}

async function browserVisible() {
  return evalApp(
    "(()=>{const p=window.__craftstationDev.stores.panel.getState();return p.browserPanelOpen||p.browserOverlayOpen;})()",
  );
}
async function hideBrowser() {
  await evalApp(
    "(()=>{const p=window.__craftstationDev.stores.panel.getState();p.setBrowserPanelOpen(false);p.setBrowserOverlayOpen(false);})()",
  );
}
async function selectMenuOption(pattern) {
  await wait(
    async () =>
      await evalApp(
        `(()=>{const e=[...document.querySelectorAll('[role=option],[role=menuitem]')].find(e=>new RegExp(${JSON.stringify(pattern)}).test(e.textContent.trim())&&e.getBoundingClientRect().height>0);if(!e)return false;e.dataset.smokeTarget='true';return true;})()`,
      ),
  );
  await click('[data-smoke-target="true"]');
  await evalApp(
    "document.querySelector('[data-smoke-target]')?.removeAttribute('data-smoke-target')",
  );
}
