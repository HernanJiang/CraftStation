import { beforeEach, describe, expect, it } from "vitest";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { adjustAppZoom } from "./zoomActions";

describe("adjustAppZoom", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({ zoomFactor: 1 });
  });

  it("steps the persisted factor and clamps at the bounds", () => {
    expect(adjustAppZoom("in")).toBeCloseTo(1.1, 5);
    expect(useSharedSettings.getState().zoomFactor).toBeCloseTo(1.1, 5);

    useSharedSettings.setState({ zoomFactor: 2 });
    expect(adjustAppZoom("in")).toBe(2);

    useSharedSettings.setState({ zoomFactor: 0.5 });
    expect(adjustAppZoom("out")).toBe(0.5);
  });

  it("resets to 100%", () => {
    useSharedSettings.setState({ zoomFactor: 1.4 });
    expect(adjustAppZoom("reset")).toBe(1);
    expect(useSharedSettings.getState().zoomFactor).toBe(1);
  });

  it("persists through the normal settings path", () => {
    adjustAppZoom("in");
    const stored = JSON.parse(localStorage.getItem("craftstation-shared-settings") ?? "{}") as {
      zoomFactor?: unknown;
    };
    expect(stored.zoomFactor).toBeCloseTo(1.1, 5);
  });
});
