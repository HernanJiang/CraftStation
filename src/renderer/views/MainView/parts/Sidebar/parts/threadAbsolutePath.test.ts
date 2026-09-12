import { describe, expect, it } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { threadAbsolutePath } from "./threadAbsolutePath";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "75f11173-eedc-470e-a5df-1b23c27a658e",
    projectId: "p1",
    title: "Thread",
    status: "inactive",
    done: false,
    starred: false,
    archived: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    agentKind: "codex",
    config: { model: "m" },
    ...overrides,
  } as unknown as Thread;
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "CraftStation",
    location: { kind: "windows", path: "C:\\repo" },
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as Project;
}

describe("threadAbsolutePath", () => {
  it("copies the worktree directory when the thread has one", () => {
    expect(
      threadAbsolutePath(thread({ worktreePath: "C:\\repo\\wt\\feature" }), project()),
    ).toBe("C:\\repo\\wt\\feature");
  });

  it("falls back to the project location (never the thread id)", () => {
    expect(threadAbsolutePath(thread(), project())).toBe("C:\\repo");
  });

  it("prefers the Windows-accessible UNC path for WSL projects", () => {
    expect(
      threadAbsolutePath(
        thread(),
        project({
          location: {
            kind: "wsl",
            distro: "Ubuntu",
            linuxPath: "/home/user/repo",
            uncPath: "\\\\wsl$\\Ubuntu\\home\\user\\repo",
          },
        }),
      ),
    ).toBe("\\\\wsl$\\Ubuntu\\home\\user\\repo");
  });
});
