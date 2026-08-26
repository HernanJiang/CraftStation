import { describe, expect, it } from "vitest";
import type { ProjectLocation } from "./contracts";
import { createLspFileUri, createLspFileUriFromAbsolutePath, createLspRootUri } from "./lsp";

describe("LSP file URI helpers", () => {
  it("builds POSIX project root and file URIs without double-prefixing slashes", () => {
    const location: ProjectLocation = { kind: "posix", path: "/Users/demo/my repo" };

    expect(createLspRootUri(location)).toBe("file:///Users/demo/my%20repo");
    expect(createLspFileUri(location, "src/app.ts")).toBe(
      "file:///Users/demo/my%20repo/src/app.ts",
    );
  });

  it("builds Windows file URIs with a leading drive slash", () => {
    const location: ProjectLocation = { kind: "windows", path: "C:\\Users\\demo\\repo" };

    expect(createLspRootUri(location)).toBe("file:///C:/Users/demo/repo");
    expect(createLspFileUri(location, "src\\app.ts")).toBe("file:///C:/Users/demo/repo/src/app.ts");
  });

  it("uses the Linux path for WSL projects", () => {
    const location: ProjectLocation = {
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/home/demo/repo",
      uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\repo",
    };

    expect(createLspRootUri(location)).toBe("file:///home/demo/repo");
    expect(createLspFileUri(location, "/src/app.ts")).toBe("file:///home/demo/repo/src/app.ts");
  });

  it("encodes reserved path characters inside file URI path segments", () => {
    expect(createLspFileUriFromAbsolutePath("/tmp/a#b/c?.ts")).toBe("file:///tmp/a%23b/c%3F.ts");
  });
});
