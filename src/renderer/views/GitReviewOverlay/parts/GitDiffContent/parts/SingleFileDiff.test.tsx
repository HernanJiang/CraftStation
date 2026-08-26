import { createRef } from "react";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";

const loadGitDiffForDisplayMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ result: { diff: string }; oldContent: string; newContent: string }>>(),
);

vi.mock("../../gitDiffLoader", () => ({
  loadGitDiffForDisplay: loadGitDiffForDisplayMock,
}));
vi.mock("../../diffBuildClient", () => ({
  buildInWorker: vi.fn<() => Promise<never[]>>(async () => []),
  diffFileFromBundle: vi.fn<() => undefined>(),
  extractDiffNames: () => ({ oldName: "src/app.ts", newName: "src/app.ts" }),
  getLang: () => "typescript",
  useDiffTheme: () => "dark",
}));
vi.mock("../../DiffAnnotationView", () => ({ DiffAnnotationView: () => null }));

import { SingleFileDiff } from "./SingleFileDiff";

const project: Project = {
  id: "project-single-diff",
  name: "CraftStation",
  createdAt: "2026-08-26T00:00:00.000Z",
  location: { kind: "windows", path: "D:\\Work\\CraftStation" },
};

function renderDiff(changedLines: number) {
  return render(
    <SingleFileDiff
      project={project}
      filePath="src/app.ts"
      staged={false}
      changedLines={changedLines}
      diffMode={4}
      refreshKey={0}
      containerRef={createRef<HTMLDivElement>()}
    />,
  );
}

describe("SingleFileDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not load a diff that exceeds the existing large-file guard", () => {
    renderDiff(501);

    expect(loadGitDiffForDisplayMock).not.toHaveBeenCalled();
    expect(screen.getByText("File too large to display")).toBeInTheDocument();
    expect(screen.getByText("501 lines changed")).toBeInTheDocument();
    expect(screen.queryByText("Loading diff...")).not.toBeInTheDocument();
  });

  it("leaves the loading state when a selected diff request fails", async () => {
    loadGitDiffForDisplayMock.mockRejectedValue(new Error("Timed out loading Git diff"));

    renderDiff(10);

    await waitFor(() => {
      expect(screen.getByText("Unable to load diff.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Loading diff...")).not.toBeInTheDocument();
  });
});
