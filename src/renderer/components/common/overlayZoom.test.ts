import { describe, expect, it } from "vitest";
import { overlayZoomClasses, withOverlayClass } from "./overlayZoom";

describe("overlayZoomClasses", () => {
  it("returns empty classes at factor 1 or unset (default DOM untouched)", () => {
    expect(overlayZoomClasses(1)).toEqual({ root: "", content: "" });
    expect(overlayZoomClasses(undefined)).toEqual({ root: "", content: "" });
  });

  it("returns the counter-zoom layer pair at other factors", () => {
    expect(overlayZoomClasses(1.25)).toEqual({
      root: "craftstation-overlay-zoom-root",
      content: "craftstation-overlay-zoom-content",
    });
    expect(overlayZoomClasses(0.8)).toEqual({
      root: "craftstation-overlay-zoom-root",
      content: "craftstation-overlay-zoom-content",
    });
  });
});

describe("withOverlayClass", () => {
  it("joins without stray spaces", () => {
    expect(withOverlayClass("w-96 p-0", "craftstation-overlay-zoom-root")).toBe(
      "w-96 p-0 craftstation-overlay-zoom-root",
    );
    expect(withOverlayClass(undefined, "")).toBe("");
    expect(withOverlayClass("w-96", "")).toBe("w-96");
  });
});
