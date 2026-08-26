import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Project, Thread } from "@/shared/contracts";
import { resolveProjectReorder, resolveThreadReorder, useDndHandlers } from "./useDndHandlers";

const showFilesPanel = vi.fn<(projectId: string, worktreePath?: string) => void>();
const showGitReviewPanel = vi.fn<(projectId: string, worktreePath?: string) => void>();
const showTerminalPanel = vi.fn<(projectId: string, worktreePath?: string) => void>();

vi.mock("@/renderer/actions/panelActions", () => ({
  showFilesPanel: (projectId: string, worktreePath?: string) =>
    showFilesPanel(projectId, worktreePath),
  showGitReviewPanel: (projectId: string, worktreePath?: string) =>
    showGitReviewPanel(projectId, worktreePath),
}));
vi.mock("@/renderer/actions/terminalActions", () => ({
  showTerminalPanel: (projectId: string, worktreePath?: string) =>
    showTerminalPanel(projectId, worktreePath),
}));

function makeThread(id: string, starred = false): Thread {
  return {
    id,
    projectId: "project-1",
    title: id,
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred,
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-03-21T10:00:00.000Z",
  };
}

function makeProject(id: string): Project {
  return {
    id,
    name: id,
    location: { kind: "posix", path: `/tmp/${id}` },
    createdAt: "2026-03-21T10:00:00.000Z",
  };
}

describe("resolveProjectReorder", () => {
  it("uses the hovered project when the sortable final index did not move", () => {
    expect(
      resolveProjectReorder({
        projects: [makeProject("a"), makeProject("b"), makeProject("c")],
        source: { type: "project", projectId: "a" },
        target: { type: "project", projectId: "c" },
        initialIndex: 0,
        finalIndex: 0,
      }),
    ).toEqual({ targetId: "c", placement: "after" });
  });

  it("falls back to the sortable final index when no hovered project is available", () => {
    expect(
      resolveProjectReorder({
        projects: [makeProject("a"), makeProject("b"), makeProject("c")],
        source: { type: "project", projectId: "c" },
        target: null,
        initialIndex: 2,
        finalIndex: 0,
      }),
    ).toEqual({ targetId: "a", placement: "before" });
  });
});

describe("resolveThreadReorder", () => {
  it("uses the hovered thread instead of the virtualized final index", () => {
    const threads = [makeThread("a"), makeThread("b", true), makeThread("c")];

    expect(
      resolveThreadReorder({
        threads,
        source: {
          type: "thread",
          threadId: "b",
          projectId: "project-1",
          sortGroup: "project-entries:project-1",
          sortIndex: 0,
        },
        target: {
          type: "thread",
          threadId: "c",
          projectId: "project-1",
          sortGroup: "project-entries:project-1",
          sortIndex: 2,
        },
        initialIndex: 0,
        finalIndex: 1,
      }),
    ).toEqual({ targetId: "c", placement: "after" });
  });

  it("falls back to the manual rendered order when no hovered thread is available", () => {
    const threads = [makeThread("a"), makeThread("b", true), makeThread("c")];

    expect(
      resolveThreadReorder({
        threads,
        source: {
          type: "thread",
          threadId: "b",
          projectId: "project-1",
          sortGroup: "project-entries:project-1",
          sortIndex: 0,
        },
        target: null,
        initialIndex: 0,
        finalIndex: 2,
      }),
    ).toEqual({ targetId: "c", placement: "after" });
  });
});

describe("useDndHandlers.handleMainPanelDrop", () => {
  function getHandler() {
    const { result } = renderHook(() => useDndHandlers());
    return result.current.handleMainPanelDrop;
  }

  function resetMocks() {
    showFilesPanel.mockReset();
    showGitReviewPanel.mockReset();
    showTerminalPanel.mockReset();
  }

  it("opens the files panel for a project drop (no worktree)", () => {
    resetMocks();
    getHandler()({ type: "project", projectId: "project-1" });
    expect(showFilesPanel).toHaveBeenCalledWith("project-1", undefined);
    expect(showGitReviewPanel).not.toHaveBeenCalled();
    expect(showTerminalPanel).not.toHaveBeenCalled();
  });

  it("opens the files panel for a worktree-group drop with worktreePath", () => {
    resetMocks();
    getHandler()({
      type: "worktree-group",
      projectId: "project-1",
      worktreePath: "/repo/.worktrees/feature",
      threadIds: [],
    });
    expect(showFilesPanel).toHaveBeenCalledWith("project-1", "/repo/.worktrees/feature");
  });

  it("dispatches sidebar-panel `files` to showFilesPanel", () => {
    resetMocks();
    getHandler()({
      type: "sidebar-panel",
      panel: "files",
      projectId: "project-1",
      worktreePath: "/repo/.worktrees/feature",
    });
    expect(showFilesPanel).toHaveBeenCalledWith("project-1", "/repo/.worktrees/feature");
    expect(showGitReviewPanel).not.toHaveBeenCalled();
  });

  it("dispatches sidebar-panel `git` to showGitReviewPanel", () => {
    resetMocks();
    getHandler()({
      type: "sidebar-panel",
      panel: "git",
      projectId: "project-1",
    });
    expect(showGitReviewPanel).toHaveBeenCalledWith("project-1", undefined);
    expect(showFilesPanel).not.toHaveBeenCalled();
  });

  it("dispatches sidebar-panel `terminal` to showTerminalPanel", () => {
    resetMocks();
    getHandler()({
      type: "sidebar-panel",
      panel: "terminal",
      projectId: "project-1",
      worktreePath: "/repo/.worktrees/feature",
    });
    expect(showTerminalPanel).toHaveBeenCalledWith("project-1", "/repo/.worktrees/feature");
    expect(showFilesPanel).not.toHaveBeenCalled();
    expect(showGitReviewPanel).not.toHaveBeenCalled();
  });
});
