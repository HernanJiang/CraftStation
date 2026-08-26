import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { BrowserTabStrip } from "./BrowserTabStrip";

describe("BrowserTabStrip", () => {
  beforeEach(() => {
    useBrowserPanelStore.setState({
      tabs: [],
      groups: [],
      activeTabId: null,
      attentionTabId: null,
    });
  });

  it("renders the first tab after mounting with no tabs", () => {
    const { getByText, queryByRole } = render(
      <BrowserTabStrip onCreateTab={vi.fn<() => void>()} />,
    );

    expect(queryByRole("button", { name: "New tab" })).toBeNull();

    act(() => {
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
      });
    });

    expect(getByText("Example")).toBeTruthy();
    expect(queryByRole("button", { name: "New tab" })).toBeTruthy();
  });
});
