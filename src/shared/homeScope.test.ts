import { describe, it, expect } from "vitest";
import {
  HOME_PROJECT_ID,
  HOME_PROJECT_NAME,
  isHomeProjectId,
  isHomeProject,
  isHomeScopeLocation,
  resolveThreadWorkspace,
} from "./homeScope";

describe("homeScope constants", () => {
  it("HOME_PROJECT_ID has expected value", () => {
    expect(HOME_PROJECT_ID).toBe("__craftstation_home__");
  });

  it("HOME_PROJECT_NAME has expected value", () => {
    expect(HOME_PROJECT_NAME).toBe("Home");
  });
});

describe("isHomeProjectId", () => {
  it("returns true for the home project id", () => {
    expect(isHomeProjectId("__craftstation_home__")).toBe(true);
  });

  it("returns false for a different id", () => {
    expect(isHomeProjectId("other-project")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isHomeProjectId(undefined)).toBe(false);
  });
});

describe("isHomeProject", () => {
  it("returns true for a project with the home id", () => {
    expect(isHomeProject({ id: "__craftstation_home__" })).toBe(true);
  });

  it("returns false for a project with a different id", () => {
    expect(isHomeProject({ id: "some-other-project" })).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isHomeProject(undefined)).toBe(false);
  });
});

describe("isHomeScopeLocation", () => {
  it("treats the user home directory as Home scope", () => {
    expect(isHomeScopeLocation({ kind: "windows", path: "C:\\Users\\me" })).toBe(true);
    expect(isHomeScopeLocation({ kind: "posix", path: "/home/me" })).toBe(true);
    expect(
      isHomeScopeLocation({
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/me",
        uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\me",
      }),
    ).toBe(true);
  });

  it("does not treat a repo under home as Home scope", () => {
    expect(isHomeScopeLocation({ kind: "windows", path: "C:\\Users\\me\\Documents" })).toBe(false);
    expect(isHomeScopeLocation({ kind: "windows", path: "C:\\repo" })).toBe(false);
    expect(isHomeScopeLocation({ kind: "posix", path: "/home/me/src/app" })).toBe(false);
  });
});

describe("resolveThreadWorkspace", () => {
  it("keeps real project locations unchanged", () => {
    expect(
      resolveThreadWorkspace({ kind: "windows", path: "D:\\Work\\CraftStation" }, "thread-1"),
    ).toBe("D:\\Work\\CraftStation");
    expect(resolveThreadWorkspace({ kind: "posix", path: "/srv/app" }, "thread-1")).toBe(
      "/srv/app",
    );
    expect(
      resolveThreadWorkspace(
        {
          kind: "wsl",
          distro: "Ubuntu",
          linuxPath: "/home/me/src/app",
          uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\me\\src\\app",
        },
        "thread-1",
      ),
    ).toBe("/home/me/src/app");
  });

  it("gives Home-scope threads a stable per-thread scratch dir, never the real home", () => {
    const workspace = resolveThreadWorkspace(
      { kind: "windows", path: "C:\\Users\\Haona" },
      "8f2b1c3e-1111-2222-3333-444455556666",
    );
    expect(workspace).toBe(
      "C:\\Users\\Haona/.craftstation/workspace-home/8f2b1c3e-1111-2222-3333-444455556666",
    );
    expect(workspace.startsWith("C:\\Users\\Haona")).toBe(true);
    expect(workspace).not.toBe("C:\\Users\\Haona");

    expect(resolveThreadWorkspace({ kind: "posix", path: "/home/me" }, "thread-9")).toBe(
      "/home/me/.craftstation/workspace-home/thread-9",
    );
    expect(
      resolveThreadWorkspace(
        {
          kind: "wsl",
          distro: "Ubuntu",
          linuxPath: "/home/me",
          uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\me",
        },
        "thread-9",
      ),
    ).toBe("/home/me/.craftstation/workspace-home/thread-9");
  });

  it("is stable for the same thread and distinct between threads", () => {
    const location = { kind: "windows" as const, path: "C:\\Users\\me" };
    expect(resolveThreadWorkspace(location, "thread-a")).toBe(
      resolveThreadWorkspace(location, "thread-a"),
    );
    expect(resolveThreadWorkspace(location, "thread-a")).not.toBe(
      resolveThreadWorkspace(location, "thread-b"),
    );
  });

  it("sanitizes unsafe thread id segments", () => {
    const workspace = resolveThreadWorkspace(
      { kind: "windows", path: "C:\\Users\\me" },
      "../../escape",
    );
    expect(workspace).toBe("C:\\Users\\me/.craftstation/workspace-home/..-..-escape");
  });
});
