import { describe, expect, it } from "vitest";
import {
  buildProbeUrls,
  isVolcengineArkApiRoot,
  normalizeApiRoot,
  openAiCompatibleApiBase,
  probeThirdPartyProvider,
  THIRD_PARTY_PROBE_TIMEOUT_MS,
  validationInputsChanged,
  type ProbeFetch,
} from "./thirdPartyValidation";

function jsonFetch(routes: Record<string, { status: number; body: unknown }>): ProbeFetch {
  return async (url) => {
    const route = routes[url];
    if (!route) return { status: 404, bodyText: JSON.stringify({ error: "unknown endpoint" }) };
    return {
      status: route.status,
      bodyText: typeof route.body === "string" ? route.body : JSON.stringify(route.body),
    };
  };
}

const OK_RESPONSES = { id: "resp_1", status: "completed", output: [{ type: "message" }] };
const OK_CHAT = { id: "chat_1", choices: [{ message: { content: "OK" } }] };

describe("thirdPartyValidation", () => {
  it("normalizes base URLs without doubling /v1", () => {
    expect(normalizeApiRoot("https://example.com")).toBe("https://example.com");
    expect(normalizeApiRoot("https://example.com/v1")).toBe("https://example.com");
    expect(normalizeApiRoot("https://example.com/v1/")).toBe("https://example.com");
    const urls = buildProbeUrls("https://example.com");
    expect(urls.responses).toBe("https://example.com/v1/responses");
    expect(urls.chatCompletions).toBe("https://example.com/v1/chat/completions");
    expect(urls.models).toBe("https://example.com/v1/models");
  });

  it("probes Volcengine Ark coding hosts via Chat Completions even when /models is 403", async () => {
    expect(isVolcengineArkApiRoot("https://ark.cn-beijing.volces.com/api/coding/v3")).toBe(true);
    let responsesCalled = false;
    const fetchImpl: ProbeFetch = async (url) => {
      if (url.endsWith("/responses")) responsesCalled = true;
      if (url.endsWith("/models")) {
        return { status: 403, bodyText: JSON.stringify({ error: "catalog disabled" }) };
      }
      if (url.endsWith("/chat/completions")) {
        return { status: 200, bodyText: JSON.stringify(OK_CHAT) };
      }
      return { status: 404, bodyText: "{}" };
    };
    const result = await probeThirdPartyProvider({
      baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      apiKey: "ark-key",
      model: "doubao-seed-2.0-code",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.validatedProtocol : undefined).toBe("chat_completions");
    expect(responsesCalled).toBe(false);
  });

  it("keeps already-versioned API roots intact (Volcengine Ark /api/v3)", () => {
    // Ark's OpenAI-compatible base carries its own version segment; appending
    // /v1 would break every probe URL.
    const ark = buildProbeUrls("https://ark.cn-beijing.volces.com/api/v3");
    expect(ark.models).toBe("https://ark.cn-beijing.volces.com/api/v3/models");
    expect(ark.responses).toBe("https://ark.cn-beijing.volces.com/api/v3/responses");
    expect(ark.chatCompletions).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    );
    const coding = buildProbeUrls("https://ark.cn-beijing.volces.com/api/coding/v3");
    expect(coding.chatCompletions).toBe(
      "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
    );
    expect(openAiCompatibleApiBase("https://example.com")).toBe("https://example.com/v1");
    expect(openAiCompatibleApiBase("https://ark.cn-beijing.volces.com/api/v3")).toBe(
      "https://ark.cn-beijing.volces.com/api/v3",
    );
  });

  it("responses success wins even when chat is also available", async () => {
    const fetchImpl = jsonFetch({
      "https://api.test/v1/models": { status: 200, body: { data: [{ id: "gpt-5.6-sol" }] } },
      "https://api.test/v1/responses": { status: 200, body: OK_RESPONSES },
      "https://api.test/v1/chat/completions": { status: 200, body: OK_CHAT },
    });
    const result = await probeThirdPartyProvider({
      baseUrl: "https://api.test/v1",
      apiKey: "sk-ok",
      model: "gpt-5.6-sol",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.validatedProtocol : undefined).toBe("responses");
  });

  it("falls back to chat only when responses is clearly unsupported", async () => {
    const fetchImpl = jsonFetch({
      "https://api.test/v1/models": { status: 200, body: { data: [] } },
      "https://api.test/v1/responses": { status: 404, body: { error: "unknown endpoint /v1/responses" } },
      "https://api.test/v1/chat/completions": { status: 200, body: OK_CHAT },
    });
    const result = await probeThirdPartyProvider({
      baseUrl: "https://api.test",
      apiKey: "sk-ok",
      model: "gpt-5.6-sol",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.validatedProtocol : undefined).toBe("chat_completions");
  });

  it("rejects when both protocols are unsupported", async () => {
    const fetchImpl = jsonFetch({
      "https://api.test/v1/models": { status: 200, body: { data: [] } },
      "https://api.test/v1/responses": { status: 404, body: { error: "unknown endpoint" } },
      "https://api.test/v1/chat/completions": { status: 404, body: { error: "unknown endpoint" } },
    });
    const result = await probeThirdPartyProvider({
      baseUrl: "https://api.test",
      apiKey: "sk-ok",
      model: "m",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok ? result.code : undefined).toBe("chat_completions_unsupported");
  });

  it("does not mistake 401 for protocol-unsupported (no fallback add)", async () => {
    let chatCalled = false;
    const fetchImpl: ProbeFetch = async (url) => {
      if (url.endsWith("/v1/chat/completions")) chatCalled = true;
      return { status: 401, bodyText: JSON.stringify({ error: "invalid api key" }) };
    };
    const result = await probeThirdPartyProvider({
      baseUrl: "https://api.test",
      apiKey: "sk-bad",
      model: "gpt-5.6-sol",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok ? result.code : undefined).toBe("unauthorized");
    expect(chatCalled).toBe(false);
  });

  it("does not mark 429/5xx as unsupported (temporarily unavailable)", async () => {
    const rateLimited = await probeThirdPartyProvider({
      baseUrl: "https://api.test",
      apiKey: "sk-ok",
      model: "m",
      fetchImpl: jsonFetch({
        "https://api.test/v1/models": { status: 200, body: { data: [] } },
        "https://api.test/v1/responses": { status: 429, body: { error: "rate limited" } },
      }),
    });
    expect(rateLimited.ok).toBe(false);
    expect(!rateLimited.ok ? rateLimited.code : undefined).toBe("rate_limited");
    expect(!rateLimited.ok ? rateLimited.retryable : undefined).toBe(true);
    const serverError = await probeThirdPartyProvider({
      baseUrl: "https://api.test",
      apiKey: "sk-ok",
      model: "m",
      fetchImpl: jsonFetch({
        "https://api.test/v1/models": { status: 200, body: { data: [] } },
        "https://api.test/v1/responses": { status: 500, body: "oops" },
      }),
    });
    expect(serverError.ok).toBe(false);
    expect(!serverError.ok ? serverError.code : undefined).toBe("server_error");
  });

  it("rejects missing models", async () => {
    const result = await probeThirdPartyProvider({
      baseUrl: "https://api.test",
      apiKey: "sk-ok",
      model: "nope-missing",
      fetchImpl: jsonFetch({
        "https://api.test/v1/models": { status: 200, body: { data: [] } },
        "https://api.test/v1/responses": { status: 404, body: { error: "model nope-missing not found" } },
      }),
    });
    expect(result.ok).toBe(false);
    expect(!result.ok ? result.code : undefined).toBe("model_not_found");
  });

  it("budgets 2 minutes for inference probes so slow relays are not false timeouts", async () => {
    const budgets: Array<{ url: string; timeoutMs: number }> = [];
    const fetchImpl: ProbeFetch = async (url, _init, timeoutMs) => {
      budgets.push({ url, timeoutMs });
      if (url.endsWith("/v1/models")) {
        return { status: 200, bodyText: JSON.stringify({ data: [{ id: "m" }] }) };
      }
      return { status: 200, bodyText: JSON.stringify(OK_RESPONSES) };
    };
    const result = await probeThirdPartyProvider({
      baseUrl: "https://api.test",
      apiKey: "sk-ok",
      model: "m",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(THIRD_PARTY_PROBE_TIMEOUT_MS).toBe(120_000);
    expect(budgets.find((entry) => entry.url.endsWith("/v1/models"))?.timeoutMs).toBe(12_000);
    expect(budgets.find((entry) => entry.url.endsWith("/v1/responses"))?.timeoutMs).toBe(
      THIRD_PARTY_PROBE_TIMEOUT_MS,
    );
  });

  it("invalidates validation when baseUrl/key/model change", () => {    const base = { baseUrl: "https://a.test", apiKey: "k1", model: "m1" };
    expect(validationInputsChanged(base, { ...base })).toBe(false);
    expect(validationInputsChanged(base, { ...base, baseUrl: "https://a.test/v1" })).toBe(false);
    expect(validationInputsChanged(base, { ...base, baseUrl: "https://b.test" })).toBe(true);
    expect(validationInputsChanged(base, { ...base, model: "m2" })).toBe(true);
    expect(validationInputsChanged(base, { ...base, apiKey: "k2" })).toBe(true);
  });
});
