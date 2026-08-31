import type { CollectOptions, HostPort } from "../host";
import type { UsageSnapshot } from "../types";

export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible" as const;

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

/** Normalize a user-supplied OpenAI-compatible base URL without accepting credentials or queries. */
export function normalizeOpenAiCompatibleBaseUrl(value: string | undefined): string | undefined {
  const raw = clean(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) return undefined;
    if (url.username || url.password || url.search || url.hash) return undefined;
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}

export function openAiCompatibleModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/u, "")}/models`;
}

function failure(status: UsageSnapshot["status"], now: number, error?: string): UsageSnapshot {
  return {
    providerId: OPENAI_COMPATIBLE_PROVIDER_ID,
    status,
    plan: "OpenAI 兼容 API",
    windows: [],
    fetchedAt: now,
    ...(error ? { error } : {}),
  };
}

/**
 * A connection-only usage provider. The models probe verifies that a supplied
 * Base URL + API key is usable, while deliberately not inventing quota meters
 * when the third-party server does not publish them.
 */
export async function collectOpenAiCompatible(
  host: HostPort,
  _opts?: CollectOptions,
): Promise<UsageSnapshot> {
  const now = host.now();
  const [baseUrlRaw, apiKeyRaw] = await Promise.all([
    host.credentials.getSecret(OPENAI_COMPATIBLE_PROVIDER_ID, "baseUrl"),
    host.credentials.getSecret(OPENAI_COMPATIBLE_PROVIDER_ID, "apiKey"),
  ]);
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(baseUrlRaw);
  const apiKey = clean(apiKeyRaw);
  if (!baseUrl || !apiKey) return failure("auth-missing", now);

  let response;
  try {
    response = await host.http.request({
      method: "GET",
      url: openAiCompatibleModelsUrl(baseUrl),
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      timeoutMs: 12_000,
    });
  } catch {
    return failure("error", now, "OpenAI 兼容 API 连接失败。");
  }
  if (response.status === 401 || response.status === 403)
    return failure("auth-missing", now, "OpenAI 兼容 API Key 无效或无权限。");
  if (response.status === 429) return failure("rate-limited", now);
  if (response.status < 200 || response.status >= 300)
    return failure("error", now, `OpenAI 兼容 API 返回 HTTP ${response.status}。`);

  return {
    providerId: OPENAI_COMPATIBLE_PROVIDER_ID,
    status: "ok",
    plan: "OpenAI 兼容 API",
    authenticatedAs: baseUrl,
    windows: [],
    fetchedAt: now,
  };
}
