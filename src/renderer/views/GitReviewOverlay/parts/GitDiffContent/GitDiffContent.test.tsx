import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFileChange, GitStatusResult, Project } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";

const bridgeMock = vi.hoisted(() => ({
  getGitDiffBatch:
    vi.fn<() => Promise<{ staged: Record<string, string>; unstaged: Record<string, string> }>>(),
}));

vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridgeMock }));
vi.mock("@/renderer/components/common", () => ({
  PixelLoader: () => <span data-testid="git-diff-loader">loading</span>,
}));
vi.mock("@/renderer/components/find/GitFindBar", () => ({ GitFindBar: () => null }));
vi.mock("../diffBuildClient", () => ({
  buildInWorker: vi.fn<() => Promise<never[]>>(async () => []),
  diffFileFromBundle: vi.fn<() => undefined>(),
  useDiffTheme: () => "dark",
}));
vi.mock("./parts/DiffSection", () => ({
  DiffSection: () => <div data-testid="batch-diff-section" />,
}));
vi.mock("./parts/SingleFileDiff", () => ({
  SingleFileDiff: (props: { filePath: string; staged: boolean; changedLines?: number }) => (
    <div data-testid="single-file-diff">
      {props.filePath}:{props.staged ? "staged" : "unstaged"}:{props.changedLines ?? 0}
    </div>
  ),
}));

import { GitDiffContent } from "./GitDiffContent";

const project: Project = {
  id: "project-review-performance",
  name: "CraftStation",
  createdAt: "2026-08-26T00:00:00.000Z",
  location: { kind: "windows", path: "D:\\Work\\CraftStation" },
};

function file(index: number): GitFileChange {
  return {
    path: `generated/file-${index}.ts`,
    status: "M",
    staged: false,
    insertions: 1,
    deletions: 0,
  };
}

function status(files: GitFileChange[]): GitStatusResult {
  return {
    isRepo: true,
    branch: "main",
    tracking: "origin/main",
    hasRemote: true,
    remoteInfo: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: files,
    totalInsertions: files.length,
    totalDeletions: 0,
  };
}

function renderContent(gitStatus: GitStatusResult, selectedFile: string | null = null) {
  return render(
    <GitDiffContent
      project={project}
      gitStatus={gitStatus}
      selectedFile={selectedFile}
      selectedStaged={false}
      diffMode={4}
      diffFilter="changes"
      refreshKey={0}
      worktreePath={undefined}
    />,
  );
}

describe("GitDiffContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMock.getGitDiffBatch.mockReturnValue(new Promise(() => undefined));
  });

  it("does not batch-load or mount thousands of diffs when review first opens", () => {
    renderContent(status(Array.from({ length: 7_863 }, (_, index) => file(index))));

    expect(bridgeMock.getGitDiffBatch).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId("batch-diff-section")).toHaveLength(0);
    expect(screen.queryByTestId("git-diff-loader")).not.toBeInTheDocument();
    expect(screen.getByText("Select a changed file to review its diff.")).toBeInTheDocument();
  });

  it("loads only the selected file and forwards its size guard", () => {
    const files = [file(0), { ...file(1), insertions: 320, deletions: 40 }];
    renderContent(status(files), files[1]!.path);

    expect(bridgeMock.getGitDiffBatch).not.toHaveBeenCalled();
    expect(screen.getByTestId("single-file-diff")).toHaveTextContent(
      "generated/file-1.ts:unstaged:360",
    );
  });
});
