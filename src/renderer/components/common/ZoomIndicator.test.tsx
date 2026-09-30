import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ZoomIndicator } from "./ZoomIndicator";

const render = renderWithI18n;

describe("ZoomIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useSharedSettings.setState({ zoomFactor: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays hidden on mount and appears when the factor changes", () => {
    render(<ZoomIndicator />);
    const pill = screen.getByText("100%").parentElement!;
    expect(pill.className).toContain("opacity-0");

    act(() => useSharedSettings.setState({ zoomFactor: 1.1 }));
    expect(screen.getByText("110%")).toBeInTheDocument();
    expect(pill.className).not.toContain("opacity-0");
  });

  it("auto-hides after the timeout", () => {
    render(<ZoomIndicator />);
    act(() => useSharedSettings.setState({ zoomFactor: 1.2 }));
    const pill = screen.getByText("120%").parentElement!;
    expect(pill.className).not.toContain("opacity-0");

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(pill.className).toContain("opacity-0");
  });

  it("steps via its own buttons and shows reset when not at 100%", () => {
    render(<ZoomIndicator />);
    act(() => useSharedSettings.setState({ zoomFactor: 1.3 }));

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(useSharedSettings.getState().zoomFactor).toBeCloseTo(1.4, 5);
    expect(screen.getByText("140%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(useSharedSettings.getState().zoomFactor).toBeCloseTo(1.3, 5);

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(useSharedSettings.getState().zoomFactor).toBe(1);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset zoom" })).not.toBeInTheDocument();
  });
});
