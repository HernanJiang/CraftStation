import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { UnifiedRightPanel, type RightPanelTab } from "./UnifiedRightPanel";

vi.mock("@/renderer/components/layout/PanelDock/PanelDockDropZone", () => ({
  PanelDockDropZone: (props: { children: React.ReactNode; className?: string }) => (
    <div className={props.className}>{props.children}</div>
  ),
}));

describe("UnifiedRightPanel", () => {
  it("renders browser pages beside other tools in one top-level tab row", () => {
    const onActivateBrowserTab = vi.fn<(tabId: string) => void>();
    const onCloseBrowserTab = vi.fn<(tabId: string) => void>();

    render(
      <UnifiedRightPanel
        activeTab="browser"
        onTabChange={() => {}}
        gitContent={<div>review-content</div>}
        harnessContent={<div>crafting-content</div>}
        filesContent={<div>files-content</div>}
        browserContent={<div>browser-content</div>}
        showTerminalTab={false}
        showFilesTab={false}
        showGitTab
        showHarnessTab
        showUsageTab={false}
        showNotesTab={false}
        browserTabs={[
          {
            tabId: "browser-1",
            title: "Example",
            url: "https://example.com",
            loading: false,
          },
          {
            tabId: "browser-2",
            title: "Docs",
            url: "https://example.com/docs",
            loading: false,
          },
        ]}
        activeBrowserTabId="browser-1"
        onActivateBrowserTab={onActivateBrowserTab}
        onCloseBrowserTab={onCloseBrowserTab}
        projectName="CraftStation"
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Review")).toBeTruthy();
    expect(screen.getByText("Crafting Table")).toBeTruthy();
    expect(screen.getByText("Example")).toBeTruthy();
    expect(screen.getByText("Docs")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide panel" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(onActivateBrowserTab).toHaveBeenCalledWith("browser-2");

    fireEvent.click(screen.getAllByRole("button", { name: "Close tab" })[0]!);
    expect(onCloseBrowserTab).toHaveBeenCalledWith("browser-1");
  });

  it("owns its local tool header and wires close plus add", () => {
    const onCloseTab = vi.fn<(tab: RightPanelTab) => void>();
    const onAddTool = vi.fn<() => void>();

    const { container } = render(
      <UnifiedRightPanel
        activeTab="git"
        onTabChange={() => {}}
        gitContent={<div>review-content</div>}
        filesContent={<div>files-content</div>}
        browserContent={<div>browser-content</div>}
        showTerminalTab={false}
        showFilesTab={false}
        showGitTab
        showHarnessTab={false}
        showUsageTab={false}
        showNotesTab={false}
        showBrowserTab={false}
        openTabs={["git"]}
        projectName="CraftStation"
        onCloseTab={onCloseTab}
        onAddTool={onAddTool}
        onClose={() => {}}
        onToggleMaximize={() => {}}
      />,
    );

    const toolsColumn = container.querySelector("[data-craftstation-tools-column]");
    const header = container.querySelector("[data-auxiliary-panel-header]");
    expect(toolsColumn).toBeInTheDocument();
    expect(header).toBeInTheDocument();
    expect(header?.closest("[data-craftstation-tools-column]")).toBe(toolsColumn);

    fireEvent.click(screen.getByRole("button", { name: "Close Review" }));
    expect(onCloseTab).toHaveBeenCalledWith("git");

    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    expect(onAddTool).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Maximize side panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide panel" })).toBeInTheDocument();
  });

  it("keeps open tabs in the header while the launcher replaces tool content", () => {
    render(
      <UnifiedRightPanel
        activeTab="browser"
        onTabChange={() => {}}
        gitContent={<div>review-content</div>}
        filesContent={<div>files-content</div>}
        browserContent={<div>browser-content</div>}
        showTerminalTab={false}
        showFilesTab={false}
        showGitTab={false}
        showHarnessTab={false}
        showUsageTab={false}
        showNotesTab={false}
        openTabs={["browser"]}
        launcherOpen
        launcherContent={<div>tool-launcher</div>}
        browserTabs={[
          {
            tabId: "browser-1",
            title: "Example",
            url: "https://example.com",
            loading: false,
          },
        ]}
        activeBrowserTabId="browser-1"
        projectName="CraftStation"
        onExpandBrowserToOverlay={() => {}}
        onExtractBrowserToWindow={() => {}}
      />,
    );

    expect(screen.getByText("Example")).toBeInTheDocument();
    expect(screen.getByText("tool-launcher")).toBeInTheDocument();
    expect(screen.queryByText("browser-content")).toBeNull();
    expect(screen.queryByRole("button", { name: "Maximize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move browser to window" })).toBeNull();
  });
});
