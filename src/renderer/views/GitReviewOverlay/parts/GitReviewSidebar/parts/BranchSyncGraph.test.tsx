import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GitStatusResult } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { BranchSyncGraph } from "./BranchSyncGraph";

const status: GitStatusResult = {
  isRepo: true,
  branch: "feature/review-ui",
  tracking: "origin/feature/review-ui",
  hasRemote: true,
  remoteInfo: null,
  ahead: 3,
  behind: 2,
  staged: [],
  unstaged: [],
  totalInsertions: 0,
  totalDeletions: 0,
  detail: "full",
};

describe("BranchSyncGraph", () => {
  it("shows the truthful local and tracking branch topology", () => {
    render(<BranchSyncGraph gitStatus={status} />);

    expect(screen.getByText("feature/review-ui")).toBeInTheDocument();
    expect(screen.getByText("origin/feature/review-ui")).toBeInTheDocument();
    expect(screen.getByText("↓2 ↑3")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("does not render outside a repository", () => {
    const { container } = render(
      <BranchSyncGraph gitStatus={{ ...status, isRepo: false, branch: "" }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
