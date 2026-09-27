import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { Project } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { SidebarArchivedProjects } from "./SidebarArchivedProjects";

vi.mock("@dnd-kit/react", () => ({
  useDraggable: () => undefined,
}));

vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({ ref: () => {} }),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({}),
}));

const project: Project = {
  id: "project-1",
  name: "agent-runtime",
  disabled: true,
  location: { kind: "posix", path: "/home/user/agent-runtime" },
  createdAt: "2026-06-01T00:00:00.000Z",
};

describe("SidebarArchivedProjects", () => {
  beforeEach(() => {
    useAppStore.setState({ projects: [project], threads: [] });
    useSidebarUiStore.setState({ archivedProjectsCollapsed: true });
  });

  it("keeps archived projects out of sight until the folder is opened", () => {
    render(<SidebarArchivedProjects projectIds={[project.id]} sortMode="updated" />);

    expect(screen.queryByText(project.name)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Archive/ }));
    expect(screen.getByText(project.name)).toBeInTheDocument();
  });
});
