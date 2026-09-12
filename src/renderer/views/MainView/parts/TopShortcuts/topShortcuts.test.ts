import { describe, expect, it } from "vitest";
import { pinnableSettingsNavigationItems } from "@/renderer/views/SettingsOverlay/parts/settingsNavigationRegistry";
import { parseTopShortcutId, topShortcutIdForPin } from "./topShortcuts";

describe("top shortcut pin identities", () => {
  it("round-trips every pinnable registry page without touching the TopBar", () => {
    // A future registry item flows through this mapping with no TopBar change:
    // parse accepts exactly what the id builder emits, keyed by stable id.
    for (const item of pinnableSettingsNavigationItems()) {
      const id = topShortcutIdForPin({ kind: "settings", section: item.id });
      expect(id).toBe(`settings.${item.id}`);
      expect(parseTopShortcutId(id)).toEqual({ kind: "settings", section: item.id });
    }
  });

  it("parses the fixed special pins", () => {
    expect(parseTopShortcutId("crafting")).toEqual({ kind: "crafting" });
    expect(parseTopShortcutId("modelUsage")).toEqual({ kind: "modelUsage" });
    expect(parseTopShortcutId("settingsHome")).toEqual({ kind: "settingsHome" });
  });

  it("rejects unknown and non-pinnable ids", () => {
    expect(parseTopShortcutId("settings.dev")).toBeUndefined();
    expect(parseTopShortcutId("settings.noSuchPage")).toBeUndefined();
    expect(parseTopShortcutId("pullRequests")).toBeUndefined();
    expect(parseTopShortcutId("")).toBeUndefined();
  });
});
