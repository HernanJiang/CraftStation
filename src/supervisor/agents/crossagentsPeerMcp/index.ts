import type { ProjectLocation } from "@/shared/contracts";
import { encodeThreadQuery, type McpThreadIdentity } from "@/shared/browserMcpThread";
import type { WslHostAccessResolver } from "@/supervisor/wsl/hostAccess";

export type CrossagentsPeerMcpLocation =
  | ProjectLocation
  | { kind: "windows" }
  | { kind: "posix" }
  | { kind: "wsl"; distro: string };

export interface CrossagentsPeerMcpHttpConfig {
  url: string;
  token: string;
  headers: Record<string, string>;
  disabledTools?: string[];
}

/** Main-process ingress coordinates, injected into the supervisor environment. */
export const CROSSAGENTS_PEER_MCP_URL_ENV = "CRAFTSTATION_CROSSAGENTS_MCP_URL";
export const CROSSAGENTS_PEER_MCP_TOKEN_ENV = "CRAFTSTATION_CROSSAGENTS_MCP_TOKEN";

export function resolveCrossagentsPeerMcpHttpConfig(
  location: CrossagentsPeerMcpLocation,
  identity?: McpThreadIdentity,
): CrossagentsPeerMcpHttpConfig | null {
  const url = process.env[CROSSAGENTS_PEER_MCP_URL_ENV];
  const token = process.env[CROSSAGENTS_PEER_MCP_TOKEN_ENV];
  if (!url || !token || location.kind === "wsl") return null;
  return createConfig(encodeThreadQuery(`${url.replace(/\/$/u, "")}/mcp`, identity), token);
}

/**
 * WSL-aware variant mirroring the app-controls posture: NAT-mode distros get
 * the loopback host rewritten to the gateway IP; mirrored mode passes
 * through; without host access there is no unreachable URL handed out.
 */
export async function resolveCrossagentsPeerMcpHttpConfigForLaunch(
  location: CrossagentsPeerMcpLocation,
  hostAccess: WslHostAccessResolver | undefined,
  identity?: McpThreadIdentity,
): Promise<CrossagentsPeerMcpHttpConfig | undefined> {
  if (location.kind !== "wsl") {
    return resolveCrossagentsPeerMcpHttpConfig(location, identity) ?? undefined;
  }
  const url = process.env[CROSSAGENTS_PEER_MCP_URL_ENV];
  const token = process.env[CROSSAGENTS_PEER_MCP_TOKEN_ENV];
  if (!url || !token || !hostAccess) return undefined;
  const access = await hostAccess.resolveHostAccess(location.distro);
  if (!access) return undefined;
  const nativeUrl = encodeThreadQuery(`${url.replace(/\/$/u, "")}/mcp`, identity);
  if (access.kind === "loopback") return createConfig(nativeUrl, token);
  try {
    const parsed = new URL(nativeUrl);
    parsed.hostname = access.ip;
    return createConfig(parsed.toString(), token);
  } catch {
    return undefined;
  }
}

function createConfig(url: string, token: string): CrossagentsPeerMcpHttpConfig {
  return { url, token, headers: { Authorization: `Bearer ${token}` } };
}
