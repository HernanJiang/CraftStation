/**
 * Lightweight Codex app-server capability probe.
 *
 * Spawns a temporary app-server, speaks JSON-RPC over stdio, queries
 * `model/list` and `configRequirements/read`, then kills the process.
 * Falls back gracefully on any failure.
 *
 * Provider-specific — unlike the ACP probe, this speaks the Codex
 * app-server JSON-RPC 2.0 protocol over newline-delimited stdio.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentSlashCommand, ProjectLocation } from "@/shared/contracts";
import { terminateChildProcessTree } from "@/shared/processTree";
import { parseCodexAuth, resolveCodexToken } from "../../runtime/codexCredentials";
import { stripCodexRouterEnv } from "../../runtime/codexProfiles";
import { createNodeHttpClient } from "../../runtime/usageHttpClient";
import { resolveNodeForDistro } from "../../wsl/runtime";
import { resolveProbeSpawnCwd } from "../probeCwd";
import { buildCodexAppServerCommand } from "./argv";
import { probeCodexCliSemver } from "./plugin/install";
import { CodexStdioTransport } from "./stdioTransport";

// ── Types ────────────────────────────────────────────────────────

/** Raw model entry from the Codex `model/list` response. */
interface CodexModelEntry {
  id: string;
  model: string;
  displayName: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  // Fast/priority service-tier signals (Codex CLI 0.143.0+). Loosely typed —
  // older CLIs omit both fields, so treat the payload defensively. `["fast"]`
  // marks a model that honors `service_tier="fast"`; the `serviceTiers` list
  // carries the matching tier descriptor (e.g. the "priority"/Fast tier).
  additionalSpeedTiers?: string[];
  serviceTiers?: Array<{ id: string }>;
}

/** Raw requirements from `configRequirements/read`. */
interface CodexConfigRequirements {
  allowedApprovalPolicies?: string[] | null;
  allowedSandboxModes?: string[] | null;
}

export interface CodexProbeResult {
  models?: Array<{ id: string; label: string }>;
  efforts?: string[];
  defaultEffort?: string;
  modelEfforts?: Record<string, string[]>;
  /** Visible model ids that support the Fast/priority service tier. */
  fastModels?: string[];
  approvalPolicies?: Array<{ id: string; label: string }>;
  sandboxModes?: Array<{ id: string; label: string }>;
  slashCommands?: AgentSlashCommand[];
  disabledSkillNames?: string[];
}

/** Account info from Codex `account/read`. */
export interface CodexAccountInfo {
  /** "chatgpt" | "apiKey" | "amazonBedrock" | other future variants. */
  type?: string;
  /** Present when `type === "chatgpt"` and the user signed in via ChatGPT. */
  email?: string;
  /** Raw plan type token from `account/read` (`pro`, `plus`, `team`, ...). */
  planType?: string;
}

// ── Label maps ──────────────────────────────────────────────────

/** Default approval policies when no enterprise requirements restrict the list. */
const DEFAULT_APPROVAL_POLICIES: Array<{ id: string; label: string }> = [
  { id: "on-request", label: "On Request" },
  { id: "never", label: "Full Access" },
  { id: "untrusted", label: "Untrusted" },
];

const APPROVAL_POLICY_LABELS: Record<string, string> = {
  "on-request": "On Request",
  never: "Full Access",
  untrusted: "Untrusted",
};

/** Default sandbox modes when no enterprise requirements restrict the list. */
const DEFAULT_SANDBOX_MODES: Array<{ id: string; label: string }> = [
  { id: "workspace-write", label: "Workspace Write" },
  { id: "read-only", label: "Read Only" },
  { id: "danger-full-access", label: "Full Access" },
];

const SANDBOX_MODE_LABELS: Record<string, string> = {
  "workspace-write": "Workspace Write",
  "read-only": "Read Only",
  "danger-full-access": "Full Access",
};

const EFFORT_ORDER: Record<string, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
};

const PREFERRED_CODEX_DEFAULT_MODEL = "gpt-5.5";

// ── Mapping helpers ─────────────────────────────────────────────

/**
 * Build a human-friendly label from a Codex model entry.
 *
 * When the server returns a `displayName` that looks like a raw model ID
 * (e.g. "gpt-5.4-mini", "GPT-5.4-Mini"), strip the "gpt-" prefix and
 * title-case dash-separated segments so the UI shows "5.4 Mini".
 *
 * If the `displayName` is meaningfully different from the `id`, use it
 * as-is (the server provided a curated label).
 */
export function humanizeCodexModelName(id: string, displayName: string): string {
  // If the displayName differs from the id in more than just casing, trust it
  if (displayName.toLowerCase() !== id.toLowerCase()) {
    return displayName;
  }

  // Strip "gpt-" prefix and title-case segments
  const stripped = id.replace(/^gpt-/i, "");
  return stripped
    .split("-")
    .map((seg) => (seg.length <= 1 ? seg : seg[0]!.toUpperCase() + seg.slice(1)))
    .join(" ");
}

/**
 * Whether a single model entry advertises the Fast/priority service tier.
 *
 * Prefer the explicit `additionalSpeedTiers` list when present; only fall
 * back to `serviceTiers` (non-empty ⇒ a tier like "priority"/Fast exists)
 * when `additionalSpeedTiers` is absent.
 *
 * The tier id was renamed from "priority" to "fast" in the Fast mode
 * rollout, and old CLIs may still report "priority", so accept both.
 */
function codexModelSupportsFast(entry: CodexModelEntry): boolean {
  if (entry.additionalSpeedTiers !== undefined) {
    return (
      Array.isArray(entry.additionalSpeedTiers) &&
      entry.additionalSpeedTiers.some((tier) => tier === "fast" || tier === "priority")
    );
  }
  return Array.isArray(entry.serviceTiers) && entry.serviceTiers.length > 0;
}

/**
 * Codex-Router catalogs prefix their per-instance model ids with
 * `cr_<instance>_` (e.g. `cr_r4a61_openai/gpt-5.6-luna`). Those ids are
 * internal to one Router process: they change when the Router restarts and a
 * managed/isolated CODEX_HOME has no Router at all, so a persisted selection
 * turns into `unknown provider for model …` at turn time. They are never
 * safe to offer as selectable models.
 */
const CODEX_ROUTER_MODEL_ID_RE = /^cr_[a-z0-9]{2,12}_/i;

export function isCodexRouterModelId(modelId: string): boolean {
  return CODEX_ROUTER_MODEL_ID_RE.test(modelId);
}

export function mapCodexModels(
  models: CodexModelEntry[],
): Pick<CodexProbeResult, "models" | "efforts" | "defaultEffort" | "modelEfforts" | "fastModels"> {
  const visible = models.filter((m) => !m.hidden && !isCodexRouterModelId(m.id));
  if (visible.length === 0) return {};

  const ordered = [...visible].sort((a, b) => {
    if (a.id === PREFERRED_CODEX_DEFAULT_MODEL) return -1;
    if (b.id === PREFERRED_CODEX_DEFAULT_MODEL) return 1;
    return 0;
  });

  const mapped = ordered.map((m) => ({
    id: m.id,
    label: humanizeCodexModelName(m.id, m.displayName),
  }));

  // Collect per-model effort arrays
  const perModelEfforts = new Map<string, string[]>();
  const allEfforts = new Set<string>();
  for (const m of visible) {
    const efforts = m.supportedReasoningEfforts.map((e) => e.reasoningEffort);
    perModelEfforts.set(m.id, efforts);
    for (const e of efforts) allEfforts.add(e);
  }

  // Sort efforts by canonical order
  const sortedEfforts = [...allEfforts].sort(
    (a, b) => (EFFORT_ORDER[a] ?? 99) - (EFFORT_ORDER[b] ?? 99),
  );

  // Prefer high for Codex threads when the default model supports it.
  // The CLI may report medium as its built-in default, but CraftStation's
  // Codex UX should start at high unless the model can't use it.
  const defaultModel =
    visible.find((m) => m.id === PREFERRED_CODEX_DEFAULT_MODEL) ??
    visible.find((m) => m.isDefault) ??
    visible[0]!;
  const defaultModelEfforts = perModelEfforts.get(defaultModel.id) ?? [];
  const defaultEffort = defaultModelEfforts.includes("high")
    ? "high"
    : defaultModel.defaultReasoningEffort;

  // modelEfforts: only include models whose efforts differ from global list
  const globalKey = sortedEfforts.join(",");
  const modelEfforts: Record<string, string[]> = {};
  for (const [modelId, efforts] of perModelEfforts) {
    const sorted = [...efforts].sort((a, b) => (EFFORT_ORDER[a] ?? 99) - (EFFORT_ORDER[b] ?? 99));
    if (sorted.join(",") !== globalKey) {
      modelEfforts[modelId] = sorted;
    }
  }

  // Fast-mode capability. When the payload reports tier data on any visible
  // model, advertise Fast only for the models that actually support it.
  // Older Codex CLIs omit both tier fields entirely — in that case keep the
  // prior behavior and treat every visible model as fast-capable so the Fast
  // toggle isn't silently dropped after a downgrade.
  const reportsTierData = visible.some(
    (m) => m.additionalSpeedTiers !== undefined || m.serviceTiers !== undefined,
  );
  const fastModels = reportsTierData
    ? visible.filter((m) => codexModelSupportsFast(m)).map((m) => m.id)
    : visible.map((m) => m.id);

  return {
    models: mapped,
    efforts: sortedEfforts,
    defaultEffort,
    ...(Object.keys(modelEfforts).length > 0 ? { modelEfforts } : {}),
    ...(fastModels.length > 0 ? { fastModels } : {}),
  };
}

const CODEX_MODEL_CATALOG_ENDPOINT = "https://chatgpt.com/backend-api/codex/models";

interface CodexCatalogModel {
  slug?: string;
  display_name?: string;
  visibility?: string;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{ effort?: string; description?: string }>;
  additional_speed_tiers?: string[];
  service_tiers?: Array<{ id?: string }>;
  minimal_client_version?: string;
  priority?: number;
}

function parseSemverTriplet(value: string | undefined): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value?.trim() ?? "");
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function semverAtLeast(
  actual: readonly [number, number, number],
  required: readonly [number, number, number],
): boolean {
  if (actual[0] !== required[0]) return actual[0] > required[0];
  if (actual[1] !== required[1]) return actual[1] > required[1];
  return actual[2] >= required[2];
}

function catalogModelToEntry(model: CodexCatalogModel): CodexModelEntry | undefined {
  const slug = model.slug?.trim();
  if (!slug || model.visibility !== "list") return undefined;
  const efforts = (model.supported_reasoning_levels ?? [])
    .map((level) => ({
      reasoningEffort: level.effort?.trim() ?? "",
      description: level.description?.trim() ?? "",
    }))
    .filter((level) => level.reasoningEffort.length > 0);
  const serviceTiers = (model.service_tiers ?? [])
    .map((tier) => tier.id?.trim())
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id }));
  return {
    id: slug,
    model: slug,
    displayName: model.display_name?.trim() || slug,
    hidden: false,
    isDefault: false,
    defaultReasoningEffort:
      model.default_reasoning_level?.trim() || efforts[0]?.reasoningEffort || "medium",
    supportedReasoningEfforts: efforts,
    ...(Array.isArray(model.additional_speed_tiers)
      ? { additionalSpeedTiers: model.additional_speed_tiers }
      : {}),
    ...(serviceTiers.length > 0 ? { serviceTiers } : {}),
  };
}

/**
 * The installed Codex CLI's `model/list` can lag the account catalog. GPT-6
 * Sol and Luna shipped in the catalog for client 0.155 while that CLI's own
 * list still only advertised the 5.6 pair. Merge listed catalog slugs the CLI
 * omitted, and only when this CLI is new enough to run them.
 */
export function mergeCodexCatalogModels(
  cliModels: CodexModelEntry[],
  catalogBody: unknown,
  cliVersion: readonly [number, number, number] | null,
): CodexModelEntry[] {
  const models = (catalogBody as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return cliModels;
  const known = new Set(cliModels.map((model) => model.id));
  const extras = models
    .map((model) =>
      model && typeof model === "object"
        ? catalogModelToEntry(model as CodexCatalogModel)
        : undefined,
    )
    .filter((model): model is CodexModelEntry => model !== undefined)
    .filter((model) => !known.has(model.id))
    .filter((model) => {
      const raw = models.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          (candidate as CodexCatalogModel).slug === model.id,
      ) as CodexCatalogModel | undefined;
      const required = parseSemverTriplet(raw?.minimal_client_version);
      if (!required || !cliVersion) return true;
      return semverAtLeast(cliVersion, required);
    });
  extras.sort((a, b) => {
    const priority = (id: string) => {
      const raw = models.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          (candidate as CodexCatalogModel).slug === id,
      ) as CodexCatalogModel | undefined;
      return raw?.priority ?? 99;
    };
    return priority(a.id) - priority(b.id);
  });
  return [...cliModels, ...extras];
}

interface CodexCatalogToken {
  accessToken: string;
  accountId?: string;
}

/**
 * Host `~/.codex` is often a different or expired login. The pool account the
 * user actually refreshes (for example geminihe) lives under the managed
 * profiles, and that token is what the official catalog will accept.
 */
function codexCatalogTokens(): {
  push: (token: { accessToken?: string; accountId?: string } | undefined) => void;
  tokens: CodexCatalogToken[];
} {
  const tokens: CodexCatalogToken[] = [];
  const seen = new Set<string>();
  const push = (token: { accessToken?: string; accountId?: string } | undefined) => {
    const accessToken = token?.accessToken?.trim();
    if (!accessToken || seen.has(accessToken)) return;
    seen.add(accessToken);
    tokens.push({
      accessToken,
      ...(token?.accountId?.trim() ? { accountId: token.accountId.trim() } : {}),
    });
  };
  return { push, tokens };
}

function managedCodexAuthFiles(): string[] {
  const override = process.env["CRAFTSTATION_ACCOUNTS_DIR"]?.trim();
  const root =
    override && override.length > 0
      ? override
      : join(homedir(), ".craftstation", "craftstation-accounts");
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("profile-"))
    .map((entry) => join(root, entry.name, "auth.json"))
    .filter((path) => existsSync(path));
}

export async function fetchFirstCodexCatalog(
  tokens: readonly CodexCatalogToken[],
  request: (token: CodexCatalogToken) => Promise<{ status: number; body: string }>,
): Promise<unknown | undefined> {
  for (const token of tokens) {
    try {
      const response = await request(token);
      if (response.status < 200 || response.status >= 300) continue;
      return JSON.parse(response.body) as unknown;
    } catch {
      // A dead login must not hide the next account's catalog.
    }
  }
  return undefined;
}

async function mergeAccountCatalog(cliModels: CodexModelEntry[]): Promise<CodexModelEntry[]> {
  try {
    const version = probeCodexCliSemver();
    if (!version) return cliModels;
    const collected = codexCatalogTokens();
    collected.push(await resolveCodexToken({ allowWslFallback: false }));
    for (const path of managedCodexAuthFiles()) {
      try {
        collected.push(parseCodexAuth(readFileSync(path, "utf8")));
      } catch {
        // Skip unreadable profile homes.
      }
    }
    if (collected.tokens.length === 0) return cliModels;
    const versionText = version.join(".");
    const client = createNodeHttpClient();
    const catalog = await fetchFirstCodexCatalog(collected.tokens, (token) =>
      client.request({
        method: "GET",
        url: `${CODEX_MODEL_CATALOG_ENDPOINT}?client_version=${encodeURIComponent(versionText)}`,
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: "application/json",
          "User-Agent": `codex-cli/${versionText}`,
          "OpenAI-Beta": "codex-1",
          originator: "codex-cli",
          ...(token.accountId ? { "ChatGPT-Account-Id": token.accountId } : {}),
        },
        timeoutMs: 12_000,
      }),
    );
    if (!catalog) return cliModels;
    return mergeCodexCatalogModels(cliModels, catalog, version);
  } catch (error) {
    console.warn(
      "[codex] official model catalog merge skipped:",
      error instanceof Error ? error.message : error,
    );
    return cliModels;
  }
}

export interface CodexRawSlashCommand {
  name?: string;
  id?: string;
  description?: string;
  argumentHint?: string;
}

interface CodexRawSkillMetadata {
  name?: unknown;
  description?: unknown;
  shortDescription?: unknown;
  path?: unknown;
  enabled?: unknown;
  scope?: unknown;
}

export function readCodexInitCommands(initResult: unknown): CodexRawSlashCommand[] {
  if (!initResult || typeof initResult !== "object") return [];
  const commands = (initResult as { commands?: unknown }).commands;
  if (!Array.isArray(commands)) return [];
  return commands.filter((c): c is CodexRawSlashCommand => typeof c === "object" && c !== null);
}

export function mapCodexSlashCommands(
  commands: readonly CodexRawSlashCommand[],
): AgentSlashCommand[] {
  return commands.flatMap((c) => {
    const id = (c.name ?? c.id ?? "").trim();
    if (!id) return [];
    const description = c.description?.trim();
    return [
      {
        id,
        label: description ? `${id} — ${description}` : id,
        ...(description ? { description } : {}),
        ...(c.argumentHint?.trim() ? { argumentHint: c.argumentHint.trim() } : {}),
      },
    ];
  });
}

export function mapCodexSkillsToSlashCommands(skillsResult: unknown): AgentSlashCommand[] {
  return readCodexSkillMetadata(skillsResult).flatMap((skill) => {
    if (skill.enabled === false) return [];
    const name = typeof skill.name === "string" ? skill.name.trim() : "";
    const path = typeof skill.path === "string" ? skill.path.trim() : "";
    if (!name || !path || /\s/u.test(name)) return [];
    const description =
      typeof skill.shortDescription === "string" && skill.shortDescription.trim()
        ? skill.shortDescription.trim()
        : typeof skill.description === "string"
          ? skill.description.trim()
          : "";
    return [
      {
        id: name,
        label: description ? `${name} — ${description}` : name,
        ...(description ? { description } : {}),
        section: "skills" as const,
        skillName: name,
        skillPath: path,
        skillInvocation: `$${name}`,
        skillProvider: "Codex",
        skillScope: skill.scope === "repo" ? ("project" as const) : ("global" as const),
      },
    ];
  });
}

function readCodexSkillMetadata(skillsResult: unknown): CodexRawSkillMetadata[] {
  if (!skillsResult || typeof skillsResult !== "object") return [];
  const data = (skillsResult as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const skills = (entry as { skills?: unknown }).skills;
    if (!Array.isArray(skills)) return [];
    return skills.filter((raw): raw is CodexRawSkillMetadata =>
      Boolean(raw && typeof raw === "object"),
    );
  });
}

export function mapCodexDisabledSkillNames(skillsResult: unknown): string[] {
  return readCodexSkillMetadata(skillsResult).flatMap((skill) => {
    const name = typeof skill.name === "string" ? skill.name.trim() : "";
    return skill.enabled === false && name ? [name] : [];
  });
}

/**
 * Map `configRequirements/read` response to approval policies and sandbox modes.
 *
 * When requirements are null (no enterprise/MDM restrictions), returns the
 * full default lists. When requirements restrict the allowed values, filters
 * down to only those.
 */
export function mapCodexRequirements(
  requirements: CodexConfigRequirements | null | undefined,
): Pick<CodexProbeResult, "approvalPolicies" | "sandboxModes"> {
  // No enterprise restrictions — return full default lists
  if (!requirements) {
    return {
      approvalPolicies: DEFAULT_APPROVAL_POLICIES,
      sandboxModes: DEFAULT_SANDBOX_MODES,
    };
  }

  return {
    approvalPolicies: requirements.allowedApprovalPolicies?.length
      ? requirements.allowedApprovalPolicies
          .filter((p) => typeof p === "string")
          .map((id) => ({ id, label: APPROVAL_POLICY_LABELS[id] ?? id }))
      : DEFAULT_APPROVAL_POLICIES,
    sandboxModes: requirements.allowedSandboxModes?.length
      ? requirements.allowedSandboxModes
          .filter((m) => typeof m === "string")
          .map((id) => ({ id, label: SANDBOX_MODE_LABELS[id] ?? id }))
      : DEFAULT_SANDBOX_MODES,
  };
}

// ── JSON-RPC helpers ────────────────────────────────────────────

/**
 * Minimal JSON-RPC 2.0 client over app-server stdio for the probe.
 *
 * Lifetime: spawn → request/notify → dispose.
 */
class ProbeClient {
  private seq = 0;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly transport: CodexStdioTransport) {
    this.transport.setListener({
      onMessage: (message) => {
        if (!message || typeof message !== "object") return;
        const msg = message as Record<string, unknown>;
        if ("id" in msg && typeof msg.id === "string") {
          const entry = this.pending.get(msg.id);
          if (!entry) return;
          this.pending.delete(msg.id);
          if (msg.error !== undefined) {
            const err = msg.error;
            const errMsg =
              typeof err === "object" && err !== null && "message" in err
                ? String((err as Record<string, unknown>).message)
                : String(err);
            entry.reject(new Error(errMsg));
          } else {
            entry.resolve(msg.result);
          }
        }
      },
      onClose: () => {
        this.rejectAll(new Error(`Codex app-server exited.${this.transport.formatOutput()}`));
      },
      onError: (error) => {
        this.rejectAll(error);
      },
    });
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `probe-${this.seq++}`;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.transport.write({ id, method, params });
    return promise;
  }

  notify(method: string): void {
    this.transport.write({ method });
  }

  dispose(): void {
    this.rejectAll(new Error("Probe disposed."));
    this.transport.dispose();
  }
}

// ── Probe ───────────────────────────────────────────────────────

interface CodexAppServerSession {
  client: ProbeClient;
  initResult: unknown;
}

interface RunWithCodexAppServerOptions {
  wslExecPath?: string;
  timeoutMs?: number;
  label?: string;
  signal?: AbortSignal;
}

/**
 * Spawn a temporary Codex app-server, run `initialize` + `initialized`, then
 * hand the connected client to `fn`. Tears the process down on success or
 * failure. Returns `undefined` on any failure (spawn error, init timeout,
 * exception thrown by `fn`).
 */
async function runWithCodexAppServer<T>(
  location: ProjectLocation,
  options: RunWithCodexAppServerOptions | undefined,
  fn: (session: CodexAppServerSession) => Promise<T>,
): Promise<T | undefined> {
  const timeoutMs = options?.timeoutMs ?? 12_000;
  const tag = options?.label ? `[codex-probe:${options.label}]` : "[codex-probe]";
  let appServer: ChildProcess | undefined;
  let client: ProbeClient | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let abortProbe: (() => void) | undefined;
  const ownedProcessGroup = process.platform !== "win32";

  if (options?.signal?.aborted) return undefined;

  try {
    const wslNodePath =
      location.kind === "wsl" ? (await resolveNodeForDistro(location.distro)).nodePath : undefined;
    const cmd = buildCodexAppServerCommand(location, {
      ...(options?.wslExecPath !== undefined ? { wslExecPath: options.wslExecPath } : {}),
      ...(wslNodePath !== undefined ? { wslNodePath } : {}),
    });
    const spawnCwd = resolveProbeSpawnCwd(location, cmd.cwd);

    appServer = spawn(cmd.command, cmd.args, {
      cwd: spawnCwd ?? undefined,
      // Strip Codex-Router / CLIProxy routing keys: a host Router overlay must
      // not turn its per-instance `cr_*` catalog into CraftStation's model list.
      env: { ...stripCodexRouterEnv(process.env), ...cmd.env, TERM: "xterm-256color" },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      detached: ownedProcessGroup,
    });
    const transport = new CodexStdioTransport(appServer);

    const spawnError = await new Promise<Error | undefined>((resolve) => {
      appServer!.once("error", (err) => resolve(err));
      setImmediate(() => resolve(undefined));
    });
    if (spawnError) {
      console.log("%s failed to spawn: %s", tag, spawnError.message);
      return undefined;
    }
    if (appServer.exitCode !== null) {
      console.log("%s exited before probe:%s", tag, transport.formatOutput());
      return undefined;
    }

    const stop = () => {
      if (appServer) terminateChildProcessTree(appServer, { ownedProcessGroup });
    };
    const signal = options?.signal;
    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          abortProbe = () => {
            stop();
            reject(new Error("Codex probe aborted"));
          };
          signal.addEventListener("abort", abortProbe, { once: true });
          if (signal.aborted) abortProbe();
        })
      : undefined;
    return await Promise.race([
      (async () => {
        client = new ProbeClient(transport);
        const initResult = await client.request("initialize", {
          clientInfo: { name: "craftstation-probe", version: "0.1.0" },
          capabilities: { experimentalApi: true, requestAttestation: false },
        });
        client.notify("initialized");
        return await fn({ client, initResult });
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          stop();
          reject(new Error("Codex probe timed out"));
        }, timeoutMs);
        if (typeof timeout.unref === "function") timeout.unref();
      }),
      ...(abortPromise ? [abortPromise] : []),
    ]);
  } catch (err) {
    console.log("%s failed: %s", tag, err instanceof Error ? err.message : err);
    return undefined;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortProbe) options?.signal?.removeEventListener("abort", abortProbe);
    client?.dispose();
    if (appServer && !appServer.killed) {
      terminateChildProcessTree(appServer, { ownedProcessGroup });
    }
  }
}

function extractCodexAccountInfo(rawResponse: unknown): CodexAccountInfo | undefined {
  if (!rawResponse || typeof rawResponse !== "object") return undefined;
  const account = (rawResponse as { account?: unknown }).account;
  if (!account || typeof account !== "object") return undefined;
  const accountObj = account as Record<string, unknown>;
  const type = typeof accountObj.type === "string" ? accountObj.type : undefined;
  const email = typeof accountObj.email === "string" ? accountObj.email.trim() : undefined;
  const planType = typeof accountObj.planType === "string" ? accountObj.planType.trim() : undefined;
  if (!type && !email && !planType) return undefined;
  return {
    ...(type ? { type } : {}),
    ...(email ? { email } : {}),
    ...(planType ? { planType } : {}),
  };
}

/**
 * Spawn a temporary Codex app-server, query `account/read`, then kill it.
 * Returns the (typed but loosely-validated) account info, or `undefined` on
 * any failure.
 */
export async function probeCodexAccount(
  location: ProjectLocation,
  options?: RunWithCodexAppServerOptions,
): Promise<CodexAccountInfo | undefined> {
  return runWithCodexAppServer(
    location,
    { ...options, label: options?.label ?? "account" },
    async ({ client }) => {
      const response = await client.request("account/read", {});
      return extractCodexAccountInfo(response);
    },
  );
}

/**
 * Spawn a temporary Codex app-server, discover its capabilities,
 * then kill it.
 *
 * Returns `undefined` on any failure (timeout, auth issues,
 * missing CLI, etc.).
 */
export async function probeCodexCapabilities(
  location: ProjectLocation,
  options?: { wslExecPath?: string; timeoutMs?: number; label?: string },
): Promise<CodexProbeResult | undefined> {
  const result = await runWithCodexAppServer(location, options, async ({ client, initResult }) => {
    const [modelResult, requirementsResult, skillsResult] = await Promise.all([
      client.request("model/list", { includeHidden: false }),
      client.request("configRequirements/read", {}).catch((error) => {
        console.warn("[codex] configRequirements/read failed:", error);
        return undefined;
      }),
      client.request("skills/list", { forceReload: true }).catch((error) => {
        console.warn("[codex] skills/list failed:", error);
        return undefined;
      }),
    ]);
    return { initResult, modelResult, requirementsResult, skillsResult };
  });

  if (!result) return undefined;

  const probeResult: CodexProbeResult = {};

  const initCommands = readCodexInitCommands(result.initResult);
  if (initCommands.length > 0) {
    probeResult.slashCommands = mapCodexSlashCommands(initCommands);
  }
  const skillCommands = mapCodexSkillsToSlashCommands(result.skillsResult);
  if (result.skillsResult !== undefined) {
    probeResult.disabledSkillNames = mapCodexDisabledSkillNames(result.skillsResult);
  }
  if (skillCommands.length > 0) {
    probeResult.slashCommands = [...(probeResult.slashCommands ?? []), ...skillCommands];
  }

  const modelData =
    result.modelResult && typeof result.modelResult === "object" && "data" in result.modelResult
      ? (result.modelResult as { data: CodexModelEntry[] }).data
      : undefined;

  const mergedModels = await mergeAccountCatalog(modelData ?? []);
  if (mergedModels.length) {
    Object.assign(probeResult, mapCodexModels(mergedModels));
  }

  const requirements =
    result.requirementsResult &&
    typeof result.requirementsResult === "object" &&
    "requirements" in result.requirementsResult
      ? (result.requirementsResult as { requirements: CodexConfigRequirements | null }).requirements
      : undefined;

  Object.assign(probeResult, mapCodexRequirements(requirements));

  return probeResult;
}
