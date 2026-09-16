import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserEvent, BrowserState } from "@/shared/ipc";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useBrowserSync } from "./useBrowserSync";

const initialBrowserState: BrowserState = {
  tabs: [
    {
      tabId: "browser-1",
      url: "https://example.com",
      title: "Example",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
  ],
  activeTabId: "browser-1",
};

const { bridge, browserListeners } = vi.hoisted(() => {
  const listeners: Array<(event: BrowserEvent) => void> = [];
  return {
    browserListeners: listeners,
    bridge: {
      windowKind: "main",
      onBrowserEvent: vi.fn<(listener: (event: BrowserEvent) => void) => () => void>((listener) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      }),
      browserGetState: vi.fn<() => Promise<BrowserState>>(),
    },
  };
});

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

describe("useBrowserSync", () => {
  beforeEach(() => {
    browserListeners.splice(0);
    bridge.onBrowserEvent.mockClear();
    bridge.browserGetState.mockReset();
    bridge.browserGetState.mockResolvedValue(initialBrowserState);
    useBrowserPanelStore.setState({
      ...initialBrowserState,
      extracted: false,
      bookmarks: [],
      bookmarkBarVisible: false,
      groups: [],
      automationActive: false,
    });
    usePanelStore.setState({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "browser",
      auxiliaryPanelTabs: ["notes", "browser"],
      rightPanelTab: "browser",
      browserPanelOpen: true,
      browserOverlayOpen: true,
      browserOverlayMaximized: true,
    });
  });

  it("returns to the previous tool when the final browser page closes", async () => {
    renderHook(() => useBrowserSync());

    await waitFor(() => expect(browserListeners).toHaveLength(1));

    act(() => {
      browserListeners[0]?.({
        type: "state",
        state: { tabs: [], activeTabId: null },
      });
    });

    expect(usePanelStore.getState()).toMatchObject({
      auxiliaryPanelTab: "notes",
      auxiliaryPanelTabs: ["notes"],
      rightPanelTab: "notes",
      browserPanelOpen: false,
      browserOverlayOpen: false,
      browserOverlayMaximized: false,
    });
  });

  it("reveals an agent-output link in the right panel when the browser preference is panel", async () => {
    usePanelStore.setState({
      auxiliaryPanelPlacement: "hidden",
      auxiliaryPanelTab: null,
      auxiliaryPanelTabs: [],
      rightPanelTab: "git",
      browserPanelOpen: false,
      browserOverlayOpen: false,
      browserOverlayMaximized: false,
    });
    renderHook(() => useBrowserSync());

    await waitFor(() => expect(browserListeners).toHaveLength(1));
    act(() => {
      browserListeners[0]?.({ type: "open-panel", mode: "panel" });
    });

    expect(usePanelStore.getState()).toMatchObject({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "browser",
      auxiliaryPanelTabs: ["browser"],
      rightPanelTab: "browser",
      browserPanelOpen: true,
      browserOverlayOpen: false,
    });
  });
});
