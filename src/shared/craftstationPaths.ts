import { homedir } from "node:os";
import { join } from "node:path";
import {
  type CraftStationChannel,
  resolveCraftStationChannel,
  userDataDirNameFor,
} from "./channel";

export interface CraftStationPaths {
  baseDir: string;
  dbPath: string;
  settingsPath: string;
  keybindingsPath: string;
  worktreesDir: string;
  attachmentsDir: string;
  logsDir: string;
  terminalLogsDir: string;
  cacheDir: string;
  statusCachePath: string;
  agentPluginsDir: string;
  /**
   * Writable root for Agent Plugins packages the user installs. Each immediate
   * child directory containing a `plugin.json` is loaded as one package.
   *
   * @see https://agent-plugins.org/client-implementers/loading-and-discovery
   */
  pluginsDir: string;
  /** Parent of the per-plugin `PLUGIN_DATA` directories handed to MCP servers. */
  pluginDataDir: string;
  /**
   * Cache directory for ACP registry agent icons. Icons are downloaded once
   * at install/backfill time, served from disk via the `craftstation-local://`
   * protocol so the renderer paints them synchronously on app start instead
   * of fetching the CDN URL on every mount.
   */
  acpIconsDir: string;
}

export function resolveCraftStationBaseDir(
  channel: CraftStationChannel = resolveCraftStationChannel(),
  homeDir: string = homedir(),
): string {
  return join(homeDir, userDataDirNameFor(channel));
}

export function resolveCraftStationPaths(
  baseDir: string = resolveCraftStationBaseDir(),
): CraftStationPaths {
  const logsDir = join(baseDir, "logs");
  const cacheDir = join(baseDir, "cache");
  return {
    baseDir,
    dbPath: join(baseDir, "state.sqlite"),
    settingsPath: join(baseDir, "settings.json"),
    keybindingsPath: join(baseDir, "keybindings.json"),
    worktreesDir: join(baseDir, "worktrees"),
    attachmentsDir: join(baseDir, "attachments"),
    logsDir,
    terminalLogsDir: join(logsDir, "terminal"),
    cacheDir,
    statusCachePath: join(cacheDir, "agent-status-cache.json"),
    agentPluginsDir: join(baseDir, "agent-plugins"),
    pluginsDir: join(baseDir, "plugins"),
    pluginDataDir: join(baseDir, "plugin-data"),
    acpIconsDir: join(cacheDir, "acp-icons"),
  };
}
