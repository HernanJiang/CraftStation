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

  it("anchors the tools toggle to the chat header only while the tools panel is collapsed", () => {
    const { container } = render(<MainContentHeaderControls />);

    const toggle = screen.getByRole("button", { name: "Toggle tools panel" });
    const positionedTrigger = toggle.parentElement;
    expect(positionedTrigger?.className).toContain("absolute");
    expect(positionedTrigger?.className).toContain("right-2.5");
    expect(container.querySelector("#craftstation-main-thread-header")).toBeInTheDocument();
    expect(container.querySelector("#craftstation-auxiliary-panel-header")).toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(usePanelStore.getState().auxiliaryPanelPlacement).toBe("right");
    expect(screen.queryByRole("button", { name: "Toggle tools panel" })).toBeNull();
  });

  it("keeps the collapsed-panel toggle interactive when an existing thread owns the header", () => {
    headerState.projectId = "project-1";
    headerState.threadId = "thread-1";
    render(<MainContentHeaderControls />);

    const toggle = screen.getByRole("button", { name: "Toggle tools panel" });
    expect(toggle).toHaveClass("pointer-events-auto", "poracode-overlay-header__controls");
    expect(toggle.parentElement).toHaveClass("z-[60]", "pointer-events-auto");

    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(usePanelStore.getState().auxiliaryPanelPlacement).toBe("right");
  });
});
