import crypto from "node:crypto";
import type { CollectOptions, HostPort, HttpResponse } from "../host";
import { parseRetryAfter, toEpochMs } from "../formatters";
import type { UsageSnapshot, UsageWindow } from "../types";

export const VOLCENGINE_PROVIDER_ID = "volcengine" as const;
export const VOLCENGINE_CODING_PLAN_URL =
  "https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01";
export const VOLCENGINE_AGENT_PLAN_URL =
  "https://open.volcengineapi.com/?Action=GetAFPUsage&Version=2024-01-01";
export const VOLCENGINE_ARK_CHAT_COMPLETIONS_URL =
  "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions";
export const VOLCENGINE_ARK_MODELS_URL = "https://ark.cn-beijing.volces.com/api/v3/models";

/**
 * Ark API keys are validated through the same minimal chat-completion surface
 * used by Token Monitor.  `/models` is not a reliable capability probe for
 * every Ark account/model permission set: a key can be valid while model
 * catalog access is unavailable.  A 404/403 for one probe model therefore
 * causes the validator to try the next known model instead of declaring the
 * credential invalid.
 */
export const VOLCENGINE_ARK_PROBE_MODELS = [
  "doubao-seed-2.0-code",
  "doubao-1.5-pro-32k",
  "doubao-lite-32k",
] as const;

const DEFAULT_REGION = "cn-beijing";
const SERVICE = "ark";
const SIGNED_HEADERS = "content-type;host;x-content-sha256;x-date";
const CONTENT_TYPE = "application/json; charset=UTF-8";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function finite(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function percent(value: unknown): number | undefined {
  const parsed = finite(value);
  return parsed === undefined ? undefined : Math.max(0, Math.min(100, parsed));
}

function planLabel(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  return raw
    .replace(/^PLAN_TIER_/iu, "")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}

function resetAt(value: unknown): number | undefined {
  return toEpochMs(value as string | number | null | undefined);
}

function codingWindow(value: unknown): UsageWindow | undefined {
  const quota = object(value);
  const level = text(quota.Level ?? quota.level)?.toLowerCase();
  const usedPercent = percent(quota.Percent ?? quota.percent);
  if (!level || usedPercent === undefined) return undefined;
  const mapped = ["session", "5-hour", "five_hour", "5h"].includes(level)
    ? ({ id: "volcengine:coding:session-5h", label: "Coding Plan · Session (5h)" } as const)
    : ["daily", "day"].includes(level)
      ? ({ id: "volcengine:coding:daily", label: "Coding Plan · Daily" } as const)
      : ["weekly", "week"].includes(level)
        ? ({ id: "volcengine:coding:weekly", label: "Coding Plan · Weekly" } as const)
        : ["monthly", "month"].includes(level)
          ? ({ id: "volcengine:coding:monthly", label: "Coding Plan · Monthly" } as const)
          : undefined;
  if (!mapped) return undefined;
  const resetsAt = resetAt(quota.ResetTimestamp ?? quota.resetTimestamp ?? quota.reset_time);
  return { ...mapped, usedPercent, ...(resetsAt !== undefined ? { resetsAt } : {}) };
}

export function parseVolcengineCodingPlanUsage(payload: unknown, now: number): UsageSnapshot {
  const result = object(object(payload).Result ?? object(payload).result);
  const rawWindows = result.QuotaUsage ?? result.quotaUsage;
  const windows = (Array.isArray(rawWindows) ? rawWindows : [])
    .map(codingWindow)
    .filter((window): window is UsageWindow => window !== undefined);
  const plan = planLabel(
    result.PlanName ??
      result.planName ??
      result.PlanTier ??
      result.planTier ??
      result.ProductName ??
      result.productName,
  );
  if (windows.length === 0) {
    return {
      providerId: VOLCENGINE_PROVIDER_ID,
      status: "error",
      ...(plan ? { plan } : {}),
      windows: [],
      fetchedAt: now,
      error: "Coding Plan response has no recognized quota windows",
    };
  }
  return {
    providerId: VOLCENGINE_PROVIDER_ID,
    status: "ok",
    ...(plan ? { plan: `Coding Plan ${plan}` } : { plan: "Coding Plan" }),
    windows,
    fetchedAt: now,
  };
}

const AGENT_WINDOWS = [
  ["AFPFiveHour", "volcengine:agent:session-5h", "Agent Plan · Session (5h)"],
  ["AFPDaily", "volcengine:agent:daily", "Agent Plan · Daily"],
  ["AFPWeekly", "volcengine:agent:weekly", "Agent Plan · Weekly"],
  ["AFPMonthly", "volcengine:agent:monthly", "Agent Plan · Monthly"],
] as const;

export function parseVolcengineAgentPlanUsage(payload: unknown, now: number): UsageSnapshot {
  const result = object(object(payload).Result ?? object(payload).result);
  const windows: UsageWindow[] = [];
  for (const [field, id, label] of AGENT_WINDOWS) {
    const raw = object(result[field] ?? result[field.toLowerCase()]);
    const limit = finite(raw.Quota ?? raw.quota);
    if (limit === undefined || limit <= 0) continue;
    const used = Math.max(0, finite(raw.Used ?? raw.used) ?? 0);
    const resetsAt = resetAt(raw.ResetTime ?? raw.resetTime ?? raw.resetTimestamp);
    windows.push({
      id,
      label,
      usedPercent: Math.max(0, Math.min(100, (used / limit) * 100)),
      used,
      limit,
      unit: "requests",
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    });
  }
  const tier = planLabel(result.PlanType ?? result.planType ?? result.PlanName ?? result.planName);
  if (windows.length === 0) {
    return {
      providerId: VOLCENGINE_PROVIDER_ID,
      status: "unsupported",
      ...(tier ? { plan: `Agent Plan ${tier}` } : {}),
      windows: [],
      fetchedAt: now,
    };
  }
  return {
    providerId: VOLCENGINE_PROVIDER_ID,
    status: "ok",
    plan: tier ? `Agent Plan ${tier}` : "Agent Plan",
    windows,
    fetchedAt: now,
  };
}

function header(response: HttpResponse, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === target && value.trim()) return value.trim();
  }
  return undefined;
}

function relativeReset(value: string | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const absolute = toEpochMs(value);
  if (absolute !== undefined) return absolute;
  let seconds = 0;
  for (const match of value.toLowerCase().matchAll(/(\d+(?:\.\d+)?)([dhms])/gu)) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) continue;
    if (match[2] === "d") seconds += amount * 86_400;
    if (match[2] === "h") seconds += amount * 3_600;
    if (match[2] === "m") seconds += amount * 60;
    if (match[2] === "s") seconds += amount;
  }
  return seconds > 0 ? now + seconds * 1000 : undefined;
}

export function parseVolcengineArkRateLimit(response: HttpResponse, now: number): UsageSnapshot {
  const remaining = finite(header(response, "x-ratelimit-remaining-requests"));
  const limit = finite(header(response, "x-ratelimit-limit-requests"));
  if (remaining === undefined || limit === undefined || limit <= 0) {
    return {
      providerId: VOLCENGINE_PROVIDER_ID,
      status: "unsupported",
      plan: "Ark API",
      windows: [],
      fetchedAt: now,
      error: "Ark response did not include request quota headers",
    };
  }
  const safeRemaining = Math.max(0, remaining);
  const used = Math.max(0, limit - safeRemaining);
  const resetsAt = relativeReset(header(response, "x-ratelimit-reset-requests"), now);
  return {
    providerId: VOLCENGINE_PROVIDER_ID,
    status: safeRemaining === 0 && response.status === 429 ? "quota-hit" : "ok",
    plan: "Ark API",
    windows: [
      {
        id: "session-5h",
        label: "Ark API · Requests",
        usedPercent: Math.max(0, Math.min(100, (used / limit) * 100)),
        used,
        limit,
        unit: "requests",
        ...(resetsAt !== undefined ? { resetsAt } : {}),
      },
    ],
    fetchedAt: now,
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key: crypto.BinaryLike, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function encode(value: string, encodeSlash = true): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return encodeSlash ? encoded : encoded.replace(/%2F/gu, "/");
}

function utcParts(date: Date): { timestamp: string; dateStamp: string } {
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/gu, "");
  return { timestamp, dateStamp: timestamp.slice(0, 8) };
}

export function signVolcengineRequest(input: {
  url: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  date?: Date;
  method?: "GET" | "POST";
  body?: string;
}): { body: string; headers: Record<string, string>; signature: string } {
  const url = new URL(input.url);
  const body = input.body ?? "{}";
  const method = input.method ?? "POST";
  const region = input.region?.trim() || DEFAULT_REGION;
  const { timestamp, dateStamp } = utcParts(input.date ?? new Date());
  const payloadHash = sha256(body);
  const query = [...url.searchParams.entries()]
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const canonicalRequest = [
    method,
    encode(url.pathname || "/", false),
    query,
    `content-type:${CONTENT_TYPE}`,
    `host:${url.host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${timestamp}`,
    "",
    SIGNED_HEADERS,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/${SERVICE}/request`;
  const stringToSign = ["HMAC-SHA256", timestamp, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(Buffer.from(input.secretAccessKey, "utf8"), dateStamp), region), SERVICE),
    "request",
  );
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    body,
    signature,
    headers: {
      Accept: "application/json",
      "Content-Type": CONTENT_TYPE,
      "X-Date": timestamp,
      "X-Content-Sha256": payloadHash,
      Authorization:
        `HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
        `SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`,
    },
  };
}

function responseFailure(response: HttpResponse, now: number): UsageSnapshot | undefined {
  if (response.status === 401 || response.status === 403) {
    return {
      providerId: VOLCENGINE_PROVIDER_ID,
      status: "auth-missing",
      windows: [],
      fetchedAt: now,
      error: `Credentials rejected (${response.status})`,
    };
  }
  if (response.status === 429) {
    const rateLimitedUntil = parseRetryAfter(header(response, "retry-after"), now);
    return {
      providerId: VOLCENGINE_PROVIDER_ID,
      status: "rate-limited",
      windows: [],
      fetchedAt: now,
      ...(rateLimitedUntil !== undefined ? { rateLimitedUntil } : {}),
    };
  }
  if (response.status < 200 || response.status >= 300) {
    return {
      providerId: VOLCENGINE_PROVIDER_ID,
      status: "error",
      windows: [],
      fetchedAt: now,
      error: `Provider unavailable (HTTP ${response.status})`,
    };
  }
  return undefined;
}

async function signedPlan(
  host: HostPort,
  url: string,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): Promise<HttpResponse> {
  const signed = signVolcengineRequest({
    url,
    accessKeyId,
    secretAccessKey,
    region,
    date: new Date(host.now()),
  });
  return host.http.request({
    method: "POST",
    url,
    headers: signed.headers,
    body: signed.body,
    timeoutMs: 12_000,
  });
}

type VolcengineCredentialProbe = {
  ok: boolean;
  code: "accepted" | "rejected" | "unavailable";
  model?: string;
};

async function validateArkApiKey(host: HostPort, apiKey: string): Promise<VolcengineCredentialProbe> {
  let sawModelUnavailable = false;
  for (const model of VOLCENGINE_ARK_PROBE_MODELS) {
    const response = await host.http.request({
      method: "POST",
      url: VOLCENGINE_ARK_CHAT_COMPLETIONS_URL,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      timeoutMs: 12_000,
    });
    if (response.status === 401) return { ok: false, code: "rejected" };
    if (response.status === 429 || (response.status >= 200 && response.status < 300)) {
      // Remember which probe model the key can actually run — the caller
      // uses it as the auto-provisioned channel's first verified model.
      return { ok: true, code: "accepted", model };
    }
    if (response.status === 403 || response.status === 404) {
      sawModelUnavailable = true;
      continue;
    }
    return { ok: false, code: "unavailable" };
  }
  return { ok: false, code: sawModelUnavailable ? "unavailable" : "rejected" };
}

async function validateVolcenginePlanKeys(
  host: HostPort,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): Promise<VolcengineCredentialProbe> {
  const responses = await Promise.all([
    signedPlan(host, VOLCENGINE_CODING_PLAN_URL, accessKeyId, secretAccessKey, region),
    signedPlan(host, VOLCENGINE_AGENT_PLAN_URL, accessKeyId, secretAccessKey, region),
  ]);
  if (responses.some((response) => response.status === 401 || response.status === 403)) {
    return { ok: false, code: "rejected" };
  }
  if (
    responses.some(
      (response) => response.status === 429 || (response.status >= 200 && response.status < 300),
    )
  ) {
    return { ok: true, code: "accepted" };
  }
  return { ok: false, code: "unavailable" };
}

/**
 * Validate credentials without writing them. The two Volcengine surfaces are
 * complementary and may be supplied together:
 * - Ark API key proves inference (auto-provisioned model channel)
 * - AK/SK proves Coding Plan / Agent Plan quota
 * A 429 still proves the credential was accepted; 401/403 is rejection.
 */
export async function validateVolcengineCredentials(
  host: HostPort,
  input: {
    apiKey?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    region?: string;
  },
): Promise<VolcengineCredentialProbe> {
  const apiKey = input.apiKey?.trim();
  const accessKeyId = input.accessKeyId?.trim();
  const secretAccessKey = input.secretAccessKey?.trim();
  const region = input.region?.trim() || DEFAULT_REGION;
  try {
    if (apiKey && accessKeyId && secretAccessKey) {
      const [keyResult, planResult] = await Promise.all([
        validateArkApiKey(host, apiKey),
        validateVolcenginePlanKeys(host, accessKeyId, secretAccessKey, region),
      ]);
      if (!keyResult.ok) return keyResult;
      if (!planResult.ok) return planResult;
      return keyResult;
    }
    if (apiKey) return validateArkApiKey(host, apiKey);
    if (accessKeyId && secretAccessKey) {
      return validateVolcenginePlanKeys(host, accessKeyId, secretAccessKey, region);
    }
    return { ok: false, code: "rejected" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

function parseJson(response: HttpResponse): unknown {
  try {
    return JSON.parse(response.body);
  } catch {
    return {};
  }
}

export async function collectVolcengine(
  host: HostPort,
  _opts?: CollectOptions,
): Promise<UsageSnapshot> {
  const now = host.now();
  const [apiKeyRaw, accessKeyIdRaw, secretAccessKeyRaw, regionRaw] = await Promise.all([
    host.credentials.getSecret(VOLCENGINE_PROVIDER_ID, "apiKey"),
    host.credentials.getSecret(VOLCENGINE_PROVIDER_ID, "accessKeyId"),
    host.credentials.getSecret(VOLCENGINE_PROVIDER_ID, "secretAccessKey"),
    host.credentials.getSecret(VOLCENGINE_PROVIDER_ID, "region"),
  ]);
  const apiKey = apiKeyRaw?.trim();
  const accessKeyId = accessKeyIdRaw?.trim();
  const secretAccessKey = secretAccessKeyRaw?.trim();
  const region = regionRaw?.trim() || DEFAULT_REGION;

  if (accessKeyId && secretAccessKey) {
    const [coding, agent] = await Promise.all([
      signedPlan(host, VOLCENGINE_CODING_PLAN_URL, accessKeyId, secretAccessKey, region),
      signedPlan(host, VOLCENGINE_AGENT_PLAN_URL, accessKeyId, secretAccessKey, region),
    ]);
    const codingFailure = responseFailure(coding, now);
    const agentFailure = responseFailure(agent, now);
    const codingSnapshot = codingFailure ?? parseVolcengineCodingPlanUsage(parseJson(coding), now);
    const agentSnapshot = agentFailure ?? parseVolcengineAgentPlanUsage(parseJson(agent), now);
    const good = [agentSnapshot, codingSnapshot].filter((snapshot) => snapshot.status === "ok");
    if (good.length > 0) {
      const windows = new Map<string, UsageWindow>();
      for (const snapshot of good) {
        for (const window of snapshot.windows) {
          windows.set(window.id, window);
        }
      }
      return {
        providerId: VOLCENGINE_PROVIDER_ID,
        status: "ok",
        plan: good
          .map((snapshot) => snapshot.plan)
          .filter(Boolean)
          .join(" + "),
        windows: [...windows.values()],
        fetchedAt: now,
      };
    }
    if (apiKey) {
      // Continue to the documented Ark API-key surface when the private Plan
      // OpenAPI is unavailable for this account.
    } else {
      return codingSnapshot.status !== "unsupported" ? codingSnapshot : agentSnapshot;
    }
  }

  if (!apiKey) {
    return {
      providerId: VOLCENGINE_PROVIDER_ID,
      status: "auth-missing",
      windows: [],
      fetchedAt: now,
    };
  }
  const response = await host.http.request({
    method: "POST",
    url: VOLCENGINE_ARK_CHAT_COMPLETIONS_URL,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "doubao-seed-2.0-code",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
    timeoutMs: 12_000,
  });
  const failure = responseFailure(response, now);
  if (failure && response.status !== 429) return failure;
  const parsed = parseVolcengineArkRateLimit(response, now);
  return response.status === 429 && parsed.windows.length === 0 ? (failure ?? parsed) : parsed;
}
