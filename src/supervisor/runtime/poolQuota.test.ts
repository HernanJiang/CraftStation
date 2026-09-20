import { describe, expect, it } from "vitest";
import {
  MAX_POOL_FAILOVER_ATTEMPTS_PER_TURN,
  POOL_FAILOVER_PROVIDERS,
  isPoolQuotaErrorForProvider,
  isPoolRotationProvider,
  isThirdPartyProtocolFlipError,
  thirdPartyFailureKind,
} from "./poolQuota";

function grokQuotaError(): Error {
  return Object.assign(new Error("Internal error"), {
    code: -32603,
    data: {
      message: "API error (status 402 Payment Required): Grok Build usage balance exhausted",
      http_status: 402,
    },
  });
}

describe("poolQuota provider dispatch", () => {
  it("covers exactly the subscription pools that may walk", () => {
    expect([...POOL_FAILOVER_PROVIDERS].sort()).toEqual(["antigravity", "codex", "grok", "kimi"]);
    expect(MAX_POOL_FAILOVER_ATTEMPTS_PER_TURN).toBe(6);
  });

  it("matches Grok on the RPC shape and the projected banner", () => {
    expect(isPoolQuotaErrorForProvider("grok", grokQuotaError())).toBe(true);
    expect(isPoolQuotaErrorForProvider("grok", new Error("Grok 额度已耗尽"))).toBe(true);
    expect(isPoolQuotaErrorForProvider("grok", new Error("Internal error"))).toBe(false);
  });

  it("fails Grok over on 403 quota wording but never on refusals", () => {
    expect(
      isPoolQuotaErrorForProvider("grok", {
        code: -32603,
        message: "Internal error",
        data: { http_status: 403, message: "API error (status 403): quota exceeded" },
      }),
    ).toBe(true);
    expect(
      isPoolQuotaErrorForProvider(
        "grok",
        new Error(
          "API error (status 403 Forbidden) permission-denied: I can't help with that request.",
        ),
      ),
    ).toBe(false);
  });

  it("matches Kimi window exhaustion but never rate-limit or auth shapes", () => {
    expect(
      isPoolQuotaErrorForProvider(
        "kimi",
        new Error(
          "provider.auth_error: 403 You've reached your 5-hour usage limit. quota will reset",
        ),
      ),
    ).toBe(true);
    expect(isPoolQuotaErrorForProvider("kimi", new Error("Kimi 额度已耗尽"))).toBe(true);
    expect(isPoolQuotaErrorForProvider("kimi", { data: { http_status: 429 } })).toBe(false);
    expect(isPoolQuotaErrorForProvider("kimi", { data: { http_status: 401 } })).toBe(false);
  });

  it("matches Codex usage-limit text but never retryable shapes", () => {
    expect(
      isPoolQuotaErrorForProvider(
        "codex",
        new Error("You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage"),
      ),
    ).toBe(true);
    expect(isPoolQuotaErrorForProvider("codex", new Error("rate limit exceeded willRetry"))).toBe(
      false,
    );
  });

  it("matches Antigravity quota text but never model errors", () => {
    expect(
      isPoolQuotaErrorForProvider("antigravity", new Error("RESOURCE_EXHAUSTED: quota exceeded")),
    ).toBe(true);
    expect(isPoolQuotaErrorForProvider("antigravity", new Error('invalid model "x"'))).toBe(false);
  });

  it("stays fail-closed for third-party and unknown providers", () => {
    expect(isPoolQuotaErrorForProvider("openai-compatible", grokQuotaError())).toBe(false);
    expect(isPoolQuotaErrorForProvider("opencode", new Error("quota exceeded"))).toBe(false);
    expect(isPoolQuotaErrorForProvider("nope", new Error("Grok 额度已耗尽"))).toBe(false);
  });

  it("marks exactly the rotatable providers", () => {
    expect(isPoolRotationProvider("grok")).toBe(true);
    expect(isPoolRotationProvider("kimi")).toBe(true);
    expect(isPoolRotationProvider("codex")).toBe(true);
    expect(isPoolRotationProvider("antigravity")).toBe(true);
    expect(isPoolRotationProvider("openai-compatible")).toBe(true);
    expect(isPoolRotationProvider("opencode")).toBe(false);
    expect(isPoolRotationProvider("claude")).toBe(false);
  });
});

describe("thirdPartyFailureKind", () => {
  it("detects relay budget exhaustion", () => {
    expect(thirdPartyFailureKind({ data: { http_status: 402 }, message: "Payment Required" })).toBe(
      "quota",
    );
    expect(thirdPartyFailureKind(new Error("402 insufficient_quota: you ran out of credits"))).toBe(
      "quota",
    );
    expect(
      thirdPartyFailureKind(
        new Error(
          "Error 429: You exceeded your current quota, please check your plan and billing.",
        ),
      ),
    ).toBe("quota");
    expect(
      thirdPartyFailureKind({
        data: { message: "Billing hard limit reached" },
        message: "request failed",
      }),
    ).toBe("quota");
  });

  it("detects transient throttling without marking it quota", () => {
    expect(thirdPartyFailureKind({ data: { http_status: 429 }, message: "slow down" })).toBe(
      "rate_limited",
    );
    expect(thirdPartyFailureKind(new Error("Rate limit reached for gpt-5, retry later"))).toBe(
      "rate_limited",
    );
    expect(thirdPartyFailureKind(new Error("429 too many requests"))).toBe("rate_limited");
  });

  it("stays fail-closed on auth denials, unknown models and bad requests", () => {
    expect(
      thirdPartyFailureKind({ data: { http_status: 401 }, message: "bad key" }),
    ).toBeUndefined();
    expect(thirdPartyFailureKind(new Error("Error: 401 Invalid API key provided"))).toBeUndefined();
    expect(thirdPartyFailureKind(new Error("403 forbidden"))).toBeUndefined();
    expect(thirdPartyFailureKind(new Error("404: model 'gpt-9' not found"))).toBeUndefined();
    expect(thirdPartyFailureKind(new Error("model_not_found"))).toBeUndefined();
    expect(thirdPartyFailureKind(new Error("400 invalid_request_error"))).toBeUndefined();
    expect(thirdPartyFailureKind(new Error("boom"))).toBeUndefined();
    expect(thirdPartyFailureKind(undefined)).toBeUndefined();
  });
});

describe("isThirdPartyProtocolFlipError", () => {
  it("fires on 400-class wire-type failures", () => {
    // Verbatim from Kimi CLI against Volcengine Ark coding over Responses.
    expect(
      isThirdPartyProtocolFlipError(
        new Error(
          'llm request failed model=kimi-k2.8-preview errorMessage="400 A parameter specified in the request is not valid" statusCode=400',
        ),
      ),
    ).toBe(true);
    expect(isThirdPartyProtocolFlipError({ data: { http_status: 400 }, message: "x" })).toBe(true);
    expect(isThirdPartyProtocolFlipError(new Error("400 Bad Request"))).toBe(true);
  });

  it("never fires on other statuses, unknown models or auth wording", () => {
    expect(isThirdPartyProtocolFlipError(new Error("404 model_not_found"))).toBe(false);
    expect(
      isThirdPartyProtocolFlipError({ data: { http_status: 404 }, message: "400 model missing?" }),
    ).toBe(false);
    expect(isThirdPartyProtocolFlipError(new Error("401 invalid_api_key"))).toBe(false);
    expect(isThirdPartyProtocolFlipError(new Error("402 insufficient_quota"))).toBe(false);
    expect(isThirdPartyProtocolFlipError(new Error("429 slow down"))).toBe(false);
    expect(isThirdPartyProtocolFlipError(new Error("boom"))).toBe(false);
    expect(isThirdPartyProtocolFlipError(undefined)).toBe(false);
  });
});
