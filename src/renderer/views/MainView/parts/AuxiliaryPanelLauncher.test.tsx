import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { AuxiliaryPanelLauncher } from "./AuxiliaryPanelLauncher";

const homeProject: Project = {
  id: HOME_PROJECT_ID,
  name: "Home",
  location: { kind: "windows", path: "C:\\Users\\Tester" },
  disabled: true,
  createdAt: "2026-08-25T00:00:00.000Z",
};

const realProject: Project = {
  id: "project-a",
  name: "Project A",
  location: { kind: "windows", path: "D:\\Work\\ProjectA" },
  createdAt: "2026-08-25T00:00:00.000Z",
};

describe("AuxiliaryPanelLauncher", () => {
  beforeEach(() => {
    useAppStore.setState({
      projects: [homeProject],
      threads: [],
      view: { kind: "home" },
      focusedPaneId: null,
    });
    usePanelStore.setState({
      auxiliaryPanelTab: null,
      auxiliaryPanelTabs: [],
      rightPanelTab: "harness",
      gitReviewContext: null,
      gitReviewAsPanel: false,
    });
  });

  it("opens the existing project flow when Review is selected without a repository", () => {
    render(<AuxiliaryPanelLauncher />);

    const reviewButton = screen.getByRole("button", { name: /Review|审查|审阅/u });
    expect(reviewButton).toBeEnabled();
    fireEvent.click(reviewButton);

    expect(usePanelStore.getState().createProjectModalOpen).toBe(true);
    expect(usePanelStore.getState().gitReviewContext).toBeNull();
  });

  it("opens review for the first real project when the current scope is Home", () => {
    useAppStore.setState({ projects: [homeProject, realProject] });
    render(<AuxiliaryPanelLauncher />);

    const reviewButton = screen.getByRole("button", { name: /Review|审查|审阅/u });
    expect(reviewButton).toBeEnabled();
    fireEvent.click(reviewButton);

    expect(usePanelStore.getState()).toMatchObject({
      auxiliaryPanelTab: "git",
      auxiliaryPanelTabs: ["git"],
      rightPanelTab: "git",
      gitReviewContext: { projectId: realProject.id },
      gitReviewAsPanel: true,
    });
  });

  it("uses the selected project for the native Files panel", () => {
    const secondProject: Project = { ...realProject, id: "project-b", name: "Project B" };
    useAppStore.setState({ projects: [homeProject, realProject, secondProject] });
    render(<AuxiliaryPanelLauncher />);

    fireEvent.change(screen.getByRole("combobox", { name: "Project scope" }), {
      target: { value: secondProject.id },
    });
    fireEvent.click(screen.getByRole("button", { name: /Files/u }));

    expect(usePanelStore.getState()).toMatchObject({
      auxiliaryPanelTab: "files",
      auxiliaryPanelTabs: ["files"],
      rightPanelTab: "files",
      filesPanelContext: {
        projectId: secondProject.id,
        projectName: secondProject.name,
      },
    });
  });
});
