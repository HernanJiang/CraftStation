import { describe, expect, it } from "vitest";
import { windowsLocationAsWsl } from "./wslFallback";

describe("windowsLocationAsWsl", () => {
  it("maps a Windows project onto the distro DrvFs mount", () => {
    expect(
      windowsLocationAsWsl({ kind: "windows", path: "D:\\Work\\CraftStation" }, "Ubuntu"),
    ).toEqual({
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/mnt/d/Work/CraftStation",
      uncPath: "\\\\wsl.localhost\\Ubuntu\\mnt\\d\\Work\\CraftStation",
    });
  });

  it("returns undefined for a path that is not a drive letter", () => {
    expect(
      windowsLocationAsWsl({ kind: "windows", path: "\\\\share\\repo" }, "Ubuntu"),
    ).toBeUndefined();
  });
});
