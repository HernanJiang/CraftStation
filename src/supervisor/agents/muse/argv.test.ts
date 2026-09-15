import { describe, expect, it } from "vitest";
import { buildMuseArgs, buildMuseConfigFlags, buildMuseResumeArgs, buildMuseServeCommand } from "./argv";
import { museDefaultCapabilities } from "./detection";
import { MUSE_FOREIGN_SETTINGS_JSON_ENV } from "./foreignEndpoint";

describe("buildMuseConfigFlags", () => {
  it("always includes --trust-workspace", () => {
    expect(buildMuseConfigFlags({} as any)).toEqual(["--trust-workspace"]);
  });

  it("maps model and effort", () => {
    expect(buildMuseConfigFlags({ model: "muse-spark-1.2", effort: "xhigh" } as any)).toEqual([
      "--trust-workspace",
      "--model",
      "muse-spark-1.2",
      "--reasoning-effort",
      "xhigh",
    ]);
  });

  it("strips catalog provider prefixes from --model", () => {
    expect(
      buildMuseConfigFlags({ model: "opencode-go/muse-spark-1.3-contributor" } as any),
    ).toEqual(["--trust-workspace", "--model", "muse-spark-1.3-contributor"]);
  });

  it("maps untrusted / on-request / never approval modes", () => {
    for (const policy of ["untrusted", "on-request", "never"] as const) {
      const args = buildMuseConfigFlags({ approvalPolicy: policy } as any);
      expect(args).toEqual(["--trust-workspace", "--approval-mode", policy]);
      expect(args).not.toContain("--yolo");
    }
  });

  it("maps yolo / bypassPermissions to --yolo", () => {
    for (const policy of ["yolo", "bypassPermissions"] as const) {
      const args = buildMuseConfigFlags({ approvalPolicy: policy } as any);
      expect(args).toContain("--yolo");
      expect(args).not.toContain("--approval-mode");
    }
  });

  it("emits --yolo for Muse's default approval policy", () => {
    const args = buildMuseConfigFlags({
      approvalPolicy: museDefaultCapabilities.defaultApprovalPolicy,
    } as any);
    expect(museDefaultCapabilities.defaultApprovalPolicy).toBe("yolo");
    expect(args).toContain("--yolo");
    expect(args).not.toContain("--approval-mode");
  });
});

describe("buildMuseArgs", () => {
  it("appends a non-empty prompt as a trailing positional", () => {
    expect(buildMuseArgs({ model: "muse-spark-1.1" } as any, "hello")).toEqual([
      "--trust-workspace",
      "--model",
      "muse-spark-1.1",
      "hello",
    ]);
  });

  it("omits an empty / whitespace prompt", () => {
    expect(buildMuseArgs({} as any, "   ")).toEqual(["--trust-workspace"]);
    expect(buildMuseArgs({} as any)).toEqual(["--trust-workspace"]);
  });
});

describe("buildMuseResumeArgs", () => {
  it("emits resume <uuid> plus config flags", () => {
    expect(
      buildMuseResumeArgs("966713f1-794f-480e-aa37-713e8387fe8e", {
        model: "muse-spark-1.2",
        effort: "high",
        approvalPolicy: "on-request",
      } as any),
    ).toEqual([
      "resume",
      "966713f1-794f-480e-aa37-713e8387fe8e",
      "--trust-workspace",
      "--model",
      "muse-spark-1.2",
      "--reasoning-effort",
      "high",
      "--approval-mode",
      "on-request",
    ]);
  });

  it("maps bypass to --yolo on resume", () => {
    const args = buildMuseResumeArgs("sess", { approvalPolicy: "yolo" } as any);
    expect(args.slice(0, 2)).toEqual(["resume", "sess"]);
    expect(args).toContain("--yolo");
  });

  it("resumes with --yolo when using the Muse default approval policy", () => {
    const args = buildMuseResumeArgs("sess", {
      approvalPolicy: museDefaultCapabilities.defaultApprovalPolicy,
    } as any);
    expect(args).toEqual(["resume", "sess", "--trust-workspace", "--yolo"]);
  });
});

describe("buildMuseServeCommand", () => {
  it("does not use a login/interactive WSL shell for muse serve", () => {
    const spec = buildMuseServeCommand(
      { kind: "wsl", distro: "Ubuntu", linuxPath: "/home/demo/repo", uncPath: "\\\\wsl$\\Ubuntu\\home\\demo\\repo" },
      "/home/demo/.local/bin/muse",
      {
        XDG_CONFIG_HOME: "/tmp/muse-iso",
        [MUSE_FOREIGN_SETTINGS_JSON_ENV]: "{\"provider\":\"meta\"}",
      },
    );
    expect(spec.command.toLowerCase()).toContain("wsl");
    expect(spec.args).not.toContain("-l");
    expect(spec.args).not.toContain("-i");
    const script = spec.args.at(-1) ?? "";
    expect(script).toContain("muse");
    expect(script).toContain("serve");
    expect(script).toContain("settings.json");
    expect(script).toContain("getent passwd");
    expect(script).toContain("HOME=");
  });

  it("exports an explicit HTTP_PROXY into the WSL muse serve script", () => {
    const spec = buildMuseServeCommand(
      { kind: "wsl", distro: "Ubuntu", linuxPath: "/home/demo/repo", uncPath: "\\\\wsl$\\Ubuntu\\home\\demo\\repo" },
      "muse",
      { HTTP_PROXY: "http://127.0.0.1:7897", HTTPS_PROXY: "http://127.0.0.1:7897" },
    );
    const script = spec.args.at(-1) ?? "";
    expect(script).toContain("export HTTP_PROXY='http://127.0.0.1:7897'");
    expect(script).toContain("export HTTPS_PROXY='http://127.0.0.1:7897'");
  });
});
