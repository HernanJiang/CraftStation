import type { ProjectLocation } from "@/shared/contracts";
import { encodeThreadQuery, type McpThreadIdentity } from "@/shared/browserMcpThread";
import type { WslHostAccessResolver } from "@/supervisor/wsl/hostAccess";

export type ScheduleMcpLocation =
  | ProjectLocation
  | { kind: "windows" }
  | { kind: "posix" }
  | { kind: "wsl"; distro: string };

export interface ScheduleMcpHttpConfig {
  url: string;
  token: string;
  headers: Record<string, string>;
}

export const SCHEDULE_MCP_URL_ENV = "CRAFTSTATION_SCHEDULE_MCP_URL";
export const SCHEDULE_MCP_TOKEN_ENV = "CRAFTSTATION_SCHEDULE_MCP_TOKEN";

export function resolveScheduleMcpHttpConfig(
  location: ScheduleMcpLocation,
  identity?: McpThreadIdentity,
): ScheduleMcpHttpConfig | null {
  const url = process.env[SCHEDULE_MCP_URL_ENV];
  const token = process.env[SCHEDULE_MCP_TOKEN_ENV];
  if (!url || !token || location.kind === "wsl") return null;
  return createConfig(encodeThreadQuery(`${url.replace(/\/$/u, "")}/mcp`, identity), token);
}

export async function resolveScheduleMcpHttpConfigForLaunch(
  location: ScheduleMcpLocation,
  hostAccess: WslHostAccessResolver | undefined,
  identity?: McpThreadIdentity,
): Promise<ScheduleMcpHttpConfig | undefined> {
  if (location.kind !== "wsl") {
    return resolveScheduleMcpHttpConfig(location, identity) ?? undefined;
  }
  const url = process.env[SCHEDULE_MCP_URL_ENV];
  const token = process.env[SCHEDULE_MCP_TOKEN_ENV];
  if (!url || !token || !hostAccess) return undefined;
  const access = await hostAccess.resolveHostAccess(location.distro);
  if (!access) return undefined;
  const nativeUrl = encodeThreadQuery(`${url.replace(/\/$/u, "")}/mcp`, identity);
  if (access.kind === "loopback") return createConfig(nativeUrl, token);
  const parsed = new URL(nativeUrl);
  parsed.hostname = access.ip;
  return createConfig(parsed.toString(), token);
}

function createConfig(url: string, token: string): ScheduleMcpHttpConfig {
  return { url, token, headers: { Authorization: `Bearer ${token}` } };
}
