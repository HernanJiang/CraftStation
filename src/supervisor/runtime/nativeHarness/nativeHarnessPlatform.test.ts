import { afterEach, describe, expect, it } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import { buildAgentCommand } from "@/supervisor/agents/base";
import { clearAgentBinaryPathCache, primeAgentBinaryPath } from "@/supervisor/agents/binaryResolver";

afterEach(() => {
  clearAgentBinaryPathCache();
});

describe("Native Harness platform launch contract", () => {
  it("keeps Windows PTY launches on the host-native executable and environment", () => {
    const location: ProjectLocation = { kind: "windows", path: "C:\\repo" };
    const spec = buildAgentCommand(
      location,
      "C:\\Tools\\agy.exe",
      ["--interactive"],
      "C:\\Tools\\agy.exe",
      { HARNESS_PROFILE: "profile:antigravity" },
    );

    expect(spec.command).toBe("C:\\Tools\\agy.exe");
    expect(spec.args).toEqual(["--interactive"]);
    expect(spec.cwd).toBe("C:\\repo");
    expect(spec.env).toMatchObject({ HARNESS_PROFILE: "profile:antigravity" });
  });

  it("keeps POSIX PTY launches in the selected workspace", () => {
    const location: ProjectLocation = { kind: "posix", path: "/workspace/repo" };
    const spec = buildAgentCommand(
      location,
      "/usr/local/bin/agy",
      ["--interactive"],
      "/usr/local/bin/agy",
    );

    expect(spec).toMatchObject({
      command: "/usr/local/bin/agy",
      args: ["--interactive"],
      cwd: "/workspace/repo",
    });
  });

  it("uses the distro-native WSL binary and Linux workspace without copying host paths", () => {
    const location: ProjectLocation = {
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/home/haona/repo",
      uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\haona\\repo",
    };
    primeAgentBinaryPath("Ubuntu", "agy", "/usr/local/bin/agy");

    const spec = buildAgentCommand(
      location,
      "agy",
      ["--interactive"],
      "/usr/local/bin/agy",
      { HARNESS_PROFILE: "profile:antigravity" },
    );
    const script = spec.args.at(-1);

    expect(spec.command.toLowerCase()).toContain("wsl");
    expect(spec.args).toEqual(
      expect.arrayContaining(["-d", "Ubuntu", "--cd", "/home/haona/repo", "--exec"]),
    );
    expect(script).toContain("/usr/local/bin/agy");
    expect(script).toContain("HARNESS_PROFILE");
    expect(script).not.toContain("C:\\\\Users\\\\Haona");
    expect(script).not.toContain("\\\\wsl.localhost");
  });
});
