import { describe, expect, it } from "vitest";
import { resolveCapabilities } from "./capabilityResolver";
import type { McpServer, SkillEntry } from "@/shared/contracts";

function createServer(
  id: string,
  name: string,
  options: {
    enabled?: boolean;
    transport?: McpServer["transport"];
    origin?: McpServer["origin"];
  } = {},
): McpServer {
  return {
    id,
    name,
    description: `Test server ${name}`,
    enabled: options.enabled ?? true,
    timeoutMs: 30_000,
    transport: options.transport ?? { type: "stdio", command: "node", args: [], env: {} },
    origin: options.origin ?? "managed",
  };
}

function createSkill(
  id: string,
  name: string,
  options: { enabled?: boolean; valid?: boolean } = {},
): SkillEntry {
  return {
    id,
    name,
    description: `Test skill ${name}`,
    folderName: name,
    absolutePath: `/path/to/${name}`,
    skillFilePath: `/path/to/${name}/SKILL.md`,
    rootPath: `/path/to`,
    providerId: "craftstation",
    providerLabel: "CraftStation",
    scope: "global",
    scopeLabel: "Global",
    origin: "managed",
    enabled: options.enabled ?? true,
    valid: options.valid ?? true,
    portable: true,
    mutable: true,
    linked: false,
  };
}

describe("CapabilityResolver", () => {
  const mcpBrowser = createServer("browser", "browser");
  const mcpChrome = createServer("chrome", "chrome");
  const mcpDisabled = createServer("custom-tool", "custom-tool", { enabled: false });
  const mcpHttp = createServer("http-tool", "http-tool", {
    transport: { type: "http", url: "https://example.com/mcp", headers: {} },
  });

  const skillAlpha = createSkill("skill-alpha", "alpha");
  const skillBeta = createSkill("skill-beta", "beta");
  const skillDisabled = createSkill("skill-disabled", "disabled-skill", { enabled: false });

  it("resolves all enabled and compatible capabilities in Auto mode", async () => {
    const result = await resolveCapabilities({
      harnessKind: "codex",
      mode: "auto",
      candidateMcpServers: [mcpBrowser, mcpChrome, mcpDisabled, mcpHttp],
      availableSkills: [skillAlpha, skillBeta, skillDisabled],
      runtimeSupport: {
        supportedMcpTransports: ["stdio", "http"],
      },
    });

    expect(result.mode).toBe("auto");
    expect(result.mcpServers.map((s) => s.id)).toEqual(["browser", "chrome", "http-tool"]);
    expect(result.skills.map((s) => s.id)).toEqual(["skill-alpha", "skill-beta"]);
    expect(
      result.diagnostics.skipped.some((d) => d.id === "custom-tool" && d.reason === "disabled"),
    ).toBe(true);
    expect(
      result.diagnostics.skipped.some((d) => d.id === "skill-disabled" && d.reason === "disabled"),
    ).toBe(true);
  });

  it("filters out incompatible MCP transports based on runtimeSupport", async () => {
    const result = await resolveCapabilities({
      harnessKind: "antigravity",
      mode: "auto",
      candidateMcpServers: [mcpBrowser, mcpHttp],
      runtimeSupport: {
        supportedMcpTransports: ["stdio"], // HTTP not supported
      },
    });

    expect(result.mcpServers.map((s) => s.id)).toEqual(["browser"]);
    const skippedHttp = result.diagnostics.skipped.find((d) => d.id === "http-tool");
    expect(skippedHttp).toBeDefined();
    expect(skippedHttp?.reason).toBe("incompatible");
  });

  it("filters capabilities using HarnessProfile in Efficient mode", async () => {
    const customMcp = createServer("extra-mcp", "extra-mcp");
    const result = await resolveCapabilities({
      harnessKind: "grok",
      mode: "efficient",
      candidateMcpServers: [mcpBrowser, mcpChrome, customMcp],
      availableSkills: [skillAlpha, skillBeta],
    });

    expect(result.mode).toBe("efficient");
    // Grok recommended profile includes browser and app-controls
    expect(result.mcpServers.map((s) => s.id)).toEqual(["browser"]);
    expect(
      result.diagnostics.skipped.some(
        (d) => d.id === "chrome" && d.reason === "excluded-by-profile",
      ),
    ).toBe(true);
    expect(
      result.diagnostics.skipped.some(
        (d) => d.id === "extra-mcp" && d.reason === "excluded-by-profile",
      ),
    ).toBe(true);
  });

  it("resolves explicit IDs in Creative mode", async () => {
    const result = await resolveCapabilities({
      harnessKind: "codex",
      mode: "creative",
      candidateMcpServers: [mcpBrowser, mcpChrome, mcpDisabled],
      availableSkills: [skillAlpha, skillBeta],
      explicitMcpServerIds: ["chrome", "custom-tool", "non-existent"],
      explicitSkillIds: ["alpha"],
    });

    expect(result.mode).toBe("creative");
    expect(result.mcpServers.map((s) => s.id)).toEqual(["chrome"]);
    expect(result.skills.map((s) => s.id)).toEqual(["skill-alpha"]);

    expect(
      result.diagnostics.skipped.some((d) => d.id === "custom-tool" && d.reason === "disabled"),
    ).toBe(true);
    expect(
      result.diagnostics.skipped.some((d) => d.id === "non-existent" && d.reason === "not-found"),
    ).toBe(true);
  });

  it("maps Creative mode without explicit IDs to Efficient behavior", async () => {
    const customMcp = createServer("extra-mcp", "extra-mcp");
    const result = await resolveCapabilities({
      harnessKind: "grok",
      mode: "creative",
      candidateMcpServers: [mcpBrowser, customMcp],
    });

    expect(result.mode).toBe("efficient");
    expect(result.mcpServers.map((s) => s.id)).toEqual(["browser"]);
    expect(result.diagnostics.skipped.some((d) => d.id === "extra-mcp")).toBe(true);
  });

  it("skips every MCP when the runtime cannot receive MCP at a WSL project location", async () => {
    const result = await resolveCapabilities({
      harnessKind: "antigravity",
      mode: "auto",
      projectLocation: {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/demo/repo",
        uncPath: "\\\\wsl$\\Ubuntu\\home\\demo\\repo",
      },
      environment: { wsl: true, wslDistro: "Ubuntu" },
      candidateMcpServers: [mcpBrowser, mcpHttp],
      runtimeSupport: {
        supportedMcpTransports: ["stdio", "http"],
        supportsMcpInWsl: false,
      },
    });

    expect(result.mcpServers).toEqual([]);
    for (const server of [mcpBrowser, mcpHttp]) {
      const skipped = result.diagnostics.skipped.find((d) => d.id === server.id);
      expect(skipped?.reason).toBe("incompatible");
      expect(skipped?.details).toContain("WSL project");
    }
  });

  it("keeps MCP servers when the project location supports runtime MCP", async () => {
    const result = await resolveCapabilities({
      harnessKind: "codex",
      mode: "auto",
      projectLocation: { kind: "windows", path: "C:\\repo" },
      candidateMcpServers: [mcpBrowser],
      runtimeSupport: {
        supportedMcpTransports: ["stdio"],
        supportsMcpInWsl: false,
      },
    });

    expect(result.mcpServers.map((s) => s.id)).toEqual(["browser"]);
  });

  it("resolves available built-in MCPs in Auto mode and skips unavailable ones with reasons", async () => {
    const result = await resolveCapabilities({
      harnessKind: "codex",
      mode: "auto",
      builtInMcpCandidates: [
        { id: "computer-use", name: "computer_use", available: true },
        {
          id: "browser",
          name: "browser",
          available: false,
          unavailableReason: "launch endpoint is not configured.",
        },
      ],
    });

    expect(result.builtInMcpServerIds).toEqual(["computer-use"]);
    const skipped = result.diagnostics.skipped.find((d) => d.id === "browser");
    expect(skipped?.reason).toBe("not-available");
    expect(skipped?.details).toContain("not configured");
  });

  it("honours the Efficient harness profile when resolving built-in MCPs", async () => {
    const customMcp = createServer("extra-mcp", "extra-mcp");
    const result = await resolveCapabilities({
      harnessKind: "grok",
      mode: "efficient",
      builtInMcpCandidates: [{ id: "computer-use", name: "computer_use", available: true }],
      candidateMcpServers: [mcpBrowser, customMcp],
    });

    // Built-ins follow the same Auto/Efficient policy; the grok profile has no
    // computer-use exclusion, so the available built-in is resolved.
    expect(result.builtInMcpServerIds).toEqual(["computer-use"]);
    expect(result.diagnostics.skipped.find((d) => d.id === "computer-use")).toBeUndefined();
  });
});
