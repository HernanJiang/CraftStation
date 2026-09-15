import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { usePanelStore } from "@/renderer/state/panelStore";
import { toggleSidebar } from "@/renderer/state/sidebarOverlayStore";
import { DraftHomeHero } from "./DraftHomeHero";

vi.mock("@/renderer/state/sidebarOverlayStore", () => ({
  toggleSidebar: vi.fn<() => void>(),
}));

const openModelUsageWorkspace =
  vi.fn<(input: { tab: "crafting" | "models" | "recipes" | "usage" | "stats" }) => void>();

describe("DraftHomeHero entry cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePanelStore.setState({
      ...usePanelStore.getState(),
      openModelUsageWorkspace,
    });
  });

  it("opens the crafting workspace tab from 合成台 / Harness", () => {
    render(<DraftHomeHero />);
    fireEvent.click(screen.getByTestId("home-entry-crafting"));
    expect(openModelUsageWorkspace).toHaveBeenCalledTimes(1);
    expect(openModelUsageWorkspace).toHaveBeenCalledWith({ tab: "crafting" });
  });

  it("toggles the existing sidebar instead of a second sidebar state", () => {
    render(<DraftHomeHero />);
    fireEvent.click(screen.getByTestId("home-entry-sidebar"));
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
    expect(openModelUsageWorkspace).not.toHaveBeenCalled();
  });

  it("opens the models tab from 模型管理", () => {
    render(<DraftHomeHero />);
    fireEvent.click(screen.getByTestId("home-entry-models"));
    expect(openModelUsageWorkspace).toHaveBeenCalledTimes(1);
    expect(openModelUsageWorkspace).toHaveBeenCalledWith({ tab: "models" });
  });

  it("opens the recipes tab from 配方管理", () => {
    render(<DraftHomeHero />);
    fireEvent.click(screen.getByTestId("home-entry-recipes"));
    expect(openModelUsageWorkspace).toHaveBeenCalledTimes(1);
    expect(openModelUsageWorkspace).toHaveBeenCalledWith({ tab: "recipes" });
  });
});
