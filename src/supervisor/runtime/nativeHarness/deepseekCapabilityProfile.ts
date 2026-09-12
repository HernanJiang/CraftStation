/**
 * DeepSeek Harness capability/profile — the single place for DeepSeek-specific
 * launch and capability knowledge (tracks upstream `master`, verified 2026-09).
 *
 * Transport preference (highest first):
 *   1. `sdk-client` — official TypeScript SDK `@deepseek-ai/dsh-sdk-client`
 *      (`DeepSeekHarness` run API over `HarnessClient`, profile `sdk`,
 *      same-version `dsh` bin, ordered `patches`). Our launcher mirrors its
 *      launch spec exactly (`dsh --profile sdk [--patch ...]`), so a caller
 *      with the SDK installed gets identical behavior; the hand-rolled
 *      Ndjson transport below speaks the same stdio wire as `HarnessClient`.
 *   2. `acp-stdio` — official automation server `@deepseek-ai/dsh-acp` via
 *      `dsh --profile acp` (ready-to-use, mounts session persistence itself).
 *      Master supports `initialize` / `authenticate` / `session/new` /
 *      `session/list` / `session/resume` / `session/close` / `session/prompt` /
 *      `session/cancel` / `session/update` (committed assistant messages +
 *      thoughts, generic tool lifecycle, config changes, context usage) /
 *      `session/request_permission`, plus stdio + Streamable HTTP MCP and
 *      model / reasoning-effort selection. Still unsupported: session
 *      deletion/fork, transcript replay, additional directories, and all
 *      DSH-private presentation (plans, titles, todos, terminal views,
 *      elicitation). `set_config_option`-style pickers are version-dependent:
 *      always feature-detect, never assume.
 *   3. `jsonrpc-stdio` (legacy fallback) — `dsh-jsonrpc-agent <cordis.yml>`;
 *      requires an explicit Cordis config containing the JSON-RPC server
 *      plugin, fail-closed otherwise.
 *
 * This module therefore:
 * - keeps DeepSeek-specific branching out of Session/Thread/UI/supervisor;
 * - never hardcodes a DeepSeek model list (models come from the plan binding
 *   and Command Code `--list-models` probe);
 * - never claims DSH-private concepts as CraftStation capabilities.
 */

/** Canonical DeepSeek harness kinds owned by this profile. */
export const DEEPSEEK_HARNESS_KINDS = ["deepseek", "deepseek-harness", "deepseek-api"] as const;
export type DeepSeekHarnessKind = (typeof DEEPSEEK_HARNESS_KINDS)[number];

/** True for either spelling of the native DSH runtime id. */
export function isDeepSeekNativeHarnessKind(harnessKind: string): boolean {
  const normalized = harnessKind.trim().toLowerCase();
  return normalized === "deepseek" || normalized === "deepseek-harness";
}

/** Executable discovery order for the native DSH runtime (PATH lookup). */
export const DEEPSEEK_EXECUTABLE_CANDIDATES = ["dsh-jsonrpc-agent", "dsh"] as const;

/** Official DSH profiles CraftStation may boot (default `sdk`). */
export const DEEPSEEK_PROFILE_NAMES = ["sdk", "acp"] as const;
export type DeepSeekProfileName = (typeof DEEPSEEK_PROFILE_NAMES)[number];

/** Transport preference, highest first (see module doc). */
export const DEEPSEEK_TRANSPORT_PREFERENCE = ["sdk-client", "acp-stdio", "jsonrpc-stdio"] as const;
export type DeepSeekTransportKind = (typeof DEEPSEEK_TRANSPORT_PREFERENCE)[number];

/** Official TypeScript SDK package (optional peer — never a hard import). */
export const DEEPSEEK_SDK_CLIENT_PACKAGE = "@deepseek-ai/dsh-sdk-client";

/**
 * Normalize a caller-supplied profile ref to a known DSH profile.
 * Unknown values fall back to `sdk` (the SDK client's own default).
 */
export function normalizeDeepSeekProfileName(profileRef?: string): DeepSeekProfileName {
  const normalized = (profileRef ?? "").trim().toLowerCase();
  if (normalized === "acp") return "acp";
  return "sdk";
}

/**
 * Resolve which transport a launch will use. The SDK client and the ACP
 * server share the same `dsh` carrier; the profile selects the server
 * composition (`sdk` = owned runs, `acp` = automation server). The legacy
 * `dsh-jsonrpc-agent` carrier only speaks the raw JSON-RPC wire.
 */
export function resolveDeepSeekTransport(input: {
  executablePath: string;
  profileRef?: string;
  sdkClientAvailable?: boolean;
}): DeepSeekTransportKind {
  const command = input.executablePath.toLowerCase().replace(/\\/g, "/");
  const isDshCli =
    command.endsWith("/dsh") ||
    command.endsWith("/dsh.exe") ||
    command.endsWith("/dsh.cmd") ||
    command.endsWith("/dsh.ps1") ||
    command === "dsh";
  if (!isDshCli) return "jsonrpc-stdio";
  const profile = normalizeDeepSeekProfileName(input.profileRef);
  if (profile === "acp") return "acp-stdio";
  if (input.sdkClientAvailable === true) return "sdk-client";
  // Default `sdk` profile: our launcher mirrors the SDK client's launch spec
  // (`--profile sdk` + ordered `--patch`), over the same stdio wire that
  // `HarnessClient` speaks — hence reported as `sdk-client`-equivalent.
  return "sdk-client";
}

/**
 * Build the `dsh --profile <name>` argv, mirroring the official SDK client's
 * launch spec: `--profile <name>` first, then caller extra args, then the
 * ordered `--patch <cordis>` overlays. The `acp` profile ships ready-to-use
 * (persistence mounted), so `configPath` is optional there; the `sdk`
 * profile requires an explicit Cordis config containing the JSON-RPC server
 * plugin (callers enforce fail-closed, this builder never invents one).
 */
export function buildDeepSeekProfileArgs(
  profile: DeepSeekProfileName | string = "sdk",
  extraArgs: readonly string[] = [],
  configPath?: string,
): string[] {
  const name = normalizeDeepSeekProfileName(typeof profile === "string" ? profile : "sdk");
  const args = ["--profile", name, ...extraArgs];
  const trimmed = (configPath ?? "").trim();
  if (trimmed) args.push("--patch", trimmed);
  return args;
}

/**
 * Upstream ACP surface on `master` (docs + `packages/acp/acp/README.md`).
 * `setConfigOption` stays version-dependent: feature-detect per server
 * instead of assuming the method exists.
 */
export const DEEPSEEK_ACP_UPSTREAM = {
  freshSessionsOnly: false,
  supportedMethods: [
    "initialize",
    "authenticate",
    "session/new",
    "session/list",
    "session/resume",
    "session/close",
    "session/prompt",
    "session/cancel",
    "session/update",
    "session/request_permission",
  ],
  versionDependentMethods: ["session/set_config_option"],
  unsupportedMethods: [
    "session/delete",
    "session/fork",
    "transcript-replay",
    "additional-directories",
    "editor-navigation",
    "terminal-transport",
    "plans",
    "titles",
    "todos",
    "elicitation",
  ],
  mcpTransports: ["stdio", "streamable-http"],
  lifetime: "session-persisted",
} as const;

/** Back-compat alias (legacy name used by earlier revisions of this file). */
export const DEEPSEEK_ACP_UPSTREAM_LIMITS = DEEPSEEK_ACP_UPSTREAM;

/**
 * Capability-driven summary for a DeepSeek launch. Models are never listed
 * here (they come from the plan binding); capabilities are reported from the
 * resolved transport/profile rather than guessed from a pinned version.
 */
export interface DeepSeekCapabilitySummary {
  harnessKind: string;
  transport: DeepSeekTransportKind;
  profile: DeepSeekProfileName;
  executableCandidates: readonly string[];
  supportsNew: boolean;
  supportsList: boolean;
  supportsResume: boolean;
  supportsClose: boolean;
  supportsInterrupt: boolean;
  supportsStreaming: boolean;
  supportsMcpViaAcp: boolean;
  /** MCP source of truth stays the CraftStation MCP registry, projected via Cordis config or ACP `session/new` depending on transport. */
  mcpInjection: "cordis-config" | "acp-session";
  upstreamAcp: typeof DEEPSEEK_ACP_UPSTREAM;
}

export function getDeepSeekCapabilitySummary(
  harnessKind = "deepseek",
  profileRef?: string,
): DeepSeekCapabilitySummary {
  const profile = normalizeDeepSeekProfileName(profileRef);
  const acp = profile === "acp";
  return {
    harnessKind,
    transport: acp ? "acp-stdio" : "sdk-client",
    profile,
    executableCandidates: DEEPSEEK_EXECUTABLE_CANDIDATES,
    supportsNew: true,
    supportsList: acp,
    supportsResume: true,
    supportsClose: acp,
    supportsInterrupt: true,
    supportsStreaming: true,
    supportsMcpViaAcp: acp,
    mcpInjection: acp ? "acp-session" : "cordis-config",
    upstreamAcp: DEEPSEEK_ACP_UPSTREAM,
  };
}
