export interface HarnessCapabilityProfile {
  harnessKind: string;
  recommendedMcpServerIds?: readonly string[];
  recommendedMcpServerNames?: readonly string[];
  excludedMcpServerIds?: readonly string[];
  recommendedSkillIds?: readonly string[];
  recommendedSkillNames?: readonly string[];
  excludedSkillIds?: readonly string[];
}

export const HARNESS_CAPABILITY_PROFILES: Record<string, HarnessCapabilityProfile> = {
  // Default-inject policy: `resolveCapabilities` injects every enabled MCP
  // server in Auto/Efficient modes; only `excludedMcpServerIds` removes one.
  // `recommendedMcpServerIds/Names` are informational affinity data and are
  // currently not enforced.
  codex: {
    harnessKind: "codex",
    recommendedMcpServerIds: ["browser", "chrome", "app-controls", "crossagents"],
    recommendedMcpServerNames: ["browser", "chrome", "craftstation", "crossagents"],
  },
  claude: {
    harnessKind: "claude",
    recommendedMcpServerIds: ["browser", "chrome", "app-controls", "crossagents"],
    recommendedMcpServerNames: ["browser", "chrome", "craftstation", "crossagents"],
  },
  gemini: {
    harnessKind: "gemini",
    recommendedMcpServerIds: ["browser", "chrome", "app-controls", "crossagents"],
    recommendedMcpServerNames: ["browser", "chrome", "craftstation", "crossagents"],
  },
  grok: {
    harnessKind: "grok",
    recommendedMcpServerIds: ["browser", "app-controls"],
    recommendedMcpServerNames: ["browser", "craftstation"],
  },
  opencode: {
    harnessKind: "opencode",
    recommendedMcpServerIds: ["browser", "app-controls"],
    recommendedMcpServerNames: ["browser", "craftstation"],
  },
  antigravity: {
    harnessKind: "antigravity",
    recommendedMcpServerIds: ["browser", "app-controls"],
    recommendedMcpServerNames: ["browser", "craftstation"],
  },
  commandcode: {
    harnessKind: "commandcode",
    recommendedMcpServerIds: ["browser", "app-controls"],
    recommendedMcpServerNames: ["browser", "craftstation"],
  },
};

export function getHarnessCapabilityProfile(
  harnessKind: string,
): HarnessCapabilityProfile | undefined {
  return HARNESS_CAPABILITY_PROFILES[harnessKind.toLowerCase()];
}
