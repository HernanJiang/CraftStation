import { describe, expect, it, vi } from "vitest";
import type { ProjectLocation, ThreadConfig } from "@/shared/contracts";
import {
  buildDevinAcpArgs,
  buildDevinArgs,
  buildDevinPrintArgs,
  permissionModeForConfig,
} from "./argv";
import {
  buildDevinCommand,
  buildDevinProbeCapabilities,
  defaultDevinCapabilities,
  defaultHiddenDevinModels,
  DEVIN_DEFAULT_MODEL_ID,
  devinDetectionSpec,
  parseDevinModels,
} from "./detection";
import { createDevinAdapter } from "./index";
import { detectDevinTerminalStatus } from "./terminal";

const probeAcpCapabilitiesMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<undefined>>(),
);

vi.mock("../acp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../acp")>()),
  createAcpStructuredSession: vi.fn<() => undefined>(() => undefined),
  probeAcpCapabilities: probeAcpCapabilitiesMock,
}));

describe("Devin detection", () => {
  it("declares the native binary, updater, ACP defaults, and login", () => {
    expect(devinDetectionSpec).toMatchObject({
      kind: "devin",
      label: "Devin",
      binary: "devin",
      loginCommand: "devin auth login",
      versionArgs: ["--version"],
      update: {
        builtIn: { binary: "devin", args: ["update"] },
        homebrewCask: "devin-cli",
        latestVersionUrls: ["https://static.devin.ai/cli/current/manifest.json"],
      },
    });
    expect(devinDetectionSpec.update?.installer?.posix.args.join(" ")).toContain(
      "https://cli.devin.ai/install.sh",
    );
    expect(devinDetectionSpec.update?.installer?.windows.args.join(" ")).toContain(
      "https://static.devin.ai/cli/setup.ps1",
    );
    expect(devinDetectionSpec.capabilities).toMatchObject({
      liveInputMode: "server",
      presentationMode: "gui",
      presentationModes: ["gui", "terminal"],
      modes: ["agent", "plan"],
      defaultApprovalPolicy: "accept-edits",
      bypassPermissions: { approvalPolicy: "yolo" },
      supportsResume: true,
      supportsOneShot: true,
    });
    expect(defaultDevinCapabilities.models.map((model) => model.id)).toContain(
      DEVIN_DEFAULT_MODEL_ID,
    );
    expect(defaultDevinCapabilities.defaultHiddenModels).toEqual(
      defaultHiddenDevinModels(defaultDevinCapabilities.models),
    );
    expect(defaultDevinCapabilities.defaultHiddenModels).not.toContain(DEVIN_DEFAULT_MODEL_ID);
  });

  it("hides every discovered Devin model except the curated default", () => {
    const discovered = [
      { id: "swe", label: "SWE-1.6" },
      { id: "claude-opus-5-medium", label: "Claude Opus 5 Medium" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    ];
    const capabilities = buildDevinProbeCapabilities({ models: discovered });
    expect(capabilities.models).toEqual(discovered);
    expect(capabilities.defaultHiddenModels).toEqual([
      "claude-opus-5-medium",
      "claude-sonnet-5",
      "gemini-3.8-flash",
    ]);
  });

  it("hides the entire ACP catalog when the curated default is absent", () => {
    const discovered = [
      { id: "claude-opus-5-high", label: "Claude Opus 5 High" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    ];
    expect(buildDevinProbeCapabilities({ models: discovered }).defaultHiddenModels).toEqual([
      "claude-opus-5-high",
      "gemini-3.8-flash",
    ]);
  });

  it("uses the bypass permission id advertised by Devin ACP", () => {
    expect(
      buildDevinProbeCapabilities({
        approvalPolicies: [
          { id: "normal", label: "Normal" },
          { id: "dangerous", label: "Bypass" },
        ],
      }).bypassPermissions,
    ).toEqual({ approvalPolicy: "dangerous" });
  });

  it("parses JSON and line-oriented model lists", () => {
    expect(parseDevinModels('["opus","swe-1-6-fast"]')).toEqual([
      { id: "opus", label: "Opus" },
      { id: "swe-1-6-fast", label: "Swe 1 6 Fast" },
    ]);
    expect(parseDevinModels('{"models":[{"id":"sonnet","label":"Sonnet"}]}')).toEqual([
      { id: "sonnet", label: "Sonnet" },
    ]);
    expect(parseDevinModels("opus  Anthropic\nsonnet  Fast")).toEqual([
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" },
    ]);
  });
});

describe("buildDevinArgs", () => {
  const config = (patch: Partial<ThreadConfig> = {}): ThreadConfig => patch as ThreadConfig;

  it("maps model, accept-edits, and an initial prompt after --", () => {
    expect(
      buildDevinArgs(config({ model: "opus", approvalPolicy: "accept-edits" }), "fix the tests"),
    ).toEqual(["--model", "opus", "--permission-mode", "accept-edits", "--", "fix the tests"]);
  });

  it("maps bypass policies to yolo and omits permission-mode in plan", () => {
    expect(permissionModeForConfig(config({ approvalPolicy: "yolo" }))).toBe("yolo");
    expect(permissionModeForConfig(config({ approvalPolicy: "bypassPermissions" }))).toBe("yolo");
    expect(permissionModeForConfig(config({ approvalPolicy: "bypass" }))).toBe("yolo");
    expect(
      permissionModeForConfig(config({ mode: "plan", approvalPolicy: "yolo" })),
    ).toBeUndefined();
    expect(buildDevinArgs(config({ mode: "plan" }), "")).toEqual([]);
  });

  it("resumes a known session and falls back to --continue", () => {
    expect(buildDevinArgs(config(), "", "sess-1")).toEqual(["--resume", "sess-1"]);
    expect(buildDevinArgs(config(), "", "")).toEqual(["--continue"]);
  });

  it("builds ACP and non-interactive print argv", () => {
    expect(buildDevinAcpArgs(config({ model: "swe", approvalPolicy: "yolo" }))).toEqual([
      "--permission-mode",
      "yolo",
      "acp",
      "--model",
      "swe",
    ]);
    expect(buildDevinPrintArgs(config({ model: "opus" }), "summarize")).toEqual([
      "--print",
      "--respect-workspace-trust",
      "false",
      "--model",
      "opus",
      "--",
      "summarize",
    ]);
  });

  it("builds the ACP command against a resolved executable", () => {
    const location: ProjectLocation = { kind: "windows", path: "C:\\repo" };
    expect(buildDevinCommand(location, ["acp"], "C:\\bin\\devin.exe")).toMatchObject({
      command: "C:\\bin\\devin.exe",
      args: ["acp"],
      cwd: "C:\\repo",
    });
  });

  it("lets extra spawn env win over the resolved HTTP proxy", () => {
    const location: ProjectLocation = { kind: "windows", path: "C:\\repo" };
    expect(
      buildDevinCommand(location, ["acp"], "C:\\bin\\devin.exe", {
        HTTP_PROXY: "http://override:9",
      }).env,
    ).toMatchObject({ HTTP_PROXY: "http://override:9" });
  });
});

describe("createDevinAdapter", () => {
  it("exposes identity, updater, launch argv, and ACP session wiring", () => {
    const adapter = createDevinAdapter();
    expect(adapter.kind).toBe("devin");
    expect(adapter.binary).toBe("devin");
    expect(adapter.update).toMatchObject({
      builtIn: { binary: "devin", args: ["update"] },
      homebrewCask: "devin-cli",
      latestVersionUrls: ["https://static.devin.ai/cli/current/manifest.json"],
    });
    expect(
      adapter.buildLaunchArgv({ kind: "posix", path: "/repo" }, { model: "swe" }, "hi"),
    ).toEqual({
      binary: "devin",
      args: ["--model", "swe", "--", "hi"],
    });
    expect(
      adapter.buildResumeArgv({ kind: "posix", path: "/repo" }, {} as ThreadConfig, "", {
        providerSessionId: "abc",
        discoveredAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual({ binary: "devin", args: ["--resume", "abc"] });
    expect(adapter.buildOneShotCommand?.("opus", undefined, "title")).toMatchObject({
      command: "devin",
      args: expect.arrayContaining(["--print", "--model", "opus"]),
    });
  });

  it("builds the ACP logout command against the resolved binary", async () => {
    const adapter = createDevinAdapter();
    const command = await adapter.buildAcpLogoutCommand?.({ envKind: "windows" });
    expect(command).toBeDefined();
    const args = command?.args ?? [];
    const rendered = args.includes("-EncodedCommand")
      ? Buffer.from(args.at(-1) ?? "", "base64").toString("utf16le")
      : [command?.command, ...args].join(" ");
    expect(rendered).toMatch(/devin/i);
    expect(rendered).toContain("auth");
    expect(rendered).toContain("logout");
  });
});

describe("detectDevinTerminalStatus", () => {
  it("classifies working, approval, and idle frames", () => {
    expect(detectDevinTerminalStatus("Working on the patch (esc to cancel)")).toMatchObject({
      status: "working",
    });
    expect(detectDevinTerminalStatus("Allow this command? (y/N)")).toMatchObject({
      status: "needs_approval",
    });
    expect(detectDevinTerminalStatus("? for shortcuts")).toMatchObject({ status: "idle" });
  });
});
