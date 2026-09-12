import { beforeEach, describe, expect, it, vi } from "vitest";
import { sidebarGlassTintDefault, sidebarGlassTintExpr } from "./sidebarGlass";

const isMac = vi.hoisted(() => vi.fn<() => boolean>(() => false));

vi.mock("@/renderer/bridge", () => ({
  isMac,
  isWindows: () => !isMac(),
}));

describe("sidebarGlassTintDefault", () => {
  beforeEach(() => {
    isMac.mockReturnValue(false);
  });

  it("uses a denser Windows light frosting so the sidebar stays light over a dark desktop", () => {
    expect(sidebarGlassTintDefault("light")).toBe(88);
    expect(sidebarGlassTintDefault("dark")).toBe(72);
  });

  it("keeps the softer macOS vibrancy defaults", () => {
    isMac.mockReturnValue(true);
    expect(sidebarGlassTintDefault("light")).toBe(35);
    expect(sidebarGlassTintDefault("dark")).toBe(65);
  });
});

describe("sidebarGlassTintExpr", () => {
  it("tints the sidebar background, not the content pane", () => {
    expect(sidebarGlassTintExpr(88)).toBe(
      "color-mix(in oklab, var(--sidebar-background) 88%, transparent)",
    );
  });
});
