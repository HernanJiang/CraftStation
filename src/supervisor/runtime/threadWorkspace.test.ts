import { describe, expect, it, vi } from "vitest";
import { ensureThreadWorkspace } from "./threadWorkspace";

const mkdirSync = vi.hoisted(() =>
  vi.fn<(path: string, options: { recursive: boolean }) => void>(),
);
vi.mock("node:fs", () => ({ mkdirSync }));

describe("ensureThreadWorkspace", () => {
  it("creates only a Home-scope scratch workspace", () => {
    ensureThreadWorkspace(
      { kind: "windows", path: "C:\\Users\\me" },
      "C:\\Users\\me/.craftstation/workspace-home/t1",
    );
    expect(mkdirSync).toHaveBeenCalledWith("C:\\Users\\me/.craftstation/workspace-home/t1", {
      recursive: true,
    });
  });

  it("does not create real project directories implicitly", () => {
    mkdirSync.mockClear();
    ensureThreadWorkspace({ kind: "windows", path: "D:\\Work\\repo" }, "D:\\Work\\repo");
    expect(mkdirSync).not.toHaveBeenCalled();
  });
});
