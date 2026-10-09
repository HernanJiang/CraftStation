import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDebugConnection } from "./craftstation-debug-session.mjs";
import { inspectCdpWindowTargets, closeWebSocket } from "./craftstation-cdp-target.mjs";

// Exercise real layout, including CSS zoom; jsdom cannot detect overlapping panels.
export async function responsiveLayoutScenario(client, outDir) {
  await mkdir(outDir, { recursive: true });
  const evaluate = async (expression) => {
    const result = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const previous = await evaluate(`(() => {
    const d = window.__craftstationDev;
    window.__layoutPrevious = {
      panel: d.stores.panel.getState(),
      settings: d.stores.sharedSettings.getState(),
      app: d.stores.app.getState(),
      update: d.stores.update.getState(),
    };
    return { zoom: d.stores.sharedSettings.getState().zoomFactor };
  })()`);
  const cases = [];
  const failures = [];
  try {
    for (const [width, height, zoom] of [
      [1920, 1080, 1],
      [1460, 920, 1],
      [1460, 920, 1.3],
      [1460, 920, 1.5],
      [1024, 800, 1],
      [1024, 800, 1.3],
      [1024, 800, 1.5],
      [720, 800, 1],
      [720, 800, 1.3],
      [540, 720, 1.5],
    ]) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(`(async () => {
        const d = window.__craftstationDev;
        d.stores.sharedSettings.getState().setZoomFactor(${zoom});
        d.stores.panel.getState().openModelUsageWorkspace({tab:'crafting'});
        await new Promise(r => setTimeout(r, 300));
      })()`);
      const crafting = await evaluate(`(() => {
        const page = document.querySelector('[data-testid="crafting-workbench-page"]');
        const rect = e => { const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
        const selectors = ['efficient-workbench','crafting-result-detail','recipes-rail','models-inventory','harness-inventory','components-rail'];
        const panels = selectors.map(id => ({id, ...rect(page.querySelector('[data-testid="'+id+'"]'))}));
        const overlaps = [];
        for (let i=0;i<panels.length;i++) for (let j=i+1;j<panels.length;j++) {
          const a=panels[i],b=panels[j];
          if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1) overlaps.push([a.id,b.id]);
        }
        const bounds=rect(page);
        return {bounds,panels,overlaps,outside:panels.filter(r=>r.left<bounds.left-1 || r.right>bounds.right+1).map(r=>r.id)};
      })()`);
      if (crafting.overlaps.length || crafting.outside.length)
        failures.push({ width, zoom, surface: "crafting", ...crafting });
      await client
        .send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        })
        .then((r) =>
          writeFile(join(outDir, `crafting-${width}-${zoom}.png`), Buffer.from(r.data, "base64")),
        );
      crafting.unreachable = await evaluate(`(() => {
        const page=document.querySelector('[data-testid="crafting-workbench-page"]');
        const unreachable=[];
        for(const id of ['efficient-workbench','crafting-result-detail','recipes-rail','models-inventory','harness-inventory','components-rail']) {
          const panel=page.querySelector('[data-testid="'+id+'"]');
          panel.scrollIntoView({block:'center',behavior:'instant'});
          const r=panel.getBoundingClientRect();
          if(r.bottom<=38 || r.top>=innerHeight || r.right<=0 || r.left>=innerWidth) unreachable.push(id);
        }
        return unreachable;
      })()`);
      if (crafting.unreachable.length)
        failures.push({ width, zoom, surface: "crafting-scroll", ...crafting });
      await evaluate(`(async () => {
        const d=window.__craftstationDev;
        d.closeSettings();
        d.stores.update.setState({phase:'downloading',version:'1.8.9',downloadPercent:42,downloadTransferred:30000000,downloadTotal:100000000,downloadBytesPerSecond:108000});
        await new Promise(r=>setTimeout(r,180));
      })()`);
      const titlebar = await evaluate(`(() => {
        const bar=document.querySelector('.craftstation-titlebar');
        const rect=e=> {const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};
        const controls=Array.from(bar.querySelectorAll('button')).filter(e=>e.getBoundingClientRect().width && e.checkVisibility()).map(e=>({id:e.dataset.testid??e.getAttribute('aria-label')??e.textContent.trim(),...rect(e)}));
        const overlaps=[];
        for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1)overlaps.push([a.id,b.id]);}
        const spacer=rect(bar.querySelector('[data-testid="titlebar-window-controls-spacer"]'));
        return {controls,overlaps,spacer,outside:controls.filter(r=>r.left<0||r.right>spacer.left+1).map(r=>r.id)};
      })()`);
      if (titlebar.overlaps.length || titlebar.outside.length)
        failures.push({ width, zoom, surface: "titlebar", ...titlebar });
      await client
        .send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        })
        .then((r) =>
          writeFile(join(outDir, `titlebar-${width}-${zoom}.png`), Buffer.from(r.data, "base64")),
        );
      cases.push({ width, height, zoom, crafting, titlebar });
    }
    const click = async (selector) => {
      const point = await evaluate(`(() => {
        const element=document.querySelector(${JSON.stringify(selector)});
        if(!element?.checkVisibility()) throw new Error('Missing visible control: '+${JSON.stringify(selector)});
        const r=element.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};
      })()`);
      await client.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        button: "left",
        clickCount: 1,
        ...point,
      });
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        button: "left",
        clickCount: 1,
        ...point,
      });
    };
    await click('[data-testid="titlebar-navigation-menu"]');
    await evaluate("new Promise(r=>setTimeout(r,150))");
    await click('[role="menuitem"][data-key="plan"]');
    await evaluate("new Promise(r=>setTimeout(r,150))");
    assert.equal(
      await evaluate("window.__craftstationDev.stores.app.getState().view.kind"),
      "schedules",
      "窄窗口菜单应打开计划页面",
    );
  } finally {
    await client.send("Emulation.clearDeviceMetricsOverride");
    await evaluate(`(() => {
      const d=window.__craftstationDev, p=window.__layoutPrevious;
      d.stores.sharedSettings.getState().setZoomFactor(${previous.zoom});
      d.stores.panel.setState(p.panel);
      d.stores.app.setState(p.app);
      d.stores.update.setState(p.update);
      delete window.__layoutPrevious;
    })()`);
    await writeFile(
      join(outDir, "responsive-layout.json"),
      JSON.stringify({ cases, failures }, null, 2),
    );
  }
  assert.equal(
    failures.length,
    0,
    `布局重叠/越界：${failures.map((f) => `${f.surface} ${f.width}px ${f.zoom * 100}% ${JSON.stringify(f.overlaps)} ${JSON.stringify(f.outside)}`).join("; ")}`,
  );
  return { cases: cases.length, failures: 0 };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const session = process.argv[2];
  const outDir = process.argv[3];
  const connection = await resolveDebugConnection({
    session,
    repoRoot: resolve("."),
    allowedPurposes: ["debug", "smoke"],
  });
  const targets = await inspectCdpWindowTargets(connection);
  assert.equal(targets.ready.length, 1);
  const ws = new WebSocket(targets.ready[0].webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    ws.onopen = done;
    ws.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = (message) => {
    const p = JSON.parse(message.data);
    if (p.id) {
      const entry = pending.get(p.id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(p.id);
        if (p.error) entry.reject(new Error(p.error.message));
        else entry.resolve(p.result);
      }
    }
  };
  const client = {
    send(method, params = {}) {
      return new Promise((done, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(method + " timed out"));
        }, 10000);
        pending.set(id, { resolve: done, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
  try {
    console.log(JSON.stringify(await responsiveLayoutScenario(client, outDir)));
  } finally {
    await closeWebSocket(ws);
  }
}
