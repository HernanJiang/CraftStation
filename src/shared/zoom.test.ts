import { describe, expect, it } from "vitest";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, nextZoomFactor, normalizeZoomFactor } from "./zoom";

describe("nextZoomFactor", () => {
  it("steps by 0.1 and resets to 1", () => {
    expect(nextZoomFactor(1, "in")).toBeCloseTo(1.1, 5);
    expect(nextZoomFactor(1, "out")).toBeCloseTo(0.9, 5);
    expect(nextZoomFactor(1.7, "reset")).toBe(ZOOM_DEFAULT);
  });

  it("clamps to the supported range", () => {
    expect(nextZoomFactor(ZOOM_MAX, "in")).toBe(ZOOM_MAX);
    expect(nextZoomFactor(ZOOM_MIN, "out")).toBe(ZOOM_MIN);
  });

  it("repairs non-finite input", () => {
    expect(nextZoomFactor(Number.NaN, "in")).toBeCloseTo(1.1, 5);
  });
});

describe("normalizeZoomFactor", () => {
  it("keeps in-range values and repairs the rest", () => {
    expect(normalizeZoomFactor(1.5)).toBe(1.5);
    expect(normalizeZoomFactor(99)).toBe(ZOOM_MAX);
    expect(normalizeZoomFactor(0)).toBe(ZOOM_MIN);
    expect(normalizeZoomFactor(undefined)).toBe(ZOOM_DEFAULT);
    expect(normalizeZoomFactor("1.5")).toBe(ZOOM_DEFAULT);
  });
});
