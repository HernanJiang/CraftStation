import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { nativeTheme } = vi.hoisted(() => ({
  nativeTheme: { themeSource: "system" as "system" | "light" | "dark" },
}));

vi.mock("electron", () => ({
  nativeTheme,
}));

const releaseMock = vi.hoisted(() => vi.fn(() => "10.0.22631"));

vi.mock("node:os", () => ({
  release: () => releaseMock(),
}));

import {
  installWindowsAcrylicHideShowGuard,
  opaqueWindowBackground,
  prepareWindowsWindowForHide,
  restoreWindowsWindowAfterShow,
  supportsNativeWindowMaterial,
} from "./windowMaterial";

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
}

function fakeWindow() {
  const window = {
    destroyed: false,
    isDestroyed: () => false,
    setBackgroundMaterial: vi.fn<(material: string) => void>(),
    setBackgroundColor: vi.fn<(color: string) => void>(),
    hide: vi.fn<() => void>(),
    on: vi.fn(),
    webContents: { invalidate: vi.fn<() => void>() },
  };
  window.on.mockImplementation(() => window);
  return window;
}

describe("Windows acrylic hide/show guard", () => {
  beforeEach(() => {
    nativeTheme.themeSource = "system";
    releaseMock.mockReturnValue("10.0.22631");
    setPlatform("win32");
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("treats Windows 11 22H2+ as acrylic-capable", () => {
    expect(supportsNativeWindowMaterial()).toBe(true);
    releaseMock.mockReturnValue("10.0.19045");
    expect(supportsNativeWindowMaterial()).toBe(false);
  });

  it("drops acrylic to an opaque fill before hide", () => {
    const window = fakeWindow();
    prepareWindowsWindowForHide(window, "dark");
    expect(window.setBackgroundMaterial).toHaveBeenCalledWith("none");
    expect(window.setBackgroundColor).toHaveBeenCalledWith(opaqueWindowBackground("dark"));
  });

  it("re-applies acrylic after show when glass is enabled", () => {
    const window = fakeWindow();
    restoreWindowsWindowAfterShow(window, { appearance: "dark", sidebarTranslucency: true });
    expect(window.setBackgroundMaterial.mock.calls).toEqual([["none"], ["acrylic"]]);
    expect(window.setBackgroundColor.mock.calls).toEqual([["#070709"], ["#00000000"]]);
    expect(nativeTheme.themeSource).toBe("dark");
    expect(window.webContents.invalidate).toHaveBeenCalled();
  });

  it("keeps an opaque fill after show when glass is off", () => {
    const window = fakeWindow();
    restoreWindowsWindowAfterShow(window, { appearance: "light", sidebarTranslucency: false });
    expect(window.setBackgroundMaterial).toHaveBeenCalledTimes(1);
    expect(window.setBackgroundMaterial).toHaveBeenCalledWith("none");
    expect(window.setBackgroundColor).toHaveBeenCalledWith(opaqueWindowBackground("light"));
  });

  it("wraps hide and restores acrylic on the following show", () => {
    const window = fakeWindow();
    const handlers: Record<string, () => void> = {};
    window.on.mockImplementation((event, handler) => {
      handlers[event] = handler;
      return window;
    });

    installWindowsAcrylicHideShowGuard(window, () => ({
      appearance: "dark",
      sidebarTranslucency: true,
    }));

    handlers.show?.();
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();

    window.hide();
    expect(window.setBackgroundMaterial).toHaveBeenCalledWith("none");
    expect(window.setBackgroundColor).toHaveBeenCalledWith("#070709");

    window.setBackgroundMaterial.mockClear();
    window.setBackgroundColor.mockClear();
    handlers.show?.();
    expect(window.setBackgroundMaterial.mock.calls).toEqual([["none"], ["acrylic"]]);
  });

  it("is a no-op on macOS", () => {
    setPlatform("darwin");
    const window = fakeWindow();
    prepareWindowsWindowForHide(window, "dark");
    restoreWindowsWindowAfterShow(window, { appearance: "dark", sidebarTranslucency: true });
    installWindowsAcrylicHideShowGuard(window, () => ({
      appearance: "dark",
      sidebarTranslucency: true,
    }));
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
    expect(window.on).not.toHaveBeenCalled();
  });
});
