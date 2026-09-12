import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { usePanelStore } from "@/renderer/state/panelStore";
import { MainContentHeaderControls } from "./MainContentHeaderControls";

const headerState = vi.hoisted(() => ({
  projectId: null as string | null,
  threadId: null as string | null,
}));

vi.mock("@/renderer/hooks/uiSelectors", () => ({
  useCurrentProjectId: () => headerState.projectId,
  useFocusedThreadId: () => headerState.threadId,
}));

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: (
    selector: (state: {
      projects: { id: string; name: string }[];
      threads: { id: string }[];
    }) => unknown,
  ) =>
    selector({ projects: [{ id: "project-1", name: "Project" }], threads: [{ id: "thread-1" }] }),
}));

describe("MainContentHeaderControls", () => {
  beforeEach(() => {
    headerState.projectId = null;
    headerState.threadId = null;
    usePanelStore.setState({
      auxiliaryPanelPlacement: "hidden",
      auxiliaryPanelTab: null,
      auxiliaryPanelMaximized: false,
    });
  });

  it("keeps the sidebar toggle on the same row as the status capsule", () => {
    const { container } = render(<MainContentHeaderControls />);

    const toggle = screen.getByRole("button", { name: "Show side panel" });
    const portal = container.querySelector("#craftstation-main-thread-header");
    // Static flex sibling — never an absolute overlay on another row.
    expect(toggle.parentElement?.className ?? "").not.toContain("absolute");
    expect(toggle).toHaveClass("size-7");
    expect(portal).toBeInTheDocument();
    expect(portal).toHaveClass("overflow-visible");
    expect(portal).not.toHaveClass("overflow-hidden");
    expect(portal).not.toHaveClass("pr-10");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(usePanelStore.getState().auxiliaryPanelPlacement).toBe("right");
    // Open state hides the header entry — the panel's own top-right close
    // button takes over, so the two never appear at the same time.
    expect(screen.queryByRole("button", { name: "Show side panel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide side panel" })).toBeNull();
  });

  it("hides the header toggle while the side panel is open", () => {
    usePanelStore.setState({
      auxiliaryPanelPlacement: "right",
      auxiliaryPanelTab: "git",
      auxiliaryPanelMaximized: false,
    });
    render(<MainContentHeaderControls />);

    expect(screen.queryByRole("button", { name: "Show side panel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide side panel" })).toBeNull();
  });

  it("keeps the toggle interactive when an existing thread owns the header", () => {
    headerState.projectId = "project-1";
    headerState.threadId = "thread-1";
    render(<MainContentHeaderControls />);

    const toggle = screen.getByRole("button", { name: "Show side panel" });
    expect(toggle).toHaveClass("pointer-events-auto", "craftstation-overlay-header__controls");

    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(usePanelStore.getState().auxiliaryPanelPlacement).toBe("right");
  });
});
