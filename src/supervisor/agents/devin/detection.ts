import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripAnsi } from "@/shared/ansi";
import type {
  AgentCapability,
  AgentTerminalAuthMethod,
  LabeledOption,
  ProjectLocation,
} from "@/shared/contracts";
import { dedupeAcpAuthMethods, probeAcpCapabilities, type AcpProbeResult } from "../acp";
import {
  batchWslCommandsAsync,
  buildAgentCommand,
  cliSubcommandAuthProbe,
  envVarAuthProbe,
  mergeSpawnEnv,
  readAgentCommandOutput,
  type AuthProbe,
  type CapabilitiesProbeResult,
  type DetectionSpec,
} from "../base";
import { devinProxySpawnEnv, ensureDevinUserProxyConfig } from "./proxy";
import { getAgentProbeCwd, resolveProbeSpawnCwd } from "../probeCwd";
import { DEVIN_ACP_ARGS } from "./argv";

export const DEVIN_DEFAULT_MODEL_ID = "swe";

const DEVIN_FALLBACK_MODELS: LabeledOption[] = [
  { id: "swe", label: "SWE-1.6" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "gpt", label: "GPT" },
  { id: "gemini", label: "Gemini" },
];

/** Hide every discovered Devin model except the curated default. */
export function defaultHiddenDevinModels(models: readonly LabeledOption[]): string[] {
  return models.filter((model) => model.id !== DEVIN_DEFAULT_MODEL_ID).map((model) => model.id);
}

const DEVIN_APPROVAL_POLICIES = [
  { id: "normal", label: "Normal" },
  { id: "accept-edits", label: "Accept Edits" },
  { id: "smart", label: "Smart" },
  { id: "yolo", label: "Bypass" },
] as const;

export const defaultDevinCapabilities: AgentCapability = {
  models: DEVIN_FALLBACK_MODELS,
  defaultHiddenModels: defaultHiddenDevinModels(DEVIN_FALLBACK_MODELS),
  efforts: [],
  modelEfforts: {},
  modes: ["agent", "plan"],
  approvalPolicies: [...DEVIN_APPROVAL_POLICIES],
  sandboxModes: [],
  supportsResume: true,
  supportsOneShot: true,
  supportsDirectInput: true,
  liveInputMode: "server",
  presentationMode: "gui",
  presentationModes: ["gui", "terminal"],
  defaultApprovalPolicy: "accept-edits",
  bypassPermissions: { approvalPolicy: "yolo" },
  settingDefs: [],
};

export const DEVIN_TERMINAL_AUTH: AgentTerminalAuthMethod = {
  id: "devin-terminal-login",
  name: "Login",
  type: "terminal",
};

export function buildDevinCommand(
  location: ProjectLocation,
  args: string[],
  executablePath?: string,
  extraEnv?: Record<string, string>,
) {
  return buildAgentCommand(
    location,
    "devin",
    args,
    executablePath,
    mergeSpawnEnv(devinProxySpawnEnv(), extraEnv),
  );
}

function humanizeDevinModelLabel(id: string): string {
  return id
    .split(/[-_/]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function asModelRow(value: unknown): LabeledOption | undefined {
  if (typeof value === "string" && value.trim()) {
    const id = value.trim();
    return { id, label: humanizeDevinModelLabel(id) };
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id =
    (typeof record.id === "string" && record.id.trim()) ||
    (typeof record.slug === "string" && record.slug.trim()) ||
    (typeof record.name === "string" && record.name.trim()) ||
    "";
  if (!id) return undefined;
  const label =
    (typeof record.label === "string" && record.label.trim()) ||
    (typeof record.displayName === "string" && record.displayName.trim()) ||
    humanizeDevinModelLabel(id);
  return { id, label };
}

/** Parse `devin models list --format json` (array, `{models:[…]}`, or line-oriented). */
export function parseDevinModels(output: string): LabeledOption[] {
  const trimmed = stripAnsi(output).trim();
  if (!trimmed) return [];
  const seen = new Set<string>();
  const models: LabeledOption[] = [];
  const push = (row: LabeledOption | undefined) => {
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    models.push(row);
  };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { models?: unknown }).models)
        ? ((parsed as { models: unknown[] }).models ?? [])
        : [];
    for (const row of rows) push(asModelRow(row));
    if (models.length > 0) return models;
  } catch {
    // Fall through to the line parser for human `devin models list` output.
  }
  for (const raw of trimmed.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(?:Available|Models|Family|Usage:|Tip:)/i.test(line)) continue;
    const id = line.split(/\s{2,}|\t/)[0]?.trim();
    if (id && /^[A-Za-z0-9][\w./:-]*$/.test(id)) push({ id, label: humanizeDevinModelLabel(id) });
  }
  return models;
}

export function buildDevinProbeCapabilities(
  probe: AcpProbeResult | undefined,
): CapabilitiesProbeResult {
  const authMethods = probe?.authMethods?.length
    ? dedupeAcpAuthMethods(probe.authMethods)
    : [DEVIN_TERMINAL_AUTH];
  const haveTerminal = authMethods.some((method) => "type" in method && method.type === "terminal");
  const discoveredModels = probe?.models?.length ? probe.models : DEVIN_FALLBACK_MODELS;
  const advertisedBypassPolicy = probe?.approvalPolicies?.find((policy) =>
    /^(?:yolo|never|bypass|dangerous|bypassPermissions)$/i.test(policy.id),
  )?.id;
  return {
    ...defaultDevinCapabilities,
    ...(probe?.models?.length ? { models: probe.models } : {}),
    defaultHiddenModels: defaultHiddenDevinModels(discoveredModels),
    ...(probe?.efforts?.length ? { efforts: probe.efforts } : {}),
    ...(probe?.defaultEffort ? { defaultEffort: probe.defaultEffort } : {}),
    ...(probe?.modelEfforts ? { modelEfforts: probe.modelEfforts } : {}),
    ...(probe?.modelDefaultEfforts ? { modelDefaultEfforts: probe.modelDefaultEfforts } : {}),
    ...(probe?.thinkingModels ? { thinkingModels: probe.thinkingModels } : {}),
    ...(probe?.modes?.length ? { modes: probe.modes } : {}),
    ...(probe?.approvalPolicies?.length ? { approvalPolicies: probe.approvalPolicies } : {}),
    ...(advertisedBypassPolicy
      ? { bypassPermissions: { approvalPolicy: advertisedBypassPolicy } }
      : {}),
    ...(probe?.slashCommands?.length ? { slashCommands: probe.slashCommands } : {}),
    authMethods: haveTerminal ? authMethods : [...authMethods, DEVIN_TERMINAL_AUTH],
    authLogoutSupported: true,
    preferTerminalLogin: true,
    ...(probe?.authState ? { authState: probe.authState } : {}),
  };
}

function nativeCredentialPaths(): string[] {
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    return [
      ...(appData ? [join(appData, "devin", "credentials.toml")] : []),
      join(home, ".devin", "credentials.toml"),
    ];
  }
  const linux = join(home, ".local", "share", "devin", "credentials.toml");
  const mac = join(home, "Library", "Application Support", "devin", "credentials.toml");
  const legacy = join(home, ".devin", "credentials.toml");
  return process.platform === "darwin" ? [mac, linux, legacy] : [linux, legacy];
}

const storedCredentialsAuthProbe: AuthProbe = async (ctx) => {
  if (ctx.location.kind === "wsl") {
    const [result] = await batchWslCommandsAsync(
      ctx.location.distro,
      [
        "test -f ~/.local/share/devin/credentials.toml -o -f ~/.devin/credentials.toml && echo yes || echo no",
      ],
      ctx.signal,
    );
    if (!result?.ok) return "unknown";
    return result.stdout.trim() === "yes" ? "authenticated" : "missing";
  }
  return nativeCredentialPaths().some((path) => existsSync(path)) ? "authenticated" : "missing";
};

async function probeCapabilities(
  location: ProjectLocation,
  executablePath: string,
  probeEnv: Record<string, string> | undefined,
  signal?: AbortSignal,
): Promise<CapabilitiesProbeResult | undefined> {
  ensureDevinUserProxyConfig();
  const command = buildDevinCommand(location, [...DEVIN_ACP_ARGS], executablePath, probeEnv);
  const processCwd = resolveProbeSpawnCwd(location, command.cwd);
  const probe = await probeAcpCapabilities(
    command.command,
    command.args,
    getAgentProbeCwd(location),
    {
      ...(processCwd ? { processCwd } : {}),
      ...(command.env ? { env: command.env } : {}),
      timeoutMs: 45_000,
      ...(signal ? { signal } : {}),
      label: location.kind === "wsl" ? `devin:wsl:${location.distro}` : `devin:${location.kind}`,
    },
  ).catch((error) => {
    console.warn("[devin] ACP capabilities probe failed:", error);
    return undefined;
  });

  const list = await readAgentCommandOutput(
    location,
    executablePath,
    ["models", "list", "--format", "json"],
    {
      timeoutMs: 45_000,
      wslLinuxCwd: "/tmp",
      posixCwd: getAgentProbeCwd(location),
      ...(probeEnv ? { env: probeEnv } : {}),
      ...(signal ? { signal } : {}),
    },
  ).catch((error) => {
    console.warn("[devin] model list probe failed:", error);
    return undefined;
  });
  const listed = list?.ok ? parseDevinModels(list.stdout) : [];
  const capabilities = buildDevinProbeCapabilities(probe ?? undefined);
  const models = listed.length > 0 ? listed : (capabilities.models ?? DEVIN_FALLBACK_MODELS);
  return {
    ...capabilities,
    models,
    defaultHiddenModels: defaultHiddenDevinModels(models),
    authMethods: capabilities.authMethods?.length
      ? capabilities.authMethods
      : [DEVIN_TERMINAL_AUTH],
  };
}

export const devinDetectionSpec: DetectionSpec = {
  kind: "devin",
  label: "Devin",
  binary: "devin",
  loginCommand: "devin auth login",
  capabilities: defaultDevinCapabilities,
  versionArgs: ["--version"],
  authProbes: [
    envVarAuthProbe(["DEVIN_API_KEY", "WINDSURF_API_KEY"]),
    cliSubcommandAuthProbe(["auth", "status"]),
    storedCredentialsAuthProbe,
  ],
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return { authMethods: [DEVIN_TERMINAL_AUTH] };
    const probed = await probeCapabilities(
      ctx.location,
      ctx.executablePath,
      ctx.probeEnv,
      ctx.signal,
    );
    return probed ?? { authMethods: [DEVIN_TERMINAL_AUTH] };
  },
  // Official distribution is the Cognition installer (`curl` / `irm`) and the
  // Homebrew cask `devin-cli`. There is no npm package named `devin` that
  // ships this CLI — do not add `npm: "devin"` or the latest-version probe
  // and the last-resort updater would hit an unrelated package.
  update: {
    builtIn: { binary: "devin", args: ["update"] },
    homebrewCask: "devin-cli",
    latestVersionUrls: ["https://static.devin.ai/cli/current/manifest.json"],
    installer: {
      posix: {
        binary: "sh",
        args: ["-c", "curl -fsSL https://cli.devin.ai/install.sh | bash"],
      },
      windows: {
        binary: "powershell.exe",
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "irm https://static.devin.ai/cli/setup.ps1 | iex",
        ],
      },
    },
  },
};
