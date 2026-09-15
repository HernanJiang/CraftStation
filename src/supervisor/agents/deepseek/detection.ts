import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentCapability, AgentTerminalAuthMethod, ProjectLocation } from "@/shared/contracts";
import { probeAcpCapabilities, type AcpProbeResult } from "../acp";
import {
  batchWslCommandsAsync,
  buildAgentCommand,
  envVarAuthProbe,
  type CapabilitiesProbeResult,
  type DetectionSpec,
} from "../base";
import { buildContextSizeCapabilities } from "../contextWindowLabel";
import { getAgentProbeCwd, resolveProbeSpawnCwd } from "../probeCwd";

export const DEEPSEEK_ACP_ARGS = ["--profile", "acp"] as const;
export const DEEPSEEK_SDK_ARGS = ["--profile", "sdk"] as const;

/** Official V4 / V4.1 Flash and Pro context window. */
export const DEEPSEEK_V4_CONTEXT_TOKENS = 1_000_000;

export const DEEPSEEK_FALLBACK_MODELS = [
  { id: "deepseek-flash", label: "DeepSeek Flash" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
  { id: "deepseek-v4.1-pro", label: "DeepSeek V4.1 Pro" },
] as const;

const DEEPSEEK_APPROVAL_POLICIES = [
  { id: "default", label: "Default" },
  { id: "auto", label: "Auto Approve" },
  { id: "yolo", label: "Bypass Approvals" },
] as const;

const DEEPSEEK_TERMINAL_AUTH: AgentTerminalAuthMethod = {
  id: "deepseek-terminal-login",
  name: "Login",
  type: "terminal",
};

const DEEPSEEK_COMPACT_COMMAND = {
  id: "compact",
  label: "compact — Compact older conversation history",
  description: "Compact older conversation history",
} as const;

export function deepseekContextTokensForModel(modelId: string): number | undefined {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    /deepseek-v4(?:\.1)?-(?:flash|pro)/.test(normalized) ||
    normalized.startsWith("deepseek/") ||
    normalized.startsWith("deepseek-")
  ) {
    return DEEPSEEK_V4_CONTEXT_TOKENS;
  }
  return undefined;
}

function mergeCompactSlashCommands(
  reported: AgentCapability["slashCommands"] | undefined,
  fallback: NonNullable<AgentCapability["slashCommands"]>,
): NonNullable<AgentCapability["slashCommands"]> {
  const have = new Set((reported ?? []).map((command) => command.id.toLowerCase()));
  const extra = fallback.filter((command) => !have.has(command.id.toLowerCase()));
  return [...(reported ?? []), ...extra];
}

function fallbackContextCaps(): ReturnType<typeof buildContextSizeCapabilities> {
  const sizes = new Map<string, number>();
  for (const model of DEEPSEEK_FALLBACK_MODELS) {
    sizes.set(model.id, DEEPSEEK_V4_CONTEXT_TOKENS);
  }
  return buildContextSizeCapabilities(sizes);
}

export const deepseekDefaultCapabilities: AgentCapability = {
  models: DEEPSEEK_FALLBACK_MODELS.map((model) => ({ id: model.id, label: model.label })),
  efforts: ["high", "max"],
  defaultEffort: "high",
  modelEfforts: Object.fromEntries(
    DEEPSEEK_FALLBACK_MODELS.map((model) => [model.id, ["high", "max"]]),
  ),
  ...fallbackContextCaps(),
  defaultContextSize: "1M",
  modes: ["agent"],
  approvalPolicies: [...DEEPSEEK_APPROVAL_POLICIES],
  sandboxModes: [],
  supportsResume: true,
  supportsOneShot: false,
  supportsDirectInput: true,
  liveInputMode: "server",
  presentationMode: "gui",
  presentationModes: ["gui"],
  defaultApprovalPolicy: "auto",
  bypassPermissions: { approvalPolicy: "yolo" },
  slashCommands: [DEEPSEEK_COMPACT_COMMAND],
  settingDefs: [],
};

export function buildDeepSeekCommand(
  location: ProjectLocation,
  args: string[],
  executablePath?: string,
) {
  return buildAgentCommand(location, "dsh", args, executablePath);
}

function contextCapsFromProbe(
  probe: AcpProbeResult | undefined,
): ReturnType<typeof buildContextSizeCapabilities> {
  const sizes = new Map<string, number>();
  for (const model of probe?.models ?? DEEPSEEK_FALLBACK_MODELS) {
    const probedTokens = probe?.modelMetadata?.[model.id]?.totalContextTokens;
    const tokens =
      typeof probedTokens === "number" && probedTokens > 0
        ? probedTokens
        : deepseekContextTokensForModel(model.id);
    if (tokens) sizes.set(model.id, tokens);
  }
  return sizes.size > 0 ? buildContextSizeCapabilities(sizes) : fallbackContextCaps();
}

export function buildDeepSeekProbeCapabilities(
  probe: AcpProbeResult | undefined,
  credentialState: { hasCredential: boolean },
): CapabilitiesProbeResult {
  const models = probe?.models?.length
    ? probe.models
    : DEEPSEEK_FALLBACK_MODELS.map((model) => ({ id: model.id, label: model.label }));
  return {
    ...deepseekDefaultCapabilities,
    models,
    ...(probe?.efforts?.length ? { efforts: probe.efforts } : {}),
    ...(probe?.defaultEffort ? { defaultEffort: probe.defaultEffort } : {}),
    ...(probe?.modelEfforts ? { modelEfforts: probe.modelEfforts } : {}),
    ...(probe?.modelDefaultEfforts ? { modelDefaultEfforts: probe.modelDefaultEfforts } : {}),
    ...(probe?.modes?.length ? { modes: probe.modes } : {}),
    ...(probe?.approvalPolicies?.length ? { approvalPolicies: probe.approvalPolicies } : {}),
    slashCommands: mergeCompactSlashCommands(probe?.slashCommands, [DEEPSEEK_COMPACT_COMMAND]),
    ...contextCapsFromProbe(probe),
    authMethods: [DEEPSEEK_TERMINAL_AUTH],
    authState: probe?.authState ?? (credentialState.hasCredential ? "authenticated" : "missing"),
    preferTerminalLogin: true,
  };
}

async function hasDeepSeekCredentialFile(location: ProjectLocation): Promise<boolean> {
  if (location.kind === "wsl") {
    const [result] = await batchWslCommandsAsync(location.distro, [
      'test -s "${DSH_HOME:-$HOME/.dsh}/.credentials.yaml" && echo yes || echo no',
    ]);
    return result?.ok === true && result.stdout.trim() === "yes";
  }
  const path = join(homedir(), ".dsh", ".credentials.yaml");
  if (!existsSync(path)) return false;
  try {
    const content = readFileSync(path, "utf8");
    return /DEEPSEEK_API_KEY\s*:/i.test(content);
  } catch {
    return false;
  }
}

async function probeCapabilities(
  location: ProjectLocation,
  executablePath: string,
  probeEnv?: Record<string, string>,
  signal?: AbortSignal,
): Promise<CapabilitiesProbeResult> {
  const spec = buildDeepSeekCommand(location, [...DEEPSEEK_ACP_ARGS], executablePath);
  const sessionCwd = getAgentProbeCwd(location);
  const processCwd = resolveProbeSpawnCwd(location, spec.cwd);
  const credentialState = { hasCredential: await hasDeepSeekCredentialFile(location) };
  const probe = await probeAcpCapabilities(spec.command, spec.args, sessionCwd, {
    ...(processCwd ? { processCwd } : {}),
    timeoutMs: 20_000,
    ...(signal ? { signal } : {}),
    ...(spec.env || probeEnv ? { env: { ...(spec.env ?? {}), ...(probeEnv ?? {}) } } : {}),
    label:
      location.kind === "wsl" ? `deepseek:wsl:${location.distro}` : `deepseek:${location.kind}`,
  });
  return buildDeepSeekProbeCapabilities(probe, credentialState);
}

export const deepseekDetectionSpec: DetectionSpec = {
  kind: "deepseek",
  label: "DeepSeek Harness",
  binary: "dsh",
  loginCommand: ({ location, executablePath }) => {
    if (!executablePath) return undefined;
    return location.kind === "windows"
      ? `Write-Host 'Set DEEPSEEK_API_KEY in %USERPROFILE%\\.dsh\\.credentials.yaml (see https://github.com/deepseek-ai/deepseek-harness).'`
      : `printf '%s\\n' 'Set DEEPSEEK_API_KEY in ~/.dsh/.credentials.yaml (see https://github.com/deepseek-ai/deepseek-harness).'`;
  },
  capabilities: deepseekDefaultCapabilities,
  update: { npm: "@deepseek-ai/dsh" },
  authProbes: [
    envVarAuthProbe(["DEEPSEEK_API_KEY"]),
    async (ctx) => ((await hasDeepSeekCredentialFile(ctx.location)) ? "authenticated" : "missing"),
  ],
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return undefined;
    return probeCapabilities(ctx.location, ctx.executablePath, ctx.probeEnv, ctx.signal);
  },
};
