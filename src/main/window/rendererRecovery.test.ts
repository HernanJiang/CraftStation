import { describe, expect, it, vi, type Mock } from "vitest";
import type { BrowserWindow } from "electron";
import { recoverRendererContent, scheduleRendererContentCheck } from "./rendererRecovery";
import { installRendererReloadGuard } from "./windowHardening";

type Handler = (...args: unknown[]) => void;

interface HealthState {
  /** Value returned by the health probe's executeJavaScript expression. */
  probe: { rootChildren: number; bootSplash: boolean };
  crashed: boolean;
}

function createWindowHarness(state: HealthState) {
  const handlers = new Map<string, Handler>();
  const onceHandlers = new Map<string, Handler>();
  const reload = vi.fn<() => void>();
  const window = {
    isDestroyed: vi.fn<() => boolean>(() => false),
    isVisible: vi.fn<() => boolean>(() => true),
    on: vi.fn<(event: string, handler: Handler) => void>((event, handler) => {
      handlers.set(event, handler);
    }),
    webContents: {
      isDestroyed: vi.fn<() => boolean>(() => false),
      isCrashed: vi.fn<() => boolean>(() => state.crashed),
      isLoading: vi.fn<() => boolean>(() => false),
      reload,
      executeJavaScript: vi
        .fn<() => Promise<unknown>>()
        .mockImplementation(() => Promise.resolve({ ...state.probe })),
      on: vi.fn<(event: string, handler: Handler) => void>((event, handler) => {
        handlers.set(event, handler);
      }),
      once: vi.fn<(event: string, handler: Handler) => void>((event, handler) => {
        onceHandlers.set(event, handler);
      }),
      removeListener: vi.fn<(event: string, handler: Handler) => void>((event, handler) => {
        if (onceHandlers.get(event) === handler) onceHandlers.delete(event);
      }),
    },
  } as unknown as BrowserWindow;
  // Real windows always run the reload guard; the tracked reload needs its state.
  installRendererReloadGuard(window, { loadRenderer: vi.fn<() => void>() });
  return { handlers, onceHandlers, reload, state, window };
}

const FAST_WAITS = { reloadLoadMs: 0, mountMs: 30, recreateDelayMs: 0 };

describe("recoverRendererContent", () => {
  it("does nothing when the content is already healthy", async () => {
    const harness = createWindowHarness({
      probe: { rootChildren: 3, bootSplash: false },
      crashed: false,
    });
    const outcome = await recoverRendererContent({
      window: harness.window,
      waitWindows: FAST_WAITS,
    });
    expect(outcome).toBe("healthy");
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it("reloads once and recovers when the renderer was stuck on the boot splash", async () => {
    const harness = createWindowHarness({
      probe: { rootChildren: 0, bootSplash: true },
      crashed: false,
    });
    const reload = harness.reload;
    const execute = (
      harness.window.webContents as unknown as {
        executeJavaScript: Mock<(code: string) => Promise<unknown>>;
      }
    ).executeJavaScript;
    execute.mockImplementation(() => {
      // After the reload is issued the document mounts normally.
      return Promise.resolve(
        reload.mock.calls.length > 0
          ? { rootChildren: 2, bootSplash: false }
          : { rootChildren: 0, bootSplash: true },
      );
    });

    const outcome = await recoverRendererContent({
      window: harness.window,
      waitWindows: FAST_WAITS,
    });
    expect(outcome).toBe("reloaded");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("recreates the window when the reload still leaves the content stuck", async () => {
    const harness = createWindowHarness({
      probe: { rootChildren: 0, bootSplash: true },
      crashed: false,
    });
    const recreate = vi.fn<() => BrowserWindow | null>(() => harness.window);
    const outcome = await recoverRendererContent({
      window: harness.window,
      recreate,
      waitWindows: FAST_WAITS,
    });
    expect(outcome).toBe("recreated");
    expect(recreate).toHaveBeenCalledOnce();
  });

  it("gives up without recreating when the caller cannot build a replacement", async () => {
    const harness = createWindowHarness({
      probe: { rootChildren: 0, bootSplash: true },
      crashed: false,
    });
    const outcome = await recoverRendererContent({
      window: harness.window,
      recreate: () => null,
      waitWindows: FAST_WAITS,
    });
    expect(outcome).toBe("unrecovered");
  });

  it("coalesces concurrent recoveries for the same window", async () => {
    const harness = createWindowHarness({
      probe: { rootChildren: 0, bootSplash: true },
      crashed: false,
    });
    const recreate = vi.fn<() => BrowserWindow | null>(() => harness.window);
    const first = recoverRendererContent({
      window: harness.window,
      recreate,
      waitWindows: FAST_WAITS,
    });
    const second = recoverRendererContent({
      window: harness.window,
      recreate,
      waitWindows: FAST_WAITS,
    });
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    expect(firstOutcome).toBe("recreated");
    expect(secondOutcome).toBe("recreated");
    expect(recreate).toHaveBeenCalledOnce();
  });

  it("skips a new ladder while the previous one is still cooling down", async () => {
    const harness = createWindowHarness({
      probe: { rootChildren: 3, bootSplash: false },
      crashed: false,
    });
    const first = await recoverRendererContent({ window: harness.window, waitWindows: FAST_WAITS });
    const second = await recoverRendererContent({
      window: harness.window,
      waitWindows: FAST_WAITS,
    });
    expect(first).toBe("healthy");
    expect(second).toBe("unrecovered");
  });
});

describe("scheduleRendererContentCheck", () => {
  it("recovers after restoring a blank minimized window", async () => {
    vi.useFakeTimers();
    try {
      const harness = createWindowHarness({
        probe: { rootChildren: 0, bootSplash: false },
        crashed: false,
      });
      const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
      scheduleRendererContentCheck({ window: harness.window, delayMs: 20_000, recover });
      harness.handlers.get("restore")?.();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(recover).toHaveBeenCalledExactlyOnceWith(harness.window);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the mount grace period when a cold window is first shown", async () => {
    vi.useFakeTimers();
    try {
      const harness = createWindowHarness({
        probe: { rootChildren: 0, bootSplash: true },
        crashed: false,
      });
      let visible = false;
      harness.window.isVisible = () => visible;
      const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
      scheduleRendererContentCheck({ window: harness.window, delayMs: 20_000, recover });
      await vi.advanceTimersByTimeAsync(20_000);
      visible = true;
      harness.handlers.get("show")?.();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(recover).not.toHaveBeenCalled();
      harness.state.probe = { rootChildren: 3, bootSplash: false };
      await vi.advanceTimersByTimeAsync(19_000);
      expect(recover).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not recover a window hidden while its health probe is pending", async () => {
    vi.useFakeTimers();
    try {
      const harness = createWindowHarness({
        probe: { rootChildren: 0, bootSplash: false },
        crashed: false,
      });
      const execute = vi.mocked(harness.window.webContents.executeJavaScript);
      let finishProbe: (value: unknown) => void = () => {};
      execute.mockReturnValue(
        new Promise((resolve) => {
          finishProbe = resolve;
        }),
      );
      const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
      scheduleRendererContentCheck({ window: harness.window, delayMs: 1_000, recover });
      await vi.advanceTimersByTimeAsync(1_000);
      harness.window.isVisible = () => false;
      finishProbe({ rootChildren: 0, bootSplash: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(recover).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a pending reveal check when the window closes", async () => {
    vi.useFakeTimers();
    try {
      const harness = createWindowHarness({
        probe: { rootChildren: 0, bootSplash: false },
        crashed: false,
      });
      const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
      scheduleRendererContentCheck({ window: harness.window, delayMs: 20_000, recover });
      harness.handlers.get("show")?.();
      harness.handlers.get("closed")?.();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(harness.window.webContents.executeJavaScript).not.toHaveBeenCalled();
      expect(recover).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks again after a window closed to tray is shown with blank content", async () => {
    vi.useFakeTimers();
    try {
      const harness = createWindowHarness({
        probe: { rootChildren: 3, bootSplash: false },
        crashed: false,
      });
      const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
      scheduleRendererContentCheck({ window: harness.window, delayMs: 20_000, recover });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(recover).not.toHaveBeenCalled();

      harness.state.probe = { rootChildren: 0, bootSplash: false };
      harness.handlers.get("show")?.();
      await vi.advanceTimersByTimeAsync(20_000);

      expect(recover).toHaveBeenCalledExactlyOnceWith(harness.window);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs the recovery ladder once when the check finds stuck content", async () => {
    const harness = createWindowHarness({
      probe: { rootChildren: 0, bootSplash: true },
      crashed: false,
    });
    (harness.window as unknown as { isVisible: () => boolean }).isVisible = () => true;
    const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
    scheduleRendererContentCheck({ window: harness.window, delayMs: 10, recover });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recover).toHaveBeenCalledOnce();
  });

  it("does not act when the window is hidden (closed to tray)", async () => {
    const harness = createWindowHarness({
      probe: { rootChildren: 0, bootSplash: true },
      crashed: false,
    });
    (harness.window as unknown as { isVisible: () => boolean }).isVisible = () => false;
    const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
    scheduleRendererContentCheck({ window: harness.window, delayMs: 10, recover });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recover).not.toHaveBeenCalled();
  });

  it("does not act when the content is healthy", async () => {
    const harness = createWindowHarness({
      probe: { rootChildren: 3, bootSplash: false },
      crashed: false,
    });
    (harness.window as unknown as { isVisible: () => boolean }).isVisible = () => true;
    const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
    scheduleRendererContentCheck({ window: harness.window, delayMs: 10, recover });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recover).not.toHaveBeenCalled();
  });
});
