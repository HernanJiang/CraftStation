import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatusResult, Project } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useGitStore } from "@/renderer/state/gitStore";
import { DraftContextBar } from "./DraftContextBar";

const panelActions = vi.hoisted(() => ({
  showGitReviewPanel: vi.fn<(projectId: string, worktreePath?: string) => void>(),
}));
const bridgeMock = vi.hoisted(() => ({
  gitSwitchBranch: vi.fn<() => Promise<never>>(),
}));

vi.mock("@/renderer/actions/panelActions", () => panelActions);
vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridgeMock }));
vi.mock("@heroui/react", () => ({ toast: { danger: vi.fn<() => void>() } }));
vi.mock("./ProjectSwitchMenu", () => ({
  ProjectSwitchMenu: () => <button type="button">Project</button>,
}));
vi.mock("./CraftModeSwitch", () => ({
  CraftModeSwitch: () => <span>Craft mode</span>,
}));
vi.mock("@/renderer/components/common", () => ({
  BranchSelector: (props: { trigger?: ReactNode }) => <>{props.trigger}</>,
}));

const project: Project = {
  id: "project-1",
  name: "CraftStation",
  createdAt: new Date().toISOString(),
  location: { kind: "windows", path: "D:\\Work\\CraftStation" },
};

const gitStatus: GitStatusResult = {
  isRepo: true,
  branch: "feature/review-ui",
  tracking: "origin/feature/review-ui",
  hasRemote: true,
  remoteInfo: null,
  ahead: 2,
  behind: 1,
  staged: [],
  unstaged: [],
  totalInsertions: 0,
  totalDeletions: 0,
  detail: "full",
};

describe("DraftContextBar Git controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGitStore.setState({ statuses: {}, worktreeStatuses: {}, branches: {} });
  });

  it("shows the active branch and opens review for the current project", () => {
    useGitStore.getState().setStatus(project.id, gitStatus);

    render(
      <DraftContextBar project={project} craftMode="auto" onCraftModeChange={() => undefined} />,
    );

    expect(screen.getByRole("button", { name: "Switch branch" })).toHaveTextContent(
      "feature/review-ui",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Git review" }));
    expect(panelActions.showGitReviewPanel).toHaveBeenCalledWith(project.id, undefined);
  });

  it("keeps a worktree branch fixed and opens review in that worktree scope", () => {
    const worktreePath = "D:\\Worktrees\\review-ui";
    useGitStore.getState().setWorktreeStatus(worktreePath, gitStatus);

    render(
      <DraftContextBar
        project={project}
        worktreePath={worktreePath}
        craftMode="auto"
        onCraftModeChange={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: "Switch branch" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Open Git review" })[0]).toHaveTextContent(
      "feature/review-ui",
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Open Git review" })[1]!);
    expect(panelActions.showGitReviewPanel).toHaveBeenCalledWith(project.id, worktreePath);
  });
});
