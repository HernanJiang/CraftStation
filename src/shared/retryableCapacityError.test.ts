import { describe, expect, it } from "vitest";
import { isRetryableCapacityError, stripRetryableCapacityNoise } from "./retryableCapacityError";

const CAPACITY_503 =
  "API error (attempt 2) UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server";
const CAPACITY_503_ATTEMPT_1 =
  "API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server";

describe("isRetryableCapacityError", () => {
  it("matches Gemini Antigravity retry logs", () => {
    expect(isRetryableCapacityError(CAPACITY_503)).toBe(true);
    expect(isRetryableCapacityError(CAPACITY_503_ATTEMPT_1)).toBe(true);
    expect(
      isRetryableCapacityError(
        "UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server",
      ),
    ).toBe(true);
  });

  it("does not match real assistant text or final non-retry failures", () => {
    expect(isRetryableCapacityError("Here is the fix.")).toBe(false);
    expect(isRetryableCapacityError("UNAVAILABLE (code 503): quota exceeded")).toBe(false);
  });
});

describe("stripRetryableCapacityNoise", () => {
  it("drops a retry-only chunk", () => {
    expect(stripRetryableCapacityNoise(CAPACITY_503)).toBeUndefined();
  });

  it("keeps surrounding answer text", () => {
    expect(stripRetryableCapacityNoise(`${CAPACITY_503}\nhello`)).toBe("hello");
  });
});
