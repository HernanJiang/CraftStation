import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { GitStatusResult } from "@/shared/contracts";
import { useGitStore } from "./gitStore";
import { useProjectGitCapabilities, useWorktreeGitCapabilities } from "./useGitCapabilities";

const baseStatus: GitStatusResult = {
  isRepo: true,
  branch: "main",
  tracking: "origin/main",
  hasRemote: true,
  remoteInfo: {
    url: "https://github.com/owner/repo.git",
    platform: "github",
    owner: "owner",
    repo: "repo",
  },
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  totalInsertions: 0,
  totalDeletions: 0,
};

function projectCaps(projectId: string) {
  return renderHook(() => useProjectGitCapabilities(projectId)).result.current;
}

function worktreeCaps(worktreePath: string | undefined, projectId: string) {
  return renderHook(() => useWorktreeGitCapabilities(worktreePath, projectId)).result.current;
}

describe("useProjectGitCapabilities", () => {
  beforeEach(() => {
    useGitStore.setState({
      statuses: {},
      worktreeStatuses: {},
      worktrees: {},
      branches: {},
      ghAvailable: {},
      prData: {},
    });
  });

  it("returns the empty shape for an unknown project", () => {
    expect(projectCaps("unknown")).toEqual({
      isRepo: false,
      hasRemote: false,
      isGitHub: false,
      remoteOwner: "",
      remoteRepo: "",
      hasBranch: false,
      isPushed: false,
    });
  });

  it("flattens remoteInfo into top-level GitHub identifiers", () => {
    useGitStore.getState().setStatus("p1", baseStatus);
    expect(projectCaps("p1")).toMatchObject({
      isRepo: true,
      hasRemote: true,
      isGitHub: true,
      remoteOwner: "owner",
      remoteRepo: "repo",
      hasBranch: true,
      isPushed: true,
    });
  });

  it("does not classify gitlab as GitHub but still reports hasRemote", () => {
    useGitStore.getState().setStatus("p1", {
      ...baseStatus,
      remoteInfo: {
        url: "https://gitlab.com/org/project.git",
        platform: "gitlab",
        owner: "org",
        repo: "project",
      },
    });
    const caps = projectCaps("p1");
    expect(caps.isGitHub).toBe(false);
    expect(caps.hasRemote).toBe(true);
    expect(caps.remoteOwner).toBe("org");
  });

  it("treats empty tracking as not-pushed even when ahead is 0", () => {
    useGitStore.getState().setStatus("p1", { ...baseStatus, tracking: "" });
    expect(projectCaps("p1").isPushed).toBe(false);
  });

  it("treats ahead > 0 as not-pushed", () => {
    useGitStore.getState().setStatus("p1", { ...baseStatus, ahead: 3 });
    expect(projectCaps("p1").isPushed).toBe(false);
  });

  it("treats a missing branch (detached HEAD) as hasBranch=false", () => {
    useGitStore.getState().setStatus("p1", { ...baseStatus, branch: "" });
    expect(projectCaps("p1").hasBranch).toBe(false);
  });

  it("does not gate isPushed on isRepo (derive() only checks tracking + ahead)", () => {
    // Regression-witness: derive() does not consider isRepo when computing
    // isPushed. Callers that need a hard "is this an actual repo" check
    // must read isRepo separately.
    useGitStore.getState().setStatus("p1", { ...baseStatus, isRepo: false });
    const caps = projectCaps("p1");
    expect(caps.isRepo).toBe(false);
    expect(caps.isPushed).toBe(true);
  });
});

describe("useWorktreeGitCapabilities", () => {
  beforeEach(() => {
    useGitStore.setState({
      statuses: {},
      worktreeStatuses: {},
      worktrees: {},
      branches: {},
      ghAvailable: {},
      prData: {},
    });
  });

  it("falls back to the project status when the worktree has no status", () => {
    useGitStore.getState().setStatus("p1", baseStatus);
    expect(worktreeCaps(undefined, "p1").isGitHub).toBe(true);
  });

  it("falls back to the project status when worktreePath is unknown", () => {
    useGitStore.getState().setStatus("p1", baseStatus);
    expect(worktreeCaps("/unknown/path", "p1").isGitHub).toBe(true);
  });

  it("uses the worktree status when available", () => {
    useGitStore.getState().setStatus("p1", baseStatus);
    useGitStore.getState().setWorktreeStatus("/wt/path", {
      ...baseStatus,
      branch: "feature/x",
      tracking: "",
      ahead: 2,
    });
    const caps = worktreeCaps("/wt/path", "p1");
    expect(caps.hasBranch).toBe(true);
    expect(caps.isPushed).toBe(false);
  });
});
