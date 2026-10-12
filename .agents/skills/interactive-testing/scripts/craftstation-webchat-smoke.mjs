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
let mainTarget;
const bootDeadline = Date.now() + 20_000;
while (!mainTarget && Date.now() < bootDeadline) {
  const targets = await inspectCdpWindowTargets({
    port: connection.port,
    appUrl: connection.appUrl,
  });
  mainTarget = targets.ready[0];
  if (!mainTarget) await new Promise((done) => setTimeout(done, 200));
}
if (!mainTarget) throw Error("隔离主窗口尚未完成热更新，无法开始网页验证");
const app = await connect(mainTarget);
await app.send("Emulation.clearDeviceMetricsOverride");
await app.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await app.send("Page.setWebLifecycleState", { state: "active" });
await evaluate(app, "window.craftstation.focusWindow()", true);
let page;
const checks = [];
const errors = [];
const runId = Date.now();
const fixtureUrl = `https://chatgpt.com/c/craftstation-webchat-fixture-${runId}`;
const disconnectUrl = `https://chatgpt.com/c/craftstation-disconnect-fixture-${runId}`;
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
  if (args.nativeOnly === "true") {
    await app.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evalApp(
      "window.__craftstationDev.stores.webChat.getState().setOpen(false);window.__craftstationDev.stores.app.getState().openHome();window.__craftstationDev.stores.app.setState({threads:[]})",
    );
    await evalApp(
      "window.craftstation.webChatList().then(async sessions=>{for(const record of sessions)await window.craftstation.webChatForget({sessionId:record.id});window.__craftstationDev.stores.webChat.getState().setSessions([]);})",
      true,
    );
    await evalApp(
      "window.craftstation.browserGetState().then(async s=>{for(const tab of s.tabs)await window.craftstation.browserCloseTab({tabId:tab.tabId})})",
      true,
    );
    const previousIds = new Set(
      (await evalApp("window.craftstation.webChatList()", true)).map((item) => item.id),
    );
    await click('[data-testid="webchat-add-remote"]');
    await wait(async () => {
      session = (await evalApp("window.craftstation.webChatList()", true)).find(
        (item) => !previousIds.has(item.id),
      );
      return Boolean(session?.tabId);
    });
    if (
      session.url !== "https://chatgpt.com/" ||
      (await evalApp("window.craftstation.webChatList()", true)).length !== previousIds.size + 1 ||
      (await evalApp("window.__craftstationDev.stores.webChat.getState().selectedSessionId")) !==
        session.id ||
      (await evalApp("Boolean(document.querySelector('[data-testid=webchat-remote-choice]'))"))
    )
      throw Error("远程 + 未直接创建并选中新的 ChatGPT 网页，或仍显示选择弹窗");
    await attachFixture(disconnectUrl);
    await wait(
      async () =>
        await evalApp(
          `window.__craftstationDev.stores.webChat.getState().sessions.find(s=>s.id===${JSON.stringify(session.id)})?.status==='ready'`,
        ),
    );
    checks.push("远程 + 直接创建新的 ChatGPT 网页、绑定并选中远程线程，无选择弹窗");
  } else {
    await evalApp(
      "(()=>{const s=window.__craftstationDev.stores.agentStatuses.getState();s.hydrateFromCache({windows:s.agentStatuses,wsl:s.wslAgentStatuses});})()",
    );
    await evalApp(
      "window.craftstation.browserGetState().then(async s=>{for(const tab of s.tabs)await window.craftstation.browserCloseTab({tabId:tab.tabId})})",
      true,
    );
    // Existing adapted-view scenarios remain covered alongside the native card below.
    await evalApp("window.__craftstationDev.stores.panel.getState().hideAuxiliaryPanel()");
    await evalApp("window.__craftstationDev.stores.webChat.getState().setNativeView(false)");
    await click('[data-testid="webchat-add-remote"]');
    if (await evalApp("Boolean(document.querySelector('[data-testid=webchat-remote-choice]'))"))
      throw Error("远程 + 仍显示选择弹窗");
    checks.push("远程 + 直接进入新建网页对话，不显示选择弹窗");
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
    const closedLayout = await evalApp(
      "(() => {const p=document.querySelector('[data-testid=chatgpt-web-page]');const controls=p.querySelector('[data-testid=webchat-controls]');const status=controls.querySelector('[role=status]');const capsule=document.querySelector('[data-testid=webchat-conversations-toggle]');const toggle=document.querySelector('[aria-label=\"Show side panel\"]');const c=capsule.getBoundingClientRect(),t=toggle.getBoundingClientRect();return {collapsed:!document.querySelector('[data-testid=webchat-conversations-list]'),expanded:capsule.getAttribute('aria-expanded'),header:Boolean(capsule.closest('[data-main-content-header]')),beforeToggle:c.right<=t.left&&Math.abs(c.y-t.y)<5,fullLabels:/Open original remote web conversation|打开原远程网页对话/.test(controls.querySelector('[data-testid=webchat-reveal]').textContent)&&/Refresh webpage|刷新网页/.test(controls.querySelector('[data-testid=webchat-refresh]').textContent),sameBar:Boolean(controls.closest('[data-draft-context-bar]')),beforeStatus:controls.lastElementChild===status,newButton:[...controls.querySelectorAll('button')].some(b=>/New conversation|新对话/.test(b.textContent))};})()",
    );
    if (
      !closedLayout.collapsed ||
      closedLayout.expanded !== "false" ||
      !closedLayout.header ||
      !closedLayout.beforeToggle ||
      !closedLayout.fullLabels ||
      !closedLayout.sameBar ||
      !closedLayout.beforeStatus ||
      closedLayout.newButton
    )
      throw Error("胶囊默认关闭、状态栏按钮位置或新对话按钮移除不符");
    checks.push(
      "右上角已有对话胶囊默认关闭；按钮在连接状态左侧且共用同一状态栏，无独立按钮行或 New conversation",
    );
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
    // 用户显式打开网页时，必须展示同一账号的官方页面。
    const previousIds = new Set(
      (await evalApp("window.craftstation.webChatList()", true)).map((s) => s.id),
    );
    await openNewWebDraft();
    await click('[data-testid="webchat-reveal"]');
    await wait(async () => {
      session = (await evalApp("window.craftstation.webChatList()", true)).find(
        (s) => !previousIds.has(s.id),
      );
      return Boolean(session?.tabId);
    });
    await attachFixture(fixtureUrl);
    // Retain the internal import seam's source-tab reuse coverage.
    const beforeImport = (await evalApp("window.craftstation.webChatList()", true)).length;
    await evalApp(
      `window.craftstation.webChatImport({url:${JSON.stringify(fixtureUrl)},tabId:${JSON.stringify(session.tabId)}})`,
      true,
    );
    const importedSource = (await evalApp("window.craftstation.webChatList()", true)).find(
      (s) => s.id === session.id,
    );
    if (
      !importedSource ||
      importedSource.tabId !== session.tabId ||
      (await evalApp("window.craftstation.webChatList()", true)).length !== beforeImport
    )
      throw Error("导入源网页没有复用线程或标签");
    checks.push("内部导入接口复用已有线程及源网页标签");
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
    await evalPage(
      "document.body.insertAdjacentHTML('beforeend','<p role=\"alert\" id=\"transient-sync-error\">暂时无法加载网页</p>')",
    );
    await wait(
      async () =>
        (await evalApp("window.craftstation.webChatList()", true)).find((s) => s.id === session.id)
          ?.status === "error",
    );
    await evalPage("document.querySelector('#transient-sync-error').remove()");
    await wait(
      async () =>
        await evalApp(
          "(()=>{const p=document.querySelector('[data-testid=chatgpt-web-page]');return /已连接|Connected/.test(p.innerText)&&!p.querySelector('[role=alert]');})()",
        ),
    );
    checks.push("首次同步出错后网页恢复，真实界面自动重新检测并清除过期错误");
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
    await click('[data-testid="webchat-refresh"]');
    await wait(
      async () =>
        await evalApp(
          "(()=>{const p=document.querySelector('[data-testid=chatgpt-web-page]');return /已连接|Connected/.test(p.innerText)&&!p.querySelector('[data-testid=webchat-refresh]').disabled;})()",
        ),
    );
    if (
      (await evalApp("document.querySelector('[data-testid=chatgpt-web-page] textarea').value")) !==
        "第一轮中文测试" ||
      (await evalPage("window.webchatSends")) !== 0
    )
      throw Error("刷新重试丢失输入或擅自发送");
    checks.push("真实刷新重试按钮重载网页登录页面，保留输入且未发送消息");
    await click('[data-testid="chatgpt-web-page"] button.craftstation-composer-send');
    await wait(async () =>
      (
        await evalApp("document.querySelector('[data-testid=chatgpt-web-page]').innerText")
      ).includes("第一段正在生成"),
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
    const text = await evalApp(
      "document.querySelector('[data-testid=chatgpt-web-page]').innerText",
    );
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
      (
        await evalApp("document.querySelector('[data-testid=chatgpt-web-page]').innerText")
      ).includes("无法加载此回复"),
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
    await assertWebControlsFit();
    const narrow = await app.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(outDir, "chatgpt-web-narrow.png"), Buffer.from(narrow.data, "base64"));
    checks.push("480px 与左右分栏：完整文字按钮可见、无标签重叠，发送按钮可点击");
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
    await wait(
      async () => await evalApp("Boolean(document.querySelector('[role=dialog] select'))"),
    );
    const choices = await evalApp(
      "[...document.querySelectorAll('[role=dialog] select option')].map(o=>o.textContent)",
    );
    if (
      choices.join(",") !== "即时,中,高,极高,Pro" ||
      (await evalPage("window.webchatEffort")) !== 1
    )
      throw new Error("网页选项读取或原档位恢复失败");
    await evalApp(
      "(()=>{const select=document.querySelector('[role=dialog] select');select.value='3';select.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await press("[role=dialog]", "应用到网页|Apply to website");
    await wait(async () => (await evalPage("window.webchatEffort")) === 3);
    await wait(async () => await evalApp("!document.querySelector('[role=dialog] select')"));
    checks.push("网页真实滑杆选项 → 本地选择 → 网页档位变更并核实；读取恢复原偏好");
    await click('[data-testid="webchat-conversations-toggle"]');
    await wait(
      async () =>
        await evalApp(
          "Boolean(document.querySelector('[data-testid=webchat-conversations-list]'))",
        ),
    );
    await click('[data-testid="webchat-discover"]');
    await wait(
      async () =>
        await evalApp(
          `Boolean(document.querySelector(${JSON.stringify(`[data-webchat-conversation-url="${fixtureUrl}"]`)}))`,
        ),
    );
    await evalApp(
      "window.__craftstationDev.stores.sidebarUi.getState().setProjectCollapsed('__craftstation_web_remote__',true)",
    );
    await click(`[data-webchat-conversation-url="${fixtureUrl}"]`);
    await wait(
      async () =>
        await evalApp(
          "!window.__craftstationDev.stores.sidebarUi.getState().collapsedProjects.__craftstation_web_remote__",
        ),
    );
    await wait(async () => await browserVisible());
    checks.push("右上角胶囊默认收起，展开读取账号对话和 ID；点击跳到原网页并展开远程线程");
    const list = await evalApp("window.craftstation.webChatList()", true);
    if (list.filter((s) => s.url === fixtureUrl).length !== 1)
      throw new Error("重复导入创建了重复会话");
    checks.push("本地导入列表读取网页已有对话，重复导入打开原记录");
    await click('[data-testid=webchat-controls] button[aria-label="Delete account conversation"]');
    await wait(async () => await evalApp("Boolean(document.querySelector('[role=alertdialog]'))"));
    await press("[role=alertdialog]", "Cancel|取消");
    if ((await evalPage("window.webchatDeletes")) !== 0) throw new Error("取消后仍执行远端删除");
    await click('[data-testid=webchat-controls] button[aria-label="Delete account conversation"]');
    await wait(async () => await evalApp("Boolean(document.querySelector('[role=alertdialog]'))"));
    await press("[role=alertdialog]", "Delete original conversation|删除原对话");
    await wait(
      async () =>
        !(await evalApp("window.craftstation.webChatList()", true)).some(
          (s) => s.id === session.id,
        ),
    );
    checks.push("删除取消不操作网页；确认后原生删除成功，移除本地记录与网页标签");
    page.close();
    const existingIds = new Set(
      (await evalApp("window.craftstation.webChatList()", true)).map((s) => s.id),
    );
    await openNewWebDraft();
    await click('[data-testid="webchat-reveal"]');
    await wait(async () => {
      session = (await evalApp("window.craftstation.webChatList()", true)).find(
        (s) => !existingIds.has(s.id),
      );
      return Boolean(session?.tabId);
    });
    await attachFixture(disconnectUrl);
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
    await wait(
      async () =>
        (await evalApp("window.craftstation.webChatList()", true)).find((s) => s.id === session.id)
          ?.messages.length > 0,
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
    const disconnectedShot = await app.send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(outDir, "disconnected-with-retry.png"),
      Buffer.from(disconnectedShot.data, "base64"),
    );
    const closedTabId = session.tabId;
    page.close();
    await click('[data-testid="webchat-refresh"]');
    await wait(async () => {
      session = (await evalApp("window.craftstation.webChatList()", true)).find(
        (s) => s.id === session.id,
      );
      return Boolean(session.tabId && session.tabId !== closedTabId);
    });
    await attachFixture(disconnectUrl);
    await wait(
      async () =>
        await evalApp(
          "(()=>{const p=document.querySelector('[data-testid=chatgpt-web-page]');return /已连接|Connected/.test(p.innerText)&&!p.querySelector('[role=alert]');})()",
        ),
    );
    if ((await evalPage("window.webchatSends")) !== 0 || !session.messages.length)
      throw Error("显式重连重发消息或清空历史");
    checks.push("关闭网页后点击刷新重试，重建会话网页并恢复连接，保留历史且不重发");
    const reconnectedShot = await app.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(outDir, "reconnected.png"), Buffer.from(reconnectedShot.data, "base64"));
  }
  await evalApp("window.__craftstationDev.stores.panel.getState().hideAuxiliaryPanel()");
  await evalApp("window.__craftstationDev.stores.webChat.getState().setNativeView(true)");
  await wait(
    async () =>
      await evalApp(
        "Boolean(document.querySelector('[data-browser-host-mode=conversation] webview[style*=flex]'))",
      ),
  );
  const guestId = await evalApp(
    "document.querySelector('[data-browser-host-mode=conversation] webview[style*=flex]').getWebContentsId()",
  );
  await evalApp("new Promise(done=>setTimeout(done,350))", true);
  const aligned = await evalApp(
    "(()=>{const card=document.querySelector('[data-testid=webchat-native-view]').getBoundingClientRect();const guest=document.querySelector('[data-browser-host-mode=conversation]').getBoundingClientRect();return Math.abs(card.x-guest.x)<2&&Math.abs(card.y-guest.y)<2&&Math.abs(card.width-guest.width)<2&&Math.abs(card.height-guest.height)<2&&!document.querySelector('[data-testid=chatgpt-web-page] .tiptap')&&!document.querySelector('[data-browser-host-mode=conversation] input');})()",
  );
  if (!aligned) throw Error("原样网页未对齐主卡片，或出现重复输入框/浏览器工具栏");
  await evalPage(
    "document.body.insertAdjacentHTML('beforeend','<button id=native-count>原样计数 0</button>');window.nativeCount=0;document.querySelector('#native-count').onclick=()=>document.querySelector('#native-count').textContent='原样计数 '+(++window.nativeCount)",
  );
  const nativeClick = async (selector) => {
    const target = await evalPage(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    const offset = await evalApp(
      "(()=>{const r=document.querySelector('[data-craftstation-browser] webview[style*=flex]').getBoundingClientRect();return {x:r.x,y:r.y};})()",
    );
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await app.send("Input.dispatchMouseEvent", {
        type,
        x: offset.x + target.x,
        y: offset.y + target.y,
        button: "left",
        clickCount: 1,
        buttons: type === "mousePressed" ? 1 : 0,
      });
  };
  await nativeClick("#native-count");
  await wait(async () => (await evalPage("window.nativeCount")) === 1);
  await nativeClick(".ProseMirror");
  await app.send("Input.insertText", { text: "网页原样保留的草稿" });
  await wait(
    async () =>
      (await evalPage("document.querySelector('.ProseMirror').innerText")) === "网页原样保留的草稿",
  );
  checks.push(
    "原样网页对齐主卡片；通过真实鼠标和键盘直接操作网页，保留原生输入框，无重复 composer 或浏览器工具栏",
  );
  const refreshAccessible = await evalApp(
    "(()=>{const e=document.querySelector('[data-testid=webchat-header-refresh]');const toggle=document.querySelector('[aria-label=\"Show side panel\"]');if(!e||!toggle)return false;const r=e.getBoundingClientRect(),t=toggle.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&r.right<=t.left&&Boolean(e.closest('[data-main-content-header]'))&&!document.querySelector('[data-testid=webchat-conversations-toggle]');})()",
  );
  if (!refreshAccessible) throw Error("右上角刷新按钮未替代已有对话，或被原生网页覆盖");
  const refreshAppRegion = await evalApp(
    "getComputedStyle(document.querySelector('[data-testid=webchat-header-refresh]')).getPropertyValue('app-region')",
  );
  if (refreshAppRegion !== "no-drag")
    throw Error(`刷新按钮未排除 Electron 原生窗口拖动区域，实际 app-region=${refreshAppRegion}`);
  checks.push("原样网页右上角改为完整文字刷新按钮，位于侧栏按钮左边且真实可点击");
  const nativeShot = await app.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(outDir, "native-conversation-card.png"),
    Buffer.from(nativeShot.data, "base64"),
  );
  await click(`[data-webchat-sidebar-session="${session.id}"] [role="button"]`, "right");
  await click('[role="menuitem"][data-key="website"]');
  await wait(async () => await browserVisible());
  await wait(
    async () =>
      await evalApp(
        "Boolean(document.querySelector('[data-browser-host-mode=docked] webview[style*=flex]'))",
      ),
  );
  const besideId = await evalApp(
    "document.querySelector('[data-browser-host-mode=docked] webview[style*=flex]').getWebContentsId()",
  );
  if (guestId === besideId) throw Error("打开侧边栏仍搬走主网页，未打开独立浏览器");
  if (await evalApp("Boolean(document.querySelector('[data-testid=webchat-return-to-card]'))"))
    throw Error("主卡片仍出现移回网页提示");
  await wait(
    async () =>
      await evalApp("Boolean(document.querySelector('[data-browser-host-mode=conversation]'))"),
  );
  if (
    (await evalPage("window.nativeCount")) !== 1 ||
    (await evalPage("document.querySelector('.ProseMirror').innerText")) !== "网页原样保留的草稿" ||
    guestId !==
      (await evalApp(
        "document.querySelector('[data-browser-host-mode=conversation] webview[style*=flex]').getWebContentsId()",
      ))
  )
    throw Error("打开侧栏改变了主网页状态、实例或草稿");
  const besideState = await evalApp("window.craftstation.browserGetState()", true);
  const besideTabId = await evalApp(
    "document.querySelector('[data-browser-host-mode=docked] webview[style*=flex]').getAttribute('data-tab-id')",
  );
  if (
    besideState.tabs.find((tab) => tab.tabId === besideTabId)?.url !==
    (await evalPage("location.href"))
  )
    throw Error("侧边栏未打开当前远程对话地址");
  await evalApp("new Promise(done=>setTimeout(done,350))", true);
  const besideShot = await app.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outDir, "independent-sidebar.png"), Buffer.from(besideShot.data, "base64"));
  await hideBrowser();
  checks.push(
    "打开右侧独立浏览器时主网页保持显示；同一主 WebContents、原生计数和未发送草稿保持，侧栏使用不同实例及相同对话地址",
  );
  await app.send("Emulation.setDeviceMetricsOverride", {
    width: 480,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(
    async () =>
      await evalApp("Boolean(document.querySelector('[data-browser-host-mode=conversation]'))"),
  );
  if (
    await evalApp(
      "Boolean(document.querySelector('[data-testid=chatgpt-web-page] footer, [data-testid=webchat-controls]'))",
    )
  )
    throw Error("原样卡片仍显示底部控制栏");
  await app.send("Emulation.clearDeviceMetricsOverride");
  if (args.nativeOnly === "true")
    await app.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
  if (
    await evalApp(
      "Boolean(document.querySelector('[data-testid=webchat-view-toggle], [data-testid=chatgpt-web-page] .tiptap'))",
    )
  )
    throw Error("原样网页仍显示应用输入框或视图切换按钮");
  checks.push("480px 原样卡片完整显示网页；没有底部控制栏、重复输入框或视图切换按钮");
  const firstSession = session;
  const firstPage = page;
  session = await evalApp("window.craftstation.webChatCreate()", true);
  await evalApp(
    `(()=>{const s=window.__craftstationDev.stores.webChat.getState();s.setSessions([${JSON.stringify(session)},...s.sessions]);})()`,
  );
  const secondUrl = `https://chatgpt.com/c/craftstation-binding-fixture-${runId}`;
  await attachFixture(secondUrl);
  await wait(
    async () =>
      (
        await evalApp(
          `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
          true,
        )
      ).status === "ready",
  );
  const sourceGuestId = await evalApp(
    `document.querySelector('webview[data-tab-id="${session.tabId}"]').getWebContentsId()`,
  );
  const recordsBeforeDefault = (await evalApp("window.craftstation.webChatList()", true)).length;
  await evalApp(
    `window.craftstation.webChatReveal({sessionId:${JSON.stringify(session.id)}})`,
    true,
  );
  await wait(async () => await browserVisible());
  await evalApp("window.__craftstationDev.stores.webChat.getState().setOpen(false)");
  await evalApp("window.__craftstationDev.stores.app.getState().openHome()");
  await wait(
    async () =>
      !(await evalApp("Boolean(document.querySelector('[data-testid=chatgpt-web-page]'))")),
  );
  await evalApp(
    "window.__craftstationDev.stores.webChat.setState({selectedSessionId:undefined,isDraft:false});window.__craftstationDev.stores.webChat.getState().setOpen(true)",
  );
  await wait(
    async () =>
      await evalApp(
        `window.__craftstationDev.stores.webChat.getState().selectedSessionId===${JSON.stringify(session.id)} && Boolean(document.querySelector('[data-browser-host-mode=conversation]'))`,
      ),
  );
  if (
    (await evalApp("window.craftstation.webChatList()", true)).length !== recordsBeforeDefault ||
    (await evalApp(
      "document.querySelector('[data-browser-host-mode=conversation] webview[style*=flex]').getWebContentsId()",
    )) !== sourceGuestId
  )
    throw Error("默认打开未复用侧边已验证网页或创建了空白线程");
  checks.push("默认打开复用侧边已打开的会话和同一 WebContents，选中绑定远程线程，不创建空白页");
  await click(`[data-webchat-sidebar-session="${firstSession.id}"] [role="button"]`);
  await wait(
    async () =>
      await evalApp(
        `document.querySelector('[data-browser-host-mode=conversation] webview[style*=flex]')?.getAttribute('data-tab-id')===${JSON.stringify(firstSession.tabId)}`,
      ),
  );
  if (
    (await evaluate(firstPage, "window.nativeCount")) !== 1 ||
    (await evaluate(firstPage, "document.querySelector('.ProseMirror').innerText")) !==
      "网页原样保留的草稿"
  )
    throw Error("切换远程线程丢失了原网页状态或草稿");
  await click(`[data-webchat-sidebar-session="${session.id}"] [role="button"]`);
  await wait(
    async () =>
      await evalApp(
        `document.querySelector('[data-browser-host-mode=conversation] webview[style*=flex]')?.getAttribute('data-tab-id')===${JSON.stringify(session.tabId)}`,
      ),
  );
  if ((await evalPage("location.href")) !== secondUrl || firstSession.tabId === session.tabId)
    throw Error("两个远程线程混用了同一网页或对话地址");
  checks.push("左侧两个线程分别绑定自己的网页；来回切换保留原网页计数和未发送草稿");
  const navigatedUrl = `https://chatgpt.com/c/native-navigation-${runId}`;
  await page.send("Page.navigate", { url: navigatedUrl });
  await wait(
    async () =>
      await evalApp(
        `window.__craftstationDev.stores.webChat.getState().sessions.find(s=>s.id===${JSON.stringify(session.id)})?.url===${JSON.stringify(navigatedUrl)}`,
      ),
  );
  await evalPage(
    "document.title='ChatGPT';document.querySelector('nav a').textContent='绑定的网页会话'",
  );
  const titlesMatch = (title) =>
    evalApp(
      `(()=>{const store=window.__craftstationDev.stores.webChat.getState();const record=store.sessions.find(s=>s.id===${JSON.stringify(session.id)});return store.selectedSessionId===${JSON.stringify(session.id)}&&record?.title===${JSON.stringify(title)}&&document.querySelector('[data-main-content-header]').innerText.includes(${JSON.stringify(title)})&&document.querySelector('[data-webchat-sidebar-session="${session.id}"]').innerText.includes(${JSON.stringify(title)});})()`,
    );
  await wait(async () => await titlesMatch("绑定的网页会话"));
  checks.push(
    "原网页切换会话后当前远程线程跟随对话 ID；网页标题为 ChatGPT 时仍同步左上角和左侧对话名",
  );
  await evalPage("document.title='网页重命名后'");
  await wait(async () => await titlesMatch("网页重命名后"));
  checks.push("仅修改网页名称也同步左上角及左侧线程，绑定 ID 和浏览器标签保持不变");
  await evalPage(
    "window.refreshWitness='before-reload';document.body.insertAdjacentHTML('beforeend','<button data-testid=\"stop-button\">停止</button><p role=\"alert\">网页同步探针失败</p>')",
  );
  await wait(
    async () =>
      await evalApp(
        `window.__craftstationDev.stores.webChat.getState().sessions.find(s=>s.id===${JSON.stringify(session.id)})?.status==='error'`,
      ),
  );
  await click('[data-testid="webchat-header-refresh"]');
  await wait(async () => await titlesMatch("ChatGPT 同步测试网页"));
  if (
    (await evalPage("window.refreshWitness")) !== undefined ||
    (await evalPage("location.href")) !== navigatedUrl ||
    (await evalPage("window.webchatSends")) !== 0 ||
    (await evalApp(
      "document.querySelector('[data-browser-host-mode=conversation] webview[style*=flex]').getWebContentsId()",
    )) !== sourceGuestId
  )
    throw Error("刷新未保持当前绑定网页，重建了浏览器实例或重发消息");
  checks.push(
    "同步失败且网页保留停止按钮时，右上角刷新仍实际重载当前文档，同一 WebContents 和线程，无重发消息",
  );
  await click(`[data-webchat-sidebar-session="${firstSession.id}"] [role="button"]`);
  await click(`[data-webchat-sidebar-session="${session.id}"] [role="button"]`);
  await wait(async () => (await evalPage("location.href")) === navigatedUrl);
  await wait(
    async () =>
      await evalApp("!document.querySelector('[data-testid=chatgpt-web-page] [role=alert]')"),
  );
  checks.push("点击左侧线程重新打开其最新保存的绑定会话，其他线程保持自己的地址");
  const rowSelector = `[data-webchat-sidebar-session="${session.id}"]`;
  await evalApp("document.activeElement?.blur()");
  await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  const actionsWidth = () =>
    evalApp(
      `document.querySelector('${rowSelector} [data-webchat-row-actions]').getBoundingClientRect().width`,
    );
  await wait(async () => (await actionsWidth()) < 1);
  const hoverRow = await evalApp(
    `(()=>{const r=document.querySelector('${rowSelector}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverRow });
  await wait(async () => (await actionsWidth()) > 30);
  const hoverShot = await app.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(outDir, "remote-row-hover-actions.png"),
    Buffer.from(hoverShot.data, "base64"),
  );
  checks.push("远程线程默认收起快捷操作，鼠标悬停后显示置顶、更多和删除对话显示");
  await click(`${rowSelector} [data-webchat-more]`);
  await click('[role="menuitem"][data-key="rename"]');
  await wait(
    async () =>
      await evalApp(`document.activeElement===document.querySelector('${rowSelector} input')`),
  );
  await app.send("Input.insertText", { text: "我重命名的远程对话" });
  await app.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await app.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await wait(async () => await titlesMatch("我重命名的远程对话"));
  await click('[data-testid="webchat-header-refresh"]');
  await wait(async () => (await evalPage("document.readyState")) === "complete");
  await wait(async () => await titlesMatch("我重命名的远程对话"));
  if (
    !(await evalApp("window.craftstation.webChatList()", true)).some(
      (item) => item.id === session.id && item.customTitle === "我重命名的远程对话",
    )
  )
    throw Error("重命名未保存到主进程记录");
  checks.push("悬停更多菜单可行内重命名，Enter 保存并同步列表与页头，刷新后仍保留自定义名称");
  await click(`${rowSelector} [role="button"]`, "right");
  await click('[role="menuitem"][data-key="rename"]');
  await wait(
    async () =>
      await evalApp(`document.activeElement===document.querySelector('${rowSelector} input')`),
  );
  await app.send("Input.insertText", { text: "不保存的名称" });
  await app.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await app.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await wait(
    async () => !(await evalApp(`Boolean(document.querySelector('${rowSelector} input'))`)),
  );
  if (!(await titlesMatch("我重命名的远程对话"))) throw Error("Escape 取消后名称仍发生修改");
  checks.push("右键重命名与悬停入口一致，Escape 取消保留原名称");
  await click(`[data-webchat-sidebar-session="${session.id}"] [role="button"]`, "right");
  if (
    !(await evalApp(
      "Boolean(document.querySelector('[role=menuitem][data-key=forget]')) && Boolean(document.querySelector('[role=menuitem][data-key=delete]'))",
    ))
  )
    throw Error("右键菜单未拆分本地展示移除与账号原对话删除");
  const menuShot = await app.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(outDir, "separate-delete-actions.png"),
    Buffer.from(menuShot.data, "base64"),
  );
  await click('[role="menuitem"][data-key="delete"]');
  await wait(async () => await evalApp("Boolean(document.querySelector('[role=alertdialog]'))"));
  await evalApp(
    "[...document.querySelectorAll('[role=alertdialog] button')].find(b=>/^(Cancel|取消)$/.test(b.textContent.trim())).dataset.smokeCancel='true'",
  );
  await click('[data-smoke-cancel="true"]');
  await wait(async () => !(await evalApp("Boolean(document.querySelector('[role=alertdialog]'))")));
  if ((await evalPage("window.webchatDeletes")) !== 0)
    throw Error("取消账号原对话删除后仍执行了网页删除");
  checks.push("右键菜单拆分两种删除；账号原对话删除继续确认，取消不删除网页对话");
  await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverRow });
  await wait(async () => (await actionsWidth()) > 30);
  await click(`${rowSelector} [data-webchat-forget]`);
  await wait(
    async () =>
      await evalApp(
        `!document.querySelector('[data-webchat-sidebar-session="${session.id}"]') && window.__craftstationDev.stores.webChat.getState().selectedSessionId===${JSON.stringify(firstSession.id)}`,
      ),
  );
  if (
    (await evalApp("window.craftstation.webChatList()", true)).some((s) => s.id === session.id) ||
    !(await evalApp("window.craftstation.browserGetState()", true)).tabs.some(
      (tab) => tab.tabId === session.tabId,
    ) ||
    (await evalPage("window.webchatDeletes")) !== 0
  )
    throw Error("删除对话显示未移除本地记录，或误关闭/删除了账号原网页");
  checks.push("删除对话显示仅移除本地线程并切到保留的线程，网页标签和账号原对话不删除");
  await click("[data-testid=webchat-header-thread-sidebar]");
  await wait(
    async () =>
      await evalApp(
        "Boolean(document.querySelector('[data-testid=webchat-thread-sidebar-dialog]'))",
      ),
  );
  if (
    !(await evalApp(
      "/暂无可用的本地对话|No local conversations available/.test(document.querySelector('[data-testid=webchat-thread-sidebar-dialog]').innerText)",
    ))
  )
    throw Error("没有本地线程时未显示空状态");
  await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await wait(
    async () =>
      !(await evalApp(
        "Boolean(document.querySelector('[data-testid=webchat-thread-sidebar-dialog]'))",
      )),
  );
  if (!(await evalApp("window.__craftstationDev.stores.webChat.getState().open")))
    throw Error("取消选择仍关闭了远程网页");
  checks.push("打开为本地对话侧边栏显示选择弹窗；无本地对话显示空状态，取消保留原网页");
  const localId = `local-sidebar-${runId}`;
  await evalApp(
    `(()=>{const s=window.__craftstationDev.stores.app;const now=new Date().toISOString();const thread={id:${JSON.stringify(localId)},projectId:'smoke-project',title:'本地侧栏目标',agentKind:'codex',config:{model:'gpt-5'},status:'idle',attention:'none',canResumeWithConfig:false,archived:false,done:false,starred:false,presentationMode:'gui',createdAt:now,updatedAt:now};s.setState({threads:[thread,{...thread,id:'archived-sidebar-fixture',archived:true,title:'已归档目标'},{...thread,id:'remote-sidebar-fixture',remoteServerId:'remote-fixture',remoteId:'remote-target',title:'远程目标'}]});})()`,
  );
  const localCountBefore = await evalApp(
    "window.__craftstationDev.stores.app.getState().threads.length",
  );
  await click("[data-testid=webchat-header-thread-sidebar]");
  await wait(
    async () =>
      await evalApp(
        "Boolean(document.querySelector('[data-testid=webchat-thread-sidebar-dialog]'))",
      ),
  );
  if ((await evalApp("document.querySelectorAll('[data-webchat-local-thread]').length")) !== 1)
    throw Error("选择框包含非本地或已归档对话");
  const chooserShot = await app.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outDir, "choose-local-thread.png"), Buffer.from(chooserShot.data, "base64"));
  await click(`[data-webchat-local-thread="${localId}"]`);
  await wait(
    async () =>
      await evalApp(
        `!window.__craftstationDev.stores.webChat.getState().open&&window.__craftstationDev.stores.app.getState().focusedPaneId===${JSON.stringify(localId)}&&Boolean(document.querySelector('[data-browser-host-mode=docked] webview[style*=flex]'))`,
      ),
  );
  if (
    (await evalApp(
      "document.querySelector('[data-browser-host-mode=docked] webview[style*=flex]').getWebContentsId()",
    )) !== guestId ||
    (await evalApp(
      "document.querySelector('[data-browser-host-mode=docked] webview[style*=flex]').getAttribute('data-tab-id')",
    )) !== firstSession.tabId ||
    (await evaluate(firstPage, "window.nativeCount")) !== 1 ||
    (await evaluate(firstPage, "document.querySelector('.ProseMirror').innerText")) !==
      "网页原样保留的草稿" ||
    (await evaluate(firstPage, "window.webchatSends")) !== 0 ||
    (await evalApp("window.__craftstationDev.stores.app.getState().threads.length")) !==
      localCountBefore ||
    !(await evalApp("window.craftstation.webChatList()", true)).some(
      (record) => record.id === firstSession.id,
    )
  )
    throw Error("本地线程侧栏未复用当前网页及草稿，或新建线程/重发消息/删除了远程记录");
  await evalApp("new Promise(done=>setTimeout(done,350))", true);
  const localShot = await app.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outDir, "local-thread-sidebar.png"), Buffer.from(localShot.data, "base64"));
  checks.push(
    "选择已有本地线程后切到目标线程，在右侧打开当前网页；复用原实例和草稿，不新增本地线程、不发送消息、不移除远程记录",
  );
  firstPage.close();
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
  await app.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
  if (!(failed && args.holdOnFailure))
    await evalApp("document.querySelector('button[aria-label=\"Back\"]')?.click()").catch(
      () => undefined,
    );
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
async function assertWebControlsFit() {
  await wait(
    async () =>
      await evalApp(`(() => {
    const controls = document.querySelector('[data-testid=webchat-controls]');
    const bar = controls.closest('[data-draft-context-bar]');
    const b = bar.getBoundingClientRect(), l = bar.firstElementChild.getBoundingClientRect(), r = controls.getBoundingClientRect();
    const separate = l.right <= r.left || l.bottom <= r.top || l.top >= r.bottom;
    const buttons = [...controls.querySelectorAll('button')];
    return separate && buttons.every(button => {
      const p = button.getBoundingClientRect();
      return p.left >= b.left && p.right <= b.right && button.scrollWidth <= button.clientWidth + 1;
    });
  })()`),
    "完整文字按钮溢出控制栏或覆盖了项目/运行方式标签",
  );
}
async function click(selector, button = "left") {
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
    button,
    buttons: button === "right" ? 2 : 1,
    clickCount: 1,
    ...rect,
  });
  await new Promise((done) => setTimeout(done, 80));
  await app.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button,
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

async function openNewWebDraft() {
  await press('[aria-label="CraftStation"]', "^New$|^新增$");
  await selectMenuOption("新增网页对话|New web conversation");
  await selectMenuOption("ChatGPT 网页对话|ChatGPT web conversation");
  await wait(
    async () =>
      await evalApp("Boolean(document.querySelector('[data-testid=chatgpt-web-page] textarea'))"),
  );
  await evalApp("new Promise(done=>setTimeout(done,100))", true);
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
