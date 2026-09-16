import { resolveProxyConfig } from "@/supervisor/runtime/usageHttpClient";

/**
 * The proxy env every agent CLI spawn should agree on.
 *
 * CLIs (Node/Go/Rust) only honor `HTTP_PROXY`-style env vars — none of them
 * read the Windows WinINET system proxy. CraftStation is frequently launched
 * from Explorer/the taskbar (no proxy env at all), so without this layer the
 * main agent and its subagent children disagree about the proxy: an adapter
 * that resolves it explicitly (Devin) tunnels while every other spawn —
 * including one-shot and structured subagent children — goes direct and dies
 * on proxy-only networks. Injecting the same resolved layer (env vars first,
 * WinINET registry fallback) into every spawn keeps main agent, subagents,
 * and one-shot children on one route.
 *
 * Callers must layer this UNDER their own env (`mergeSpawnEnv(agentProxySpawnEnv(), env)`):
 * an explicit caller-provided value stays authoritative.
 */
export function agentProxySpawnEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> | undefined {
  const proxy = resolveProxyConfig(env, { allowSystemProxyFallback: true });
  const raw = proxy?.httpsProxy || proxy?.httpProxy;
  if (!raw) return undefined;
  const url = normalizeHttpProxyUrl(raw);
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

/**
 * Clash/V2Ray often export SOCKS URLs; several CLIs (notably Devin's reqwest
 * client) only tunnel HTTP CONNECT even though their mixed ports speak both.
 * Rewrite a socks scheme to http — same host:port, CONNECT-capable.
 */
export function normalizeHttpProxyUrl(url: string): string {
  const trimmed = url.trim();
  const match = /^(socks5h?|socks4a?):\/\//i.exec(trimmed);
  if (!match) return trimmed;
  return `http://${trimmed.slice(match[0].length)}`;
}
