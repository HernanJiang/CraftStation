import type { AccountQuotaWindow } from "@/shared/contracts";
import type { HttpClient, HttpRequest, HttpResponse, OAuthToken } from "@craftstation/agents-usage";

/**
 * Account-scoped Grok billing fallback. The official CLI remains the primary
 * source; this module is only used when its x.ai/billing RPC is unavailable.
 * It sends the access token read from that account's managed auth.json, never a
 * host cookie or the Codex Router pool.
 */

export const GROK_PROXY_CREDITS_ENDPOINT =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const GROK_PROXY_BILLING_ENDPOINT = "https://cli-chat-proxy.grok.com/v1/billing";
export const GROK_TOKEN_GRPC_ENDPOINT =
  "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
export const GROK_TOKEN_GRPC_EMPTY_FRAME = "AAAAAAA=";

export type GrokTokenQuotaErrorClass = "auth" | "http" | "network" | "timeout" | "invalid";

export type GrokTokenQuotaSuccess = {
  ok: true;
  source: "proxy" | "grpc-web";
  windows: AccountQuotaWindow[];
  fetchedAt: number;
};

export type GrokTokenQuotaFailure = {
  ok: false;
  errorClass: GrokTokenQuotaErrorClass;
  error: string;
};

export type GrokTokenQuotaResult = GrokTokenQuotaSuccess | GrokTokenQuotaFailure;

export interface GrokTokenQuotaOptions {
  http: HttpClient;
  token: OAuthToken;
  now: () => number;
  refreshToken?: (token: OAuthToken) => Promise<OAuthToken | undefined>;
  attempts?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function percent(value: unknown): number | undefined {
  const numeric = finiteNumber(value);
  if (numeric === undefined) return undefined;
  const result = numeric > 0 && numeric < 1 ? numeric * 100 : numeric;
  return result >= 0 && result <= 100 ? result : undefined;
}

function epochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function proxyWindow(body: unknown, _now: number): AccountQuotaWindow | undefined {
  if (!isRecord(body)) return undefined;
  const config = isRecord(body.config) ? body.config : body;
  const used = finiteNumber((isRecord(config.used) ? config.used.val : config.used) as unknown);
  const limit = finiteNumber(
    (isRecord(config.monthlyLimit) ? config.monthlyLimit.val : config.monthlyLimit) as unknown,
  );
  const usedPercent =
    percent(config.creditUsagePercent) ??
    (used !== undefined && limit !== undefined && limit > 0
      ? Math.min(100, Math.max(0, (used / limit) * 100))
      : undefined);
  if (usedPercent === undefined) return undefined;
  const currentPeriod = isRecord(config.currentPeriod) ? config.currentPeriod : undefined;
  const resetsAt = epochMs(
    currentPeriod?.end ?? config.billingPeriodEnd ?? config.resetAt ?? config.resetsAt,
  );
  const start = epochMs(currentPeriod?.start ?? config.billingPeriodStart);
  const days = start !== undefined && resetsAt !== undefined ? (resetsAt - start) / 864e5 : 0;
  const label = days > 0 && days <= 10 ? "Weekly credits" : "Monthly credits";
  return {
    id: days > 0 && days <= 10 ? "weekly" : "monthly",
    label,
    usedPercent,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

function parseJsonBody(response: HttpResponse): unknown | undefined {
  try {
    return JSON.parse(response.body);
  } catch {
    return undefined;
  }
}

function transientMessage(message: string): boolean {
  return /(?:eof|fetch failed|connect|reset|socket|timed?\s*out|timeout|ssl|tls)/iu.test(message);
}

function responseError(response: HttpResponse): GrokTokenQuotaFailure {
  if (response.status === 401 || response.status === 403) {
    return { ok: false, errorClass: "auth", error: `HTTP ${response.status}` };
  }
  return { ok: false, errorClass: "http", error: `HTTP ${response.status}` };
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function tokenHeaders(token: OAuthToken, contentType?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token.accessToken}`,
    "X-XAI-Token-Auth": "xai-grok-cli",
    Accept: contentType ? "*/*" : "application/json",
    ...(contentType
      ? {
          "Content-Type": contentType,
          Origin: "https://grok.com",
          Referer: "https://grok.com/?_s=usage",
          "x-grpc-web": "1",
          "x-user-agent": "connect-es/2.1.1",
        }
      : {}),
  };
}

async function requestWithRetry(
  http: HttpClient,
  request: HttpRequest,
  attempts: number,
): Promise<{ response?: HttpResponse; error?: GrokTokenQuotaResult }> {
  let lastError: GrokTokenQuotaResult = {
    ok: false,
    errorClass: "network",
    error: "network error",
  };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await http.request(request);
      if (response.status >= 200 && response.status < 300) return { response };
      const classified = responseError(response);
      if (classified.errorClass === "auth") return { error: classified };
      lastError = classified;
      if (attempt + 1 >= attempts || !isTransientStatus(response.status)) {
        return { error: classified };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = /(?:timed?\s*out|timeout)/iu.test(message) ? "timeout" : "network";
      lastError = { ok: false, errorClass, error: message.slice(0, 240) };
      if (!transientMessage(message) || attempt + 1 >= attempts) return { error: lastError };
    }
  }
  return { error: lastError };
}

function readVarint(bytes: Uint8Array, cursor: { index: number }): number | undefined {
  let value = 0;
  let shift = 0;
  while (cursor.index < bytes.length && shift <= 28) {
    const byte = bytes[cursor.index++]!;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7;
  }
  return undefined;
}

function scanBillingMessage(
  bytes: Uint8Array,
  depth = 0,
): {
  percentages: number[];
  timestamps: number[];
} {
  const percentages: number[] = [];
  const timestamps: number[] = [];
  if (depth > 4) return { percentages, timestamps };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cursor = { index: 0 };
  while (cursor.index < bytes.length) {
    const key = readVarint(bytes, cursor);
    if (key === undefined || key === 0) break;
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      const value = readVarint(bytes, cursor);
      if (value === undefined) break;
      if (value >= 1_700_000_000 && value <= 2_100_000_000) timestamps.push(value);
      continue;
    }
    if (wire === 1) {
      if (cursor.index + 8 > bytes.length) break;
      const value = view.getFloat64(cursor.index, true);
      if (field === 1 && value >= 0 && value <= 100) percentages.push(value);
      cursor.index += 8;
      continue;
    }
    if (wire === 2) {
      const length = readVarint(bytes, cursor);
      if (length === undefined || cursor.index + length > bytes.length) break;
      const start = cursor.index;
      const end = start + length;
      const nested = scanBillingMessage(bytes.subarray(start, end), depth + 1);
      percentages.push(...nested.percentages);
      timestamps.push(...nested.timestamps);
      cursor.index = end;
      continue;
    }
    if (wire === 5) {
      if (cursor.index + 4 > bytes.length) break;
      const value = view.getFloat32(cursor.index, true);
      if (field === 1 && value >= 0 && value <= 100) percentages.push(value);
      cursor.index += 4;
      continue;
    }
    break;
  }
  return { percentages, timestamps };
}

function decodeGrpcBody(response: HttpResponse): Uint8Array {
  const text = response.body.replace(/\s+/gu, "");
  if (/^[A-Za-z0-9+/=]+$/u.test(text) && text.length > 0) {
    const segments = text.match(/[A-Za-z0-9+/]+={0,2}/gu) ?? [];
    return Uint8Array.from(
      Buffer.concat(segments.map((segment) => Buffer.from(segment, "base64"))),
    );
  }
  return response.bodyBytes ?? Uint8Array.from(Buffer.from(response.body, "binary"));
}

type ParsedGrpcBilling =
  | { kind: "ok"; window: AccountQuotaWindow }
  | { kind: "auth" }
  | { kind: "invalid"; error: string };

function parseGrpcBilling(response: HttpResponse, now: number): ParsedGrpcBilling {
  const bytes = decodeGrpcBody(response);
  const cursor = { index: 0 };
  const dataFrames: Uint8Array[] = [];
  const trailerParts: string[] = [];
  while (cursor.index + 5 <= bytes.length) {
    const flags = bytes[cursor.index++]!;
    const length =
      (bytes[cursor.index++]! << 24) |
      (bytes[cursor.index++]! << 16) |
      (bytes[cursor.index++]! << 8) |
      bytes[cursor.index++]!;
    if (length < 0 || cursor.index + length > bytes.length) break;
    const payload = bytes.slice(cursor.index, cursor.index + length);
    cursor.index += length;
    if ((flags & 0x80) !== 0) trailerParts.push(Buffer.from(payload).toString("utf8"));
    else dataFrames.push(payload);
  }
  const statusLine = trailerParts
    .flatMap((part) => part.split(/\r?\n/u))
    .find((line) => line.toLowerCase().startsWith("grpc-status:"));
  if (statusLine) {
    const status = Number.parseInt(statusLine.slice(statusLine.indexOf(":") + 1).trim(), 10);
    if (status === 16) return { kind: "auth" };
    if (Number.isFinite(status) && status !== 0) {
      return { kind: "invalid", error: `grpc ${status}` };
    }
  }
  const scan = dataFrames.reduce(
    (all, frame) => {
      const next = scanBillingMessage(frame);
      all.percentages.push(...next.percentages);
      all.timestamps.push(...next.timestamps);
      return all;
    },
    { percentages: [] as number[], timestamps: [] as number[] },
  );
  const usedPercent = scan.percentages[0] ?? (scan.timestamps.length > 0 ? 0 : undefined);
  if (usedPercent === undefined)
    return { kind: "invalid", error: "gRPC response had no quota fields" };
  const future = scan.timestamps.filter((value) => value * 1000 > now);
  return {
    kind: "ok",
    window: {
      id: "monthly",
      label: "Credits",
      usedPercent,
      ...(future[0] !== undefined ? { resetsAt: future[0] * 1000 } : {}),
    },
  };
}

async function fetchProxy(
  options: GrokTokenQuotaOptions,
  token: OAuthToken,
  endpoint: string,
  attempts: number,
): Promise<GrokTokenQuotaResult> {
  const result = await requestWithRetry(
    options.http,
    { url: endpoint, headers: tokenHeaders(token) },
    attempts,
  );
  if (result.error) return result.error;
  const body = parseJsonBody(result.response!);
  const window = proxyWindow(body, options.now());
  if (!window) return { ok: false, errorClass: "invalid", error: "no credit fields in response" };
  return { ok: true, source: "proxy", windows: [window], fetchedAt: options.now() };
}

async function fetchGrpc(
  options: GrokTokenQuotaOptions,
  token: OAuthToken,
  attempts: number,
): Promise<GrokTokenQuotaResult> {
  const result = await requestWithRetry(
    options.http,
    {
      method: "POST",
      url: GROK_TOKEN_GRPC_ENDPOINT,
      headers: tokenHeaders(token, "application/grpc-web-text"),
      body: GROK_TOKEN_GRPC_EMPTY_FRAME,
    },
    attempts,
  );
  if (result.error) return result.error;
  const parsed = parseGrpcBilling(result.response!, options.now());
  if (parsed.kind === "auth")
    return { ok: false, errorClass: "auth", error: "gRPC unauthenticated" };
  if (parsed.kind === "invalid") {
    return { ok: false, errorClass: "invalid", error: parsed.error };
  }
  return {
    ok: true,
    source: "grpc-web",
    windows: [parsed.window],
    fetchedAt: options.now(),
  };
}

export async function collectManagedGrokTokenQuota(
  options: GrokTokenQuotaOptions,
): Promise<GrokTokenQuotaResult> {
  const attempts = Math.min(3, Math.max(1, options.attempts ?? 2));
  let token = options.token;
  let last: GrokTokenQuotaResult = {
    ok: false,
    errorClass: "invalid",
    error: "no billing response",
  };
  for (let tokenAttempt = 0; tokenAttempt < 2; tokenAttempt += 1) {
    last = await fetchProxy(options, token, GROK_PROXY_CREDITS_ENDPOINT, attempts);
    if (last.ok) return last;
    if (!last.ok && last.errorClass === "auth") {
      const refreshed = await options.refreshToken?.(token);
      if (refreshed?.accessToken && refreshed.accessToken !== token.accessToken) {
        token = refreshed;
        continue;
      }
    }
    const legacy = await fetchProxy(options, token, GROK_PROXY_BILLING_ENDPOINT, attempts);
    if (legacy.ok) return legacy;
    last = legacy;
    if (!legacy.ok && legacy.errorClass === "auth") {
      const refreshed = await options.refreshToken?.(token);
      if (refreshed?.accessToken && refreshed.accessToken !== token.accessToken) {
        token = refreshed;
        continue;
      }
    }
    break;
  }
  const grpc = await fetchGrpc(options, token, attempts);
  return grpc.ok
    ? grpc
    : !last.ok && last.errorClass === "auth" && grpc.errorClass === "invalid"
      ? last
      : grpc;
}
