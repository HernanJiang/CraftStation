import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { BrowserHost } from "./BrowserHost";

vi.mock("@/renderer/state/panelDockSelectors", () => ({
  useIsPanelTabVisible: () => false,
}));

vi.mock("./useBrowserHostPositioning", () => ({
  HEADLESS_HEIGHT: 800,
  HEADLESS_WIDTH: 1280,
  HEADLESS_Z: "-1",
  useBrowserHostPositioning: vi.fn<() => void>(),
}));

vi.mock("./BrowserPanel", () => ({
  BrowserPanel: () => <div data-testid="browser-panel" />,
}));

describe("BrowserHost idle lifecycle", () => {
  beforeEach(() => {
    usePanelStore.setState({
      browserPanelOpen: false,
      browserOverlayOpen: false,
      browserOverlayMaximized: false,
    });
    useBrowserPanelStore.setState({
      tabs: [
        {
          tabId: "tab-1",
          url: "https://example.com/",
          title: "Example",
          loading: false,
          canGoBack: false,
          canGoForward: false,
        },
      ],
      activeTabId: "tab-1",
      extracted: false,
      automationActive: false,
    });
  });

  afterEach(cleanup);

  it("unmounts hidden webviews once browser automation is idle", () => {
    render(<BrowserHost />);

    expect(screen.queryByTestId("browser-panel")).toBeNull();
  });

  it("keeps hidden webviews mounted while an agent is driving the browser", () => {
    useBrowserPanelStore.setState({ automationActive: true });

    render(<BrowserHost />);

    expect(screen.getByTestId("browser-panel")).toBeTruthy();
  });
});
