import { describe, expect, it } from "vitest";
import { unwrapGitForWindowsConsoleWrapper } from "./exec";

describe("unwrapGitForWindowsConsoleWrapper", () => {
  it("rewrites Git for Windows cmd\\git.exe to mingw64\\bin\\git.exe", () => {
    const existing = new Set(["C:\\Program Files\\Git\\mingw64\\bin\\git.exe"]);
    expect(
      unwrapGitForWindowsConsoleWrapper("C:\\Program Files\\Git\\cmd\\git.exe", (path) =>
        existing.has(path),
      ),
    ).toBe("C:\\Program Files\\Git\\mingw64\\bin\\git.exe");
  });

  it("rewrites git.cmd next to a real git.exe", () => {
    expect(
      unwrapGitForWindowsConsoleWrapper(
        "C:\\tools\\git.cmd",
        (path) => path === "C:\\tools\\git.exe",
      ),
    ).toBe("C:\\tools\\git.exe");
  });

  it("leaves an already-real git.exe alone", () => {
    expect(unwrapGitForWindowsConsoleWrapper("C:\\Program Files\\Git\\mingw64\\bin\\git.exe")).toBe(
      "C:\\Program Files\\Git\\mingw64\\bin\\git.exe",
    );
  });
});
