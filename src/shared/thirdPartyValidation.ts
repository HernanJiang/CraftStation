/**
 * Third-party OpenAI-compatible API validation.
 *
 * Invariant: a Base URL + Key + Model + Protocol quadruple must prove itself
 * with one minimal REAL inference request before the model may enter the
 * Available/Selected catalog. `GET /models` is only a connectivity/auth hint —
 * "model listed" never implies "model can answer through this protocol".
 *
 * Probe order (system default): Responses wins.
 *   1. POST /v1/responses  (minimal, no tools, fixed "Reply with OK." prompt)
 *   2. only when Responses is clearly unsupported → POST /v1/chat/completions
 *
 * Never fallback on: 401/403 (credential), DNS/TLS (connectivity), 429/5xx or
 * timeout (temporary). Those surface directly instead of masquerading as
 * "protocol unsupported". Secrets never enter logs.
 */

export type ThirdPartyProtocol = "responses" | "chat_completions";

export type ThirdPartyValidationErrorCode =
  | "invalid_base_url"
  | "network_error"
  | "tls_error"
  | "unauthorized"
  | "forbidden"
  | "model_not_found"
  | "responses_unsupported"
  | "chat_completions_unsupported"
  | "rate_limited"
  | "server_error"
  | "invalid_response"
  | "timeout";

export interface ThirdPartyValidationFailure {
  ok: false;
  code: ThirdPartyValidationErrorCode;
  /** User-facing message (no secrets). */
  message: string;
  /** Technical detail for logs (must never contain the API key). */
  detail?: string | undefined;
  /** When true the user may retry; the provider must NOT be added yet. */
  retryable: boolean;
}

export interface ThirdPartyValidationSuccess {
  ok: true;
  validatedProtocol: ThirdPartyProtocol;
  /** Normalized API root (no trailing /v1) used for the probe. */
  normalizedApiRoot: string;
  validatedAt: number;
  /** Whether GET /v1/models listed the model (hint only). */
  modelListedHint: boolean;
}

export type ThirdPartyValidationResult =
  | ThirdPartyValidationSuccess
  | ThirdPartyValidationFailure;

export const THIRD_PARTY_VALIDATION_PROMPT = "Reply with OK.";
export const THIRD_PARTY_PROBE_MAX_TOKENS = 8;

/**
 * Inference-probe budget. Third-party relays routinely take 6–20s+ for one
 * minimal inference (cold model load, queueing) and may answer rejections
 * (e.g. 429) after 30s+ — a short budget turns healthy relays into false
 * "验证超时". Measured 2026-09-07 against a live relay: GET /v1/models 2.2s,
 * POST /v1/responses 200 in 6.3s/7.0s/18.8s, 429 in 32s.
 * The /models hint below keeps its own 12s cap.
 */
export const THIRD_PARTY_PROBE_TIMEOUT_MS = 120_000;

/** Normalize user input to an API root without a trailing `/v1` (avoids `/v1/v1/...`). */
export function normalizeApiRoot(input: string | undefined | null): string | undefined {
  const raw = (input ?? "").trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  let path = url.pathname.replace(/\/+$/u, "");
  // Strip ONE trailing /v1 (case-insensitive) so both
  // `https://host` and `https://host/v1` converge to `https://host`.
  path = path.replace(/\/v1$/i, "");
  url.pathname = path === "" ? "/" : path;
  return url.toString().replace(/\/$/u, "");
}

/**
 * API base for probes and stored account configs. Bare roots get the OpenAI
 * `/v1` convention appended; roots that already carry an explicit version
 * segment (e.g. Volcengine Ark's `/api/v3` or `/api/coding/v3`) are already
 * complete base URLs and stay as-is.
 */
export function openAiCompatibleApiBase(normalizedApiRoot: string): string {
  const root = normalizedApiRoot.replace(/\/$/u, "");
  let path = "";
  try {
    path = new URL(root).pathname;
  } catch {
    path = "";
  }
  return /\/v\d+$/i.test(path) ? root : `${root}/v1`;
}

export function buildProbeUrls(normalizedApiRoot: string): {
  models: string;
  responses: string;
  chatCompletions: string;
} {
  const base = openAiCompatibleApiBase(normalizedApiRoot);
  return {
    models: `${base}/models`,
    responses: `${base}/responses`,
    chatCompletions: `${base}/chat/completions`,
  };
}

const UNSUPPORTED_HINTS = [
  "unknown endpoint",
  "not found",
  "no such endpoint",
  "unsupported",
  "unknown api",
  "invalid url",
  "unrecognized",
  "method not allowed",
];

function bodyIndicatesUnsupported(bodyText: string): boolean {
  const lowered = bodyText.toLowerCase();
  return UNSUPPORTED_HINTS.some((hint) => lowered.includes(hint));
}

function bodyIndicatesModelMissing(bodyText: string, model: string): boolean {
  const lowered = bodyText.toLowerCase();
  if (!lowered.includes("model")) return false;
  if (model && !lowered.includes(model.toLowerCase())) {
    // Generic model error without naming ours — still treat 404 as missing.
    return true;
  }
  return (
    lowered.includes("not found") ||
    lowered.includes("does not exist") ||
    lowered.includes("unknown model") ||
    lowered.includes("invalid model")
  );
}

export interface ProbeFetchResponse {
  status: number;
  bodyText: string;
}

export type ProbeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | undefined },
  timeoutMs: number,
) => Promise<ProbeFetchResponse>;

function failure(
  code: ThirdPartyValidationErrorCode,
  message: string,
  retryable: boolean,
  detail?: string | undefined,
): ThirdPartyValidationFailure {
  return { ok: false, code, message, retryable, ...(detail ? { detail } : {}) };
}

function classifyTransportError(error: unknown): ThirdPartyValidationFailure {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  if (lowered.includes("timeout") || lowered.includes("aborted") || lowered.includes("timed out")) {
    return failure("timeout", "验证超时，请检查网络后重试。", true, "probe timeout");
  }
  if (
    lowered.includes("certificate") ||
    lowered.includes("tls") ||
    lowered.includes("ssl") ||
    lowered.includes("cert")
  ) {
    return failure("tls_error", "TLS 证书验证失败，请检查 Base URL 与代理配置。", false, "tls failure");
  }
  if (
    lowered.includes("enotfound") ||
    lowered.includes("econnrefused") ||
    lowered.includes("dns") ||
    lowered.includes("fetch failed") ||
    lowered.includes("network")
  ) {
    return failure("network_error", "无法连接到 Base URL，请检查地址与网络。", true, "network failure");
  }
  return failure("network_error", "无法连接到 Base URL，请检查地址与网络。", true, "network failure");
}

function responsesBodyLooksOk(bodyText: string): boolean {
  // Minimal shape check: must be JSON with some output-ish field. Strict
  // full-schema validation would couple us to vendor drift; this only rejects
  // obvious non-Responses payloads (HTML, empty, error envelopes).
  const trimmed = bodyText.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("<")) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      if ("error" in parsed && (parsed as { error?: unknown }).error) return false;
      return (
        "output" in parsed ||
        "output_text" in parsed ||
        "response" in parsed ||
        "id" in parsed ||
        "status" in parsed
      );
    }
    return false;
  } catch {
    return false;
  }
}

function chatBodyLooksOk(bodyText: string): boolean {
  const trimmed = bodyText.trim();
  if (!trimmed || trimmed.startsWith("<")) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      if ("error" in parsed && (parsed as { error?: unknown }).error) return false;
      const choices = (parsed as { choices?: unknown }).choices;
      if (Array.isArray(choices)) return true;
      return "id" in parsed || "model" in parsed;
    }
    return false;
  } catch {
    return false;
  }
}

export interface ProbeThirdPartyInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl: ProbeFetch;
  timeoutMs?: number | undefined;
  now?: number | undefined;
}

/**
 * Run the real compatibility probe. Responses first; Chat Completions only
 * when Responses is clearly unsupported. Credential / connectivity /
 * temporary failures never fall through to the next protocol.
 */
export async function probeThirdPartyProvider(
  input: ProbeThirdPartyInput,
): Promise<ThirdPartyValidationResult> {
  const normalizedApiRoot = normalizeApiRoot(input.baseUrl);
  if (!normalizedApiRoot) {
    return failure("invalid_base_url", "Base URL 无效，请输入 http(s) 地址。", false);
  }
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  if (!apiKey) return failure("unauthorized", "API Key 不能为空。", false);
  if (!model) return failure("model_not_found", "Model Name 不能为空。", false);

  const timeoutMs = input.timeoutMs ?? THIRD_PARTY_PROBE_TIMEOUT_MS;
  const now = input.now ?? Date.now();
  const urls = buildProbeUrls(normalizedApiRoot);
  const authHeader = `Bearer ${apiKey}`;

  // Low-cost hint only: GET /models for connectivity/auth/model-existence.
  // Its outcome never decides pass/fail by itself.
  let modelListedHint = false;
  try {
    const modelsRes = await input.fetchImpl(
      urls.models,
      { method: "GET", headers: { Accept: "application/json", Authorization: authHeader } },
      Math.min(timeoutMs, 12_000),
    );
    if (modelsRes.status === 401) {
      return failure("unauthorized", "API Key 无效或已失效（401）。", false, "GET /v1/models 401");
    }
    if (modelsRes.status === 403) {
      return failure("forbidden", "API Key 无权限访问该 Base URL（403）。", false, "GET /v1/models 403");
    }
    if (modelsRes.status === 429) {
      return failure("rate_limited", "服务端限流（429），请稍后重试。验证暂不可用。", true, "GET /v1/models 429");
    }
    if (modelsRes.status >= 200 && modelsRes.status < 300) {
      try {
        const parsed = JSON.parse(modelsRes.bodyText) as { data?: Array<{ id?: unknown }> };
        const ids = Array.isArray(parsed.data)
          ? parsed.data.map((e) => (typeof e?.id === "string" ? e.id : ""))
          : [];
        modelListedHint = ids.includes(model);
      } catch {
        modelListedHint = false;
      }
    }
    // Other /models failures are ignored: the real inference probe decides.
  } catch (error) {
    // A hard network failure on /models is still worth surfacing early ONLY
    // when it is clearly connectivity (DNS/refused). Otherwise continue to
    // the real probe so a /models-less vendor is not rejected outright.
    const classified = classifyTransportError(error);
    if (classified.detail === "network failure") {
      // Continue: some vendors disable /models but serve inference.
    }
  }

  const responsesBody = JSON.stringify({
    model,
    input: THIRD_PARTY_VALIDATION_PROMPT,
    max_output_tokens: THIRD_PARTY_PROBE_MAX_TOKENS,
  });
  let responsesRes: ProbeFetchResponse;
  try {
    responsesRes = await input.fetchImpl(
      urls.responses,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authHeader },
        body: responsesBody,
      },
      timeoutMs,
    );
  } catch (error) {
    return classifyTransportError(error);
  }

  if (responsesRes.status === 401) {
    return failure("unauthorized", "API Key 无效或已失效（401）。", false, "POST /v1/responses 401");
  }
  if (responsesRes.status === 403) {
    return failure("forbidden", "API Key 无权限调用该模型（403）。", false, "POST /v1/responses 403");
  }
  if (responsesRes.status === 429) {
    return failure("rate_limited", "服务端限流（429），请稍后重试。验证暂不可用。", true, "POST /v1/responses 429");
  }
  if (responsesRes.status >= 500) {
    return failure("server_error", "服务端错误，请稍后重试。验证暂不可用。", true, `POST /v1/responses ${responsesRes.status}`);
  }
  if (responsesRes.status >= 200 && responsesRes.status < 300) {
    if (!responsesBodyLooksOk(responsesRes.bodyText)) {
      return failure("invalid_response", "Responses 返回了无法识别的结构，验证未通过。", false, "POST /v1/responses invalid shape");
    }
    // Responses wins even when Chat would also work — no second probe needed.
    return { ok: true, validatedProtocol: "responses", normalizedApiRoot, validatedAt: now, modelListedHint };
  }
  if (responsesRes.status === 404 || responsesRes.status === 405) {
    // Candidate for fallback — but confirm it is really "unsupported", not a
    // missing model or bad key surfaced as 404/400.
    if (bodyIndicatesModelMissing(responsesRes.bodyText, model)) {
      return failure("model_not_found", `模型 ${model} 不存在或无权访问。`, false, "POST /v1/responses model missing");
    }
    // Fall through to Chat Completions.
  } else if (responsesRes.status === 400) {
    if (bodyIndicatesModelMissing(responsesRes.bodyText, model)) {
      return failure("model_not_found", `模型 ${model} 不存在或无权访问。`, false, "POST /v1/responses model missing");
    }
    if (!bodyIndicatesUnsupported(responsesRes.bodyText)) {
      return failure(
        "invalid_response",
        "Responses 请求被拒绝（400），请检查 Model Name 后重试。",
        false,
        `POST /v1/responses 400: ${responsesRes.bodyText.slice(0, 200)}`,
      );
    }
    // Unsupported request shape → fall through to Chat.
  } else if (responsesRes.status === 408 || responsesRes.status === 425) {
    return failure("timeout", "验证超时，请检查网络后重试。", true, `POST /v1/responses ${responsesRes.status}`);
  } else {
    // Any other 4xx (402/413/…) is NOT protocol-unsupported evidence.
    return failure(
      "invalid_response",
      `Responses 验证失败（HTTP ${responsesRes.status}），未确认支持前不能添加。`,
      false,
      `POST /v1/responses ${responsesRes.status}`,
    );
  }

  // ── Fallback: Chat Completions (only after clear Responses-unsupported) ──
  const chatBody = JSON.stringify({
    model,
    messages: [{ role: "user", content: THIRD_PARTY_VALIDATION_PROMPT }],
    max_tokens: THIRD_PARTY_PROBE_MAX_TOKENS,
  });
  let chatRes: ProbeFetchResponse;
  try {
    chatRes = await input.fetchImpl(
      urls.chatCompletions,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authHeader },
        body: chatBody,
      },
      timeoutMs,
    );
  } catch (error) {
    return classifyTransportError(error);
  }
  if (chatRes.status === 401) {
    return failure("unauthorized", "API Key 无效或已失效（401）。", false, "POST /v1/chat/completions 401");
  }
  if (chatRes.status === 403) {
    return failure("forbidden", "API Key 无权限调用该模型（403）。", false, "POST /v1/chat/completions 403");
  }
  if (chatRes.status === 429) {
    return failure("rate_limited", "服务端限流（429），请稍后重试。验证暂不可用。", true, "POST /v1/chat/completions 429");
  }
  if (chatRes.status >= 500) {
    return failure("server_error", "服务端错误，请稍后重试。验证暂不可用。", true, `POST /v1/chat/completions ${chatRes.status}`);
  }
  if (chatRes.status >= 200 && chatRes.status < 300) {
    if (!chatBodyLooksOk(chatRes.bodyText)) {
      return failure("invalid_response", "Chat Completions 返回了无法识别的结构，验证未通过。", false, "POST /v1/chat/completions invalid shape");
    }
    return { ok: true, validatedProtocol: "chat_completions", normalizedApiRoot, validatedAt: now, modelListedHint };
  }
  if (chatRes.status === 404 || chatRes.status === 405) {
    if (bodyIndicatesModelMissing(chatRes.bodyText, model)) {
      return failure("model_not_found", `模型 ${model} 不存在或无权访问。`, false, "POST /v1/chat/completions model missing");
    }
    return failure("chat_completions_unsupported", "该 API 同时不支持 Responses 与 Chat Completions，无法添加。", false, `POST /v1/chat/completions ${chatRes.status}`);
  }
  if (chatRes.status === 400) {
    if (bodyIndicatesModelMissing(chatRes.bodyText, model)) {
      return failure("model_not_found", `模型 ${model} 不存在或无权访问。`, false, "POST /v1/chat/completions model missing");
    }
    if (bodyIndicatesUnsupported(chatRes.bodyText)) {
      return failure("chat_completions_unsupported", "该 API 同时不支持 Responses 与 Chat Completions，无法添加。", false, "POST /v1/chat/completions unsupported");
    }
    return failure("invalid_response", "Chat Completions 请求被拒绝（400），请检查 Model Name 后重试。", false, `POST /v1/chat/completions 400`);
  }
  return failure(
    "chat_completions_unsupported",
    "该 API 同时不支持 Responses 与 Chat Completions，无法添加。",
    false,
    `POST /v1/chat/completions ${chatRes.status}`,
  );
}

export interface ThirdPartyValidationInputs {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** True when any of Base URL / Key / Model changed → prior validation is stale. */
export function validationInputsChanged(
  previous: ThirdPartyValidationInputs,
  next: ThirdPartyValidationInputs,
): boolean {
  if (normalizeApiRoot(previous.baseUrl) !== normalizeApiRoot(next.baseUrl)) return true;
  if (previous.model.trim() !== next.model.trim()) return true;
  // Key comparison by value; callers hold the raw key in memory only.
  if (previous.apiKey !== next.apiKey) return true;
  return false;
}

export interface ThirdPartyModelDescriptor {
  providerId: string;
  /** Normalized API root (no trailing /v1). */
  baseUrl: string;
  modelId: string;
  modelSource: "third-party";
  validatedProtocol: ThirdPartyProtocol;
  validatedAt: number;
}
