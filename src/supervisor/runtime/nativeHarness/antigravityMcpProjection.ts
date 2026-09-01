import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedMcpServer } from "@/shared/contracts";

const SESSION_HOME_PREFIX = "craftstation-agy-session-";
const SECRET_KEY_NAME = /token|cookie|secret|password|authorization|api[_-]?key|credential/iu;
const SECRET_ARGUMENT =
  /(?:bearer\s+|(?:api[_-]?key|token|secret|password|authorization|cookie)\s*[:=])/iu;

interface AntigravityMcpConfigEntry {
  disabled: false;
  command?: string;
  args?: string[];
  serverUrl?: string;
}

export interface AntigravityMcpProjection {
  readonly env: Record<string, string>;
  readonly homeDir: string;
  readonly configPath: string;
  dispose(): void;
}

function assertDiskSafeServer(server: ResolvedMcpServer): void {
  if (server.transport.type === "sse") {
    throw new Error(
      `Antigravity selected MCP server '${server.name}' uses unsupported SSE transport.`,
    );
  }
  if (server.transport.type === "http" && Object.keys(server.transport.headers).length > 0) {
    throw new Error(
      `Antigravity selected HTTP MCP server '${server.name}' contains headers that cannot be written to a session config safely.`,
    );
  }
  if (server.transport.type === "http") {
    const url = new URL(server.transport.url);
    if (
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((key) => SECRET_KEY_NAME.test(key))
    ) {
      throw new Error(
        `Antigravity selected HTTP MCP server '${server.name}' contains credential-like URL fields.`,
      );
    }
  }
  if (
    server.transport.type === "stdio" &&
    [server.transport.command, ...server.transport.args].some((value) =>
      SECRET_ARGUMENT.test(value),
    )
  ) {
    throw new Error(
      `Antigravity selected MCP server '${server.name}' contains a credential-like command argument.`,
    );
  }
}

function configEntry(server: ResolvedMcpServer): AntigravityMcpConfigEntry {
  assertDiskSafeServer(server);
  if (server.transport.type === "stdio") {
    return {
      disabled: false,
      command: server.transport.command,
      args: [...server.transport.args],
    };
  }
  return { disabled: false, serverUrl: server.transport.url };
}

function mergeServerEnvironment(target: Record<string, string>, server: ResolvedMcpServer): void {
  if (server.transport.type !== "stdio") return;
  for (const [key, value] of Object.entries(server.transport.env)) {
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
): AntigravityMcpProjection | undefined {
  if (servers.length === 0) return undefined;

  const processEnv: Record<string, string> = {};
  const mcpServers: Record<string, AntigravityMcpConfigEntry> = {};
  for (const server of servers) {
    if (mcpServers[server.name]) {
      throw new Error(`Duplicate Antigravity MCP server name '${server.name}'.`);
    }
    mcpServers[server.name] = configEntry(server);
    mergeServerEnvironment(processEnv, server);
  }

  const homeDir = mkdtempSync(join(tmpdir(), SESSION_HOME_PREFIX));
  const isolatedGeminiDir = join(homeDir, ".gemini");
  const isolatedNativeHome = join(isolatedGeminiDir, "antigravity-cli");
  const realNativeHome = join(homedir(), ".gemini", "antigravity-cli");
  const isolatedConversations = join(isolatedNativeHome, "conversations");
  const realConversations = join(realNativeHome, "conversations");
  const configDir = join(isolatedGeminiDir, "config");
  const configPath = join(configDir, "mcp_config.json");
  let linkedConversations = false;
  let disposed = false;

  try {
    mkdirSync(configDir, { recursive: true });
    mkdirSync(isolatedNativeHome, { recursive: true });
    if (existsSync(realConversations)) {
      symlinkSync(
        realConversations,
        isolatedConversations,
        process.platform === "win32" ? "junction" : "dir",
      );
      linkedConversations = true;
    }
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
      if (
        linkedConversations &&
        existsSync(isolatedConversations) &&
        lstatSync(isolatedConversations).isSymbolicLink()
      ) {
        unlinkSync(isolatedConversations);
      }
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}
