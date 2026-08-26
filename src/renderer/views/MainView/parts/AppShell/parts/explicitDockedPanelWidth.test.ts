import { describe, expect, it } from "vitest";
import {
  resolveExplicitDockedPanelWidth,
  shouldUseRightPanelOverlay,
} from "./explicitDockedPanelWidth";

describe("resolveExplicitDockedPanelWidth", () => {
  it("keeps a readable chat column when the saved tools width is too large", () => {
    expect(
      resolveExplicitDockedPanelWidth({
        requestedWidth: 640,
        shellWidth: 1_000,
        sidebarWidth: 210,
      }),
    ).toBe(470);
  });

  it("falls back to an even split in a very small window", () => {
    expect(
      resolveExplicitDockedPanelWidth({
        requestedWidth: 480,
        shellWidth: 700,
        sidebarWidth: 210,
      }),
    ).toBe(245);
  });

  it("preserves the requested width when the workspace is wide enough", () => {
    expect(
      resolveExplicitDockedPanelWidth({
        requestedWidth: 480,
        shellWidth: 1_600,
        sidebarWidth: 210,
      }),
    ).toBe(480);
  });
});

describe("shouldUseRightPanelOverlay", () => {
  const narrowPanel = {
    forceSidebarExpanded: false,
    wantsRightOverlay: true,
    wouldBeMainWidth: 240,
    contentMinWidth: 540,
  };

  it("keeps an explicitly controlled auxiliary panel docked", () => {
    expect(shouldUseRightPanelOverlay({ ...narrowPanel, hasExplicitOpenState: true })).toBe(false);
  });

  it("preserves the legacy narrow-window overlay path", () => {
    expect(shouldUseRightPanelOverlay({ ...narrowPanel, hasExplicitOpenState: false })).toBe(true);
  });
});
