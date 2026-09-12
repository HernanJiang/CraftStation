import { afterEach, describe, expect, it } from "vitest";
import { readUnscaledRect, rootZoomFactor } from "./rootZoom";

describe("rootZoom", () => {
  afterEach(() => {
    document.documentElement.style.zoom = "";
  });

  it("defaults to 1 without a root zoom", () => {
    expect(rootZoomFactor()).toBe(1);
  });

  it("reads the root zoom factor when set", () => {
    document.documentElement.style.zoom = "1.5";
    expect(rootZoomFactor()).toBe(1.5);
  });

  it("normalizes scaled rects back to CSS px", () => {
    document.documentElement.style.zoom = "1.5";
    const element = document.createElement("div");
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => ({ width: 1500, height: 900 }) as DOMRect,
      configurable: true,
    });
    expect(readUnscaledRect(element)).toEqual({ width: 1000, height: 600 });
  });

  it("passes rects through untouched at zoom 1", () => {
    const element = document.createElement("div");
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => ({ width: 1000, height: 600 }) as DOMRect,
      configurable: true,
    });
    expect(readUnscaledRect(element)).toEqual({ width: 1000, height: 600 });
  });
});
