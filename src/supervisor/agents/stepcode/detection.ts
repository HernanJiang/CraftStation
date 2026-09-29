import { readFileSync } from "node:fs";
import type { AgentCapability, AgentProviderMetadata, ProjectLocation } from "@/shared/contracts";
import { hasNativeStepCodeCredentials, nativeStepCodeAuthPath } from "@/shared/stepcodePaths";
import {
  batchWslCommandsAsync,
  envVarAuthProbe,
  readAgentCommandOutput,
  type AuthProbe,
  type CapabilitiesProbeResult,
  type DetectionSpec,
} from "../base";
import { humanizePiModelId, parsePiModelList } from "../pi/detection";

const STEP_AUTH_ENV_KEYS = [
  // Built-in `step` provider key, plus the external config-projection path
  // (a bound file carries provider credentials the file probe cannot see).
  "STEP_API_KEY",
  "STEPCODE_CONFIG_PATH",
] as const;

// Canonical location logic lives in `@/shared/stepcodePaths` so the main
// process (usage login state) resolves the same paths without importing the
// supervisor's probe machinery. Re-exported here to keep this module's public
// surface unchanged.
export {
  nativeStepCodeAuthCandidates,
  nativeStepCodeAuthPath,
  stepCodeAgentHomePath,
  stepCodeConfigRoot,
} from "@/shared/stepcodePaths";

function nativeAuthProvidersFor(path: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
  } catch {
    return [];
  }
}

const stepCodeAuthFileProbe: AuthProbe = async (ctx) => {
  if (ctx.location.kind === "wsl") {
    const [result] = await batchWslCommandsAsync(
      ctx.location.distro,
      [
        'for f in "${STEPCODE_AUTH_PATH:-}" "${STEP_CODING_AGENT_DIR:+$(dirname "$STEP_CODING_AGENT_DIR")/auth.json}" "$HOME/.stepcode/auth.json" "$HOME/.stepcode/legacy-auth.json" "$HOME/.step-harness/auth.json" "$HOME/.step-harness/agent/auth.json"; do [ -n "$f" ] && [ -s "$f" ] && exit 0; done; exit 1',
      ],
      ctx.signal,
    );
    return result?.ok ? "authenticated" : "missing";
  }
  return hasNativeStepCodeCredentials() ? "authenticated" : "missing";
};

export const stepCodeDefaultCapabilities: AgentCapability = {
  // Seeded so the picker shows StepFun's flagship before `--list-models`
  // runs; the probe replaces this with the live catalog when installed.
  models: [{ id: "step/step-5-preview", label: "Step 5 Preview" }],
  efforts: [],
  modelEfforts: {},
  modes: [],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsOneShot: true,
  supportsTextOnlyOneShot: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  presentationModes: ["terminal", "gui"],
  defaultApprovalPolicy: "never",
  bypassPermissions: { approvalPolicy: "never" },
  mcpScope: { terminal: "none", gui: "launch" },
  settingDefs: [],
};

const STEP_CLI_REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

async function probeStepCapabilities(
  location: ProjectLocation,
  executablePath: string,
  signal?: AbortSignal,
): Promise<CapabilitiesProbeResult> {
  // `step --list-models` prints the same column layout as `pi --list-models`
  // (provider / model / context / max-out / thinking / images). The table
  // lists the built-in StepFun catalog even before login, so a nonempty table
  // is NOT an auth signal — auth state stays with the auth probes.
  const output = await readAgentCommandOutput(location, executablePath, ["--list-models"], {
    timeoutMs: 15_000,
    ...(signal ? { signal } : {}),
  });
  const models = output.ok ? parsePiModelList(output.stdout) : [];
  const modelEfforts = Object.fromEntries(
    models.map((model) => [model.id, model.reasoning ? [...STEP_CLI_REASONING_LEVELS] : ["off"]]),
  );
  const base: CapabilitiesProbeResult = {
    ...stepCodeDefaultCapabilities,
    models: models.map((model) => ({ id: model.id, label: humanizePiModelId(model.id) })),
    efforts: [...new Set(Object.values(modelEfforts).flat())],
    modelEfforts,
    authMethods: [{ id: "stepcode-login", name: "Step Code login", type: "terminal" }],
    preferTerminalLogin: true,
  };
  if (location.kind === "wsl") {
    return { ...base, presentationModes: ["terminal"] };
  }
  const providers = [
    ...new Set([
      ...nativeAuthProvidersFor(nativeStepCodeAuthPath()),
      ...models.map((model) => model.id.split("/", 1)[0]!),
    ]),
  ];
  const providerMetadata: AgentProviderMetadata | undefined = providers.length
    ? { connectedProviders: providers.map((provider) => ({ id: provider, label: provider })) }
    : undefined;
  return { ...base, ...(providerMetadata ? { providerMetadata } : {}) };
}

export const stepCodeDetectionSpec: DetectionSpec = {
  kind: "stepcode",
  label: "Step Code",
  binary: "step",
  loginCommand: "step login",
  capabilities: stepCodeDefaultCapabilities,
  update: {
    builtIn: { binary: "step", args: ["update"] },
    // Official release manifest (no GitHub Releases / npm): carries the newest
    // published version as a top-level `version` field.
    latestVersionUrls: ["https://static-openapi.stepfun.com/stepcode/latest.json"],
    installer: {
      posix: {
        binary: "sh",
        args: ["-c", "curl -fsSL https://static-openapi.stepfun.com/stepcode/install.sh | sh"],
      },
      windows: {
        binary: "powershell.exe",
        args: [
          "-NoProfile",
          "-Command",
          "irm https://static-openapi.stepfun.com/stepcode/install.ps1 | iex",
        ],
      },
    },
  },
  authProbes: [envVarAuthProbe([...STEP_AUTH_ENV_KEYS]), stepCodeAuthFileProbe],
  async capabilitiesProbe(ctx) {
    if (!ctx.executablePath) return undefined;
    return probeStepCapabilities(ctx.location, ctx.executablePath, ctx.signal);
  },
};
