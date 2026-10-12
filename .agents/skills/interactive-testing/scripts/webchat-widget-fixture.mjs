// 公开 MCP Apps 的 iframe 消息形状；桥接留在原网页中，CraftStation 只映射画面和输入。
export const widgetFixture = `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;background:#e8edf5;color:#162030;margin:16px}button,input{padding:8px;margin:6px}canvas{display:block}output{font-size:24px}</style>
<h2>计算器与模拟器</h2><input id="number" type="number" value="7"><button id="calculate">计算平方</button><output id="result">49</output>
<p>模拟速度 <input id="speed" type="range" min="0" max="100" value="20"><span id="speedValue">20</span></p><canvas width="450" height="65"></canvas><p id="bridge">桥接初始化中</p>
<script>
const number=document.querySelector('#number'),result=document.querySelector('#result'),speed=document.querySelector('#speed'),ctx=document.querySelector('canvas').getContext('2d');let request=1;
const report=()=>parent.postMessage({fixture:true,geometry:Object.fromEntries(['number','calculate','speed'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{x:r.x,y:r.y,width:r.width,height:r.height}]})),number:number.value,result:result.textContent,speed:speed.value,active:document.activeElement?.id,node:typeof require,bridge:document.querySelector('#bridge').textContent},'*');number.oninput=report;
const draw=()=>{ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,450,65);ctx.fillStyle='#276fd8';ctx.fillRect(0,10,Number(speed.value)*4,40);document.querySelector('#speedValue').textContent=speed.value;report();};speed.oninput=draw;
document.querySelector('#calculate').onclick=()=>parent.postMessage({jsonrpc:'2.0',id:++request,method:'tools/call',params:{name:'demo_square',arguments:{value:Number(number.value)}}},'*');
addEventListener('message',e=>{if(e.source!==parent)return;const m=e.data;if(m.id===1&&m.result){document.querySelector('#bridge').textContent='MCP Apps 已连接';parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');}if(m.result?.structuredContent){result.textContent=String(m.result.structuredContent.value);report();}});
parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'calculator',version:'1.0'},appCapabilities:{}}},'*');draw();setInterval(report,200);
</script>`;

export async function runWidgetChecks({
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
}) {
  await evalPage(`(() => {
    const frame=document.createElement('iframe');frame.title='计算器与模拟器';frame.style='width:600px;max-width:100%;height:360px;border:0';frame.sandbox='allow-scripts';frame.srcdoc=${JSON.stringify(widgetFixture)};
    window.widgetProtocol=[];window.widgetState=null;
    addEventListener('message',e=>{if(e.source!==frame.contentWindow)return;const m=e.data;if(m.fixture){window.widgetState=m;return;}window.widgetProtocol.push(m.method);if(m.method==='ui/initialize') frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'fixture-host',version:'1.0'},hostCapabilities:{serverTools:{}},hostContext:{displayMode:'inline',theme:'light'}}},'*');else if(m.method==='tools/call')frame.contentWindow.postMessage(m.params.name==='demo_square'?{jsonrpc:'2.0',id:m.id,result:{structuredContent:{value:m.params.arguments.value**2},content:[]}}:{jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'未授权的工具'}},'*');});
    document.querySelector('[data-markdown-text-style="assistant-message"]').append(frame);return true;
  })()`);
  await wait(async () => (await evalPage("window.widgetState"))?.bridge === "MCP Apps 已连接");
  let widgetId;
  await wait(async () => {
    const record = await evalApp(
      `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
      true,
    );
    widgetId = record.messages
      .flatMap((m) => m.widgets ?? [])
      .find((w) => w.title === "计算器与模拟器")?.id;
    return Boolean(widgetId);
  });
  const card = `[data-widget-id=${JSON.stringify(widgetId)}]`;
  const readFrame = async () => {
    let frame;
    await wait(async () => {
      try {
        frame = await evalApp(
          `window.craftstation.webChatWidgetFrame({sessionId:${JSON.stringify(session.id)},widgetId:${JSON.stringify(widgetId)}})`,
          true,
        );
        return true;
      } catch (error) {
        if (!String(error).includes("WEB_WIDGET_RESIZING")) throw error;
        return false;
      }
    });
    return frame;
  };
  await wait(async () => await evalApp(`Boolean(document.querySelector(${JSON.stringify(card)}))`));
  if (
    await evalApp(
      `Boolean([...document.querySelectorAll(${JSON.stringify(card + " button")})].find(b=>b.textContent.includes('打开交互')))`,
    )
  )
    await press(card, "打开交互");
  await wait(async () =>
    Boolean(
      await evalApp(
        `document.querySelector(${JSON.stringify(card + " [data-testid=webchat-widget-surface] img")})?.complete`,
      ),
    ),
  );
  const sendPointer = async (phase, x, y, pressed) => {
    const frame = await readFrame();
    await evalApp(
      `window.craftstation.webChatWidgetInput(${JSON.stringify({ sessionId: session.id, widgetId, frameId: frame.frameId, input: { kind: "pointer", phase, x, y, pressed } })})`,
      true,
    );
  };
  const tapControl = async (name) => {
    await wait(
      async () => Number((await evalPage("window.widgetState"))?.geometry?.[name]?.width) > 0,
    );
    const state = await evalPage("window.widgetState");
    const b = state.geometry[name];
    await evalApp(
      `document.querySelector(${JSON.stringify(card + " [data-testid=webchat-widget-surface]")}).scrollIntoView({block:'center',behavior:'instant'})`,
    );
    await evalApp(
      "new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))",
      true,
    );
    const p = await evalApp(
      `(()=>{const e=document.querySelector(${JSON.stringify(card + " [data-testid=webchat-widget-surface]")});const r=e.getBoundingClientRect();return {x:r.x+((${b.x}+${b.width}/2)/600)*r.width,y:r.y+((${b.y}+${b.height}/2)/360)*r.height};})()`,
    );
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await app.send("Input.dispatchMouseEvent", {
        type,
        ...p,
        button: "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: 1,
      });
      if (type === "mousePressed") await new Promise((done) => setTimeout(done, 80));
    }
  };
  await tapControl("number");
  // The one-digit number input can place its caret on either side after a click.
  // Delete both sides; Home/Delete alone can leave 7 and append 9 as 79.
  const keys = ["Backspace", "Delete"];
  // 原网页输入框获得焦点；本地卡片传回键盘、文本而不读取 iframe DOM。
  for (const key of keys) {
    const frame = await readFrame();
    await evalApp(
      `window.craftstation.webChatWidgetInput(${JSON.stringify({ sessionId: session.id, widgetId, frameId: frame.frameId, input: { kind: "key", key } })})`,
      true,
    );
  }
  const frame = await readFrame();
  await evalApp(
    `window.craftstation.webChatWidgetInput(${JSON.stringify({ sessionId: session.id, widgetId, frameId: frame.frameId, input: { kind: "text", text: "9" } })})`,
    true,
  );
  await wait(async () => (await evalPage("window.widgetState"))?.number === "9");
  await tapControl("calculate");
  await wait(async () => (await evalPage("window.widgetState"))?.result === "81");
  checks.push("原网页隔离 iframe → 本地卡片真实点击/键盘/输入 → MCP Apps tools/call → 结果 81");
  const state = await evalPage("window.widgetState");
  const b = state.geometry.speed;
  const px = (b.x + b.width * 0.2) / 600,
    py = (b.y + b.height / 2) / 360;
  await sendPointer("down", px, py, true);
  await sendPointer("move", (b.x + b.width * 0.8) / 600, py, true);
  await sendPointer("up", (b.x + b.width * 0.8) / 600, py, false);
  await wait(async () => Number((await evalPage("window.widgetState")).speed) > 65);
  if ((await evalPage("window.widgetState")).node !== "undefined")
    throw Error("组件获得 Node 权限");
  checks.push("滑块按下/拖动/释放改变模拟图表；组件无 Node 权限，公开 MCP Apps 初始化链路保留");
  await evalApp(
    `document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'start',behavior:'instant'})`,
  );
  await press(card, "展开");
  await wait(async () =>
    Boolean(
      await evalApp(
        "Boolean(document.querySelector('[role=dialog] [data-testid=webchat-widget-surface]'))",
      ),
    ),
  );
  const shot = await app.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outDir, "webchat-widget-expanded.png"), Buffer.from(shot.data, "base64"));
  await click("[role=dialog] button[aria-label=Close]");
  await wait(
    async () =>
      !(await evalApp(
        "Boolean(document.querySelector('[role=dialog] [data-testid=webchat-widget-surface]'))",
      )),
  );
  await press(card, "继续修改");
  if (
    !(await evalApp(
      "document.querySelector('[data-testid=chatgpt-web-page] textarea').value.includes('计算器与模拟器')",
    ))
  )
    throw Error("未生成组件修改草稿");
  await evalApp(
    "(()=>{const e=document.querySelector('[data-testid=chatgpt-web-page] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  checks.push("组件展开与关闭、继续修改草稿定位到当前组件");

  // Screenshot regression: native HTML controls with no iframe or special
  // visualization marker must become live cards instead of flattened text.
  await evalPage(`(() => {
    const turn=document.createElement('article');turn.dataset.turnId='inline-widget-turn';
    turn.innerHTML='<div data-markdown-text-style="assistant-message"><div class="markdown"><p>几个交互小玩意</p><section id="inline-clicker" style="padding:24px;background:#191426;color:white;border-radius:16px;margin:12px 0;min-height:200px"><h2>解压点击器</h2><output id="inline-count">0</output><p><button id="inline-click" style="background:#8b5cf6;color:white;padding:20px;border-radius:40px">给我点！</button></p></section><section id="inline-mood" style="padding:24px;min-height:160px;background:#202030;color:white;border-radius:16px"><h2>心情调节器</h2><input id="inline-slider" type="range" min="0" max="100" value="20" style="width:80%"><output id="inline-mood-value">20</output></section></div></div>';
    document.querySelector('main').append(turn);
    document.querySelector('#inline-click').onclick=()=>{const e=document.querySelector('#inline-count');e.textContent=String(Number(e.textContent)+1);};
    document.querySelector('#inline-slider').oninput=e=>document.querySelector('#inline-mood-value').textContent=e.target.value;
  })()`);
  let inlineId;
  await wait(async () => {
    const record = await evalApp(
      `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
      true,
    );
    inlineId = record.messages
      .flatMap((m) => m.widgets ?? [])
      .find((w) => w.title === "解压点击器")?.id;
    return Boolean(inlineId);
  });
  const inlineCard = `[data-widget-id=${JSON.stringify(inlineId)}]`;
  await wait(
    async () =>
      await evalApp(
        `Boolean(document.querySelector(${JSON.stringify(inlineCard + " [data-testid=webchat-widget-surface] img")}))`,
      ),
  );
  const inlinePoint = async (selector, fraction = 0.5) => {
    const target = await evalPage(
      `(() => {const el=document.querySelector(${JSON.stringify(selector)});const r=el.getBoundingClientRect(),s=el.closest('section').getBoundingClientRect();return {x:r.x-s.x+r.width*${fraction},y:r.y-s.y+r.height/2,width:s.width,height:s.height};})()`,
    );
    const surfaceSelector = `[data-widget-id=${JSON.stringify(selector === "#inline-click" ? inlineId : moodId)}] [data-testid=webchat-widget-surface]`;
    await evalApp(
      `document.querySelector(${JSON.stringify(surfaceSelector)}).scrollIntoView({block:'center',behavior:'instant'})`,
    );
    return await evalApp(
      `(() => {const r=document.querySelector(${JSON.stringify(surfaceSelector)}).getBoundingClientRect();return {x:r.x+r.width*${target.x / target.width},y:r.y+r.height*${target.y / target.height}};})()`,
    );
  };
  const clickPoint = await inlinePoint("#inline-click");
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await app.send("Input.dispatchMouseEvent", {
      type,
      ...clickPoint,
      button: "left",
      buttons: type === "mousePressed" ? 1 : 0,
      clickCount: 1,
    });
  await wait(
    async () => (await evalPage("document.querySelector('#inline-count').textContent")) === "1",
  );
  const inlineShot = await app.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(outDir, "webchat-inline-clicker.png"),
    Buffer.from(inlineShot.data, "base64"),
  );
  const record = await evalApp(
    `window.craftstation.webChatRead({sessionId:${JSON.stringify(session.id)}})`,
    true,
  );
  const moodId = record.messages
    .flatMap((m) => m.widgets ?? [])
    .find((w) => w.title === "心情调节器")?.id;
  if (!moodId) throw Error("原生 HTML 滑块未识别");
  await press(`[data-widget-id=${JSON.stringify(moodId)}]`, "打开交互");
  await wait(
    async () =>
      await evalApp(
        `Boolean(document.querySelector('[data-widget-id="${moodId}"] [data-testid=webchat-widget-surface] img'))`,
      ),
  );
  const down = await inlinePoint("#inline-slider", 0.2);
  const up = await inlinePoint("#inline-slider", 0.85);
  await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...down });
  await app.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...down,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await app.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...up,
    button: "left",
    buttons: 1,
  });
  await app.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...up,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await wait(
    async () => Number(await evalPage("document.querySelector('#inline-slider').value")) > 65,
  );
  checks.push(
    "无专用标记的 HTML 小部件自动同步：点击器 0→1，滑块真实拖动更新原网页；新回复自动连接",
  );
}
