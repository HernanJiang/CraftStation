import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import {
  recoverRendererContent,
  scheduleRendererContentCheck,
} from "./rendererRecovery";
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
  installRendererReloadGuard(window, { loadRenderer: vi.fn() });
  return { handlers, onceHandlers, reload, state, window };
}

const FAST_WAITS = { reloadLoadMs: 0, mountMs: 30, recreateDelayMs: 0 };

describe("recoverRendererContent", () => {
  it("does nothing when the content is already healthy", async () => {
    const harness = createWindowHarness({ probe: { rootChildren: 3, bootSplash: false }, crashed: false });
    const outcome = await recoverRendererContent({
      window: harness.window,
      waitWindows: FAST_WAITS,
    });
    expect(outcome).toBe("healthy");
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it("reloads once and recovers when the renderer was stuck on the boot splash", async () => {
    const harness = createWindowHarness({ probe: { rootChildren: 0, bootSplash: true }, crashed: false });
    const reload = harness.reload;
    const execute = (harness.window.webContents as unknown as { executeJavaScript: ReturnType<typeof vi.fn> }).executeJavaScript;
    execute.mockImplementation(() => {
      // After the reload is issued the document mounts normally.
      return Promise.resolve(reload.mock.calls.length > 0 ? { rootChildren: 2, bootSplash: false } : { rootChildren: 0, bootSplash: true });
    });

    const outcome = await recoverRendererContent({
      window: harness.window,
      waitWindows: FAST_WAITS,
    });
    expect(outcome).toBe("reloaded");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("recreates the window when the reload still leaves the content stuck", async () => {
    const harness = createWindowHarness({ probe: { rootChildren: 0, bootSplash: true }, crashed: false });
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
    const harness = createWindowHarness({ probe: { rootChildren: 0, bootSplash: true }, crashed: false });
    const outcome = await recoverRendererContent({
      window: harness.window,
      recreate: () => null,
      waitWindows: FAST_WAITS,
    });
    expect(outcome).toBe("unrecovered");
  });

  it("coalesces concurrent recoveries for the same window", async () => {
    const harness = createWindowHarness({ probe: { rootChildren: 0, bootSplash: true }, crashed: false });
    const recreate = vi.fn<() => BrowserWindow | null>(() => harness.window);
    const first = recoverRendererContent({ window: harness.window, recreate, waitWindows: FAST_WAITS });
    const second = recoverRendererContent({ window: harness.window, recreate, waitWindows: FAST_WAITS });
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    expect(firstOutcome).toBe("recreated");
    expect(secondOutcome).toBe("recreated");
    expect(recreate).toHaveBeenCalledOnce();
  });

  it("skips a new ladder while the previous one is still cooling down", async () => {
    const harness = createWindowHarness({ probe: { rootChildren: 3, bootSplash: false }, crashed: false });
    const first = await recoverRendererContent({ window: harness.window, waitWindows: FAST_WAITS });
    const second = await recoverRendererContent({ window: harness.window, waitWindows: FAST_WAITS });
    expect(first).toBe("healthy");
    expect(second).toBe("unrecovered");
  });
});

describe("scheduleRendererContentCheck", () => {
  it("runs the recovery ladder once when the check finds stuck content", async () => {
    const harness = createWindowHarness({ probe: { rootChildren: 0, bootSplash: true }, crashed: false });
    (harness.window as unknown as { isVisible: () => boolean }).isVisible = () => true;
    const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
    scheduleRendererContentCheck({ window: harness.window, delayMs: 10, recover });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recover).toHaveBeenCalledOnce();
  });

  it("does not act when the window is hidden (closed to tray)", async () => {
    const harness = createWindowHarness({ probe: { rootChildren: 0, bootSplash: true }, crashed: false });
    (harness.window as unknown as { isVisible: () => boolean }).isVisible = () => false;
    const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
    scheduleRendererContentCheck({ window: harness.window, delayMs: 10, recover });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recover).not.toHaveBeenCalled();
  });

  it("does not act when the content is healthy", async () => {
    const harness = createWindowHarness({ probe: { rootChildren: 3, bootSplash: false }, crashed: false });
    (harness.window as unknown as { isVisible: () => boolean }).isVisible = () => true;
    const recover = vi.fn<() => Promise<unknown>>().mockResolvedValue("reloaded");
    scheduleRendererContentCheck({ window: harness.window, delayMs: 10, recover });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recover).not.toHaveBeenCalled();
  });
});
