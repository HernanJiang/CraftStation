import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ResponsiveMenuSurface } from "./ResponsiveMenuSurface";

vi.mock("@/renderer/bridge", () => ({
  isRemoteSession: () => false,
  readBridge: () => ({}),
}));

function OpenSurface() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <ResponsiveMenuSurface
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      label="Zoom menu"
      trigger={<button type="button" data-testid="zoom-trigger">open</button>}
      placement="top start"
      contentClassName="w-44 p-0"
      dialogClassName="flex flex-col"
    >
      <div>menu body</div>
    </ResponsiveMenuSurface>
  );
}

describe("ResponsiveMenuSurface zoom compensation", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    useSharedSettings.setState({ zoomFactor: 1 });
  });

  it("leaves overlay DOM untouched at factor 1", () => {
    render(<OpenSurface />);
    fireEvent.click(screen.getByTestId("zoom-trigger"));
    expect(screen.getByText("menu body")).toBeInTheDocument();
    expect(document.querySelector(".craftstation-overlay-zoom-root")).toBeNull();
    expect(document.querySelector(".craftstation-overlay-zoom-content")).toBeNull();
  });

  it("counter-scales the positioned layer and re-scales content off factor 1", () => {
    useSharedSettings.setState({ zoomFactor: 1.25 });
    render(<OpenSurface />);
    fireEvent.click(screen.getByTestId("zoom-trigger"));
    expect(screen.getByText("menu body")).toBeInTheDocument();
    expect(document.querySelector(".craftstation-overlay-zoom-root")).not.toBeNull();
    expect(document.querySelector(".craftstation-overlay-zoom-content")).not.toBeNull();
  });
});
