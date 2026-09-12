import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_BOTTOM_PANEL_DOCKS, usePanelStore } from "./panelStore";
import { useSharedSettings } from "./sharedSettingsStore";
import { useIsPanelTabVisible } from "./panelDockSelectors";

describe("useIsPanelTabVisible", () => {
  beforeEach(() => {
    useSharedSettings.setState({ terminalPosition: "right" });
    usePanelStore.setState({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "browser",
      auxiliaryPanelTabs: ["browser"],
      rightPanelSplit: null,
      bottomPanelDocks: EMPTY_BOTTOM_PANEL_DOCKS,
      modelUsageDialogOpen: false,
    });
  });

  it("hides the docked browser while the tool launcher is active", () => {
    const { result } = renderHook(() => useIsPanelTabVisible("browser"));
    expect(result.current).toBe(true);

    act(() => usePanelStore.getState().setAuxiliaryPanelTab(null));

    expect(result.current).toBe(false);
  });

  it("does not paint the active tab while the auxiliary panel is hidden", () => {
    const { result } = renderHook(() => useIsPanelTabVisible("browser"));

    act(() => usePanelStore.getState().setAuxiliaryPanelPlacement("hidden"));

    expect(result.current).toBe(false);
  });

  it("hides docked tabs while the model-usage workspace is open", () => {
    const { result } = renderHook(() => useIsPanelTabVisible("browser"));
    expect(result.current).toBe(true);

    act(() => usePanelStore.setState({ modelUsageDialogOpen: true }));

    expect(result.current).toBe(false);
  });

  it("keeps a bottom-docked browser visible independently from the launcher", () => {
    useSharedSettings.setState({ terminalPosition: "bottom" });
    usePanelStore.setState({
      auxiliaryPanelTab: null,
      bottomPanelDocks: { left: null, right: "browser" },
    });

    const { result } = renderHook(() => useIsPanelTabVisible("browser"));

    expect(result.current).toBe(true);
  });
});
