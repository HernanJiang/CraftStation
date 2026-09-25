import type { AgentKind, AgentStatusesResponse, ProjectLocation } from "@/shared/contracts";
import { getProjectAgentStatuses } from "@/shared/agentStatus";
import { applyPermissionMode } from "@/shared/agents/defaultPermissions";
import type { UnrestrictedPermissionConfig } from "@/shared/agents/unrestrictedPermissions";
import type { DefaultPermissionMode } from "@/shared/settings";

/**
 * Resolve the configured default permission posture for an agent in a given
 * location. Threads launched from automation (schedules, the app-controls MCP)
 * honor the same Settings → General default as user-created drafts — which
 * defaults to the provider's unrestricted posture so unattended runs never
 * stall on an approval prompt. On a lookup failure or unknown agent, fall back
 * to provider defaults rather than failing the launch.
 */
export async function resolveDefaultThreadPermissions(
  getAgentStatuses: (wslDistros: string[]) => Promise<AgentStatusesResponse>,
  agentKind: AgentKind,
  location: ProjectLocation,
  mode: DefaultPermissionMode,
): Promise<UnrestrictedPermissionConfig> {
  try {
    const statuses = await getAgentStatuses(location.kind === "wsl" ? [location.distro] : []);
    const agents = getProjectAgentStatuses(location, statuses.windows, statuses.wsl);
    const agent = agents.find((status) => status.kind === agentKind);
    if (!agent) return {};
    // `model` is required by ThreadConfig but irrelevant to permission fields.
    const resolved = applyPermissionMode(agent.capabilities, { model: "" }, mode);
    return {
      ...(resolved.approvalPolicy ? { approvalPolicy: resolved.approvalPolicy } : {}),
      ...(resolved.sandboxMode ? { sandboxMode: resolved.sandboxMode } : {}),
    };
  } catch {
    return {};
  }
}
