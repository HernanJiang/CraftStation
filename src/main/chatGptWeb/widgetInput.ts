import type { WebChatWidgetInput } from "@/shared/chatGptWeb";

type Send = (method: string, params: Record<string, unknown>, sessionId?: string) => Promise<any>;
type Listen = (
  listener: (event: { sessionId: string; targetInfo: { targetId: string } }) => void,
) => () => void;

/** Route only through iframe nodes under the already validated component. */
export async function dispatchWidgetInput(
  send: Send,
  input: WebChatWidgetInput,
  point?: { x: number; y: number },
  listen?: Listen,
) {
  let sessionId: string | undefined;
  let local = point;
  const attached: string[] = [];
  const children = new Map<string, string>();
  const automatic: Array<string | undefined> = [];
  const unsubscribe = listen?.((event) => children.set(event.targetInfo.targetId, event.sessionId));
  try {
    for (let depth = 0; depth < 8; depth++) {
      const expression = `(() => { const el=${local ? `document.elementFromPoint(${local.x},${local.y})` : "document.activeElement"}; return el instanceof HTMLIFrameElement ? el : null; })()`;
      const remote = await send(
        "Runtime.evaluate",
        { expression, returnByValue: false },
        sessionId,
      );
      if (remote.exceptionDetails)
        throw new Error("WEB_WIDGET_FRAME：无法确定组件的输入目标，请刷新。");
      const objectId = remote.result?.objectId;
      if (!objectId) break;
      let node: { frameId?: string; contentDocument?: unknown };
      let nextPoint = local;
      try {
        ({ node } = await send("DOM.describeNode", { objectId }, sessionId));
        if (local) {
          const geometry = await send(
            "Runtime.callFunctionOn",
            {
              objectId,
              functionDeclaration:
                "function(){const r=this.getBoundingClientRect();return {x:r.x,y:r.y,scaleX:r.width/this.offsetWidth,scaleY:r.height/this.offsetHeight,left:this.clientLeft,top:this.clientTop};}",
              returnByValue: true,
            },
            sessionId,
          );
          const r = geometry.result?.value;
          if (!r?.scaleX || !r.scaleY) throw new Error("WEB_WIDGET_FRAME：组件已隐藏，请刷新。");
          nextPoint = {
            x: (local.x - r.x) / r.scaleX - r.left,
            y: (local.y - r.y) / r.scaleY - r.top,
          };
        }
      } finally {
        await send("Runtime.releaseObject", { objectId }, sessionId).catch(() => {});
      }
      // Same-process frames are handled by Chromium's parent input routing.
      if (!node.frameId || node.contentDocument) break;
      let target: { sessionId?: string };
      if (listen) {
        // Electron's page debugger exposes related iframe targets through
        // auto-attach; attachToTarget can only see the page's own target.
        await send(
          "Target.setAutoAttach",
          {
            autoAttach: true,
            waitForDebuggerOnStart: false,
            flatten: true,
            filter: [{ type: "iframe", exclude: false }, { exclude: true }],
          },
          sessionId,
        );
        automatic.push(sessionId);
        if (!children.has(node.frameId)) await new Promise<void>((done) => setTimeout(done, 100));
        const childSessionId = children.get(node.frameId);
        target = childSessionId ? { sessionId: childSessionId } : {};
      } else
        target = await send("Target.attachToTarget", { targetId: node.frameId, flatten: true });
      if (!target.sessionId)
        throw new Error("WEB_WIDGET_FRAME：组件的跨域输入连接不可用，请刷新。");
      if (!listen) attached.push(target.sessionId);
      sessionId = target.sessionId;
      local = nextPoint;
      if (depth === 7) throw new Error("WEB_WIDGET_FRAME：组件嵌套层数过多，请打开原网页。");
    }
    if (input.kind === "pointer") {
      await send(
        "Input.dispatchMouseEvent",
        {
          type:
            input.phase === "down"
              ? "mousePressed"
              : input.phase === "up"
                ? "mouseReleased"
                : "mouseMoved",
          ...local,
          button: input.phase === "move" && !input.pressed ? "none" : "left",
          buttons: input.pressed ? 1 : 0,
          clickCount: input.phase === "move" ? 0 : 1,
        },
        sessionId,
      );
    } else if (input.kind === "scroll") {
      await send(
        "Input.dispatchMouseEvent",
        { type: "mouseWheel", ...local, deltaX: input.deltaX, deltaY: input.deltaY },
        sessionId,
      );
    } else if (input.kind === "text") {
      await send("Input.insertText", { text: input.text }, sessionId);
    } else {
      const keyCode = {
        Enter: 13,
        Tab: 9,
        Escape: 27,
        Backspace: 8,
        Delete: 46,
        ArrowLeft: 37,
        ArrowRight: 39,
        ArrowUp: 38,
        ArrowDown: 40,
        Home: 36,
        End: 35,
        Space: 32,
      }[input.key];
      const event = {
        key: input.key === "Space" ? " " : input.key,
        code: input.key,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers: input.shift ? 8 : 0,
      };
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...event }, sessionId);
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...event }, sessionId);
    }
  } finally {
    for (const id of automatic.reverse())
      await send(
        "Target.setAutoAttach",
        { autoAttach: false, waitForDebuggerOnStart: false, flatten: true },
        id,
      ).catch(() => {});
    unsubscribe?.();
    for (const id of attached.reverse())
      await send("Target.detachFromTarget", { sessionId: id }).catch(() => {});
  }
}
