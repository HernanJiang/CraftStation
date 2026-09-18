import { afterEach, describe, expect, it } from "vitest";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { normalizeContainerRectForAppZoom } from "./zoomNormalizedContainerRect";

function fakeRect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("normalizeContainerRectForAppZoom", () => {
  afterEach(() => {
    useSharedSettings.setState({ zoomFactor: 1 });
  });

  it("passes the native rect through untouched at factor 1", () => {
    const element = document.createElement("div");
    const native = fakeRect(10, 20, 300, 400);
    element.getBoundingClientRect = () => native;
    normalizeContainerRectForAppZoom(element);
    expect(element.getBoundingClientRect()).toBe(native);
  });

  it("divides visual pixels by the live zoom factor", () => {
    const element = document.createElement("div");
    element.getBoundingClientRect = () => fakeRect(125, 250, 1250, 625);
    normalizeContainerRectForAppZoom(element);
    useSharedSettings.setState({ zoomFactor: 1.25 });
    const result = element.getBoundingClientRect();
    expect(result.top).toBe(100);
    expect(result.left).toBe(200);
    expect(result.width).toBe(1000);
    expect(result.height).toBe(500);
  });

  it("tracks zoom changes without re-patching", () => {
    const element = document.createElement("div");
    element.getBoundingClientRect = () => fakeRect(200, 0, 200, 100);
    normalizeContainerRectForAppZoom(element);
    useSharedSettings.setState({ zoomFactor: 2 });
    expect(element.getBoundingClientRect().top).toBe(100);
    useSharedSettings.setState({ zoomFactor: 1 });
    expect(element.getBoundingClientRect().top).toBe(200);
  });

  it("is idempotent per container and never double-divides", () => {
    const element = document.createElement("div");
    element.getBoundingClientRect = () => fakeRect(125, 0, 125, 0);
    normalizeContainerRectForAppZoom(element);
    const patched = element.getBoundingClientRect;
    normalizeContainerRectForAppZoom(element);
    expect(element.getBoundingClientRect).toBe(patched);
    useSharedSettings.setState({ zoomFactor: 1.25 });
    expect(element.getBoundingClientRect().top).toBe(100);
  });

  it("ignores a missing container", () => {
    expect(() => normalizeContainerRectForAppZoom(null)).not.toThrow();
  });
});
