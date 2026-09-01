import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCraftStationBaseDir, resolveCraftStationPaths } from "./craftstationPaths";

describe("craftstationPaths", () => {
  it("derives the default base dir under the user home", () => {
    expect(resolveCraftStationBaseDir("stable")).toBe(join(homedir(), ".craftstation"));
  });

  it("returns the nightly base dir when the channel is nightly", () => {
    expect(resolveCraftStationBaseDir("nightly")).toBe(join(homedir(), ".craftstation-nightly"));
  });

  it("derives all persisted paths from the provided base dir", () => {
    const baseDir = join("tmp", "craftstation");
    expect(resolveCraftStationPaths(baseDir)).toEqual({
      baseDir,
      dbPath: join(baseDir, "state.sqlite"),
      settingsPath: join(baseDir, "settings.json"),
      keybindingsPath: join(baseDir, "keybindings.json"),
      worktreesDir: join(baseDir, "worktrees"),
      attachmentsDir: join(baseDir, "attachments"),
      logsDir: join(baseDir, "logs"),
      terminalLogsDir: join(baseDir, "logs", "terminal"),
      cacheDir: join(baseDir, "cache"),
      statusCachePath: join(baseDir, "cache", "agent-status-cache.json"),
      agentPluginsDir: join(baseDir, "agent-plugins"),
      pluginsDir: join(baseDir, "plugins"),
      pluginDataDir: join(baseDir, "plugin-data"),
      acpIconsDir: join(baseDir, "cache", "acp-icons"),
    });
  });
});
