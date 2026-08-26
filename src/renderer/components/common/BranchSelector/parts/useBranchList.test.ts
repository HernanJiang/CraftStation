import { describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { getActiveWorktreeBranchNames } from "./useBranchList";

function makeThread(overrides: Partial<Thread> & Pick<Thread, "id" | "projectId">): Thread {
  return {
    title: "Thread",
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getActiveWorktreeBranchNames", () => {
  it("returns sorted unique active worktree branches for the project", () => {
    const threads = [
      makeThread({ id: "t1", projectId: "p1", worktreeBranch: "feature/b" }),
      makeThread({ id: "t2", projectId: "p1", worktreeBranch: "feature/a" }),
      makeThread({ id: "thread-three", projectId: "p1", worktreeBranch: "feature/a" }),
      makeThread({ id: "t4", projectId: "p2", worktreeBranch: "feature/c" }),
      makeThread({ id: "t5", projectId: "p1", archived: true, worktreeBranch: "feature/d" }),
      makeThread({ id: "t6", projectId: "p1" }),
    ];

    expect(getActiveWorktreeBranchNames(threads, "p1")).toEqual(["feature/a", "feature/b"]);
  });

  it("ignores status-only thread updates", () => {
    const threads = [
      makeThread({ id: "t1", projectId: "p1", worktreeBranch: "feature/a" }),
      makeThread({ id: "t2", projectId: "p1", worktreeBranch: "feature/b" }),
    ];
    const updatedThreads = threads.map((thread) =>
      thread.id === "t1" ? { ...thread, status: "working" as const } : thread,
    );

    expect(getActiveWorktreeBranchNames(updatedThreads, "p1")).toEqual(
      getActiveWorktreeBranchNames(threads, "p1"),
    );
  });
});
