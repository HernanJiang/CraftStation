import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadAttention, ThreadStatus } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";

const nativeImageMock = vi.hoisted(() => ({
  createFromDataURL: vi.fn<(dataUrl: string) => unknown>(() => ({ id: "overlay-dot" })),
}));
const dockBounceMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  app: { dock: { bounce: dockBounceMock } },
  nativeImage: nativeImageMock,
}));

import { createTaskbarAttentionController } from "./taskbarAttention";

type ThreadStateEvent = Extract<SupervisorEvent, { type: "thread-state" }>;

function threadState(
  threadId: string,
  status: ThreadStatus,
  attention: ThreadAttention = "none",
  extra?: Partial<ThreadStateEvent>,
): SupervisorEvent {
  return {
    type: "thread-state",
    threadId,
    status,
    attention,
    canResumeWithConfig: false,
    ...extra,
  };
}

function createWindowMock() {
  return {
    destroyed: false,
    focused: false,
    isDestroyed() {
      return this.destroyed;
    },
    isFocused() {
      return this.focused;
    },
    setOverlayIcon: vi.fn<(icon: unknown, description: string) => void>(),
    flashFrame: vi.fn<(flag: boolean) => void>(),
  };
}

type WindowMock = ReturnType<typeof createWindowMock>;

function setup(options?: {
  enabled?: Partial<Record<"done" | "needsAttention" | "error", boolean>>;
}) {
  const win = createWindowMock();
  const enabledCalls: string[] = [];
  const controller = createTaskbarAttentionController({
    // The production window type is Electron's BrowserWindow; the mock only
    // implements the surface the controller touches.
    getWindow: () => win as unknown as import("electron").BrowserWindow,
    isCategoryEnabled: (category) => {
      enabledCalls.push(category);
      return options?.enabled?.[category] ?? true;
    },
  });
  return { win, controller, enabledCalls };
}

describe("taskbarAttention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("badges and flashes when a working thread finishes while the window is unfocused", () => {
    const { win, controller } = setup();
    controller.observeSupervisorEvent(threadState("t1", "working", "working"));
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
    controller.observeSupervisorEvent(threadState("t1", "finished"));
    expect(win.setOverlayIcon).toHaveBeenCalledTimes(1);
    expect(win.setOverlayIcon.mock.calls[0]?.[1]).toBe("1 task needs your attention");
    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });

  it("does not flag when the window is focused at settle time", () => {
    const { win, controller } = setup();
    win.focused = true;
    controller.observeSupervisorEvent(threadState("t1", "working", "working"));
    controller.observeSupervisorEvent(threadState("t1", "finished"));
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
    expect(win.flashFrame).not.toHaveBeenCalled();
  });

  it("flags needs_approval and error transitions under their own categories", () => {
    const { win, controller, enabledCalls } = setup();
    controller.observeSupervisorEvent(threadState("t1", "working", "working"));
    controller.observeSupervisorEvent(threadState("t1", "needs_approval", "needs_approval"));
    controller.observeSupervisorEvent(threadState("t2", "working", "working"));
    controller.observeSupervisorEvent(threadState("t2", "error", "error"));
    expect(enabledCalls).toEqual(["needsAttention", "error"]);
    expect(win.setOverlayIcon.mock.calls.at(-1)?.[1]).toBe("2 tasks need your attention");
  });

  it("ignores user-initiated stops (forceCloseActiveTurn)", () => {
    const { win, controller, enabledCalls } = setup();
    controller.observeSupervisorEvent(threadState("t1", "working", "working"));
    controller.observeSupervisorEvent(
      threadState("t1", "finished", "none", { forceCloseActiveTurn: true }),
    );
    expect(enabledCalls).toEqual([]);
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
  });

  it("does not flag a settle that never had an active status", () => {
    const { win, controller } = setup();
    controller.observeSupervisorEvent(threadState("t1", "finished"));
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
  });

  it("respects the category gate from notification settings", () => {
    const { win, controller } = setup({ enabled: { done: false } });
    controller.observeSupervisorEvent(threadState("t1", "working", "working"));
    controller.observeSupervisorEvent(threadState("t1", "finished"));
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
  });

  it("dismissThread clears the badge and stops the flash once nothing is flagged", () => {
    const { win, controller } = setup();
    controller.observeSupervisorEvent(threadState("t1", "working", "working"));
    controller.observeSupervisorEvent(threadState("t1", "finished"));
    controller.dismissThread("t1");
    expect(win.setOverlayIcon).toHaveBeenLastCalledWith(null, "");
    expect(win.flashFrame).toHaveBeenLastCalledWith(false);
  });

  it("window focus stops the flash but keeps the badge until the thread is opened", () => {
    const { win, controller } = setup();
    controller.observeSupervisorEvent(threadState("t1", "working", "working"));
    controller.observeSupervisorEvent(threadState("t1", "finished"));
    controller.notifyWindowFocus();
    expect(win.flashFrame).toHaveBeenLastCalledWith(false);
    // No clearing setOverlayIcon(null) call after the badge was painted.
    expect(win.setOverlayIcon).toHaveBeenCalledTimes(1);
  });

  it("auto-dismisses a flagged thread when it exits", () => {
    const { win, controller } = setup();
    controller.observeSupervisorEvent(threadState("t1", "working", "working"));
    controller.observeSupervisorEvent(threadState("t1", "finished"));
    controller.observeSupervisorEvent({ type: "thread-exited", threadId: "t1", exitCode: 0 });
    expect(win.setOverlayIcon).toHaveBeenLastCalledWith(null, "");
  });

  it("bounces the dock on macOS when flagging unfocused", () => {
    const { controller } = setup();
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    try {
      controller.observeSupervisorEvent(threadState("t1", "working", "working"));
      controller.observeSupervisorEvent(threadState("t1", "finished"));
      expect(dockBounceMock).toHaveBeenCalledWith("informational");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });

  it("dispose clears state and unpaints the window", () => {
    const { win, controller } = setup();
    controller.observeSupervisorEvent(threadState("t1", "working", "working"));
    controller.observeSupervisorEvent(threadState("t1", "finished"));
    controller.dispose();
    expect(win.setOverlayIcon).toHaveBeenLastCalledWith(null, "");
    expect(win.flashFrame).toHaveBeenLastCalledWith(false);
  });

  it("tolerates a missing window", () => {
    const controller = createTaskbarAttentionController({
      getWindow: () => null,
      isCategoryEnabled: () => true,
    });
    expect(() => {
      controller.observeSupervisorEvent(threadState("t1", "working", "working"));
      controller.observeSupervisorEvent(threadState("t1", "finished"));
      controller.notifyWindowFocus();
      controller.dismissThread("t1");
      controller.dispose();
    }).not.toThrow();
  });
});
