import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatusResult, Project } from "@/shared/contracts";

const bridgeMock = vi.hoisted(() => ({
  getGitStatus: vi.fn<() => Promise<GitStatusResult>>(),
}));

vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridgeMock }));

vi.mock("@/renderer/state/gitRefresh", () => ({
  mightBeGitHubRemote: () => false,
  refreshGitProject: vi.fn<() => void>(),
  refreshSinglePr: vi.fn<() => void>(),
}));

vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: (selector: (state: { threadRemoveAction: "archive" }) => unknown) =>
    selector({ threadRemoveAction: "archive" }),
}));

vi.mock("@/renderer/components/common", () => ({ BranchSelector: () => null }));

vi.mock("@/renderer/views/MainView/parts/AppShell/AppShell", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return { SidebarContext: React.createContext(null) };
});

vi.mock("./GitReviewSidebar/GitReviewSidebar", () => ({
  GitReviewSidebar: (props: { onSelectFile: (path: string, staged: boolean) => void }) => (
    <button type="button" onClick={() => props.onSelectFile("src/app.tsx", false)}>
      Select changed file
    </button>
  ),
}));
vi.mock("./GitDiffContent/GitDiffContent", () => ({
  GitDiffContent: (props: {
    selectedFile: string | null;
    diffFilter: string;
    diffMode: number;
  }) => (
    <div data-testid="git-diff-content">
      {props.selectedFile ?? "all files"}:{props.diffFilter}:{props.diffMode}
    </div>
  ),
}));
vi.mock("./initGitRepository", () => ({
  addGitRemote: vi.fn<() => void>(),
  initGitRepository: vi.fn<() => void>(),
}));

vi.mock("@heroui/react", () => {
  const Tooltip = (props: { children: ReactNode }) => <>{props.children}</>;
  Tooltip.Trigger = (props: { children: ReactNode }) => <>{props.children}</>;
  Tooltip.Content = (props: { children: ReactNode }) => <>{props.children}</>;
  return { Tooltip, toast: { danger: vi.fn<() => void>() } };
});

import { useGitStore } from "@/renderer/state/gitStore";
import { GitReviewPanel } from "./GitReviewPanel";

const cleanStatus: GitStatusResult = {
  isRepo: true,
  branch: "main",
  tracking: "origin/main",
  hasRemote: true,
  remoteInfo: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  totalInsertions: 0,
  totalDeletions: 0,
  detail: "full",
};

describe("GitReviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGitStore.setState({
      statuses: {},
      worktreeStatuses: {},
      ghAvailable: {},
      prData: {},
      worktreeSourceInfo: {},
    });
  });

  it("refreshes an existing full status when the panel opens", async () => {
    const project: Project = {
      id: "remote-project",
      name: "Poracode",
      createdAt: new Date().toISOString(),
      location: {
        kind: "posix",
        path: "/Users/test/work/lightcode",
        remoteServerId: "remote-desktop",
      },
    };
    const currentStatus: GitStatusResult = {
      ...cleanStatus,
      unstaged: [
        {
          path: "README.md",
          status: "M",
          staged: false,
          insertions: 2,
          deletions: 0,
        },
      ],
      totalInsertions: 2,
    };
    useGitStore.getState().setStatus(project.id, cleanStatus);
    bridgeMock.getGitStatus.mockResolvedValue(currentStatus);

    render(
      <GitReviewPanel
        project={project}
        onClose={() => undefined}
        onExpandToOverlay={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(bridgeMock.getGitStatus).toHaveBeenCalledWith({
        projectLocation: project.location,
      });
      expect(useGitStore.getState().statuses[project.id]).toEqual(currentStatus);
    });
  });

  it("renders code changes on the left and files with commit controls on the right", () => {
    const project: Project = {
      id: "project-review-layout",
      name: "CraftStation",
      createdAt: new Date().toISOString(),
      location: { kind: "windows", path: "D:\\Work\\CraftStation" },
    };
    useGitStore.getState().setStatus(project.id, cleanStatus);
    bridgeMock.getGitStatus.mockResolvedValue(cleanStatus);

    const { container } = render(
      <GitReviewPanel
        project={project}
        onClose={() => undefined}
        onExpandToOverlay={() => undefined}
        hideHeader
      />,
    );

    expect(container.querySelector("[data-git-review-workspace]")).toBeInTheDocument();
    expect(container.querySelector("[data-git-review-diff]")).toContainElement(
      screen.getByTestId("git-diff-content"),
    );
    expect(container.querySelector("[data-git-review-files]")).toContainElement(
      screen.getByRole("button", { name: "Select changed file" }),
    );
    expect(screen.getByTestId("git-diff-content")).toHaveTextContent("all files:changes:4");

    fireEvent.click(screen.getByRole("button", { name: "Select changed file" }));
    expect(screen.getByTestId("git-diff-content")).toHaveTextContent("src/app.tsx:changes:4");

    fireEvent.click(screen.getByTitle("Split view"));
    expect(screen.getByTestId("git-diff-content")).toHaveTextContent("src/app.tsx:changes:1");
  });
});
