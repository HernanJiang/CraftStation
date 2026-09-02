import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpServer, ProjectLocation, ResolvedMcpServer } from "@/shared/contracts";
import { resolveNodeForDistro } from "../wsl/runtime";
import { deployFilesToWslTempBase, resolveWslHelpersDir } from "../wsl/wslDeploy";

const CONFIG_ENV = "CRAFTSTATION_MCP_FILTER_CONFIG";

function filterConfig(server: McpServer): string {
  return Buffer.from(
    JSON.stringify({ server, disabledTools: server.disabledTools ?? [] }),
    "utf8",
  ).toString("base64url");
}

function hasHttpHeaders(server: Pick<McpServer, "transport">): boolean {
  return server.transport.type !== "stdio" && Object.keys(server.transport.headers).length > 0;
}

/**
 * Rewrite header-bearing HTTP MCP servers as stdio proxies so secret-free
 * runtimes (Antigravity) can receive App Controls without writing Bearer
 * tokens into mcp_config.json. The token stays in the child environment.
 */
export async function wrapHeaderBearingHttpMcpAsStdio(
  servers: readonly ResolvedMcpServer[],
  location: ProjectLocation,
): Promise<ResolvedMcpServer[]> {
  if (!servers.some(hasHttpHeaders)) return [...servers];
  try {
    return (await proxyMcpServersThroughStdio(servers as readonly McpServer[], location, (server) =>
      hasHttpHeaders(server),
    )) as ResolvedMcpServer[];
  } catch (error) {
    console.warn(
      "[supervisor] MCP stdio proxy unavailable; header-bearing HTTP servers stay filtered.",
      error instanceof Error ? error.message : error,
    );
    return [...servers];
  }
}

export async function prepareMcpToolFilters(
  servers: readonly McpServer[],
  location: ProjectLocation,
): Promise<McpServer[]> {
  if (!servers.some((server) => (server.disabledTools?.length ?? 0) > 0)) return [...servers];
  return proxyMcpServersThroughStdio(
    servers,
    location,
    (server) => (server.disabledTools?.length ?? 0) > 0,
  );
}

async function proxyMcpServersThroughStdio(
  servers: readonly McpServer[],
  location: ProjectLocation,
  shouldProxy: (server: McpServer) => boolean,
): Promise<McpServer[]> {
  const helpersDir = resolveWslHelpersDir();
  const workerSource = helpersDir ? join(helpersDir, "mcp-filter.mjs") : "";
  if (!workerSource || !existsSync(workerSource)) {
    throw new Error("CraftStation MCP tool filter is unavailable.");
  }

  let command = process.execPath;
  let workerPath = workerSource;
  const baseEnv = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
  if (location.kind === "wsl") {
    const node = await resolveNodeForDistro(location.distro);
    const deployed = deployFilesToWslTempBase(
      location.distro,
      `craftstation-mcp-filter-${process.pid}`,
      [{ src: workerSource, relDest: "mcp-filter/mcp-filter.mjs" }],
    );
    if (!deployed) throw new Error("CraftStation MCP tool filter could not be deployed to WSL.");
    command = node.nodePath;
    workerPath = `${deployed.linuxBaseDir}/mcp-filter/mcp-filter.mjs`;
  }

  return servers.map((server) => {
    if (!shouldProxy(server)) return server;
    return {
      ...server,
      transport: {
        type: "stdio",
        command,
        args: [workerPath],
        env: { ...baseEnv, [CONFIG_ENV]: filterConfig(server) },
        ...(location.kind === "wsl" ? { cwd: location.linuxPath } : { cwd: location.path }),
      },
    };
  });
}
