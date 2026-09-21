import type { AgentCapability, AgentTerminalAuthMethod, ProjectLocation } from "@/shared/contracts";
import { probeAcpCapabilities, type AcpProbeResult } from "../acp";
import {
  buildAgentCommand,
  envVarAuthProbe,
  type CapabilitiesProbeResult,
  type DetectionSpec,
} from "../base";
import { getAgentProbeCwd, resolveProbeSpawnCwd } from "../probeCwd";
import { MINIMAX_DEFAULT_MODEL_ID } from "./argv";

export const minimaxDefaultCapabilities: AgentCapability = {
  models: [{ id: MINIMAX_DEFAULT_MODEL_ID, label: "MiniMax M3" }],
  efforts: [],
  modelEfforts: {},
  modes: ["agent", "plan"],
  approvalPolicies: [
    { id: "default", label: "Ask Permissions" },
    { id: "auto", label: "Auto" },
    { id: "never", label: "Full Access" },
  ],
  sandboxModes: [],
  supportsResume: true,
  supportsOneShot: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  presentationModes: ["terminal", "gui"],
  defaultApprovalPolicy: "auto",
  bypassPermissions: { approvalPolicy: "never" },
  mcpScope: { terminal: "none", gui: "launch" },
  settingDefs: [],
};

export function buildMiniMaxCommand(
  location: ProjectLocation,
  args: string[],
  executablePath?: string,
) {
  return buildAgentCommand(location, "mcode", args, executablePath);
}

const terminalAuth: AgentTerminalAuthMethod = {
  id: "minimax-terminal-login",
  name: "Login",
  type: "terminal",
};

export function buildMiniMaxProbeCapabilities(
  probe: AcpProbeResult | undefined,
): CapabilitiesProbeResult {
  return {
    ...minimaxDefaultCapabilities,
    ...(probe?.models?.length ? { models: probe.models } : {}),
    ...(probe?.efforts?.length ? { efforts: probe.efforts } : {}),
    ...(probe?.modelEfforts ? { modelEfforts: probe.modelEfforts } : {}),
    ...(probe?.modelDefaultEfforts ? { modelDefaultEfforts: probe.modelDefaultEfforts } : {}),
    modes: [...new Set([...minimaxDefaultCapabilities.modes, ...(probe?.modes ?? [])])],
    ...(probe?.approvalPolicies?.length ? { approvalPolicies: probe.approvalPolicies } : {}),
    ...(probe?.slashCommands?.length ? { slashCommands: probe.slashCommands } : {}),
    authMethods: [terminalAuth],
    preferTerminalLogin: true,
    ...(probe?.authState ? { authState: probe.authState } : {}),
  };
}

async function probeCapabilities(
  location: ProjectLocation,
  executablePath: string,
  signal?: AbortSignal,
): Promise<CapabilitiesProbeResult> {
  const command = buildMiniMaxCommand(location, ["acp"], executablePath);
  const processCwd = resolveProbeSpawnCwd(location, command.cwd);
  const probe = await probeAcpCapabilities(
    command.command,
    command.args,
    getAgentProbeCwd(location),
    {
      ...(processCwd ? { processCwd } : {}),
      ...(command.env ? { env: command.env } : {}),
      timeoutMs: 20_000,
      ...(signal ? { signal } : {}),
      label:
        location.kind === "wsl" ? `minimax:wsl:${location.distro}` : `minimax:${location.kind}`,
    },
  );
  return buildMiniMaxProbeCapabilities(probe);
}

export const minimaxDetectionSpec: DetectionSpec = {
  kind: "minimax",
  label: "MiniMax Code",
  binary: "mcode",
  loginCommand: "mcode login",
  capabilities: minimaxDefaultCapabilities,
  update: { npm: "@minimax-ai/code" },
  authProbes: [envVarAuthProbe(["MINIMAX_API_KEY", "MCODE_PROVIDER_API_KEY"])],
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return undefined;
    return probeCapabilities(ctx.location, ctx.executablePath, ctx.signal);
  },
};
