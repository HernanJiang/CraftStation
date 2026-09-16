import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveProxyConfig } from "@/supervisor/runtime/usageHttpClient";

/**
 * Devin CLI (chisel) uses a 10s Connect-RPC timeout for
 * `GetCliTeamSettings` during ACP `session/new`. On Windows its default
 * `proxy.mode=system` talks to WinHTTP, which is often *direct* even when
 * Clash/V2Ray has set WinINET + `HTTP_PROXY`. The refresh then fail-closes
 * the session with "Failed to load team settings".
 *
 * Pin the same HTTP proxy CraftStation already resolved for usage/Muse so
 * Devin's reqwest client uses an explicit tunnel instead of empty WinHTTP.
 */

const TEAM_SETTINGS_ERROR = /failed to (?:load|fetch) team settings|GetCliTeamSettings/i;

export function isDevinTeamSettingsTimeoutError(error: unknown): boolean {
  const text = errorText(error);
  return TEAM_SETTINGS_ERROR.test(text) && /timed?\s*out/i.test(text);
}

export function errorText(error: unknown): string {
  if (error instanceof Error) {
    const data =
      "data" in error && (error as { data?: unknown }).data !== undefined
        ? ` ${JSON.stringify((error as { data?: unknown }).data)}`
        : "";
    return `${error.message}${data}`;
  }
  return String(error);
}

export function defaultDevinUserConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  if (process.platform === "win32") {
    const appData = env.APPDATA?.trim();
    if (appData) return join(appData, "devin", "config.json");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "devin", "config.json");
  }
  return join(homedir(), ".config", "devin", "config.json");
}

export function devinProxySpawnEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> | undefined {
  const proxy = resolveProxyConfig(env, { allowSystemProxyFallback: true });
  const raw = proxy?.httpsProxy || proxy?.httpProxy;
  if (!raw) return undefined;
  // Devin's reqwest client rejects `socks5://` ("unsupported scheme socks5")
  // even though Clash mixed ports speak both HTTP CONNECT and SOCKS. Force HTTP.
  const url = httpProxyUrlForDevin(raw);
  const noProxy = proxy.noProxy?.trim() || "localhost,127.0.0.1,::1";
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    ALL_PROXY: url,
    all_proxy: url,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

/** Clash/V2Ray often export SOCKS; Devin CLI only tunnels HTTP CONNECT. */
export function httpProxyUrlForDevin(url: string): string {
  const trimmed = url.trim();
  const match = /^(socks5h?|socks4a?):\/\//i.exec(trimmed);
  if (!match) return trimmed;
  return `http://${trimmed.slice(match[0].length)}`;
}

export type EnsureDevinProxyResult = {
  applied: boolean;
  url?: string;
  reason: string;
};

let ensuredKey: string | undefined;

/** Test-only: forget the in-process "already wrote config" memo. */
export function resetDevinProxyConfigMemo(): void {
  ensuredKey = undefined;
}

/**
 * Upgrade Devin's user `proxy.mode` from the default `system` (WinHTTP /
 * PAC) to `manual` when CraftStation can see a working HTTP proxy.
 *
 * Leaves `off` and an existing `manual` URL alone — those are explicit
 * user/enterprise choices. `configPath` is for tests; production writes
 * `%APPDATA%\devin\config.json` (Windows) or the platform user config.
 */
export function ensureDevinUserProxyConfig(options?: {
  configPath?: string;
  env?: Record<string, string | undefined>;
}): EnsureDevinProxyResult {
  const env = options?.env ?? process.env;
  const spawnEnv = devinProxySpawnEnv(env);
  const url = spawnEnv?.HTTPS_PROXY || spawnEnv?.HTTP_PROXY;
  if (!url) return { applied: false, reason: "no-proxy" };

  const configPath = options?.configPath ?? defaultDevinUserConfigPath(env);
  const memoKey = `${configPath}|${url}`;
  if (!options?.configPath && ensuredKey === memoKey) {
    return { applied: false, url, reason: "already-applied" };
  }

  let parsed: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf8");
      const json = JSON.parse(stripJsonComments(raw)) as unknown;
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        return { applied: false, url, reason: "unreadable-config" };
      }
      parsed = json as Record<string, unknown>;
    } catch {
      return { applied: false, url, reason: "unreadable-config" };
    }
  }

  const existing = asProxyBlock(parsed.proxy);
  if (existing?.mode === "off") return { applied: false, url, reason: "user-disabled" };
  if (existing?.mode === "manual" && existing.url) {
    if (!options?.configPath) ensuredKey = memoKey;
    return { applied: false, url: existing.url, reason: "already-manual" };
  }

  const noProxy = spawnEnv?.NO_PROXY;
  parsed.proxy = {
    mode: "manual",
    url,
    ...(noProxy ? { no_proxy: noProxy } : {}),
  };

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  } catch {
    return { applied: false, url, reason: "write-failed" };
  }
  if (!options?.configPath) ensuredKey = memoKey;
  return { applied: true, url, reason: "wrote-manual" };
}

function asProxyBlock(value: unknown): { mode?: string; url?: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.mode === "string" ? { mode: record.mode } : {}),
    ...(typeof record.url === "string" && record.url.trim() ? { url: record.url.trim() } : {}),
  };
}

/** Devin config allows JS comments; drop them so JSON.parse can read it. */
function stripJsonComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
