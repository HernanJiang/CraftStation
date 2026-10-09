import { describe, expect, it, vi } from "vitest";
import { dispatchWidgetInput } from "./widgetInput";

describe("网页组件跨 iframe 输入", () => {
  function fixture(options: { sameProcess?: boolean; failInput?: boolean } = {}) {
    let visited = false;
    const send = vi
      .fn<
        (method: string, params: Record<string, unknown>, sessionId?: string) => Promise<unknown>
      >()
      .mockImplementation(async (method) => {
        if (method === "Runtime.evaluate") {
          if (visited) return { result: { subtype: "null" } };
          visited = true;
          return { result: { objectId: "owned-frame" } };
        }
        if (method === "DOM.describeNode")
          return {
            node: {
              frameId: "child-target",
              ...(options.sameProcess ? { contentDocument: {} } : {}),
            },
          };
        if (method === "Runtime.callFunctionOn")
          return { result: { value: { x: 100, y: 200, scaleX: 2, scaleY: 2, left: 1, top: 1 } } };
        if (method === "Target.attachToTarget") return { sessionId: "owned-child-session" };
        if (method.startsWith("Input.") && options.failInput) throw Error("child closed");
        return {};
      });
    return send;
  }
  it("跨域 iframe 坐标转换后投递给对应子会话，释放临时连接", async () => {
    const send = fixture();
    await dispatchWidgetInput(
      send,
      { kind: "pointer", phase: "down", x: 0.5, y: 0.5, pressed: true },
      { x: 142, y: 262 },
    );
    expect(send).toHaveBeenCalledWith(
      "Input.dispatchMouseEvent",
      expect.objectContaining({ x: 20, y: 30, type: "mousePressed" }),
      "owned-child-session",
    );
    expect(send).toHaveBeenCalledWith("Target.attachToTarget", {
      targetId: "child-target",
      flatten: true,
    });
    expect(send).toHaveBeenCalledWith("Target.detachFromTarget", {
      sessionId: "owned-child-session",
    });
  });
  it("键盘与文字进入已聚焦的子 iframe", async () => {
    const send = fixture();
    await dispatchWidgetInput(send, { kind: "text", text: "中文测试" });
    expect(send).toHaveBeenCalledWith(
      "Input.insertText",
      { text: "中文测试" },
      "owned-child-session",
    );
  });
  it("Electron 自动附加仅使用对应 iframe，会后撤销并移除监听", async () => {
    const send = fixture();
    const original = send.getMockImplementation()!;
    let listener:
      | ((event: { sessionId: string; targetInfo: { targetId: string } }) => void)
      | undefined;
    const unsubscribe = vi.fn<() => void>();
    send.mockImplementation(async (method, params, sessionId) => {
      if (method === "Target.setAutoAttach") {
        if (params.autoAttach)
          listener?.({ sessionId: "native-child", targetInfo: { targetId: "child-target" } });
        return {};
      }
      return original(method, params, sessionId);
    });
    await dispatchWidgetInput(send, { kind: "text", text: "9" }, undefined, (receive) => {
      listener = receive;
      return unsubscribe;
    });
    expect(send).toHaveBeenCalledWith("Input.insertText", { text: "9" }, "native-child");
    expect(send).not.toHaveBeenCalledWith("Target.attachToTarget", expect.anything());
    expect(send).toHaveBeenCalledWith(
      "Target.setAutoAttach",
      { autoAttach: false, waitForDebuggerOnStart: false, flatten: true },
      undefined,
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
  it("同进程 iframe 保留 Chromium 的顶层投递", async () => {
    const send = fixture({ sameProcess: true });
    await dispatchWidgetInput(
      send,
      { kind: "pointer", phase: "up", x: 0.5, y: 0.5, pressed: false },
      { x: 142, y: 262 },
    );
    expect(send).toHaveBeenCalledWith(
      "Input.dispatchMouseEvent",
      expect.objectContaining({ x: 142, y: 262 }),
      undefined,
    );
    expect(send).not.toHaveBeenCalledWith("Target.attachToTarget", expect.anything());
  });
  it("子 iframe 关闭时不回退给其他页面，仍释放连接", async () => {
    const send = fixture({ failInput: true });
    await expect(dispatchWidgetInput(send, { kind: "key", key: "Enter" })).rejects.toThrow(
      "child closed",
    );
    expect(send).toHaveBeenCalledWith("Target.detachFromTarget", {
      sessionId: "owned-child-session",
    });
    expect(send.mock.calls.filter(([method]) => method.startsWith("Input."))).toHaveLength(1);
  });
});
