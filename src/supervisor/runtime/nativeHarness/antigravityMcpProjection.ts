import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { hasCredentialLikeMcpLaunchFields, type ResolvedMcpServer } from "@/shared/contracts";

const SESSION_HOME_PREFIX = "craftstation-agy-session-";

interface AntigravityMcpConfigEntry {
  disabled: false;
  command?: string;
  args?: string[];
  serverUrl?: string;
  env?: Record<string, string>;
}

/**
 * CraftStation's own per-worker filter config. Unlike ordinary server env
 * (API keys and the like, which are genuinely shared session settings), this
 * value embeds the individual server's filter spec, so two proxied workers
 * ALWAYS carry different values. A single process environment cannot hold
 * both — it travels inline in each server's config entry (Antigravity honors
 * per-server `env` on stdio entries) and is excluded from the shared session
 * merge below.
 */
const FILTER_CONFIG_ENV = "CRAFTSTATION_MCP_FILTER_CONFIG";

export interface AntigravityMcpProjection {
  readonly env: Record<string, string>;
  readonly homeDir: string;
  readonly configPath: string;
  dispose(): void;
}

export interface AntigravityMcpProjectionOptions {
  /** Test seam; production defaults to the provider's real native home. */
  nativeHomeDir?: string;
  /** Test seam; production defaults to the OS temporary directory. */
  temporaryBaseDir?: string;
}

function diskUnsafeReason(server: ResolvedMcpServer): string | undefined {
  if (server.transport.type === "sse") return "unsupported SSE transport";
  if (server.transport.type === "http" && Object.keys(server.transport.headers).length > 0) {
    return "HTTP headers cannot be written to a session config safely";
  }
  if (hasCredentialLikeMcpLaunchFields(server)) {
    return server.transport.type === "stdio"
      ? "credential-like command arguments cannot be written safely"
      : "credential-like URL fields cannot be written safely";
  }
  return undefined;
}

function configEntry(server: ResolvedMcpServer): AntigravityMcpConfigEntry {
  if (server.transport.type === "stdio") {
    return {
      disabled: false,
      command: server.transport.command,
      args: [...server.transport.args],
      ...(server.transport.env[FILTER_CONFIG_ENV] !== undefined
        ? { env: { [FILTER_CONFIG_ENV]: server.transport.env[FILTER_CONFIG_ENV] } }
        : {}),
    };
  }
  return { disabled: false, serverUrl: server.transport.url };
}

function mergeServerEnvironment(target: Record<string, string>, server: ResolvedMcpServer): void {
  if (server.transport.type !== "stdio") return;
  for (const [key, value] of Object.entries(server.transport.env)) {
    // Per-worker filter configs ride inline in each server's own config
    // entry (see above) — merging them into the single shared session env
    // is what used to throw on every multi-server Antigravity launch.
    if (key === FILTER_CONFIG_ENV) continue;
    const existing = target[key];
    if (existing !== undefined && existing !== value) {
      throw new Error(
        `Antigravity selected MCP servers require conflicting values for environment variable '${key}'.`,
      );
    }
    target[key] = value;
  }
}

/**
 * Projects only the selected MCP servers into an isolated Antigravity home.
 *
 * The provider's native conversation store remains linked so official resume
 * identity keeps working, while the user-global MCP config is never edited.
 * MCP environment values stay in the child environment and are deliberately
 * omitted from the temporary JSON file.
 */
export function createAntigravityMcpProjection(
  servers: readonly ResolvedMcpServer[],
  options: AntigravityMcpProjectionOptions = {},
): AntigravityMcpProjection | undefined {
  if (servers.length === 0) return undefined;

  const processEnv: Record<string, string> = {};
  const mcpServers: Record<string, AntigravityMcpConfigEntry> = {};
  for (const server of servers) {
    const reason = diskUnsafeReason(server);
    if (reason) {
      // Name + reason only: never log URL, headers, env, args, or credentials.
      console.warn(`[antigravity] skipped MCP server '${server.name}': ${reason}.`);
      continue;
    }
    if (Object.hasOwn(mcpServers, server.name)) {
      throw new Error(`Duplicate Antigravity MCP server name '${server.name}'.`);
    }
    mcpServers[server.name] = configEntry(server);
    mergeServerEnvironment(processEnv, server);
  }
  if (Object.keys(mcpServers).length === 0) return undefined;

  const homeDir = mkdtempSync(join(options.temporaryBaseDir ?? tmpdir(), SESSION_HOME_PREFIX));
  const isolatedGeminiDir = join(homeDir, ".gemini");
  const isolatedNativeHome = join(isolatedGeminiDir, "antigravity-cli");
  const realNativeHome = options.nativeHomeDir ?? join(homedir(), ".gemini", "antigravity-cli");
  const isolatedConversations = join(isolatedNativeHome, "conversations");
  const realConversations = join(realNativeHome, "conversations");
  const configDir = join(isolatedGeminiDir, "config");
  const configPath = join(configDir, "mcp_config.json");
  let linkedConversations = false;
  let disposed = false;

  try {
    mkdirSync(configDir, { recursive: true });
    mkdirSync(isolatedNativeHome, { recursive: true });
    // Create the provider-owned persistent store before linking it. On a user's
    // first real conversation the directory does not exist yet; omitting this
    // step makes agy create it under the disposable HOME and resume breaks as
    // soon as the projection is disposed.
    mkdirSync(realConversations, { recursive: true });
    symlinkSync(
      realConversations,
      isolatedConversations,
      process.platform === "win32" ? "junction" : "dir",
    );
    linkedConversations = true;
    writeFileSync(configPath, `${JSON.stringify({ mcpServers }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    if (linkedConversations && existsSync(isolatedConversations)) unlinkSync(isolatedConversations);
    rmSync(homeDir, { recursive: true, force: true });
    throw error;
  }

  return {
    env: {
      ...processEnv,
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
    homeDir,
    configPath,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // The linked directory contains persistent provider data. Remove only the
      // link itself before recursively deleting the disposable projection home.
      if (linkedConversations && existsSync(isolatedConversations)) {
        unlinkSync(isolatedConversations);
      }
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}
