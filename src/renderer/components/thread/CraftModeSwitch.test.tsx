import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { CraftModeSwitch } from "./CraftModeSwitch";

describe("CraftModeSwitch", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({ zoomFactor: 1 });
  });

  async function openMenu() {
    fireEvent.click(screen.getByRole("button", { name: "CraftStation mode" }));
    return screen.findByRole("menu");
  }

  it("selects a mode through the menu", async () => {
    const onChange = vi.fn<(mode: string) => void>();
    render(<CraftModeSwitch value="auto" onChange={onChange} />);
    const menu = await openMenu();

    fireEvent.click(
      within(menu).getByRole("menuitemradio", {
        name: /Efficient mode/,
      }),
    );
    expect(onChange).toHaveBeenCalledWith("efficient");
  });

  it("leaves the overlay DOM untouched at zoom 1", async () => {
    render(<CraftModeSwitch value="auto" onChange={() => {}} />);
    await openMenu();

    const popover = document.querySelector('[data-slot="dropdown-popover"]');
    expect(popover?.className).not.toMatch("craftstation-overlay-zoom-root");
  });

  // At zoom ≠ 1 the root zoom re-scales plain CSS px, so the popover needs
  // the counter-scaling wrapper or it drifts (zoom-1)×distance and clips
  // past the window's right edge.
  it("wraps the popover for zoom compensation at zoom ≠ 1", async () => {
    useSharedSettings.setState({ zoomFactor: 1.25 });
    render(<CraftModeSwitch value="auto" onChange={() => {}} />);
    await openMenu();

    const popover = document.querySelector('[data-slot="dropdown-popover"]');
    expect(popover?.className).toMatch("craftstation-overlay-zoom-root");
  });
});
