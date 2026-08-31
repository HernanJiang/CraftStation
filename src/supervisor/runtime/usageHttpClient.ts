import type { HttpClient, HttpRequest, HttpResponse } from "@poracode/agents-usage";
import { EnvHttpProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

/**
 * Node implementation of the usage HostPort's HTTP client: fetch with an
 * abort-based timeout. Extracted to its own leaf module (no other local imports)
 * so both the usage host and the Claude OAuth refresh path can reuse it without
 * an import cycle.
 *
 * Proxy handling: Node's global fetch (undici) never applies HTTP(S)_PROXY on
 * its own, so provider endpoints that are only reachable through a local proxy
 * would otherwise hang until the timeout and surface as a misleading "network"
 * failure. When standard proxy env vars are configured we route through an
 * EnvHttpProxyAgent (NO_PROXY honored); without them we keep the exact previous
 * global-fetch behavior.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export type UsageHttpErrorKind = "timeout";

export class UsageHttpError extends Error {
  readonly kind: UsageHttpErrorKind;

  constructor(kind: UsageHttpErrorKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "UsageHttpError";
    this.kind = kind;
    Object.setPrototypeOf(this, UsageHttpError.prototype);
  }
}

export type ProxyEnvConfig = {
  httpProxy: string;
  httpsProxy: string;
  noProxy?: string;
};

type HeaderBag = {
  forEach(callback: (value: string, key: string) => void): void;
  getSetCookie(): string[];
};

function cleanProxyUrl(value: string | undefined): string {
  if (typeof value !== "string") return "";
  let raw = value.trim();
  if (!raw) return "";
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function envValue(
  env: Record<string, string | undefined>,
  lowercaseName: string,
  uppercaseName: string,
): string {
  // Lowercase wins over uppercase, matching curl/undici precedence.
  return cleanProxyUrl(env[lowercaseName]) || cleanProxyUrl(env[uppercaseName]);
}

/**
 * Resolve standard proxy env configuration. Returns undefined when no proxy is
 * configured at all, so callers can keep the zero-overhead global fetch path.
 */
export function resolveProxyConfig(
  env: Record<string, string | undefined>,
): ProxyEnvConfig | undefined {
  const allProxy = envValue(env, "all_proxy", "ALL_PROXY");
  const httpProxy = envValue(env, "http_proxy", "HTTP_PROXY") || allProxy;
  const httpsProxy = envValue(env, "https_proxy", "HTTPS_PROXY") || httpProxy;
  if (!httpProxy && !httpsProxy) return undefined;
  // An explicitly present (even empty) no_proxy must win over any ambient
  // process-level NO_PROXY the agent would otherwise fall back to.
  const hasNoProxy = "no_proxy" in env || "NO_PROXY" in env;
  const noProxy = envValue(env, "no_proxy", "NO_PROXY");
  return {
    httpProxy,
    httpsProxy,
    ...(hasNoProxy ? { noProxy } : {}),
  };
}

function headersToRecord(headers: HeaderBag): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

export function createNodeHttpClient(
  env: Record<string, string | undefined> = process.env,
): HttpClient {
  // One dispatcher per client; EnvHttpProxyAgent honors NO_PROXY per request.
  const proxyConfig = resolveProxyConfig(env);
  const dispatcher: Dispatcher | undefined = proxyConfig
    ? new EnvHttpProxyAgent(proxyConfig)
    : undefined;
  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      const controller = new AbortController();
      const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const body =
        req.bodyBytes !== undefined
          ? Buffer.from(req.bodyBytes)
          : req.body !== undefined
            ? req.body
            : undefined;
      try {
        const requestInit = {
          method: req.method ?? "GET",
          ...(req.headers ? { headers: req.headers } : {}),
          ...(body !== undefined ? { body } : {}),
          signal: controller.signal,
        };
        const res = dispatcher
          ? await undiciFetch(req.url, { ...requestInit, dispatcher })
          : await fetch(req.url, requestInit);
        const bodyBytes = new Uint8Array(await res.arrayBuffer());
        const responseBody = Buffer.from(bodyBytes).toString("utf8");
        // `headersToRecord` collapses repeated `set-cookie` into one comma-joined
        // value that cannot be split back apart (attributes contain commas), so
        // surface the raw lines separately for collectors that rotate a session
        // cookie. Same pitfall the relay host documents.
        const setCookies = res.headers.getSetCookie();
        return {
          status: res.status,
          headers: headersToRecord(res.headers),
          body: responseBody,
          bodyBytes,
          ...(setCookies.length > 0 ? { setCookies } : {}),
        };
      } catch (error) {
        if (timedOut) {
          throw new UsageHttpError(
            "timeout",
            `HTTP request timed out after ${timeoutMs}ms.`,
            error,
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
