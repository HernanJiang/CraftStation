import { describe, expect, it } from "vitest";
import {
  pinnableSettingsNavigationItems,
  settingsNavigationItem,
  SETTINGS_NAVIGATION,
} from "./settingsNavigationRegistry";

describe("settings navigation registry", () => {
  it("exposes the sidebar pages as pinnable shortcuts", () => {
    const ids = pinnableSettingsNavigationItems().map((item) => item.id);
    for (const expected of [
      "mcpServers",
      "plugins",
      "skills",
      "usage",
      "appearance",
      "profile",
      "remoteAccess",
    ] as const) {
      expect(ids).toContain(expected);
    }
    // The dev tools page is never pinnable.
    expect(ids).not.toContain("dev");
  });

  it("gates remote-only visibility exactly like the sidebar", () => {
    const remote = pinnableSettingsNavigationItems({ remoteSession: true }).map((item) => item.id);
    expect(remote).not.toContain("mcpServers");
    expect(remote).not.toContain("remoteAccess");
    expect(remote).toContain("general");
  });

  it("resolves every pinnable id back to its registry entry", () => {
    for (const item of pinnableSettingsNavigationItems()) {
      expect(settingsNavigationItem(item.id)).toBe(item);
    }
  });

  it("keeps group order stable for sidebar and picker consumers", () => {
    expect(SETTINGS_NAVIGATION.map((group) => group.id)).toEqual([
      "personal",
      "workspace",
      "agents",
      "remote",
      "about",
    ]);
  });
});
