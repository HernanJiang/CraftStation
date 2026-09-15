import { describe, expect, it } from "vitest";
import type { AgentStatus, ProjectLocation } from "./contracts";
import {
  getLaunchableAgentStatuses,
  getProjectAgentStatuses,
  getSettingsInstalledAgents,
  resolveAgentPresentationMode,
} from "./agentStatus";

const capabilities = {
  models: [],
  efforts: [],
  modelEfforts: {},
  modes: [],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "terminal" as const,
  presentationMode: "terminal" as const,
  settingDefs: [],
};

function makeStatus(kind: AgentStatus["kind"], input: Partial<AgentStatus> = {}): AgentStatus {
  return {
    kind,
    label: kind,
    installed: true,
    authState: "unknown",
    capabilities,
    ...input,
  };
}

describe("resolveAgentPresentationMode", () => {
  it("replaces a stale terminal request for a GUI-only provider", () => {
    expect(
      resolveAgentPresentationMode(
        { presentationMode: "gui", presentationModes: ["gui"] },
        "terminal",
      ),
    ).toBe("gui");
  });

  it("preserves terminal when the provider still supports both surfaces", () => {
    expect(
      resolveAgentPresentationMode(
        { presentationMode: "gui", presentationModes: ["gui", "terminal"] },
        "terminal",
      ),
    ).toBe("terminal");
  });
});

describe("getProjectAgentStatuses", () => {
  it("returns windows statuses for windows projects", () => {
    const location: ProjectLocation = { kind: "windows", path: "C:\\repo" };
    const windowsStatuses = [makeStatus("codex")];

    expect(getProjectAgentStatuses(location, windowsStatuses, [makeStatus("claude")])).toEqual(
      windowsStatuses,
    );
  });

  it("returns only statuses for the matching WSL distro", () => {
    const location: ProjectLocation = {
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/home/demo/repo",
      uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\repo",
    };

    expect(
      getProjectAgentStatuses(
        location,
        [],
        [
          makeStatus("codex", { envKind: "wsl", envDistro: "Ubuntu" }),
          makeStatus("claude", { envKind: "wsl", envDistro: "Debian" }),
        ],
      ),
    ).toEqual([makeStatus("codex", { envKind: "wsl", envDistro: "Ubuntu" })]);
  });

  it("falls back to legacy WSL statuses without a distro tag", () => {
    const location: ProjectLocation = {
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/home/demo/repo",
      uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\repo",
    };
    const legacyStatuses = [makeStatus("gemini", { envKind: "wsl" })];

    expect(getProjectAgentStatuses(location, [], legacyStatuses)).toEqual(legacyStatuses);
  });
});

describe("getLaunchableAgentStatuses", () => {
  it("adds WSL-only Muse to a Windows project so Muse Spark can spawn Muse Code", () => {
    const location: ProjectLocation = { kind: "windows", path: "D:\\Work\\CraftStation" };
    const windowsStatuses = [makeStatus("opencode"), makeStatus("commandcode")];
    const wslMuse = makeStatus("muse", { envKind: "wsl", envDistro: "Ubuntu" });

    expect(
      getLaunchableAgentStatuses(location, windowsStatuses, [wslMuse]).map((status) => status.kind),
    ).toEqual(["opencode", "commandcode", "muse"]);
  });

  it("does not add other WSL-only CLIs to a Windows project", () => {
    const location: ProjectLocation = { kind: "windows", path: "D:\\Work\\CraftStation" };
    expect(
      getLaunchableAgentStatuses(
        location,
        [makeStatus("opencode")],
        [makeStatus("kimi", { envKind: "wsl", envDistro: "Ubuntu" })],
      ).map((status) => status.kind),
    ).toEqual(["opencode"]);
  });

  it("uses WSL Muse when Windows reports the adapter as not installed", () => {
    const location: ProjectLocation = { kind: "windows", path: "D:\\Work\\CraftStation" };
    const missingNative = makeStatus("muse", { envKind: "windows", installed: false });
    const wslMuse = makeStatus("muse", { envKind: "wsl", envDistro: "Ubuntu" });
    expect(
      getLaunchableAgentStatuses(location, [makeStatus("opencode"), missingNative], [wslMuse])
        .filter((status) => status.installed)
        .map((status) => status.kind),
    ).toEqual(["opencode", "muse"]);
  });

  it("prefers an installed Windows Muse over the WSL copy", () => {
    const location: ProjectLocation = { kind: "windows", path: "C:\\repo" };
    const nativeMuse = makeStatus("muse", { envKind: "windows", label: "Muse Native" });
    const wslMuse = makeStatus("muse", {
      envKind: "wsl",
      envDistro: "Ubuntu",
      label: "Muse WSL",
    });
    expect(getLaunchableAgentStatuses(location, [nativeMuse], [wslMuse])).toEqual([nativeMuse]);
  });
});

describe("getSettingsInstalledAgents", () => {
  it("includes WSL-only installed agents after native ones", () => {
    expect(
      getSettingsInstalledAgents(
        [makeStatus("codex", { envKind: "windows" })],
        [makeStatus("gemini", { envKind: "wsl", envDistro: "Ubuntu" })],
      ).map((status) => status.kind),
    ).toEqual(["codex", "gemini"]);
  });

  it("dedupes providers installed in both native and WSL, preferring native", () => {
    const nativeGemini = makeStatus("gemini", { envKind: "windows", label: "Gemini Native" });
    const wslGemini = makeStatus("gemini", {
      envKind: "wsl",
      envDistro: "Ubuntu",
      label: "Gemini WSL",
    });

    expect(getSettingsInstalledAgents([nativeGemini], [wslGemini])).toEqual([nativeGemini]);
  });

  it("keeps only the first WSL-installed entry for navigation when no native install exists", () => {
    const ubuntu = makeStatus("gemini", { envKind: "wsl", envDistro: "Ubuntu" });
    const debian = makeStatus("gemini", { envKind: "wsl", envDistro: "Debian" });

    expect(getSettingsInstalledAgents([], [ubuntu, debian])).toEqual([ubuntu]);
  });
});
