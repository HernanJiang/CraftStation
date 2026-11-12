import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const window = {
    webContents: {
      session: {},
      setUserAgent: vi.fn<(value: string) => void>(),
      setWindowOpenHandler: vi.fn<(handler: (...args: unknown[]) => unknown) => void>(),
      on: vi.fn<(...args: unknown[]) => void>(),
    },
    setVisibleOnAllWorkspaces: vi.fn<(visible: boolean, options: unknown) => void>(),
    once: vi.fn<(...args: unknown[]) => void>(),
    on: vi.fn<(...args: unknown[]) => void>(),
    loadURL: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
    loadFile: vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined),
    isDestroyed: vi.fn<() => boolean>().mockReturnValue(false),
    getBounds: vi
      .fn<() => { x: number; y: number; width: number; height: number }>()
      .mockReturnValue({ x: 120, y: 80, width: 560, height: 470 }),
    setBounds: vi.fn<(bounds: unknown, animate: boolean) => void>(),
    setMinimumSize: vi.fn<(width: number, height: number) => void>(),
    isMinimized: vi.fn<() => boolean>().mockReturnValue(false),
    isVisible: vi.fn<() => boolean>().mockReturnValue(false),
    show: vi.fn<() => void>(),
    focus: vi.fn<() => void>(),
  };
  return {
    BrowserWindow: vi.fn<(options: unknown) => typeof window>(function BrowserWindowMock(
      _options: unknown,
    ) {
      return window;
    }),
    screen: {
      getCursorScreenPoint: vi.fn<() => { x: number; y: number }>(() => ({ x: 100, y: 100 })),
      getDisplayNearestPoint: vi.fn<
        () => { workArea: { x: number; y: number; width: number; height: number } }
      >(() => ({ workArea: { x: 0, y: 0, width: 3440, height: 1400 } })),
      getAllDisplays: vi.fn<
        () => Array<{ workArea: { x: number; y: number; width: number; height: number } }>
      >(() => [{ workArea: { x: 0, y: 0, width: 3440, height: 1400 } }]),
    },
    window,
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  screen: electronMock.screen,
}));
vi.mock("../browser/permissions", () => ({
  installSessionPermissions: vi.fn<(session: unknown) => void>(),
}));

import {
  createQuickComposerWindow,
  isQuickComposerBoundsVisible,
  resolveQuickComposerBounds,
  showQuickComposerWindow,
} from "./createQuickComposerWindow";

describe("quick composer window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMock.window.getBounds.mockReturnValue({ x: 120, y: 80, width: 560, height: 470 });
    electronMock.window.isDestroyed.mockReturnValue(false);
    electronMock.window.isVisible.mockReturnValue(false);
  });

  it("places the composer bottom-center with room above for its menus", () => {
    expect(resolveQuickComposerBounds({ x: 0, y: 0, width: 3440, height: 1400 })).toEqual({
      x: 1440,
      y: 678,
      width: 560,
      height: 470,
    });
  });

  it.each([
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: 0, y: 0, width: 640, height: 480 },
    { x: -800, y: 40, width: 800, height: 560 },
  ])("keeps temporary chat compact and entirely inside $width × $height", (workArea) => {
    const bounds = resolveQuickComposerBounds(workArea, "temporaryChat");
    expect(bounds.width).toBeLessThanOrEqual(520);
    expect(bounds.height).toBeLessThanOrEqual(560);
    expect(bounds.width).toBeLessThanOrEqual(workArea.width * 0.8);
    expect(bounds.height).toBeLessThanOrEqual(workArea.height * 0.8);
    expect(bounds.x).toBeGreaterThan(workArea.x);
    expect(bounds.y).toBeGreaterThan(workArea.y);
    expect(bounds.x + bounds.width).toBeLessThan(workArea.x + workArea.width);
    expect(bounds.y + bounds.height).toBeLessThan(workArea.y + workArea.height);
  });

  it("shrinks a temporary chat that no longer fits after switching screens", () => {
    electronMock.screen.getAllDisplays.mockReturnValueOnce([
      { workArea: { x: 0, y: 0, width: 640, height: 480 } },
    ]);
    electronMock.screen.getDisplayNearestPoint.mockReturnValueOnce({
      workArea: { x: 0, y: 0, width: 640, height: 480 },
    });
    electronMock.window.getBounds.mockReturnValue({ x: 20, y: 20, width: 560, height: 640 });

    showQuickComposerWindow(electronMock.window as never, "temporaryChat");

    expect(electronMock.window.setBounds).toHaveBeenCalledWith(
      { x: 64, y: 48, width: 512, height: 384 },
      false,
    );
    expect(electronMock.window.setMinimumSize).toHaveBeenCalledWith(400, 360);
  });

  it("allows temporary chat to shrink below its usual minimum on a short display", () => {
    const workArea = { x: 0, y: 0, width: 640, height: 400 };
    electronMock.screen.getAllDisplays.mockReturnValueOnce([{ workArea }]);
    electronMock.screen.getDisplayNearestPoint.mockReturnValueOnce({ workArea });
    electronMock.window.getBounds.mockReturnValue({ x: 20, y: 20, width: 560, height: 640 });

    showQuickComposerWindow(electronMock.window as never, "temporaryChat");

    expect(electronMock.window.setMinimumSize).toHaveBeenCalledWith(400, 320);
    expect(electronMock.window.setBounds).toHaveBeenCalledWith(
      { x: 64, y: 40, width: 512, height: 320 },
      false,
    );
  });

  it("keeps a user-dragged position and only recenters an offscreen window", () => {
    showQuickComposerWindow(electronMock.window as never);
    expect(electronMock.window.setBounds).not.toHaveBeenCalled();

    electronMock.window.getBounds.mockReturnValue({ x: 5000, y: 5000, width: 560, height: 470 });
    showQuickComposerWindow(electronMock.window as never);
    expect(electronMock.window.setBounds).toHaveBeenCalledWith(
      resolveQuickComposerBounds({ x: 0, y: 0, width: 3440, height: 1400 }),
      false,
    );
  });

  it("requires at least a 50px visible grip on one display", () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    expect(
      isQuickComposerBoundsVisible({ x: 1870, y: 900, width: 520, height: 430 }, displays),
    ).toBe(true);
    expect(
      isQuickComposerBoundsVisible({ x: 1871, y: 900, width: 520, height: 430 }, displays),
    ).toBe(false);
  });

  it("creates a frameless transparent window that remains natively draggable", () => {
    createQuickComposerWindow({
      title: "CraftStation",
      isDev: false,
      channel: "stable",
      preloadPath: "preload.cjs",
      rendererHtmlPath: "index.html",
      appVersion: "1.0.0",
      posthogEnableDev: false,
      posthogEnabled: false,
      posthogHost: "",
      posthogKey: "",
      sentryEnabled: false,
      browserUserAgent: "CraftStation",
      onClosed: vi.fn<() => void>(),
    });

    expect(electronMock.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        frame: false,
        transparent: true,
        movable: true,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
      }),
    );
    expect(electronMock.window.once).toHaveBeenCalledWith("ready-to-show", expect.any(Function));
  });

  it("stays hidden when asked to prepare before the user opens it", () => {
    createQuickComposerWindow({
      title: "CraftStation",
      isDev: false,
      channel: "stable",
      preloadPath: "preload.cjs",
      rendererHtmlPath: "index.html",
      appVersion: "1.0.0",
      posthogEnableDev: false,
      posthogEnabled: false,
      posthogHost: "",
      posthogKey: "",
      sentryEnabled: false,
      browserUserAgent: "CraftStation",
      initiallyHidden: true,
      onClosed: vi.fn<() => void>(),
    });

    expect(electronMock.window.once).not.toHaveBeenCalledWith(
      "ready-to-show",
      expect.any(Function),
    );
    expect(electronMock.window.show).not.toHaveBeenCalled();
  });
});
