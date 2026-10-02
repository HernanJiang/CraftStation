import { describe, expect, it } from "vitest";
import { classifyCodexPoolQuotaError, isCodexPoolQuotaError } from "./sessionErrors";
import { codexRateLimitsToQuotaWindows } from "./acp";

const QUOTA =
  "Error running remote compact task You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits.";

describe("codex session errors", () => {
  it("matches the verified usage-limit shape", () => {
    expect(isCodexPoolQuotaError(new Error(QUOTA))).toBe(true);
    expect(isCodexPoolQuotaError(QUOTA)).toBe(true);
  });

  it("matches the structured 429 usage_limit_reached shape", () => {
    // Codex maps ChatGPT-quota exhaustion to HTTP 429 + error_type
    // `usage_limit_reached` — a typed quota signal, not generic throttling.
    expect(
      isCodexPoolQuotaError({
        status: 429,
        error: { type: "usage_limit_reached", message: "usage limit reached" },
      }),
    ).toBe(true);
    expect(isCodexPoolQuotaError(new Error("codex error: usage_limit_reached (429)"))).toBe(true);
  });

  it("quota wording wins over transient noise in the same payload", () => {
    // A typed usage-limit error may carry a serialized `willRetry` flag or a
    // status code alongside the quota text — the quota signal is definitive.
    expect(isCodexPoolQuotaError(new Error(`${QUOTA} willRetry`))).toBe(true);
  });

  it("never matches generic rate-limit or retryable shapes", () => {
    expect(isCodexPoolQuotaError(new Error("rate limit exceeded, retry in 30s"))).toBe(false);
    expect(isCodexPoolQuotaError(new Error("429 too many requests"))).toBe(false);
    expect(isCodexPoolQuotaError(new Error("Approaching rate limits, switch model"))).toBe(false);
    expect(isCodexPoolQuotaError(new Error("exceeded retry limit, last status: 429"))).toBe(false);
  });

  it("rejects unrelated failures and empty input", () => {
    expect(isCodexPoolQuotaError(new Error("transport closed"))).toBe(false);
    expect(isCodexPoolQuotaError(undefined)).toBe(false);
    expect(isCodexPoolQuotaError("")).toBe(false);
  });
});

describe("classifyCodexPoolQuotaError", () => {
  const now = new Date(2026, 9, 15, 14, 0, 0).getTime(); // 2026-10-15 14:00 local

  it("same-day reset inside 6h lands on session-5h", () => {
    const error = new Error("You've hit your usage limit. Upgrade to Pro or try again at 4:45 PM.");
    const classified = classifyCodexPoolQuotaError(error, undefined, now);
    expect(classified?.axisId).toBe("session-5h");
    expect(classified?.recoversAt).toBe(new Date(2026, 9, 15, 16, 45, 0).getTime());
  });

  it("a reset further than 6h out lands on weekly", () => {
    const error = new Error("You've hit your usage limit. Try again at Oct 22nd, 2026 9:00 AM.");
    const classified = classifyCodexPoolQuotaError(error, undefined, now);
    expect(classified?.axisId).toBe("weekly");
    expect(classified?.recoversAt).toBe(new Date(2026, 9, 22, 9, 0, 0).getTime());
  });

  it("credits wording without a timestamp lands on weekly", () => {
    const classified = classifyCodexPoolQuotaError(new Error(QUOTA), undefined, now);
    expect(classified?.axisId).toBe("weekly");
  });

  it("an observed weekly window near saturation explains the failure", () => {
    const error = new Error("You've hit your usage limit. Try again later.");
    const classified = classifyCodexPoolQuotaError(
      error,
      [{ id: "weekly", usedPercent: 97, resetsAt: now + 3 * 24 * 3_600_000 }],
      now,
    );
    expect(classified?.axisId).toBe("weekly");
    expect(classified?.recoversAt).toBe(now + 3 * 24 * 3_600_000);
  });

  it("defaults to session-5h when no reset hint or weekly evidence exists", () => {
    // Plus accounts never report `session-5h` to the usage poller, so a bare
    // usage-limit failure is most plausibly the invisible short window.
    const error = new Error("You've hit your usage limit. Try again later.");
    const classified = classifyCodexPoolQuotaError(error, [{ id: "weekly", usedPercent: 12 }], now);
    expect(classified?.axisId).toBe("session-5h");
    expect(classified?.recoversAt).toBeUndefined();
  });

  it("returns undefined for non-quota errors", () => {
    expect(classifyCodexPoolQuotaError(new Error("429 too many requests"))).toBeUndefined();
    expect(classifyCodexPoolQuotaError(undefined)).toBeUndefined();
  });
});

describe("codexRateLimitsToQuotaWindows", () => {
  it("maps primary/secondary snapshots onto the 5h and weekly axes", () => {
    // The v2 wire shape is camelCase with `resetsAt` in Unix SECONDS.
    const windows = codexRateLimitsToQuotaWindows({
      primary: {
        usedPercent: 100,
        windowDurationMins: 300,
        resetsAt: 1_800_000_000,
      },
      secondary: {
        usedPercent: 42.36,
        windowDurationMins: 10080,
        resetsAt: 1_800_500_000,
      },
    });
    expect(windows).toEqual([
      {
        id: "session-5h",
        label: "Session (5h)",
        usedPercent: 100,
        resetsAt: 1_800_000_000_000,
      },
      {
        id: "weekly",
        label: "Weekly",
        usedPercent: 42.4,
        resetsAt: 1_800_500_000_000,
      },
    ]);
  });

  it("accepts snake_case fields and falls back to the slot axis without a duration", () => {
    const windows = codexRateLimitsToQuotaWindows({
      secondary: { used_percent: 100, resets_at: 1_800_100_000 },
    });
    expect(windows).toEqual([
      {
        id: "weekly",
        label: "Weekly",
        usedPercent: 100,
        resetsAt: 1_800_100_000_000,
      },
    ]);
  });

  it("omits absent slots and malformed payloads produce nothing", () => {
    expect(codexRateLimitsToQuotaWindows({ primary: undefined })).toEqual([]);
    expect(codexRateLimitsToQuotaWindows({ primary: { windowDurationMins: 300 } })).toEqual([]);
    expect(codexRateLimitsToQuotaWindows(null)).toEqual([]);
    expect(codexRateLimitsToQuotaWindows("not an object")).toEqual([]);
  });
});
