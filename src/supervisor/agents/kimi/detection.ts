import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type {
  AgentCapability,
  AgentTerminalAuthMethod,
  AuthState,
  ProjectLocation,
} from "@/shared/contracts";
import { probeAcpCapabilities, type AcpProbeResult } from "../acp";
import {
  batchWslCommandsAsync,
  buildAgentCommand,
  type CapabilitiesProbeResult,
  type DetectionSpec,
  quotePosixShellArg,
  quotePowerShellLiteral,
} from "../base";
import { buildContextSizeCapabilities } from "../contextWindowLabel";
import { getAgentProbeCwd, resolveProbeSpawnCwd } from "../probeCwd";
import { kimiThoughtLevelChoices, preferredKimiThoughtTier } from "./thoughtLevels";
import { ensureKimiWorkspaceTrust } from "./kimiTrust";
import {
  kimiHomeFromOAuthCredentialPath,
  listKimiOAuthCredentialPaths,
  nativeKimiHomePath,
  nativeKimiOAuthCredentialPath,
} from "./paths";

// Kimi Code permission modes (verified against `kimi --help` on 0.42.0):
//   • default/manual → no flag (CLI default: ask)
//   • auto           → `--auto` (Never Ask: never interrupts, everything runs
//                      and is decided automatically — the true full access)
//   • yolo           → `--yolo` (Ask When Needed: routine edits/commands run
//                      automatically, but risky actions, questions and plans
//                      STILL ask — NOT a full bypass since 0.42)
// CraftStation starts fresh threads in auto mode, and "完全访问权限" maps to
// `auto` (not `yolo`) for exactly this reason. The two flags are mutually
// exclusive at launch.
const KIMI_APPROVAL_POLICIES = [
  { id: "default", label: "Default" },
  { id: "auto", label: "Auto Approve" },
  { id: "yolo", label: "Bypass Approvals" },
] as const;

// Models fill in from the ACP capabilities probe (k3 / kimi-for-coding /
// kimi-for-coding-highspeed). Efforts are probed too; Kimi has no
// `--reasoning-effort` flag, so effort switching only rides the ACP protocol.
export const kimiDefaultCapabilities: AgentCapability = {
  models: [],
  efforts: [],
  modelEfforts: {},
  modes: ["agent", "plan"],
  approvalPolicies: [...KIMI_APPROVAL_POLICIES],
  sandboxModes: [],
  supportsResume: true,
  supportsOneShot: true,
  supportsDirectInput: true,
  liveInputMode: "server",
  presentationMode: "gui",
  presentationModes: ["gui"],
  defaultApprovalPolicy: "auto",
  bypassPermissions: { approvalPolicy: "auto" },
  settingDefs: [],
};

export function buildKimiCommand(location: ProjectLocation, args: string[], wslExecPath?: string) {
  return buildAgentCommand(location, "kimi", args, wslExecPath);
}

// 0.33.0's agent-core-v2 ACP server no longer drives the OAuth device flow
// from `authenticate` — it only re-validates auth state. Sign-in happens in a
// terminal instead, through `kimiDetectionSpec.loginCommand`. Advertise a
// static terminal method (the Qwen pattern) so the Login button survives even
// when the ACP probe itself fails. The method carries no `args`: the renderer
// runs `status.loginCommand` and reads only `env` off the method, so anything
// else here would be inert.
export const kimiTerminalAuthMethod: AgentTerminalAuthMethod = {
  id: "kimi-terminal-login",
  name: "Login",
  type: "terminal",
};

/**
 * Turn Kimi's `thought_level` selector into real effort tiers.
 *
 * Each model keeps the levels it actually offers (see thoughtLevels.ts for the
 * probed payloads): the `low`/`high`/`max` ladder for K3, and the lone untiered
 * `on` for K2.7 — which the composer renders as no picker at all, since there is
 * nothing to choose, while still giving the thread a level to send.
 *
 * Kimi reports `currentValue: "on"` even for the tiered K3 models, so defaults
 * resolve through {@link preferredKimiThoughtTier} (`high`) rather than adopting
 * a level the model does not offer.
 */
export function normalizeKimiProbeEfforts(probe: AcpProbeResult | undefined): {
  efforts?: string[];
  defaultEffort?: string;
  modelEfforts?: Record<string, string[]>;
  modelDefaultEfforts?: Record<string, string>;
  thinkingModels?: string[];
} {
  const efforts = kimiThoughtLevelChoices(probe?.efforts ?? []);
  const defaultEffort = preferredKimiThoughtTier(efforts, probe?.defaultEffort);
  const modelEfforts: Record<string, string[]> = {};
  for (const [modelId, levels] of Object.entries(probe?.modelEfforts ?? {})) {
    // Record every probed model, including the untiered ones: consumers resolve
    // `modelEfforts[model] ?? efforts`, so omitting a model makes it inherit the
    // global list — and that list holds only the levels of whichever model the
    // probe started on, which is whatever the Kimi CLI last persisted.
    modelEfforts[modelId] = kimiThoughtLevelChoices(levels);
  }
  // Kimi's probed default (`on`) names no tier for the tiered models, so resolve
  // every model's default against the levels that model actually offers.
  const modelDefaultEfforts: Record<string, string> = {};
  const probedModelIds = new Set([
    ...Object.keys(modelEfforts),
    ...Object.keys(probe?.modelDefaultEfforts ?? {}),
  ]);
  for (const modelId of probedModelIds) {
    const levels = modelEfforts[modelId] ?? efforts;
    const level = preferredKimiThoughtTier(levels, probe?.modelDefaultEfforts?.[modelId]);
    if (level) modelDefaultEfforts[modelId] = level;
  }
  return {
    ...(efforts.length > 0 ? { efforts, ...(defaultEffort ? { defaultEffort } : {}) } : {}),
    ...(Object.keys(modelEfforts).length > 0 ? { modelEfforts } : {}),
    ...(Object.keys(modelDefaultEfforts).length > 0 ? { modelDefaultEfforts } : {}),
    ...(probe?.thinkingModels ? { thinkingModels: probe.thinkingModels } : {}),
  };
}

export function buildKimiProbeCapabilities(
  probe: AcpProbeResult | undefined,
  credentialState: {
    hasAnyCredential: boolean;
    hasManagedOAuthCredential: boolean;
    /** Live token in a CraftStation managed account profile, not the host CLI home. */
    hasPoolOAuthCredential?: boolean;
  },
): CapabilitiesProbeResult {
  let contextCaps: Pick<AgentCapability, "contextSizes" | "modelContextSizes"> = {};
  if (probe?.modelMetadata) {
    const sizes = new Map<string, number>();
    for (const [modelId, meta] of Object.entries(probe.modelMetadata)) {
      const tokens = (meta as { totalContextTokens?: unknown }).totalContextTokens;
      if (typeof tokens === "number" && tokens > 0) sizes.set(modelId, tokens);
    }
    if (sizes.size > 0) {
      contextCaps = buildContextSizeCapabilities(sizes);
    }
  }

  return {
    // 0.33.0 carries no model list on `initialize`; models arrive on
    // `session/new` configOptions, which the shared probe already maps.
    ...(probe?.models?.length ? { models: probe.models } : {}),
    ...normalizeKimiProbeEfforts(probe),
    ...(probe?.modes?.length ? { modes: probe.modes } : {}),
    ...(probe?.approvalPolicies?.length ? { approvalPolicies: probe.approvalPolicies } : {}),
    ...(probe?.slashCommands?.length ? { slashCommands: probe.slashCommands } : {}),
    ...contextCaps,
    authMethods: [kimiTerminalAuthMethod],
    // Prefer the ACP-native auth signal (session/new succeeded → authenticated,
    // `auth_required` → missing); fall back to the credential files when the
    // probe couldn't decide. A managed pool token wins over a host-home probe
    // that reports missing: sessions spawn with KIMI_CODE_HOME pinned to the
    // pool profile, so the host CLI's empty stub must not disable the composer.
    authState: resolveKimiAuthState(probe, credentialState),
    // v2 advertises `agentCapabilities.auth.logout` (the ACP logout RPC); the
    // legacy engine has no RPC but its managed OAuth token file can be
    // removed directly — the adapter's logout command handles both.
    ...(probe?.authLogoutSupported || credentialState.hasManagedOAuthCredential
      ? { authLogoutSupported: true }
      : {}),
    preferTerminalLogin: true,
  };
}

// Offline fallback model snapshot (model ids + thought levels verified
// against real `session/new` payloads from kimi 0.33.0 — see
// detection.test.ts "normalizes the same payload probed from a K3 model").
// Used only when the live ACP probe yields no models, e.g. the host CLI is
// logged out (empty host credential) while a managed pool account holds valid
// auth and quota. The live probe replaces this whenever it succeeds, so it
// never has to stay current (same pattern as Command Code's
// COMMANDCODE_FALLBACK_MODEL_IDS).
export const KIMI_FALLBACK_PROBE: Pick<
  AcpProbeResult,
  "models" | "efforts" | "defaultEffort" | "modelEfforts" | "modelDefaultEfforts"
> = {
  models: [
    { id: "kimi-code/k3-256k", label: "Kimi K3 256K" },
    { id: "kimi-code/k3", label: "Kimi K3" },
    { id: "kimi-code/kimi-for-coding", label: "Kimi For Coding" },
    { id: "kimi-code/kimi-for-coding-highspeed", label: "Kimi For Coding Highspeed" },
  ],
  efforts: ["low", "high", "max", "on"],
  defaultEffort: "on",
  modelEfforts: {
    "kimi-code/kimi-for-coding": ["on"],
    "kimi-code/kimi-for-coding-highspeed": ["on"],
  },
  modelDefaultEfforts: {
    "kimi-code/kimi-for-coding": "on",
    "kimi-code/kimi-for-coding-highspeed": "on",
    "kimi-code/k3": "on",
    "kimi-code/k3-256k": "on",
  },
};

export function resolveKimiAuthState(
  probe: Pick<AcpProbeResult, "authState"> | undefined,
  credentialState: {
    hasAnyCredential: boolean;
    hasPoolOAuthCredential?: boolean;
  },
): AuthState {
  if (credentialState.hasPoolOAuthCredential) return "authenticated";
  return probe?.authState ?? (credentialState.hasAnyCredential ? "authenticated" : "missing");
}

async function probeCapabilities(
  location: ProjectLocation,
  executablePath?: string,
  signal?: AbortSignal,
  probeEnv?: Record<string, string>,
): Promise<CapabilitiesProbeResult> {
  const spec = buildKimiCommand(location, ["acp"], executablePath);
  const sessionCwd = getAgentProbeCwd(location);
  const processCwd = resolveProbeSpawnCwd(location, spec.cwd);
  // `session/new` is what decides `authState`, models and modes, so the probe
  // must not be the one call that trips over 0.33's workspace-trust gate.
  // Trust the probe's own cwd (a scratch dir on posix hosts, the project
  // elsewhere) rather than the project path a launch would use.
  // Only the ACP probe depends on the trust marker, so read the credential
  // files (another WSL round trip) alongside the marker write instead of after.
  const credentialState = await readKimiCredentialState(location);
  const probeHome = location.kind === "wsl" ? undefined : credentialState.probeHome;
  await ensureKimiWorkspaceTrust(
    location,
    sessionCwd,
    probeHome ? { kimiHome: probeHome } : undefined,
  );
  // No `authenticateMethodIds`: on the legacy engine `authenticate` triggers
  // the interactive OAuth device flow, and on 0.33.0's v2 server it only
  // re-validates — probing must never invoke either.
  const probe = await probeAcpCapabilities(spec.command, spec.args, sessionCwd, {
    ...(processCwd ? { processCwd } : {}),
    timeoutMs: 20_000,
    ...(signal ? { signal } : {}),
    label: location.kind === "wsl" ? `kimi:wsl:${location.distro}` : `kimi:${location.kind}`,
    env: {
      ...(probeEnv ?? {}),
      ...(probeHome ? { KIMI_CODE_HOME: probeHome } : {}),
    },
  });
  // Fall back to the verified snapshot when the live probe has no models
  // (host logged out, managed pool account still usable). A successful probe
  // always wins — the fallback only fills the model/effort surface.
  const effectiveProbe =
    probe?.models?.length
      ? probe
      : { ...(probe ?? {}), ...KIMI_FALLBACK_PROBE };
  return buildKimiProbeCapabilities(effectiveProbe, credentialState);
}

/**
 * True when a Kimi `config.toml` holds a real inline credential. Managed Kimi
 * OAuth providers keep an `api_key` placeholder plus a storage reference in
 * TOML even after logout; their live token is checked separately below.
 */
export function hasKimiCredential(content: string): boolean {
  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch {
    return false;
  }
  if (!isRecord(parsed) || !isRecord(parsed.providers)) return false;
  for (const provider of Object.values(parsed.providers)) {
    if (!isRecord(provider)) continue;
    const oauth = isRecord(provider.oauth) ? provider.oauth : undefined;
    if (
      oauth &&
      [oauth.access_token, oauth.refresh_token, oauth.id_token].some(
        (value) => typeof value === "string" && value.length > 0,
      )
    ) {
      return true;
    }
    const usesExternalOAuthStorage =
      oauth && typeof oauth.storage === "string" && typeof oauth.key === "string";
    if (
      !usesExternalOAuthStorage &&
      typeof provider.api_key === "string" &&
      provider.api_key.length > 0
    ) {
      return true;
    }
  }
  return false;
}

export function hasKimiOAuthCredential(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown;
    return (
      isRecord(parsed) &&
      [parsed.access_token, parsed.accessToken].some(
        (value) => typeof value === "string" && value.length > 0,
      )
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface KimiCredentialState {
  hasAnyCredential: boolean;
  hasManagedOAuthCredential: boolean;
  hasPoolOAuthCredential: boolean;
  probeHome?: string;
}

/**
 * Home the ACP probe and composer should treat as Kimi's runtime home.
 * Prefers a CraftStation pool profile that actually holds a live token over
 * the host `~/.kimi-code`, which isolation may have wiped to an empty stub.
 */
export async function resolveKimiProbeHome(location: ProjectLocation): Promise<string> {
  if (location.kind === "wsl") return nativeKimiHomePath();
  return (await readKimiCredentialState(location)).probeHome ?? nativeKimiHomePath();
}

async function readKimiCredentialState(location: ProjectLocation): Promise<KimiCredentialState> {
  if (location.kind !== "wsl") {
    const hostHome = nativeKimiHomePath();
    const hostPath = nativeKimiOAuthCredentialPath();
    const [hasConfigCredential, hostOAuthContent, credentialPaths] = await Promise.all([
      readFile(join(hostHome, "config.toml"), "utf8")
        .then(hasKimiCredential)
        .catch(() => false),
      readFile(hostPath, "utf8").catch(() => ""),
      listKimiOAuthCredentialPaths(),
    ]);
    const hasHostOAuthCredential = hasKimiOAuthCredential(hostOAuthContent);
    let hasPoolOAuthCredential = false;
    let probeHome = hostHome;
    for (const path of credentialPaths) {
      if (path === hostPath) continue;
      try {
        const content = await readFile(path, "utf8");
        if (!hasKimiOAuthCredential(content)) continue;
        hasPoolOAuthCredential = true;
        probeHome = kimiHomeFromOAuthCredentialPath(path);
        break;
      } catch {
        // Unreadable pool files are not credentials.
      }
    }
    const hasManagedOAuthCredential = hasHostOAuthCredential || hasPoolOAuthCredential;
    return {
      hasAnyCredential: hasConfigCredential || hasManagedOAuthCredential,
      hasManagedOAuthCredential,
      hasPoolOAuthCredential,
      probeHome,
    };
  }
  const [configResult, oauthResult] = await batchWslCommandsAsync(location.distro, [
    'cat "${KIMI_CODE_HOME:-$HOME/.kimi-code}/config.toml" 2>/dev/null || true',
    'cat "${KIMI_CODE_HOME:-$HOME/.kimi-code}/credentials/kimi-code.json" 2>/dev/null || true',
  ]);
  const hasConfigCredential = configResult?.ok ? hasKimiCredential(configResult.stdout) : false;
  const hasManagedOAuthCredential = oauthResult?.ok
    ? hasKimiOAuthCredential(oauthResult.stdout)
    : false;
  return {
    hasAnyCredential: hasConfigCredential || hasManagedOAuthCredential,
    hasManagedOAuthCredential,
    hasPoolOAuthCredential: false,
  };
}

export const kimiDetectionSpec: DetectionSpec = {
  kind: "kimi",
  label: "Kimi Code",
  binary: "kimi",
  wslBinaryHome: {
    env: "KIMI_CODE_HOME",
    defaultSubpath: ".kimi-code",
  },
  // The v2 terminal-auth entry point: `kimi acp --login` runs the device-code
  // login flow in the terminal and exits. This is the only thing that drives a
  // Kimi sign-in — the renderer's Login button runs exactly this string.
  // Works on the legacy engine too.
  loginCommand: ({ location, executablePath }) => {
    if (!executablePath) return undefined;
    return location.kind === "windows"
      ? `& ${quotePowerShellLiteral(executablePath)} acp --login`
      : `${quotePosixShellArg(executablePath)} acp --login`;
  },
  capabilities: kimiDefaultCapabilities,
  // `kimi upgrade` is an interactive TUI (arrow-key chooser, no headless flag),
  // so it can't run through the supervisor's non-interactive updater — hence no
  // `builtIn`. Re-run the official install script instead: the same
  // non-interactive path the Settings "Install" card uses, for both Unix
  // (`curl … | bash`) and Windows (`irm … | iex`). `npm` stays only as the
  // latest-version probe that decides whether to surface the update button.
  update: {
    npm: "@moonshot-ai/kimi-code",
    installer: {
      posix: {
        binary: "sh",
        args: ["-c", "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash"],
      },
      windows: {
        binary: "powershell.exe",
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
        ],
      },
    },
  },
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return undefined;
    return probeCapabilities(ctx.location, ctx.executablePath, ctx.signal, ctx.probeEnv);
  },
};
