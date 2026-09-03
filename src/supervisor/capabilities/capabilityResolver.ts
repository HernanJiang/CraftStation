import type { McpServer, McpRuntimeSupport, ProjectLocation, SkillEntry } from "@/shared/contracts";
import {
  isMcpServerSupportedByRuntime,
  supportsMcpAtProjectLocation,
} from "@/shared/contracts/mcpServer";
import type { CapabilityMode } from "@/shared/crafting/types";
import { getHarnessCapabilityProfile } from "./harnessProfiles";

export interface CapabilityResolutionInput {
  harnessKind: string;
  agentKind?: string | undefined;
  mode?: CapabilityMode | undefined;
  projectLocation?: ProjectLocation | undefined;
  environment?:
    | {
        wsl?: boolean | undefined;
        wslDistro?: string | undefined;
      }
    | undefined;
  candidateMcpServers?: readonly McpServer[] | undefined;
  availableSkills?: readonly SkillEntry[] | undefined;
  runtimeSupport?: McpRuntimeSupport | undefined;
  explicitMcpServerIds?: readonly string[] | undefined;
  explicitSkillIds?: readonly string[] | undefined;
}

export interface CapabilityDiagnosticItem {
  id: string;
  name: string;
  kind: "mcp" | "skill";
  reason: "disabled" | "incompatible" | "excluded-by-profile" | "not-available" | "not-found";
  details?: string | undefined;
}

export interface ResolvedCapabilities {
  mode: CapabilityMode;
  mcpServers: McpServer[];
  skills: SkillEntry[];
  diagnostics: {
    skipped: CapabilityDiagnosticItem[];
  };
}

export async function resolveCapabilities(
  input: CapabilityResolutionInput,
): Promise<ResolvedCapabilities> {
  const requestedMode: CapabilityMode = input.mode ?? "auto";
  // Manager plan: Creative maps to Efficient this version unless explicit IDs
  // are present, which keeps the fail-closed explicit-selection behavior.
  const mode: CapabilityMode =
    requestedMode === "creative" &&
    !input.explicitMcpServerIds?.length &&
    !input.explicitSkillIds?.length
      ? "efficient"
      : requestedMode;
  const harnessKind = input.harnessKind;
  const profile = getHarnessCapabilityProfile(harnessKind);
  const skipped: CapabilityDiagnosticItem[] = [];

  // --- 1. MCP Server Resolution ---
  const allCandidates = input.candidateMcpServers ?? [];
  let candidateServers: McpServer[] = [];

  if (mode === "creative" && input.explicitMcpServerIds && input.explicitMcpServerIds.length > 0) {
    const requestedIds = new Set(input.explicitMcpServerIds);
    const candidateMap = new Map(allCandidates.map((s) => [s.id, s]));
    for (const id of requestedIds) {
      const found = candidateMap.get(id);
      if (found) {
        if (found.enabled) {
          candidateServers.push(found);
        } else {
          skipped.push({
            id: found.id,
            name: found.name,
            kind: "mcp",
            reason: "disabled",
            details: `MCP server '${found.name}' is disabled in configuration.`,
          });
        }
      } else {
        skipped.push({
          id,
          name: id,
          kind: "mcp",
          reason: "not-found",
          details: `Requested MCP server id '${id}' not found.`,
        });
      }
    }
  } else {
    // Auto or Efficient (or Creative with no explicit IDs)
    const enabledServers = allCandidates.filter((s) => {
      if (!s.enabled) {
        skipped.push({
          id: s.id,
          name: s.name,
          kind: "mcp",
          reason: "disabled",
        });
        return false;
      }
      return true;
    });

    if (mode === "efficient" && profile) {
      candidateServers = enabledServers.filter((s) => {
        const isExcluded = profile.excludedMcpServerIds?.includes(s.id);
        if (isExcluded) {
          skipped.push({
            id: s.id,
            name: s.name,
            kind: "mcp",
            reason: "excluded-by-profile",
            details: `Excluded by profile for ${harnessKind}`,
          });
          return false;
        }

        const isRecommended =
          profile.recommendedMcpServerIds?.includes(s.id) ||
          profile.recommendedMcpServerNames?.includes(s.name.toLowerCase());

        if (profile.recommendedMcpServerIds || profile.recommendedMcpServerNames) {
          if (!isRecommended) {
            skipped.push({
              id: s.id,
              name: s.name,
              kind: "mcp",
              reason: "excluded-by-profile",
              details: `Not in recommended list for ${harnessKind}`,
            });
            return false;
          }
        }
        return true;
      });
    } else {
      candidateServers = enabledServers;
    }
  }

  // Compatibility & Environment Check for MCP
  const resolvedMcpServers: McpServer[] = [];
  // The runtime must be able to receive MCP servers at the project location at
  // all (e.g. runtimes without WSL MCP support cannot serve a WSL project);
  // otherwise resolution would claim a capability the launch cannot deliver.
  const locationSupportsMcp =
    !input.runtimeSupport ||
    !input.projectLocation ||
    supportsMcpAtProjectLocation(input.runtimeSupport, input.projectLocation);
  if (!locationSupportsMcp && input.projectLocation) {
    const environmentNote =
      input.projectLocation.kind === "wsl"
        ? `WSL project${input.environment?.wslDistro ? ` (${input.environment.wslDistro})` : ""}`
        : "current project location";
    for (const server of candidateServers) {
      skipped.push({
        id: server.id,
        name: server.name,
        kind: "mcp",
        reason: "incompatible",
        details: `MCP server '${server.name}' skipped: ${harnessKind} cannot receive MCP servers in the ${environmentNote}.`,
      });
    }
  }
  for (const server of locationSupportsMcp ? candidateServers : []) {
    if (input.runtimeSupport) {
      const isSupported = isMcpServerSupportedByRuntime(server, input.runtimeSupport);
      if (!isSupported) {
        skipped.push({
          id: server.id,
          name: server.name,
          kind: "mcp",
          reason: "incompatible",
          details: `MCP server '${server.name}' is incompatible with runtime support settings.`,
        });
        continue;
      }
    }
    resolvedMcpServers.push(server);
  }

  // --- 2. Skills Resolution ---
  const allSkills = input.availableSkills ?? [];
  let candidateSkills: SkillEntry[] = [];

  if (mode === "creative" && input.explicitSkillIds && input.explicitSkillIds.length > 0) {
    const requestedIds = new Set(input.explicitSkillIds.map((id) => id.toLowerCase()));
    for (const skill of allSkills) {
      if (requestedIds.has(skill.id.toLowerCase()) || requestedIds.has(skill.name.toLowerCase())) {
        if (skill.enabled && skill.valid) {
          candidateSkills.push(skill);
        } else {
          skipped.push({
            id: skill.id,
            name: skill.name,
            kind: "skill",
            reason: "disabled",
            details: `Skill '${skill.name}' is disabled or invalid.`,
          });
        }
      }
    }
  } else {
    // Auto or Efficient (or Creative with no explicit IDs)
    const activeSkills = allSkills.filter((skill) => {
      if (!skill.enabled || !skill.valid) {
        skipped.push({
          id: skill.id,
          name: skill.name,
          kind: "skill",
          reason: "disabled",
        });
        return false;
      }
      return true;
    });

    if (mode === "efficient" && profile) {
      candidateSkills = activeSkills.filter((skill) => {
        const isExcluded = profile.excludedSkillIds?.includes(skill.id);
        if (isExcluded) {
          skipped.push({
            id: skill.id,
            name: skill.name,
            kind: "skill",
            reason: "excluded-by-profile",
            details: `Excluded by profile for ${harnessKind}`,
          });
          return false;
        }
        if (profile.recommendedSkillIds || profile.recommendedSkillNames) {
          const isRecommended =
            profile.recommendedSkillIds?.includes(skill.id) ||
            profile.recommendedSkillNames?.includes(skill.name.toLowerCase());
          if (!isRecommended) {
            skipped.push({
              id: skill.id,
              name: skill.name,
              kind: "skill",
              reason: "excluded-by-profile",
            });
            return false;
          }
        }
        return true;
      });
    } else {
      candidateSkills = activeSkills;
    }
  }

  return {
    mode,
    mcpServers: resolvedMcpServers,
    skills: candidateSkills,
    diagnostics: {
      skipped,
    },
  };
}
