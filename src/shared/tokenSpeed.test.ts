// @vitest-environment node

import { describe, expect, it } from "vitest";
import { estimateStreamedTokens, formatTokenRate } from "./tokenSpeed";

describe("estimateStreamedTokens", () => {
  it("estimates ASCII/code text at ~4 chars per token", () => {
    expect(estimateStreamedTokens("Hello world")).toBeCloseTo(11 / 4);
    expect(estimateStreamedTokens("")).toBe(0);
  });

  it("estimates CJK text at ~1.6 chars per token", () => {
    expect(estimateStreamedTokens("六个中文字符")).toBeCloseTo(6 / 1.6);
  });

  it("blends CJK and ASCII in one delta", () => {
    // 4 CJK chars + "ab cd" (5 ASCII chars, space counts as non-CJK)
    expect(estimateStreamedTokens("中文字符 ab cd")).toBeCloseTo(4 / 1.6 + 6 / 4);
  });

  it("counts CJK punctuation in the CJK bucket", () => {
    // "。" (U+3002) and "，" (U+FF0C) are CJK-class characters.
    expect(estimateStreamedTokens("好。")).toBeCloseTo(2 / 1.6);
  });
});

describe("formatTokenRate", () => {
  it("renders a rounded tok/s label", () => {
    expect(formatTokenRate(42.36)).toBe("≈ 42.4 tok/s");
    expect(formatTokenRate(128.6)).toBe("≈ 129 tok/s");
  });

  it("renders a placeholder for non-positive or non-finite rates", () => {
    expect(formatTokenRate(0)).toBe("--");
    expect(formatTokenRate(Number.NaN)).toBe("--");
  });
});
