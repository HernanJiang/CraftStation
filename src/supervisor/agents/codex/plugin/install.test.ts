import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecFileSync = vi.hoisted(() =>
  vi.fn<(command: string, args?: string[], options?: Record<string, unknown>) => string | Buffer>(),
);

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFileSync: mockExecFileSync,
  };
});

import {
  breakPrivateHostStateLink,
  buildWslCodexHomeSeedScript,
  codexHooksFeatureFlagForSemver,
  getCodexPluginPaths,
  isCodexSemverSupportedForGoals,
  isCodexSemverSupportedForHooks,
  mergeCodexHooksDocument,
  parseCodexVersionLine,
  probeCodexCliSemver,
  seedNativeCodexHome,
  shouldLinkHostCodexStateFile,
} from "./install";
import { buildNativeHookCommandHead } from "../../plugin/installerBase";

const forwardPath = "C:\\Users\\demo\\.craftstation\\agent-plugins\\codex\\forward.mjs";
const forwardPathUnix = "/home/demo/.craftstation/agent-plugins/codex/forward.mjs";

/**
 * Test helpers build a `commandHead` matching one of the two shapes
 * `mergeCodexHooksDocument` accepts: WSL (`<node-path> <forward-mjs-path>`)
 * or native (`<wrapper-path>`). The merger doesn't care which shape it
 * gets — it just appends ` <event>`.
 */
function wslCommandHead(fp: string): string {
  return `${JSON.stringify("/home/demo/.nvm/versions/node/v22.11.0/bin/node")} ${JSON.stringify(fp)}`;
}

function nativeCommandHead(wrapperPath: string): string {
  return buildNativeHookCommandHead(wrapperPath);
}

function commandFor(head: string, event: string): string {
  return `${head} ${event}`;
}

const originalPlatform = process.platform;

beforeEach(() => {
  mockExecFileSync.mockReset();
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
});

describe("getCodexPluginPaths", () => {
  it("places Codex hooks under CraftStation's private CODEX_HOME", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "craftstation-codex-paths-"));
    const paths = getCodexPluginPaths({ envKind: "posix", baseDir });

    expect(paths.pluginDir).toBe(join(baseDir, "agent-plugins", "codex"));
    expect(paths.codexHomeDir).toBe(join(baseDir, "agent-plugins", "codex", "home"));
    expect(paths.codexHooksPath).toBe(
      join(baseDir, "agent-plugins", "codex", "home", "hooks.json"),
    );
  });
});

describe("probeCodexCliSemver", () => {
  it("does not use shell:true for Windows version probes", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mockExecFileSync.mockReturnValue("codex-cli 0.130.0");

    expect(probeCodexCliSemver()).toEqual([0, 130, 0]);

    const options = mockExecFileSync.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options).toMatchObject({
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
    expect(options).not.toHaveProperty("shell");
  });
});

describe("parseCodexVersionLine + isCodexSemverSupportedForHooks", () => {
  it("parses codex-cli semver lines", () => {
    expect(parseCodexVersionLine("codex-cli 0.122.0")).toEqual([0, 122, 0]);
    expect(parseCodexVersionLine("codex-cli 0.121.99")).toEqual([0, 121, 99]);
    expect(parseCodexVersionLine("  codex-cli 1.0.0  ")).toEqual([1, 0, 0]);
  });

  it("returns null for unexpected output", () => {
    expect(parseCodexVersionLine("codex 0.122.0")).toBeNull();
    expect(parseCodexVersionLine("")).toBeNull();
  });

  it("gates hooks support at 0.122.0", () => {
    expect(isCodexSemverSupportedForHooks([0, 121, 0])).toBe(false);
    expect(isCodexSemverSupportedForHooks([0, 121, 99])).toBe(false);
    expect(isCodexSemverSupportedForHooks([0, 122, 0])).toBe(true);
    expect(isCodexSemverSupportedForHooks([0, 123, 0])).toBe(true);
    expect(isCodexSemverSupportedForHooks(null)).toBe(false);
  });

  it("uses the renamed hooks feature flag from 0.130.0 onward", () => {
    expect(codexHooksFeatureFlagForSemver([0, 129, 99])).toBe("codex_hooks");
    expect(codexHooksFeatureFlagForSemver([0, 130, 0])).toBe("hooks");
    expect(codexHooksFeatureFlagForSemver([0, 131, 0])).toBe("hooks");
    expect(codexHooksFeatureFlagForSemver([1, 0, 0])).toBe("hooks");
    expect(codexHooksFeatureFlagForSemver(null)).toBe("codex_hooks");
  });

  it("gates the goals feature flag at 0.130.0", () => {
    expect(isCodexSemverSupportedForGoals([0, 129, 99])).toBe(false);
    expect(isCodexSemverSupportedForGoals([0, 130, 0])).toBe(true);
    expect(isCodexSemverSupportedForGoals([1, 0, 0])).toBe(true);
    expect(isCodexSemverSupportedForGoals(null)).toBe(false);
  });
});

describe("shouldLinkHostCodexStateFile", () => {
  it("never links host config.toml or auth.json", () => {
    expect(shouldLinkHostCodexStateFile("C:\\Users\\demo\\.codex", "config.toml")).toBe(false);
    expect(shouldLinkHostCodexStateFile("C:\\Users\\demo\\.codex", "auth.json")).toBe(false);
    expect(shouldLinkHostCodexStateFile("C:\\Users\\demo\\.codex", "sessions")).toBe(true);
    expect(shouldLinkHostCodexStateFile("C:\\Users\\demo\\.codex", "session_index.jsonl")).toBe(
      true,
    );
  });
});

describe("breakPrivateHostStateLink", () => {
  const tempRoots: string[] = [];
  afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("unlinks a leftover private config.toml that points at the Router overlay", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-break-link-"));
    tempRoots.push(root);
    const hostHome = join(root, "host");
    const privateHome = join(root, "private");
    mkdirSync(hostHome, { recursive: true });
    mkdirSync(privateHome, { recursive: true });
    const hostConfig = join(hostHome, "config.toml");
    const privateConfig = join(privateHome, "config.toml");
    writeFileSync(hostConfig, 'model_provider = "codex-router"\n');
    let linked = true;
    try {
      require("node:fs").symlinkSync(hostConfig, privateConfig, "file");
    } catch {
      linked = false;
    }
    if (!linked) return;
    expect(breakPrivateHostStateLink(privateConfig, hostConfig)).toBe(true);
    expect(require("node:fs").existsSync(privateConfig)).toBe(false);
    expect(require("node:fs").readFileSync(hostConfig, "utf8")).toContain("codex-router");
  });

  it("leaves an independent private config.toml in place", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-keep-private-"));
    tempRoots.push(root);
    const hostConfig = join(root, "host.toml");
    const privateConfig = join(root, "private.toml");
    writeFileSync(hostConfig, "host");
    writeFileSync(privateConfig, "private");
    expect(breakPrivateHostStateLink(privateConfig, hostConfig)).toBe(false);
    expect(require("node:fs").readFileSync(privateConfig, "utf8")).toBe("private");
  });
});

describe("buildWslCodexHomeSeedScript", () => {
  it("never mkdir/touch/link host config.toml or auth.json", () => {
    const script = buildWslCodexHomeSeedScript({
      linuxCodexHome: "/home/demo/.craftstation/agent-plugins/codex/home",
      globalCodexHome: "/home/demo/.codex",
    });
    expect(script).not.toContain("mkdir -p '/home/demo/.codex/sessions'");
    expect(script).not.toContain("touch '/home/demo/.codex/session_index.jsonl'");
    expect(script).not.toContain("ln -s '/home/demo/.codex/config.toml'");
    expect(script).not.toContain("ln -s '/home/demo/.codex/auth.json'");
    expect(script).not.toContain("ln '/home/demo/.codex/config.toml'");
    expect(script).not.toContain("cp '/home/demo/.codex/config.toml'");
    expect(script).toContain(
      "rm -f '/home/demo/.craftstation/agent-plugins/codex/home/config.toml'",
    );
    expect(script).toContain("rm -f '/home/demo/.craftstation/agent-plugins/codex/home/auth.json'");
    expect(script).toContain("ln -s '/home/demo/.codex/sessions'");
  });
});

describe("seedNativeCodexHome", () => {
  const tempRoots: string[] = [];
  afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("does not create or overwrite host config.toml/auth.json", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-seed-native-"));
    tempRoots.push(root);
    const hostHome = join(root, "host");
    const privateHome = join(root, "private");
    mkdirSync(hostHome, { recursive: true });
    mkdirSync(privateHome, { recursive: true });
    const hostConfig = join(hostHome, "config.toml");
    const hostAuth = join(hostHome, "auth.json");
    writeFileSync(
      hostConfig,
      'model_provider = "codex-router"\nmodel_catalog_json = "catalog.json"\n',
    );
    writeFileSync(hostAuth, '{"tokens":{"access_token":"secret"}}');
    seedNativeCodexHome(privateHome, hostHome);
    expect(require("node:fs").readFileSync(hostConfig, "utf8")).toContain("codex-router");
    expect(require("node:fs").readFileSync(hostAuth, "utf8")).toContain("secret");
    expect(require("node:fs").existsSync(join(hostHome, "sessions"))).toBe(false);
    expect(require("node:fs").existsSync(join(hostHome, "session_index.jsonl"))).toBe(false);
  });

  it("breaks a leftover private config.toml symlink into the host overlay", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-seed-break-"));
    tempRoots.push(root);
    const hostHome = join(root, "host");
    const privateHome = join(root, "private");
    mkdirSync(hostHome, { recursive: true });
    mkdirSync(privateHome, { recursive: true });
    const hostConfig = join(hostHome, "config.toml");
    const privateConfig = join(privateHome, "config.toml");
    writeFileSync(hostConfig, 'model_provider = "codex-router"\n');
    let linked = true;
    try {
      require("node:fs").symlinkSync(hostConfig, privateConfig, "file");
    } catch {
      linked = false;
    }
    if (!linked) return;
    seedNativeCodexHome(privateHome, hostHome);
    expect(require("node:fs").existsSync(privateConfig)).toBe(false);
    expect(require("node:fs").lstatSync(privateConfig, { throwIfNoEntry: false })).toBeUndefined();
    expect(require("node:fs").readFileSync(hostConfig, "utf8")).toContain("codex-router");
  });
});

describe("mergeCodexHooksDocument", () => {
  it("creates only CraftStation entries when hooks.json was absent (WSL shape)", () => {
    const head = wslCommandHead(forwardPath);
    const doc = mergeCodexHooksDocument(null, head);
    expect(Object.keys(doc.hooks)).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PermissionRequest",
      "Stop",
    ]);
    const stop = doc.hooks.Stop as unknown[];
    expect(stop).toHaveLength(1);
    const stopHook = (stop[0] as { hooks: { command: string }[] }).hooks[0];
    expect(stopHook?.command).toBe(commandFor(head, "Stop"));
  });

  it("preserves user matcher groups and appends CraftStation", () => {
    const head = wslCommandHead(forwardPath);
    const userGroup = {
      matcher: "*",
      hooks: [{ type: "command", command: "node user-script.js" }],
    };
    const existing = {
      hooks: {
        Stop: [userGroup],
        SessionStart: [],
      },
    };
    const doc = mergeCodexHooksDocument(existing, head);
    const stop = doc.hooks.Stop as unknown[];
    expect(stop).toHaveLength(2);
    expect(stop[0]).toEqual(userGroup);
    const lc = (stop[1] as { hooks: { command: string }[] }).hooks[0];
    expect(lc?.command).toBe(commandFor(head, "Stop"));
  });

  it("prunes stale CraftStation groups by forward.mjs path fingerprint and replaces", () => {
    const head = wslCommandHead(forwardPath);
    const stale = {
      hooks: [
        {
          type: "command",
          command: `node "C:\\old\\.craftstation\\agent-plugins\\codex\\forward.mjs" Stop`,
        },
      ],
    };
    const existing = { hooks: { Stop: [stale] } };
    const doc = mergeCodexHooksDocument(existing, head);
    const stop = doc.hooks.Stop as unknown[];
    expect(stop).toHaveLength(1);
    const h = (stop[0] as { hooks: { command: string }[] }).hooks[0];
    expect(h?.command).toBe(commandFor(head, "Stop"));
  });

  it("prunes legacy CraftStation groups by native wrapper fingerprint", () => {
    const head = nativeCommandHead(
      "C:\\Users\\demo\\.craftstation\\agent-plugins\\codex\\craftstation-hook.cmd",
    );
    const stale = {
      hooks: [
        {
          type: "command",
          command: `"C:\\old\\.craftstation\\agent-plugins\\codex\\craftstation-hook.cmd" Stop`,
        },
      ],
    };
    const existing = { hooks: { Stop: [stale] } };
    const doc = mergeCodexHooksDocument(existing, head);
    const stop = doc.hooks.Stop as unknown[];
    expect(stop).toHaveLength(1);
    const h = (stop[0] as { hooks: { command: string }[] }).hooks[0];
    expect(h?.command).toBe(commandFor(head, "Stop"));
  });

  it("is idempotent when re-run with the same command head", () => {
    const head = wslCommandHead(forwardPathUnix);
    const first = mergeCodexHooksDocument(null, head);
    const second = mergeCodexHooksDocument(first, head);
    expect(second).toEqual(first);
  });

  it("is idempotent when re-run with the same Windows forward path", () => {
    const first = mergeCodexHooksDocument(null, forwardPath);
    const second = mergeCodexHooksDocument(first, forwardPath);
    expect(second).toEqual(first);
  });

  it("uses matcher only for SessionStart, PreToolUse, PostToolUse", () => {
    const doc = mergeCodexHooksDocument(null, forwardPath);
    expect((doc.hooks.SessionStart as { matcher?: string }[])[0]).toMatchObject({
      matcher: "*",
    });
    expect((doc.hooks.UserPromptSubmit as { matcher?: string }[])[0]?.matcher).toBeUndefined();
    expect((doc.hooks.PermissionRequest as { matcher?: string }[])[0]?.matcher).toBeUndefined();
    expect((doc.hooks.Stop as { matcher?: string }[])[0]?.matcher).toBeUndefined();
  });
});
