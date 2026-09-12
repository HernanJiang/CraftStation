import { describe, expect, it } from "vitest";
import { isCodexPoolQuotaError } from "./sessionErrors";

const QUOTA =
  "Error running remote compact task You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits.";

describe("codex session errors", () => {
  it("matches the verified usage-limit shape", () => {
    expect(isCodexPoolQuotaError(new Error(QUOTA))).toBe(true);
    expect(isCodexPoolQuotaError(QUOTA)).toBe(true);
  });

  it("never matches rate-limit or retryable shapes", () => {
    expect(isCodexPoolQuotaError(new Error("rate limit exceeded, retry in 30s"))).toBe(false);
    expect(isCodexPoolQuotaError(new Error("429 too many requests"))).toBe(false);
    expect(isCodexPoolQuotaError(new Error(`${QUOTA} willRetry`))).toBe(false);
    expect(isCodexPoolQuotaError(new Error("Approaching rate limits, switch model"))).toBe(false);
  });

  it("rejects unrelated failures and empty input", () => {
    expect(isCodexPoolQuotaError(new Error("transport closed"))).toBe(false);
    expect(isCodexPoolQuotaError(undefined)).toBe(false);
    expect(isCodexPoolQuotaError("")).toBe(false);
  });
});
