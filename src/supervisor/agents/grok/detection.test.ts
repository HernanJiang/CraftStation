import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";

const authFileMock = vi.hoisted(() => ({ exists: false }));
const buildAgentCommandMock = vi.hoisted(() =>
  vi.fn<
    (
      location: ProjectLocation,
      command: string,
      args: string[],
      executablePath?: string,
    ) => { command: string; args: string[]; cwd?: string; env?: Record<string, string> }
  >(),
);
const probeAcpCapabilitiesMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);
const readDetectedVersionMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string | undefined>>(),
);

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: import("node:fs").PathLike) =>
      String(path).replaceAll("\\", "/").endsWith("/.grok/auth.json")
        ? authFileMock.exists
        : actual.existsSync(path),
  };
});

vi.mock("../base", async () => {
  const actual = await vi.importActual<typeof import("../base")>("../base");
  return {
    ...actual,
    buildAgentCommand: buildAgentCommandMock,
    readDetectedVersion: readDetectedVersionMock,
  };
});

vi.mock("../acp", async () => {
  const actual = await vi.importActual<typeof import("../acp")>("../acp");
  return { ...actual, probeAcpCapabilities: probeAcpCapabilitiesMock };
});

import {
  buildGrokProviderMetadata,
  grokDetectionSpec,
  mapGrokEffortCapabilities,
} from "./detection";

// Model `_meta` shapes as returned live by `grok agent stdio` 0.2.118
// (initialize/_meta.modelState and session/new `models.availableModels[]._meta`).
const GROK_45_META = {
  totalContextTokens: 500_000,
  agentType: "grok-build-plan",
  supportsReasoningEffort: true,
  reasoningEffort: "high",
  reasoningEfforts: [
    { id: "high", value: "high", label: "High Effort", default: true },
    { id: "medium", value: "medium", label: "Medium Effort", default: false },
    { id: "low", value: "low", label: "Low Effort", default: false },
  ],
};

// grok-4.6 as returned live by `grok agent stdio` 1.0.5. Note that it flags
// BOTH xhigh and high `default: true`; only `reasoningEffort` names the tier a
// session actually starts on.
const GROK_46_META = {
  totalContextTokens: 500_000,
  agentType: "grok-build-plan",
  supportsReasoningEffort: true,
  reasoningEffort: "high",
  reasoningEfforts: [
    { id: "xhigh", value: "xhigh", label: "Extra High Effort", default: true },
    { id: "high", value: "high", label: "High Effort", default: true },
    { id: "medium", value: "medium", label: "Medium Effort", default: false },
    { id: "low", value: "low", label: "Low Effort", default: false },
  ],
};

const MODEL_WITHOUT_EFFORT_META = {
  totalContextTokens: 200_000,
  agentType: "cursor",
};

beforeEach(() => {
  vi.clearAllMocks();
  buildAgentCommandMock.mockReturnValue({
    command: "/Users/demo/.local/share/fnm/node-versions/v24/bin/grok",
    args: ["--no-auto-update", "agent", "stdio"],
    cwd: "/Users/demo/project",
    env: { PATH: "/Users/demo/.local/share/fnm/node-versions/v24/bin:/usr/bin:/bin" },
  });
  probeAcpCapabilitiesMock.mockResolvedValue(undefined);
  readDetectedVersionMock.mockResolvedValue("1.0.46");
});

describe("Grok capability detection", () => {
  it("defaults new threads to the CraftStation GUI structured session", () => {
    expect(grokDetectionSpec.capabilities).toMatchObject({
      liveInputMode: "server",
      presentationMode: "gui",
      presentationModes: ["gui"],
    });
  });

  it("preserves ACP thinking model capabilities", async () => {
    probeAcpCapabilitiesMock.mockResolvedValue({
      models: [{ id: "grok-4.6", label: "Grok 4.6" }],
      thinkingModels: ["grok-4.6"],
    });

    const result = await grokDetectionSpec.capabilitiesProbe?.({
      location: { kind: "posix", path: "/repo" },
      executablePath: "grok",
    });

    expect(result?.thinkingModels).toEqual(["grok-4.6"]);
  });

  it("folds the advertised -build-fast variant into its base model", async () => {
    probeAcpCapabilitiesMock.mockResolvedValue({
      models: [
        { id: "grok-4.7", label: "Grok 4.7" },
        { id: "grok-4.7-build-fast", label: "Grok 4.7 Fast" },
        { id: "grok-4.6", label: "Grok 4.6" },
      ],
    });

    const result = await grokDetectionSpec.capabilitiesProbe?.({
      location: { kind: "posix", path: "/repo" },
      executablePath: "grok",
    });

    expect(result?.models?.map((model) => model.id)).toEqual(["grok-4.7", "grok-4.6"]);
    expect(result?.fastModels).toEqual(["grok-4.7", "grok-4.6"]);
    expect(result?.fastModelVariants).toEqual({ "grok-4.7": "grok-4.7-build-fast" });
  });

  it("offers Fast on grok-N bases even when the catalog omits the variant row", async () => {
    // Older CLIs (or a `session/new` model list that drops the sibling) never
    // advertise `grok-X-build-fast` — the Fast lane is a fixed vendor
    // convention, so the toggle must not disappear with the catalog row.
    probeAcpCapabilitiesMock.mockResolvedValue({
      models: [
        { id: "grok-4.7", label: "Grok 4.7" },
        { id: "grok-4.6", label: "Grok 4.6" },
        { id: "grok-code-fast-1", label: "Grok Code Fast" },
      ],
    });

    const result = await grokDetectionSpec.capabilitiesProbe?.({
      location: { kind: "posix", path: "/repo" },
      executablePath: "grok",
    });

    expect(result?.models?.map((model) => model.id)).toEqual([
      "grok-4.7",
      "grok-4.6",
      "grok-code-fast-1",
    ]);
    expect(result?.fastModels).toEqual(["grok-4.7", "grok-4.6"]);
    expect(result?.fastModelVariants).toBeUndefined();
  });

  it("forwards the login-shell environment to the ACP process", async () => {
    const location: ProjectLocation = { kind: "posix", path: "/Users/demo/project" };

    await grokDetectionSpec.capabilitiesProbe?.({
      location,
      executablePath: "/Users/demo/.local/share/fnm/node-versions/v24/bin/grok",
    });

    expect(probeAcpCapabilitiesMock).toHaveBeenCalledWith(
      "/Users/demo/.local/share/fnm/node-versions/v24/bin/grok",
      ["--no-auto-update", "agent", "stdio"],
      expect.any(String),
      expect.objectContaining({
        env: {
          PATH: "/Users/demo/.local/share/fnm/node-versions/v24/bin:/usr/bin:/bin",
        },
        label: "grok:posix",
        timeoutMs: 20_000,
      }),
    );
  });
});

describe("mapGrokEffortCapabilities", () => {
  it("derives ascending effort tiers and the advertised default", () => {
    const caps = mapGrokEffortCapabilities({
      "grok-4.5": GROK_45_META,
      "model-without-effort": MODEL_WITHOUT_EFFORT_META,
    });
    expect(caps.efforts).toEqual(["low", "medium", "high"]);
    expect(caps.defaultEffort).toBe("high");
  });

  it("gives models without tiers an explicit empty list so the picker hides effort", () => {
    const caps = mapGrokEffortCapabilities({
      "grok-4.5": GROK_45_META,
      "model-without-effort": MODEL_WITHOUT_EFFORT_META,
    });
    expect(caps.modelEfforts).toEqual({
      "grok-4.5": ["low", "medium", "high"],
      "model-without-effort": [],
    });
  });

  it("keeps unknown tier ids after the known ones in their original order", () => {
    const caps = mapGrokEffortCapabilities({
      m: {
        reasoningEfforts: [
          { id: "turbo", default: false },
          { id: "low", default: true },
          { id: "hyper", default: false },
        ],
      },
    });
    expect(caps.modelEfforts["m"]).toEqual(["low", "turbo", "hyper"]);
    expect(caps.defaultEffort).toBe("low");
  });

  it("prefers the advertised reasoningEffort when several tiers claim default", () => {
    const caps = mapGrokEffortCapabilities({
      "grok-4.6": GROK_46_META,
      "grok-4.5": GROK_45_META,
    });
    // grok-4.6 flags xhigh and high both `default: true`; `reasoningEffort`
    // breaks the tie the way the CLI itself does.
    expect(caps.defaultEffort).toBe("high");
    expect(caps.efforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(caps.modelEfforts).toEqual({
      "grok-4.6": ["low", "medium", "high", "xhigh"],
      "grok-4.5": ["low", "medium", "high"],
    });
  });

  it("falls back to the flagged tier when the model omits reasoningEffort", () => {
    const caps = mapGrokEffortCapabilities({
      m: {
        reasoningEfforts: [
          { id: "high", default: true },
          { id: "low", default: false },
        ],
      },
    });
    expect(caps.defaultEffort).toBe("high");
  });

  it("ignores a reasoningEffort that names no advertised tier", () => {
    const caps = mapGrokEffortCapabilities({
      m: {
        reasoningEffort: "ludicrous",
        reasoningEfforts: [
          { id: "high", default: true },
          { id: "low", default: false },
        ],
      },
    });
    expect(caps.defaultEffort).toBe("high");
  });

  it("returns empty capabilities when metadata is missing or malformed", () => {
    expect(mapGrokEffortCapabilities(undefined)).toEqual({ efforts: [], modelEfforts: {} });
    expect(mapGrokEffortCapabilities({ m: { reasoningEfforts: "nope" as unknown } })).toEqual({
      efforts: [],
      modelEfforts: { m: [] },
    });
  });
});

describe("buildGrokProviderMetadata", () => {
  it("maps the 0.2.x authenticate _meta fields, including team_name → organization", () => {
    expect(
      buildGrokProviderMetadata({
        email: "dev@example.com",
        auth_mode: "Oidc",
        subscription_tier: "X Premium+",
        team_name: "Acme",
        team_id: "t-1",
        is_zdr: false,
      }),
    ).toEqual({
      authenticatedAs: "dev@example.com",
      organization: "Acme",
      plan: "X Premium+",
      authMethod: "OIDC",
    });
  });

  it("omits organization when team_name is null (personal accounts)", () => {
    expect(buildGrokProviderMetadata({ email: "dev@example.com", team_name: null })).toEqual({
      authenticatedAs: "dev@example.com",
    });
  });
});

describe("Grok auth file detection", () => {
  const probe = grokDetectionSpec.authProbes?.[1];

  it("reports missing authentication after logout removes auth.json", async () => {
    authFileMock.exists = false;

    await expect(
      probe?.({ location: { kind: "posix", path: "/repo" }, executablePath: "grok" }),
    ).resolves.toBe("missing");
  });

  it("reports authentication while auth.json is present", async () => {
    authFileMock.exists = true;

    await expect(
      probe?.({ location: { kind: "posix", path: "/repo" }, executablePath: "grok" }),
    ).resolves.toBe("authenticated");
  });
});

describe("grokVersionProbe (managed account profiles)", () => {
  const ext = process.platform === "win32" ? ".exe" : "";
  const bin = process.platform === "win32" ? "grok.exe" : "grok";
  const dirs: string[] = [];
  const winLocation: ProjectLocation = { kind: "windows", path: "C:\\repo" };

  function makeProfile(accountsRoot: string, name: string, versions: string[]): void {
    const dir = join(accountsRoot, name, "bin");
    mkdirSync(dir, { recursive: true });
    for (const v of versions) writeFileSync(join(dir, `grok-${v}${ext}`), `v${v}`);
    writeFileSync(join(dir, bin), "canonical");
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reports the oldest managed binary, not the freshly updated wrapper", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "grok-detect-"));
    dirs.push(baseDir);
    const accountsRoot = join(baseDir, "craftstation-accounts");
    makeProfile(accountsRoot, "profile-a", ["1.0.5"]);
    makeProfile(accountsRoot, "profile-b", ["1.0.25", "1.0.46"]);

    const version = await grokDetectionSpec.versionProbe?.({
      location: winLocation,
      executablePath: "C:\\grok.cmd",
      baseDir,
    });

    expect(version).toBe("1.0.5");
  });

  it("falls back to the wrapper version when no managed profile has a binary", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "grok-detect-"));
    dirs.push(baseDir);
    mkdirSync(join(baseDir, "craftstation-accounts", "profile-empty"), {
      recursive: true,
    });

    const version = await grokDetectionSpec.versionProbe?.({
      location: winLocation,
      executablePath: "C:\\grok.cmd",
      baseDir,
    });

    expect(version).toBe("1.0.46");
  });
});
