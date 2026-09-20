import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  AgentKind,
  CaptureExperimentSnapshotPayload,
  CaptureExperimentSnapshotResult,
  CloneRepoPayload,
  CloneRepoResult,
  DetectSetupScriptPayload,
  DetectSetupScriptResult,
  GitProjectSnapshotPayload,
  GitProjectSnapshotResult,
  GitPruneWorktreesPayload,
  GitRemoveWorktreePayload,
  GitSyncPayload,
  GitSyncResult,
  JudgeExperimentSnapshotPayload,
  JudgeExperimentSnapshotResult,
  ProjectLocation,
  RemoveExperimentWorktreesPayload,
  RemoveExperimentWorktreesResult,
  RelocateProjectPayload,
  RelocateProjectResult,
  AccountAddPayload,
  AccountBinding,
  AccountPoolConfigPayload,
  AccountProviderPayload,
  AccountRenamePayload,
  AccountResolution,
  AccountResolutionRequest,
  AccountView,
  TokenUsagePayload,
  TokenUsageResponse,
  CodexProfileCreatePayload,
  CodexProfileImportPayload,
  CodexProfileLoginPayload,
  CodexProfileLoginResult,
  GrokProfileLoginCreatePayload,
  GrokProfileLoginCreateResult,
  GrokProfileLoginPayload,
  GrokProfileLoginResult,
  KimiProfileCreatePayload,
  KimiProfileImportPayload,
  KimiProfileApiKeyPayload,
  KimiProfileLoginPayload,
  KimiProfileLoginResult,
  GrokProfileCompletePayload,
  GrokProfileCancelPayload,
  GrokProfilePollPayload,
  GrokProfilePollResult,
  McpServer,
  PromptSegment,
  ProviderPoolConfig,
  ResolveThreadServerRequestPayload,
  ResolvedMcpServer,
  SendThreadInputPayload,
  InterruptThreadPayload,
  SetPendingSteerPayload,
  ClearPendingSteerPayload,
  CloseThreadPayload,
  SwitchThreadProviderPayload,
  SwitchThreadProviderResult,
  NativeSessionPathQuery,
  NativeSessionPathResult,
} from "@/shared/contracts";
import { resolveNativeSessionPath } from "./runtime/nativeSessionPaths";
import type {
  CraftRequestResolution,
  CraftSession,
  CraftingDiscoveredModel,
  CraftingModelInventory,
  CraftingModelInventoryPayload,
  HarnessRuntimeAdapter,
  NativeHarnessDiagnostic,
  NativeHarnessControlPlaneEntry,
  NativeHarnessControlPlanePayload,
  PromptResult,
  TurnResult,
} from "@/shared/crafting";
import {
  resolveCompatibility,
  type ResolveCompatibilityPayload,
  type ResolveCompatibilityResult,
} from "@/shared/crafting/compatibility";
import {
  compatibilityBridgeStatusSchema,
  type CompatibilityBridgeStatusView,
} from "@/shared/crafting/compatibilityBridge";
import { craftPlanSchema, nativeRuntimeExecutionConfigForPlan } from "@/shared/crafting";
import { isThirdPartyAccountId } from "@/shared/thirdPartyRouting";
import { sanitizePortableRecord } from "./sessionHandoff/redaction";
import {
  AccountControlError,
  BUILT_IN_MCP_SERVER_NAMES,
  DEFAULT_MCP_SERVER_TIMEOUT_MS,
} from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import type {
  CraftAgentPayload,
  CraftAgentResult,
  ResumeCraftAgentPayload,
} from "@/shared/ipc/schemas";
import { crossagentRankingPreferences } from "@/shared/crossagentRanking";
import type { CrossagentRoutingState } from "@/shared/crossagentRanking";
import type { ConfirmOwnSubagentsRoutingOverridePayload } from "@/shared/ipc/procedures/mcp";
import { msg } from "@/shared/messages";
import { resolveCraftStationBaseDir, resolveCraftStationPaths } from "@/shared/craftstationPaths";
import { joinProjectPosixPath } from "@/shared/wsl";
import { prefetchNativeNodeRuntime } from "./runtime/prefetchNativeNode";
import {
  setSessionFsBridgeClient,
  setWslProcessBridgeClient,
  type AgentAdapter,
  type AgentNativePlugin,
} from "./agents/base";
import {
  isCompatibilityBridgeStartable,
  resolveCompatibilityBridgeBinary,
} from "./runtime/compatibilityBridge/binaryResolution";
import {
  compatibilityBridgeUserToolsDir,
  installCliProxyApiBinary,
  isHostNativeCliProxyBinary,
} from "./runtime/compatibilityBridge/install";
import { setWslAttachmentBridgeClient } from "./runtime/threadAttachments";
import { FileIndexService } from "./fileIndex";
import { GitService, resolveBuiltInWorktreeRoot, type CapturedExperimentSnapshot } from "./git";
import { resolveThreadWorkspace } from "@/shared/homeScope";
import { normalizeWorktreePathForComparison, resolveWorktreePlacement } from "@/shared/worktree";
import { GitCheckpointService } from "./git/checkpointService";
import { GitHubService } from "./github";
import { ProjectWatcher } from "./projectWatcher";
import { LanguageServerManager } from "./lsp";
import { ProjectTreeService } from "./projectTree";
import { WINDOWS_SHELL_AUTO } from "@/shared/settings";
import {
  detectWindowsShells,
  inferWindowsShellKind,
  selectWindowsPowerShell,
  selectWindowsShell,
  setWindowsPowerShellPreferenceResolver,
  type WindowsShellPreference,
} from "./shellPreference";
import { getWindowsSystemCommand } from "./agents/base/shellBasics";
import { resolveExecutablePath } from "./agents/base/processRuntime";
import { AgentStatusService, detectWslAgentStatuses } from "./runtime/agentStatusService";
import { createLocalUsageCollectors } from "./runtime/localUsageCollectors";
import { UsageService } from "./runtime/usageService";
import { setWslCredentialProjectScope } from "./runtime/wslCredentials";
import { AgentRegistryService } from "./runtime/agentRegistryService";
import { GenerationService } from "./runtime/generationService";
import { type SessionRuntime, type ShellSessionRuntime } from "./runtime/sessionTypes";
import { ThreadSessionManager, writeSubmittedPrompt } from "./runtime/threadSessionManager";
import { CliHookPluginCoordinator } from "./runtime/cliHookPluginCoordinator";
import { OwnSubagentsMcpIngress } from "./crossagentMcp/CrossagentMcpIngress";
import { SubagentRunManager } from "./crossagentMcp/SubagentRunManager";
import { RoutingOverridePersistence } from "./crossagentMcp/RoutingOverridePersistence";
import {
  visibleCrossagentCapabilitiesForAdapter,
  type CrossagentVisibilitySettings,
} from "./crossagentMcp/availability";
import { buildSpawnableAgents } from "./crossagentMcp/toolRegistry";
import {
  crossagentRoutingSnapshot,
  listCrossagentEligibleProviders,
} from "./crossagentMcp/routingSnapshot";
import { dispatchAgentEvent } from "./runtime/agentEventDispatcher";
import { hookDebugEnvelope, isCraftStationHookDebug } from "./runtime/hookDebug";
import { SupervisorSharedSettingsCache } from "./runtime/supervisorSharedSettings";
import { WslBridgeServer } from "./wsl/bridge";
import { WslBridgeClient } from "./wsl/bridge/client";
import { resolveWslHelpersDir } from "./wsl/wslDeploy";
import { resolveWslHostAccess } from "./wsl/hostAccess";
import { McpOAuthService } from "./mcp/McpOAuthService";
import { McpProbeService } from "./mcp/McpProbeService";
import { prepareMcpToolFilters } from "./mcp/McpToolFilterService";
import { resolveCapabilities, type BuiltInMcpCandidate } from "./capabilities/capabilityResolver";
import {
  readComputerUseMcpEnv,
  resolveComputerUseMcpHttpConfig,
} from "@/supervisor/agents/computerUseMcp";
import { ExternalMcpDiscoveryService } from "./mcp/ExternalMcpDiscoveryService";
import { SkillsService } from "./skills/SkillsService";
import { dropSkillSegmentsOnPolicyFailure } from "./skills/pluginSkillPolicy";
import { PluginRegistry, resolvePluginMcpServers } from "./plugins";
import { captureExperimentResponseSnapshot } from "./experimentResponseSnapshot";
import { CompatibilityBridgeService } from "./runtime/compatibilityBridge";
import { CompatibilityRuntimeAdapter } from "./runtime/compatibilityBridge/compatibilityRuntimeAdapter";
import { createCompatibilityTargetRuntime } from "./runtime/compatibilityBridge/targetRuntime";
import { projectCompatibilityAccount } from "./runtime/compatibilityBridge/accountProjection";
import { OwnedHarnessRuntimes } from "./runtime/ownedHarnessRuntimes";
import { permissionConfigSchema } from "@/shared/contracts/config";
import { NativeCodexRuntimeAdapter } from "./runtime/nativeCodex";
import { CraftingError } from "@/shared/crafting/errors";
import { AccountResolver } from "./runtime/accountResolver";
import { AccountStore, QUOTA_INFERENCE_MARK_TTL_MS } from "./runtime/accountStore";
import {
  MAX_POOL_FAILOVER_ATTEMPTS_PER_TURN,
  POOL_FAILOVER_PROVIDERS,
  THIRD_PARTY_CHANNEL_PROVIDER,
  isPoolQuotaErrorForProvider,
  isPoolRotationProvider,
  isThirdPartyProtocolFlipError,
  thirdPartyFailureKind,
} from "./runtime/poolQuota";
import { createNativeHarnessRuntimeAdapter } from "./runtime/nativeHarness";
import {
  isGrokPoolQuotaError,
  isKimiPoolQuotaError,
  resolveAcpPromptRpcErrorMessage,
} from "./agents/acp/sessionErrors";
import { isCodexPoolQuotaError } from "./agents/codex/sessionErrors";
import {
  createRuntimeLedgerTokenUsageScanner,
  TokenUsageAdapter,
} from "./runtime/tokenUsageAdapter";
import {
  KimiProfileService,
  buildKimiLoginScript,
  managedKimiLoginCwd,
  managedKimiProcessEnvironment,
} from "./runtime/kimiProfiles";
import {
  CodexProfileService,
  buildCodexLoginScript,
  managedCodexLoginCwd,
  managedCodexProcessEnvironment,
  scrubManagedCodexConfig,
} from "./runtime/codexProfiles";
import { prepareNativeProfile, verifyProfileIdentity } from "./runtime/nativeProfile";
import {
  GrokProfileService,
  buildGrokLoginScript,
  createPendingGrokHome,
  managedGrokLoginCwd,
  managedGrokProcessEnvironment,
  grokAccountIdentityFromContainer,
} from "./runtime/grokProfiles";
import { AntigravityProfileService } from "./runtime/antigravityProfiles";
import {
  isAntigravityAuthError,
  isAntigravityQuotaError,
} from "./agents/antigravity/sessionErrors";
import { OpenAiCompatibleProfileService } from "./runtime/openaiCompatibleProfiles";
import { grokAuthContainer } from "./runtime/grokCredentials";
import { NATIVE_HARNESS_DESCRIPTORS } from "./runtime/nativeHarness/descriptors";
import { projectNativeHarnessControlPlane } from "./runtime/nativeHarness/controlPlane";
import { AccountStoreOpenCodeRuntimeBindingResolver } from "./runtime/openCodeNative/runtimeBinding";
import { OpenCodeNativeServerPool } from "./runtime/openCodeNative/serverPool";
import { ensureThreadWorkspace } from "./runtime/threadWorkspace";
import { resolveCraftedRequest, type CraftedRequest } from "./runtime/craftedRequestResolution";
import { probeCodexCapabilities } from "./agents/codex/probe";
import type {
  RequestSessionSwitchPayload,
  SessionSwitchResult,
  SessionSwitchState,
} from "@/shared/sessionHandoff";
import { RuntimeSegmentLedger } from "./sessionHandoff/segmentLedger";
import {
  SessionHandoffCoordinator,
  SessionHandoffError,
  type PreparedTargetRuntime,
} from "./sessionHandoff/coordinator";

export { detectWslAgentStatuses, writeSubmittedPrompt };

/**
 * Parse the renderer's stable model material id. Agent material ids are
 * `agent:<provider-surface>:<presentation>:<model>` and custom material ids
 * begin `custom:<provider>:...`; in both cases the provider is the second
 * segment. Unknown ids are rejected instead of borrowing the Harness vendor.
 */
function modelProviderFromEntryRef(entryRef: string): string | undefined {
  const parts = entryRef.split(":");
  if (parts[0] !== "agent" && parts[0] !== "custom") return undefined;
  if (parts.length < 3 || !parts.slice(2).join(":").trim()) return undefined;
  const provider = parts[1]?.trim();
  return provider && /^[a-z][a-z0-9-]*$/u.test(provider) ? provider : undefined;
}

/**
 * Absolute force-stop deadline for crafted interrupts, mirroring the legacy
 * StructuredInterruptWatchdog grace. If the native runtime does not
 * acknowledge Stop with a turn completion by this point, the turn is closed
 * locally so the renderer can never stay wedged in "working".
 */
const CRAFTED_INTERRUPT_FORCE_STOP_MS = 3_000;

/** Retry budget for a transiently all-unusable account pool (see resolveAccountSessionEnv). */
const ACCOUNT_RESOLUTION_RETRIES = 3;
const ACCOUNT_RESOLUTION_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function enrichCraftingError(
  error: CraftingError,
  plan: CraftAgentPayload["craftPlan"],
  entityId: string | undefined,
  sessionId: string | undefined,
) {
  const detail = error.toDetail();
  return {
    ...detail,
    details: {
      ...(detail.details ?? {}),
      recipeId: plan.recipeId,
      modelId: plan.runtimeBinding.modelId,
      harnessKind: plan.runtimeBinding.harnessKind,
      ...(plan.threadId ? { threadId: plan.threadId } : {}),
      ...(entityId ? { entityId } : {}),
      ...(sessionId ? { sessionId } : {}),
    },
  };
}

function toPublicExperimentSnapshot(
  snapshot: CapturedExperimentSnapshot,
): CaptureExperimentSnapshotResult {
  return {
    hash: snapshot.hash,
    candidates: snapshot.candidates.map(({ diff: _diff, ...candidate }) => candidate),
  };
}

/**
 * A native CraftSession may surface a quota death as a resolved failed
 * turn (`TurnResult.status === "failed"` carrying the provider text)
 * instead of a rejection. Detect that shape with the same
 * provider-dispatched matcher so crafted pool failover runs for both —
 * mirroring the legacy lane, where the in-stream failure rejects like an
 * RPC quota rejection for exactly this reason.
 */
function readCraftedQuotaFailure(provider: string, result: unknown): Error | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const record = result as { status?: unknown; error?: unknown };
  if (record.status !== "failed") return undefined;
  const message = typeof record.error === "string" ? record.error : "";
  if (!message) return undefined;
  const probe = new Error(message);
  return isPoolQuotaErrorForProvider(provider, probe) ? probe : undefined;
}

/**
 * Project a raw provider quota shape into the actionable banner text before
 * it travels further. The legacy lane gets this projection from the ACP
 * session (raw "Internal error" becomes "Grok 额度已耗尽"); custom crafted
 * adapters may reject with the raw shape, and the failover banner + write-
 * back must stay readable. Idempotent: projecting an already-projected
 * message returns it unchanged.
 */
function projectCraftedQuotaError(provider: string, error: unknown): Error {
  if (provider === "grok") {
    const message = resolveAcpPromptRpcErrorMessage(error);
    if (error instanceof Error && error.message === message) return error;
    return new Error(message, { cause: error });
  }
  return error instanceof Error ? error : new Error(String(error ?? "quota exhausted"));
}

/**
 * Third-party counterpart of {@link readCraftedQuotaFailure}: a resolved
 * failed turn whose text classifies as a channel quota/rate death fuels
 * rotation the same way a rejection does.
 */
function readCraftedChannelFailure(result: unknown): Error | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const record = result as { status?: unknown; error?: unknown };
  if (record.status !== "failed") return undefined;
  const message = typeof record.error === "string" ? record.error : "";
  if (!message) return undefined;
  const probe = new Error(message);
  return thirdPartyFailureKind(probe) !== undefined ? probe : undefined;
}

/**
 * Resolved-failed-turn counterpart of the protocol-flip trigger: a failed
 * turn carrying 400-class wire-type text fuels a same-channel flip the same
 * way a 400 rejection does.
 */
function readCraftedFlipFailure(result: unknown): Error | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const record = result as { status?: unknown; error?: unknown };
  if (record.status !== "failed") return undefined;
  const message = typeof record.error === "string" ? record.error : "";
  if (!message) return undefined;
  const probe = new Error(message);
  return isThirdPartyProtocolFlipError(probe) ? probe : undefined;
}

export class SupervisorRuntime {
  private _customCraftingAdapter?:
    | ((
        plan: CraftAgentPayload["craftPlan"],
        location: ProjectLocation,
      ) => import("@/shared/crafting").HarnessRuntimeAdapter)
    | undefined;

  setCustomCraftingAdapter(
    factory?:
      | ((
          plan: CraftAgentPayload["craftPlan"],
          location: ProjectLocation,
        ) => import("@/shared/crafting").HarnessRuntimeAdapter)
      | undefined,
  ): void {
    this._customCraftingAdapter = factory;
  }

  private _compatibilityRuntimeAdapterFactory?:
    | ((
        harnessKind: string,
        accountId: string | undefined,
      ) =>
        | import("@/shared/crafting").HarnessRuntimeAdapter
        | Promise<import("@/shared/crafting").HarnessRuntimeAdapter>
        | undefined)
    | undefined;

  /**
   * Override the production Compatibility adapter (real CLIProxyAPI sidecar +
   * official Target Harness CLI). Returning undefined keeps the honest
   * RUNTIME_UNAVAILABLE fail-closed behavior.
   */
  setCompatibilityRuntimeAdapterFactory(
    factory?:
      | ((
          harnessKind: string,
          accountId: string | undefined,
        ) =>
          | import("@/shared/crafting").HarnessRuntimeAdapter
          | Promise<import("@/shared/crafting").HarnessRuntimeAdapter>
          | undefined)
      | undefined,
  ): void {
    this._compatibilityRuntimeAdapterFactory = factory;
  }

  /**
   * Production Compatibility adapter: the long-lived CLIProxyAPI singleton
   * (env → PATH → bundled `.tools/cpa` → portable extra dirs) plus a
   * session-scoped account credential namespace. Undefined when no sidecar
   * binary exists so the route stays honestly RUNTIME_UNAVAILABLE.
   */
  private async createDefaultCompatibilityRuntimeAdapter(
    harnessKind: string,
    accountId: string | undefined,
    projectLocation: ProjectLocation,
    candidateMcpServers: McpServer[] | undefined,
  ): Promise<import("@/shared/crafting").HarnessRuntimeAdapter | undefined> {
    const resolution = this.resolveCompatibilityBridgeBinaryForHost();
    if (!resolution.binaryPath) return undefined;
    let accountPin: { accountId: string; credentialNamespace: string; authDir: string } | undefined;
    if (accountId) {
      const record = this.accountStore.getRecord(accountId);
      if (record) {
        accountPin = {
          accountId,
          credentialNamespace: "cli-proxy-api-auth",
          authDir: projectCompatibilityAccount(
            record.provider,
            this.accountStore.credentialRoot(record.accountId),
            join(
              this.baseDir,
              "compatibility-auth",
              record.accountId.replace(/[^A-Za-z0-9._-]/g, "_"),
            ),
          ),
        };
      } else {
        throw new Error("CPA 配方绑定的账号不存在，请重新选择模型账号。");
      }
    }
    const service = this.compatibilityBridgeService;
    if (!service.getStatus().running) {
      service.configure({
        binaryPath: resolution.binaryPath,
        ...(accountPin ? { authDir: accountPin.authDir } : {}),
      });
    }
    return new CompatibilityRuntimeAdapter(harnessKind, {
      bridge: service,
      ownsBridge: false,
      ...(accountPin ? { accountPin } : {}),
      createTargetAdapter: async (config, plan) => {
        const skills = await this.resolveCraftingSkills(plan, projectLocation);
        return createCompatibilityTargetRuntime({
          config,
          plan,
          projectLocation,
          directory: join(
            this.baseDir,
            "compatibility-runtime",
            (plan.threadId ?? plan.id).replace(/[^A-Za-z0-9._-]/g, "_"),
          ),
          agent: this.adapters.get(harnessKind),
          descriptor:
            NATIVE_HARNESS_DESCRIPTORS[harnessKind as keyof typeof NATIVE_HARNESS_DESCRIPTORS],
          mcpServers:
            (await this.resolveCraftingMcpServers(plan, projectLocation, candidateMcpServers)) ??
            [],
          skillSegments: skills.segments,
          ...(skills.inlineInstructions
            ? { inlineSkillInstructions: skills.inlineInstructions }
            : {}),
        });
      },
    });
  }

  private resolveCompatibilityBridgeBinaryForHost(options?: {
    cwd?: string;
    existsSync?: (path: string) => boolean;
    resolveOnPath?: (command: string) => string | undefined;
  }) {
    const goPath = process.env.GOPATH?.trim();
    const extraSearchDirs = [
      compatibilityBridgeUserToolsDir(this.baseDir),
      typeof process.resourcesPath === "string" && process.resourcesPath
        ? join(process.resourcesPath, "cpa")
        : "",
      join(dirname(process.execPath), ".tools", "cpa"),
      join(homedir(), "go", "bin"),
      goPath ? join(goPath, "bin") : "",
    ].filter((dir) => dir.length > 0);
    return resolveCompatibilityBridgeBinary({
      envBinaryPath: process.env.CLIPROXY_BINARY_PATH,
      platform: process.platform,
      cwd: options?.cwd ?? process.cwd(),
      existsSync:
        options?.existsSync ??
        ((path) => existsSync(path) && isHostNativeCliProxyBinary(path, process.platform)),
      resolveOnPath: options?.resolveOnPath ?? ((command) => resolveExecutablePath(command)),
      extraSearchDirs,
    });
  }

  private isCompatibilityBridgeStartableForHost(options?: {
    cwd?: string;
    existsSync?: (path: string) => boolean;
    resolveOnPath?: (command: string) => string | undefined;
  }): boolean {
    return isCompatibilityBridgeStartable({
      running: this.compatibilityBridgeService.getStatus().running,
      binaryPath: this.resolveCompatibilityBridgeBinaryForHost(options).binaryPath,
    });
  }

  private _craftingModelDiscovery:
    | ((location: ProjectLocation) => Promise<CraftingDiscoveredModel[] | undefined>)
    | undefined;

  setCraftingModelDiscovery(
    discovery?: (location: ProjectLocation) => Promise<CraftingDiscoveredModel[] | undefined>,
  ): void {
    this._craftingModelDiscovery = discovery;
  }
  private readonly isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  private readonly baseDir: string;
  private readonly emit: (event: SupervisorEvent) => void;
  private readonly runtimeEventSubscribers = new Set<
    (threadId: string, event: import("@/shared/contracts").RuntimeEvent) => void
  >();
  private readonly logsDir: string;
  private readonly settingsPath: string;
  private readonly acpIconsDir: string;
  private readonly sharedSettingsCache: SupervisorSharedSettingsCache;
  // The service cluster is public on purpose: `createSupervisorIpcHandlers`
  // maps IPC procedures straight onto these services — this class only wires
  // them together and hosts the few cross-service orchestrations below.
  readonly compatibilityBridgeService = new CompatibilityBridgeService();
  readonly gitService = new GitService();
  readonly gitCheckpointService = new GitCheckpointService();
  private _projectWatcher: ProjectWatcher | undefined;
  readonly githubService = new GitHubService();
  readonly fileIndexService = new FileIndexService();
  readonly projectTreeService = new ProjectTreeService();
  private readonly adapters = new Map<AgentKind, AgentAdapter>();
  /**
   * Native composition adapters are created per CraftPlan. Keep the latest
   * instance for the control-plane read model so provider failures observed
   * after construction are not lost between IPC reads.
   */
  private readonly nativeHarnessAdapters = new Map<string, HarnessRuntimeAdapter>();
  private readonly ownedHarnessRuntimes = new OwnedHarnessRuntimes();
  /** Latest session per harness for the control-plane diagnostics projection. */
  private readonly nativeHarnessSessions = new Map<string, CraftSession>();
  /** Crafted sessions are not ThreadSessionManager sessions, so keep their
   * lifecycle and account binding indexed by the durable CraftStation thread.
   * This prevents an account from remaining locked after a crafted session
   * exits, while still protecting an account while any crafted session uses it.
   */
  private readonly craftedSessionBindings = new Map<string, AccountBinding>();
  /** Every live crafted session, keyed by its durable CraftStation thread id. */
  private readonly craftedSessionsByThread = new Map<string, CraftSession>();
  /** Immutable active plan per durable CraftStation thread. */
  private readonly craftedPlansByThread = new Map<string, CraftAgentPayload["craftPlan"]>();
  /**
   * MCP candidates the renderer handed to the most recent craft per thread.
   * Session handoff must relaunch the target with the same servers — the
   * handoff target plan compiles from model+harness slots alone, so without
   * this snapshot `resolveCraftingMcpServers` sees no candidates and the
   * rebuilt session launches with every user-configured MCP server missing.
   */
  private readonly craftMcpCandidatesByThread = new Map<string, McpServer[]>();
  /**
   * Project location per crafted thread, captured at craft/resume/handoff
   * time. Same-turn pool failover rebuilds the session on the next usable
   * pool row; the rebuild needs the same location (and MCP candidates above)
   * but `sendThreadInput` carries neither.
   */
  private readonly craftProjectLocationByThread = new Map<string, ProjectLocation>();
  /**
   * Pool accounts a crafted turn already proved dead, per thread. Lets a
   * post-failover resume tolerate the renderer's stale stored binding (the
   * row still names the dead account until a craft result persists the new
   * one): a mismatch against a tried account is healed drift, not a plan
   * violation.
   */
  private readonly craftedFailoverTriedByThread = new Map<string, Set<string>>();
  /**
   * Failover-epoch guard per crafted thread, bumped by explicit Stop. A
   * quota failure racing a user interrupt must not rebuild + replay a turn
   * the user just killed (same role as the legacy lane's turn generation).
   */
  private readonly craftedFailoverEpochByThread = new Map<string, number>();
  /**
   * Third-party channels proved quota-dead, with the wall-clock time the
   * row becomes eligible again. Subscription rows persist this in the store
   * (marks + poller TTL); channel rows must not be store-marked — the relay
   * quota poller resets every row to available on each pass — so the
   * cooldown lives here, process-local, with the same house TTL.
   */
  private readonly thirdPartyChannelCooldownUntil = new Map<string, number>();
  /** Source binding retained only across target CAS -> bootstrap commit. */
  private readonly handoffSourceBindings = new Map<string, AccountBinding | undefined>();
  private readonly pendingHandoffEvents = new Map<
    string,
    import("@/shared/contracts").RuntimeEvent[]
  >();
  private readonly craftedSessionUnsubscribers = new Map<string, Map<string, () => void>>();
  private readonly craftedRequestsByThread = new Map<string, Map<string, CraftedRequest>>();
  /** Force-stop deadlines for crafted interrupts that the runtime never acknowledged. */
  private readonly craftedInterruptWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly runtimeSegmentLedger: RuntimeSegmentLedger;
  private readonly sessionHandoffCoordinator: SessionHandoffCoordinator;
  /** Per-account quota refresh locks so concurrent refreshes coalesce (v0.5 T09). */
  private readonly accountRefreshLocks = new Map<string, Promise<unknown>>();
  private availableWindowsShellsCache:
    | { shells: ReturnType<typeof detectWindowsShells>; ts: number }
    | undefined;
  readonly agentStatusService: AgentStatusService;
  readonly usageService: UsageService;
  readonly agentRegistryService: AgentRegistryService;
  readonly generationService: GenerationService;
  readonly threadSessionManager: ThreadSessionManager;
  readonly lspManager: LanguageServerManager;
  readonly cliHookPluginCoordinator: CliHookPluginCoordinator;
  readonly externalMcpDiscoveryService = new ExternalMcpDiscoveryService();
  readonly mcpOAuthService: McpOAuthService;
  readonly mcpProbeService: McpProbeService;
  readonly skillsService: SkillsService;
  readonly pluginRegistry: PluginRegistry;
  readonly accountStore: AccountStore;
  readonly accountResolver: AccountResolver;
  private readonly openCodeRuntimeBindingResolver: AccountStoreOpenCodeRuntimeBindingResolver;
  private readonly openCodeServerPool: OpenCodeNativeServerPool;
  readonly tokenUsageAdapter: TokenUsageAdapter;
  readonly codexProfileService: CodexProfileService;
  readonly grokProfileService: GrokProfileService;
  readonly kimiProfileService: KimiProfileService;
  readonly antigravityProfileService: AntigravityProfileService;
  readonly openAiCompatibleProfileService: OpenAiCompatibleProfileService;
  /**
   * Pending isolated Grok logins. A pending home is created WITHOUT an
   * AccountStore row; it is only promoted to an account by
   * `completeGrokProfileLogin` once the official auth file carries an identity.
   */
  readonly grokPendingLogins = new Map<
    string,
    { label: string; home: string; createdAt: number }
  >();
  private readonly pluginDataDir: string;
  private readonly ownSubagentsMcpIngress: OwnSubagentsMcpIngress;
  private readonly subagentRunManager: SubagentRunManager;
  private readonly routingOverridePersistence: RoutingOverridePersistence;
  private readonly disposeWslCredentialProjectScope: () => void;
  private readonly disposeWindowsPowerShellPreference: () => void;
  /**
   * In-flight host-follow writes per pool account (B-mode). Concurrent
   * Antigravity session starts for the same row share one CredWrite; rows
   * never interleave mid-write.
   */
  private readonly antigravityHostFollowInFlight = new Map<string, Promise<void>>();
  private wslHookBridge: WslBridgeServer | undefined;

  readonly sessions: Map<string, SessionRuntime>;
  readonly shellSessions: Map<string, ShellSessionRuntime>;

  get projectWatcher(): ProjectWatcher {
    if (!this._projectWatcher) {
      const watcher = new ProjectWatcher({
        onGitChanged: (projectId) => {
          this.emit({ type: "git-changed", projectId });
        },
        onTreeChanged: (projectId) => {
          this.projectTreeService.invalidateAllCaches();
          this.emit({ type: "project-tree-changed", projectId });
        },
      });
      if (this.wslBridgeClient) watcher.setWslClient(this.wslBridgeClient);
      this._projectWatcher = watcher;
    }
    return this._projectWatcher;
  }

  private wslBridgeClient: WslBridgeClient | undefined;

  constructor(emitToParent: (event: SupervisorEvent) => void) {
    const emit = (event: SupervisorEvent): void => {
      emitToParent(event);
      if (event.type === "thread-runtime-event") {
        this.observeParentTurnEnd(event.threadId, event.event);
        for (const listener of this.runtimeEventSubscribers) listener(event.threadId, event.event);
      } else if (event.type === "thread-runtime-events") {
        for (const runtimeEvent of event.events) {
          this.observeParentTurnEnd(event.threadId, runtimeEvent);
        }
        for (const listener of this.runtimeEventSubscribers) {
          for (const runtimeEvent of event.events) listener(event.threadId, runtimeEvent);
        }
      } else if (event.type === "thread-runtime-events-multi") {
        for (const batch of event.batches) {
          for (const runtimeEvent of batch.events) {
            this.observeParentTurnEnd(batch.threadId, runtimeEvent);
          }
        }
        for (const listener of this.runtimeEventSubscribers) {
          for (const batch of event.batches) {
            for (const runtimeEvent of batch.events) listener(batch.threadId, runtimeEvent);
          }
        }
      }
    };
    this.emit = emit;
    // Defensive: `process.env.X = undefined` coerces to the literal string
    // "undefined" in Node, and we've been bitten by that path creating
    // `./undefined/settings.json` in cwd. Also reject bare relative paths —
    // the supervisor must always operate out of an absolute baseDir so
    // writes land somewhere predictable regardless of cwd at spawn time.
    const rawBaseDir = process.env.CRAFTSTATION_DATA_DIR?.trim();
    const envBaseDir =
      rawBaseDir && rawBaseDir !== "undefined" && isAbsolute(rawBaseDir) ? rawBaseDir : undefined;
    const baseDir = envBaseDir ?? resolveCraftStationBaseDir();
    this.baseDir = baseDir;
    this.runtimeSegmentLedger = new RuntimeSegmentLedger(baseDir);
    this.sessionHandoffCoordinator = new SessionHandoffCoordinator({
      ledger: this.runtimeSegmentLedger,
      getSession: (threadId) => this.craftedSessionsByThread.get(threadId),
      getPlan: (threadId) => this.craftedPlansByThread.get(threadId),
      getPendingRequestCount: (threadId) => this.craftedRequestsByThread.get(threadId)?.size ?? 0,
      prepareTarget: (plan, location, accountId, accountMode) =>
        this.prepareHandoffTarget(plan, location, accountId, accountMode),
      activateTarget: (threadId, target, segment) => {
        this.handoffSourceBindings.set(threadId, this.craftedSessionBindings.get(threadId));
        this.pendingHandoffEvents.set(threadId, []);
        this.registerCraftedSession(
          threadId,
          target.plan.runtimeBinding.harnessKind,
          target.session,
          target.accountBinding,
          target.plan,
          target.entity.id,
          segment,
        );
      },
      restoreSource: (threadId, plan, session, segment) => {
        this.pendingHandoffEvents.delete(threadId);
        this.registerCraftedSession(
          threadId,
          plan.runtimeBinding.harnessKind,
          session,
          this.handoffSourceBindings.get(threadId),
          plan,
          session.entityId,
          segment,
        );
        this.handoffSourceBindings.delete(threadId);
      },
      commitTarget: (threadId) => {
        this.handoffSourceBindings.delete(threadId);
        const events = this.pendingHandoffEvents.get(threadId) ?? [];
        this.pendingHandoffEvents.delete(threadId);
        if (events.length > 0) this.emit({ type: "thread-runtime-events", threadId, events });
      },
      emitState: (state) =>
        this.emit({ type: "session-switch-state", threadId: state.threadId, state }),
    });
    this.mcpOAuthService = new McpOAuthService({ baseDir });
    this.mcpProbeService = new McpProbeService({
      applyAuthorization: (server) => this.mcpOAuthService.applyAuthorizationToServer(server),
    });
    const paths = resolveCraftStationPaths(baseDir);
    this.logsDir = paths.terminalLogsDir;
    this.settingsPath = paths.settingsPath;
    this.acpIconsDir = paths.acpIconsDir;
    this.sharedSettingsCache = new SupervisorSharedSettingsCache(this.settingsPath);
    this.disposeWindowsPowerShellPreference = setWindowsPowerShellPreferenceResolver(() => {
      const preference = this.resolveWindowsPowerShell();
      return preference.kind === "cmd"
        ? undefined
        : { path: preference.shell, kind: preference.kind };
    });
    this.routingOverridePersistence = new RoutingOverridePersistence({
      emit,
      invalidateSettings: () => this.sharedSettingsCache.invalidate(),
    });
    // The agent/ACP registry cluster. Constructed up front so the initial
    // adapter build below can run before the later-created services exist; those
    // dependencies (status/usage/hook-plugin/sessions) resolve lazily at call
    // time via the getter closures.
    this.agentRegistryService = new AgentRegistryService({
      adapters: this.adapters,
      settingsPath: this.settingsPath,
      baseDir,
      acpIconsDir: this.acpIconsDir,
      sharedSettingsCache: this.sharedSettingsCache,
      getAgentStatusService: () => this.agentStatusService,
      getActiveWslProjectDistros: () => this._projectWatcher?.getWslDistros() ?? [],
      closeThreadsForAgentKind: (agentKind) => this.closeThreadsForAgentKind(agentKind),
    });
    this.agentRegistryService.refreshAgentRegistryAdapters();
    mkdirSync(paths.cacheDir, { recursive: true });
    mkdirSync(this.logsDir, { recursive: true });

    // Prefetch the native Node resolver so the login-shell probe runs in
    // parallel with the rest of the supervisor boot. By the time providers'
    // `installPlugin` calls `resolveInstallNodePath`, the shared promise is
    // typically already settled. Failures surface as a single warn line.
    void prefetchNativeNodeRuntime(baseDir);

    this.lspManager = new LanguageServerManager(emit);
    this.agentStatusService = new AgentStatusService({
      adapters: this.adapters,
      settingsPath: this.settingsPath,
      statusCachePath: paths.statusCachePath,
      emit,
    });
    this.pluginRegistry = new PluginRegistry({
      bundledPluginsDir: () => process.env.CRAFTSTATION_BUNDLED_PLUGINS_DIR?.trim() || undefined,
      userPluginsDir: () => paths.pluginsDir,
    });
    this.pluginDataDir = paths.pluginDataDir;
    this.skillsService = new SkillsService({
      adapters: this.adapters,
      resolveAgentVersion: (kind, wslDistro) =>
        this.agentStatusService.getCachedVersion(kind, wslDistro),
      readInstalledPlugins: () => this.sharedSettingsCache.readFresh().installedPlugins,
      readPlugins: () => this.pluginRegistry.listPlugins(),
    });

    // Boot the CLI hook plugin coordinator BEFORE the thread session manager so
    // the manager can pull `resolvePluginEnvForSpawn` off it. The coordinator
    // owns the singleton hook ingress; `startIngress()` is non-blocking — the
    // Electron window opens regardless of how long `listen()` takes.
    const runHookDispatch = (
      envelope: import("@/shared/contracts").AgentEventEnvelope,
      source: "hook-ingress" | "wsl-bridge",
    ): void => {
      // Dev-only toggle: drop hook envelopes on the supervisor side so the UI
      // falls back to L2 (OSC 9;4 progress) without uninstalling the plugin
      // or touching the agent's settings. Install + `--settings <path>` +
      // `preferredNotifChannel: "iterm2"` all stay in place so L2 keeps
      // flowing; we just ignore the L1 signal here.
      if (this.sharedSettingsCache.read().disableCliHookPlugin) {
        if (isCraftStationHookDebug()) {
          console.log(`[supervisor] hook-debug: L1 envelope dropped (dev toggle) ← ${source}`, {
            threadId: envelope.threadId,
            sessionId: envelope.sessionId,
            intent: envelope.intent,
            agentKind: envelope.agentKind,
          });
        }
        return;
      }
      hookDebugEnvelope(source, envelope);
      dispatchAgentEvent(envelope, {
        lookupSession: (input) => this.threadSessionManager.findSessionForCliHookPlugin(input),
        applyCliHookPluginState: (session, change) =>
          this.threadSessionManager.applyCliHookPluginState(session, change),
        onRoutedEvent: (session, env) =>
          this.threadSessionManager.noteCliHookPluginActivity(session, env),
        onUnroutable: (env) => {
          if (isCraftStationHookDebug()) {
            console.warn(
              `[supervisor] hook-debug: envelope NOT ROUTED (no live thread) ← ${source}`,
              {
                threadId: env.threadId,
                sessionId: env.sessionId,
                intent: env.intent,
                agentKind: env.agentKind,
              },
            );
          }
        },
      });
    };
    const dispatchEnvelope = (envelope: import("@/shared/contracts").AgentEventEnvelope): void =>
      runHookDispatch(envelope, "hook-ingress");

    this.cliHookPluginCoordinator = new CliHookPluginCoordinator(
      {
        adapters: this.adapters,
        settingsPath: this.settingsPath,
        baseDir,
        ...(process.env.CRAFTSTATION_HOOK_PORT
          ? { preferredPort: Number(process.env.CRAFTSTATION_HOOK_PORT) }
          : {}),
      },
      dispatchEnvelope,
    );

    // Construct the WSL hook bridge manager only when bundled helpers are
    // available. Plugins inside a WSL distro can't reach the host
    // `HookIngress` over WSL2 NAT loopback; the bridge stages and runs
    // `bridge.mjs` inside the distro instead, sharing the supervisor's
    // bearer secret + protocol version. Native (Windows / macOS / Linux)
    // spawns continue to use the HookIngress directly.
    if (process.platform === "win32" && resolveWslHelpersDir()) {
      const bridge = new WslBridgeServer({
        onEvent: (envelope) => runHookDispatch(envelope, "wsl-bridge"),
        onBridgeExit: (distro) => this._projectWatcher?.handleWslBridgeExit(distro),
        onError: (message, error) => {
          if (isCraftStationHookDebug()) {
            console.warn(`[supervisor] hook-debug: ${message}`, error);
          }
        },
        secret: this.cliHookPluginCoordinator.getHookSecret(),
        protocolVersion: this.cliHookPluginCoordinator.getProtocolVersion(),
      });
      this.wslHookBridge = bridge;
      this.cliHookPluginCoordinator.setWslHookBridge(bridge);
      const client = new WslBridgeClient(bridge);
      this.wslBridgeClient = client;
      this.gitService.setWslClient(client);
      this.gitCheckpointService.setWslClient(client);
      this.projectTreeService.setWslClient(client);
      this.githubService.setWslClient(client);
      this._projectWatcher?.setWslClient(client);
      setSessionFsBridgeClient(client);
      setWslProcessBridgeClient(client);
      setWslAttachmentBridgeClient(client);
    }

    this.cliHookPluginCoordinator.startIngress();

    // Own Subagents: an in-process MCP server (OwnSubagentsMcpIngress)
    // lets any agent spawn the other connected agents as temporary subagents.
    // The run manager owns child structured sessions; the ingress mints
    // per-thread tokens and routes tools/call to the caller's parent thread.
    // The run manager's host is the thread session manager (assigned just
    // below — the closures resolve it lazily at call time).
    this.subagentRunManager = new SubagentRunManager({
      adapters: this.adapters,
      // Validate spawn selections against the persisted status pipeline — the
      // same source list_agents/get_agent (and the composer) are served from —
      // so the executor never disagrees with the roster it advertised.
      getStatusCapabilities: (kind) => {
        const adapter = this.adapters.get(kind);
        if (!adapter) return null;
        const settings = this.sharedSettingsCache.read();
        const cachedCapabilities = this.agentStatusService.getCachedCapabilities(kind);
        if (cachedCapabilities === null) return null;
        return visibleCrossagentCapabilitiesForAdapter(adapter, cachedCapabilities, settings);
      },
      host: {
        getParentContext: (threadId) =>
          this.threadSessionManager.getSubagentParentContext(threadId),
        resolveParentMcpAccess: (threadId, identity, targetAgentKind) =>
          this.threadSessionManager.resolveSubagentParentMcpAccess(
            threadId,
            identity,
            targetAgentKind,
          ),
        appendRuntimeEvent: (parentThreadId, event) =>
          this.threadSessionManager.appendSubagentRuntimeEvent(parentThreadId, event),
      },
    });
    this.ownSubagentsMcpIngress = new OwnSubagentsMcpIngress({
      runManager: this.subagentRunManager,
      getSpawnableAgents: (tags) => this.getOwnSubagentsSpawnableAgents(tags),
      resolveParentAgentKind: (threadId) =>
        this.threadSessionManager.sessions.get(threadId)?.agentKind,
      resolveParentEntity: (threadId) => {
        const session = this.threadSessionManager.sessions.get(threadId);
        if (!session?.agentKind) return undefined;
        return {
          agentKind: session.agentKind,
          ...(session.config.model ? { model: session.config.model } : {}),
          ...(session.config.effort ? { effort: session.config.effort } : {}),
        };
      },
      getRouteOrder: () => this.sharedSettingsCache.read().ownSubagentsRouteOrder,
      resolveProviderSessionThreadId: (sessionId) =>
        this.threadSessionManager.getThreadIdByProviderSessionId(sessionId),
      // User-configured routing guidance, read live from shared settings (the
      // cache invalidates on file change) so edits take effect on the next turn
      // without a supervisor restart. Empty/whitespace-only = no guidance.
      getRoutingGuide: () => {
        const guide = this.sharedSettingsCache.read().ownSubagentRoutingGuide.trim();
        return guide.length > 0 ? guide : undefined;
      },
      recordExplicitSelections: (selections) => {
        const validSelections = selections.flatMap(({ selection, explicitFields, tags }) =>
          selection.model
            ? [
                {
                  agentKind: selection.agent,
                  modelId: selection.model,
                  ...(selection.effort ? { effort: selection.effort } : {}),
                  fast: selection.fast === true,
                  ...(tags.length > 0 ? { tags } : {}),
                  explicitFields,
                },
              ]
            : [],
        );
        if (validSelections.length === 0) return;
        emit({
          type: "ownsubagents-selection-used",
          selections: validSelections,
        });
      },
      listRoutingOverrides: () => this.sharedSettingsCache.read().ownSubagentRoutingOverrides,
      setRoutingOverride: (override) => {
        return this.routingOverridePersistence.persist({ action: "set", override });
      },
      removeRoutingOverride: (tags) => {
        return this.routingOverridePersistence.persist({
          action: "remove",
          tags: [...tags],
        });
      },
    });
    void this.ownSubagentsMcpIngress.start().catch((error) => {
      console.warn("[supervisor] Own Subagents MCP ingress failed to start:", error);
    });

    this.threadSessionManager = new ThreadSessionManager({
      emit,
      isDev: this.isDev,
      logsDir: this.logsDir,
      settingsPath: this.settingsPath,
      readDisableCliHookPlugin: () => this.sharedSettingsCache.read().disableCliHookPlugin,
      readTurnRetryPolicy: () => {
        const settings = this.sharedSettingsCache.read();
        return {
          maxAttempts: settings.turnRetryMaxAttempts,
          intervalMs: settings.turnRetryIntervalSeconds * 1000,
        };
      },
      adapters: this.adapters,
      resolveWindowsShell: (runtime) => this.resolveWindowsShell(runtime),
      resolveAccountSessionEnv: (input) => this.resolveAccountSessionEnv(input),
      // Same-turn channel failover scheduler for sticky third-party
      // sessions (see ThreadSessionManagerOptions.resolveNextThirdPartyAccount).
      resolveNextThirdPartyAccount: (input) =>
        Promise.resolve(
          this.resolveNextThirdPartyChannel({
            threadId: input.threadId,
            modelId: input.model,
            failedAccountId: input.failedAccountId,
            excludedAccountIds: input.excludedAccountIds,
          }),
        ),
      getThirdPartyChannelProtocol: (accountId) =>
        this.openAiCompatibleProfileService.getDescriptor(accountId)?.validatedProtocol,
      // Submit-path usability probe (mirrors the scheduler's usable rule so
      // a thread restarts onto the next usable pool row before burning a
      // turn on a dead binding).
      isPoolAccountUsable: (provider, accountId) => {
        const record = this.accountStore.getRecord(accountId);
        return (
          !!record &&
          record.provider === provider &&
          record.enabled &&
          (record.status === "available" || record.status === "quota-low")
        );
      },
      hasUsablePoolAccount: (provider) =>
        this.accountStore
          .records(provider)
          .some(
            (account) =>
              account.enabled &&
              (account.status === "available" || account.status === "quota-low") &&
              this.hasManagedCredential(provider, account),
          ),
      // Failover notice identities (providerAccountId → masked → label).
      describePoolAccount: (provider, accountId) => {
        const view = this.accountStore.get(accountId);
        if (!view || view.provider !== provider) return undefined;
        return (
          view.providerAccountId?.trim() ||
          view.maskedIdentity?.trim() ||
          view.label.trim() ||
          undefined
        );
      },
      handleAccountPromptError: (input) => {
        // Chat-lane quota write-back (mirrors the craftAgent lane): a prompt
        // rejected for quota marks the bound account exhausted so the pool
        // scheduler skips it on the next session.
        // Third-party channels cool down instead of store-marking: the relay
        // quota poller resets every row on each pass, so a store mark would
        // flap. Transient throttling never cools down either.
        if (input.provider === "openai-compatible") {
          if (thirdPartyFailureKind(input.error) === "quota") {
            this.thirdPartyChannelCooldownUntil.set(
              input.accountId,
              Date.now() + QUOTA_INFERENCE_MARK_TTL_MS,
            );
          }
          return;
        }
        if (input.provider === "antigravity") {
          this.handleAntigravityNativePromptError(input.accountId, input.error);
          return;
        }
        if (input.provider === "kimi") {
          this.handleKimiNativePromptError(input.accountId, input.error);
          return;
        }
        if (input.provider === "codex") {
          this.handleCodexNativePromptError(input.accountId, input.error);
          return;
        }
        this.handleGrokNativePromptError(input.accountId, input.error);
      },
      ...(this.wslHookBridge ? { wslBridge: this.wslHookBridge } : {}),
      resolvePluginEnvForSpawn: (input) =>
        this.cliHookPluginCoordinator.resolvePluginEnvForSpawn(input),
      ownSubagentsMcp: {
        register: (threadId, disabledTools) =>
          this.ownSubagentsMcpIngress.registerThread(threadId, disabledTools),
        registerProviderSession: (threadId, disabledTools) =>
          this.ownSubagentsMcpIngress.registerProviderSessionThread(threadId, disabledTools),
        unregister: (threadId) => this.ownSubagentsMcpIngress.unregisterThread(threadId),
        cancelForeground: (threadId) => this.subagentRunManager.cancelForegroundForThread(threadId),
        cancelAll: (threadId) => this.subagentRunManager.cancelAllForThread(threadId),
        resolveChildRequest: (requestId, response) =>
          this.subagentRunManager.resolveChildServerRequest(requestId, response),
      },
      wslHostAccess: {
        resolveHostAccess: (distro) => resolveWslHostAccess(distro),
      },
      applyMcpServerAuthorization: (servers) => this.mcpOAuthService.applyAuthorization(servers),
      prepareMcpToolFilters,
      resolvePluginLaunchContributions: async (projectLocation, agentKind) => {
        const adapter = this.adapters.get(agentKind);
        const envContext =
          projectLocation.kind === "wsl"
            ? {
                envKind: "wsl" as const,
                wslDistro: projectLocation.distro,
                baseDir: this.baseDir,
              }
            : {
                envKind: projectLocation.kind,
                baseDir: this.baseDir,
              };
        let nativePlugins: readonly AgentNativePlugin[] = [];
        try {
          nativePlugins = (await adapter?.listNativePlugins?.(envContext)) ?? [];
        } catch (error) {
          console.warn(`[plugins] failed to inspect native ${agentKind} plugins:`, error);
        }
        const result = resolvePluginMcpServers(
          this.pluginRegistry.listPlugins(),
          this.sharedSettingsCache.readFresh().installedPlugins,
          {
            pluginDataRoot: this.pluginDataDir,
            hostPlatform: process.platform,
            projectLocation,
            nativePluginNames: new Set(nativePlugins.map((plugin) => plugin.name)),
          },
        );
        return {
          mcpServers: result.servers,
          builtInMcpServerIds: result.builtInMcpServerIds,
          nativePlugins: [...nativePlugins],
        };
      },
      prepareSkillsForLaunch: async (projectLocation, agentKind) => {
        try {
          await this.skillsService.prepareForLaunch(projectLocation, agentKind);
        } catch (error) {
          console.warn("[skills] failed to prepare provider skill projections:", error);
        }
      },
      filterPluginSkillSegments: async (input) => {
        try {
          return await this.skillsService.filterPluginSkillSegments(input.segments, input);
        } catch (error) {
          console.warn("[skills] failed to apply plugin skill policy:", error);
          return dropSkillSegmentsOnPolicyFailure(input.segments);
        }
      },
      buildSkillTurnInjection: async (input) => {
        try {
          return await this.skillsService.buildTurnSkillInjection(input);
        } catch (error) {
          // Skill delivery is best-effort; a failed inline must never block a turn.
          console.warn("[skills] failed to build inline skill instructions:", error);
          return undefined;
        }
      },
      rewriteTerminalSkillSegments: async (input) => {
        try {
          return await this.skillsService.rewriteTerminalSkillSegments(input);
        } catch (error) {
          // Best-effort: fall back to the original segments (plain invocation).
          console.warn("[skills] failed to rewrite terminal skill segments:", error);
          return [...input.segments];
        }
      },
    });
    this.sessions = this.threadSessionManager.sessions;
    this.shellSessions = this.threadSessionManager.shellSessions;

    // The usage credential WSL fallback boots every installed distro (and
    // keeps its VM alive via the resident bridge) just to look for tokens.
    // Restrict it to when the user actually uses WSL — a watched WSL project
    // or a live WSL session — so a Windows-only setup never spins up VmmemWSL.
    this.disposeWslCredentialProjectScope = setWslCredentialProjectScope(() =>
      this.hasActiveWslContext(),
    );
    this.accountStore = new AccountStore(join(paths.baseDir, "craftstation-accounts"));
    this.openCodeServerPool = new OpenCodeNativeServerPool();
    this.accountResolver = new AccountResolver(this.accountStore, (account) =>
      this.hasManagedCredential(account.provider, account),
    );
    this.tokenUsageAdapter = new TokenUsageAdapter(
      createRuntimeLedgerTokenUsageScanner(paths.dbPath),
    );
    this.codexProfileService = new CodexProfileService({ store: this.accountStore });
    this.grokProfileService = new GrokProfileService({ store: this.accountStore });
    this.kimiProfileService = new KimiProfileService({ store: this.accountStore });
    this.antigravityProfileService = new AntigravityProfileService({
      store: this.accountStore,
      cacheDir: paths.cacheDir,
    });
    this.openAiCompatibleProfileService = new OpenAiCompatibleProfileService({
      store: this.accountStore,
      cacheDir: paths.cacheDir,
      settingsPath: this.settingsPath,
    });
    // The native OpenCode server has its own private XDG root. Third-party
    // accounts must project their provider config into that root before the
    // server starts; otherwise it receives `craftstation/model` but has no
    // matching model definition.
    this.openCodeRuntimeBindingResolver = new AccountStoreOpenCodeRuntimeBindingResolver(
      this.accountStore,
      (accountId, modelId) =>
        this.openAiCompatibleProfileService.prepareOpenCodeRuntime(accountId, modelId),
    );
    this.usageService = new UsageService({
      emit,
      cachePath: join(paths.cacheDir, "provider-usage.json"),
      cacheDir: paths.cacheDir,
      settingsPath: this.settingsPath,
      localCollectors: createLocalUsageCollectors({
        getActiveAntigravityWslDistros: () => this.getActiveAntigravityWslDistros(),
      }),
    });
    this.usageService.startAutoRefresh();

    this.generationService = new GenerationService({
      adapters: this.adapters,
      readTerminalScrollback: (threadId) =>
        this.threadSessionManager.readTerminalScrollback(threadId),
      wslBridgeClient: this.wslBridgeClient,
    });

    // One-time-per-machine icon repair: localize any acp-generic icon still on
    // a remote CDN URL so sidebar rows paint from disk instead of flickering
    // through a network round-trip on every start. No-op (no network) once all
    // icons are local. Fire-and-forget — never blocks the window from opening.
    void this.agentRegistryService.cacheLocalAcpIconsOnLaunch();
    void this.agentRegistryService.pruneAcpRegistryLeftoversOnLaunch();
  }

  subscribeRuntimeEvents(
    listener: (threadId: string, event: import("@/shared/contracts").RuntimeEvent) => void,
  ): () => void {
    this.runtimeEventSubscribers.add(listener);
    return () => this.runtimeEventSubscribers.delete(listener);
  }

  listAccounts(payload: AccountProviderPayload = {}): AccountView[] {
    const accounts = this.accountStore.list(payload.provider);
    // The renderer replaces its whole store from this event: always broadcast
    // the authoritative FULL list even when the request was provider-scoped.
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return accounts;
  }

  addAccount(payload: AccountAddPayload): AccountView {
    const account = this.accountStore.add({
      provider: payload.provider,
      label: payload.label,
      ...(payload.maskedIdentity !== undefined ? { maskedIdentity: payload.maskedIdentity } : {}),
      ...(payload.plan !== undefined ? { plan: payload.plan } : {}),
      ...(payload.providerAccountId !== undefined
        ? { providerAccountId: payload.providerAccountId }
        : {}),
      ...(payload.credentialScopeRef !== undefined
        ? { credentialScopeRef: payload.credentialScopeRef }
        : {}),
      ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
    });
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  removeAccount(accountId: string): void {
    if (
      [...this.craftedSessionBindings.values()].some((binding) => binding.accountId === accountId)
    ) {
      throw new AccountControlError(
        "ACCOUNT_LOCKED",
        "This account has a live Session binding and cannot be removed while in use.",
        { accountId },
      );
    }
    const removed = this.accountStore.getRecord(accountId);
    if (!removed) {
      // Idempotent delete: the row is already gone (scrubbed/deduped after the
      // UI listed it, or a double-click). The desired end state holds; still
      // sweep any orphaned credential bucket and re-emit so ghost rows
      // disappear instead of failing with Unknown account.
      this.destroyAccountCredentialsForId(accountId);
      this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
      return;
    }
    this.accountStore.remove(accountId);
    if (removed.provider === "antigravity") {
      // The sealed OAuth bundle lives outside the managed credential dir.
      this.antigravityProfileService.destroyCredentials(accountId);
    }
    if (removed.provider === "openai-compatible") {
      this.openAiCompatibleProfileService.destroyCredentials(accountId);
    }
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
  }

  /** Best-effort credential sweep for an account row that no longer exists. Never throws. */
  private destroyAccountCredentialsForId(accountId: string): void {
    const provider = accountId.split(":", 1)[0]?.trim();
    try {
      if (provider === "antigravity") {
        this.antigravityProfileService.destroyCredentials(accountId);
      } else if (provider === "openai-compatible") {
        this.openAiCompatibleProfileService.destroyCredentials(accountId);
      }
    } catch {
      // The row is already gone; leftover secrets must not fail the delete.
    }
  }

  /** Close either a crafted native session or a regular terminal/ACP thread. */
  async closeThread(payload: CloseThreadPayload): Promise<void> {
    const craftedSession = this.craftedSessionsByThread.get(payload.threadId);
    if (craftedSession) {
      this.sessionHandoffCoordinator.assertActiveExecution(payload.threadId, payload.execution);
      const switchState = this.sessionHandoffCoordinator.readState(payload.threadId);
      if (switchState?.phase === "queued") {
        this.sessionHandoffCoordinator.cancelQueued(payload.threadId, switchState.requestId);
      }
      try {
        await craftedSession.terminate();
      } finally {
        this.sessionHandoffCoordinator.terminateActive(payload.threadId);
        this.releaseCraftedSession(payload.threadId);
        await this.ownedHarnessRuntimes.flush();
      }
      return;
    }
    await this.threadSessionManager.closeThread(payload);
  }

  /**
   * Switch a live logical thread to another harness/model (renderer
   * provider-menu action). Crafted sessions keep their own handoff path;
   * plain threads go through the session manager rebuild.
   */
  async switchThreadProvider(
    payload: SwitchThreadProviderPayload,
  ): Promise<SwitchThreadProviderResult> {
    if (this.craftedSessionsByThread.has(payload.threadId)) {
      throw new Error("合成台会话请走会话交接流程切换模型。");
    }
    return this.threadSessionManager.switchThreadProvider(payload);
  }

  /**
   * Resolve native CLI session paths for copy/archive audit. Best-effort
   * per entry (unknown provider, missing home, or not-yet-created session
   * files resolve to null) — never throws for a single bad entry.
   */
  async resolveNativeSessionPaths(
    queries: NativeSessionPathQuery[],
  ): Promise<NativeSessionPathResult[]> {
    return queries.map((query) => {
      let credentialRoot: string | undefined;
      if (query.poolAccountId) {
        try {
          credentialRoot = this.accountStore.credentialRoot(query.poolAccountId);
        } catch {
          credentialRoot = undefined;
        }
      }
      let path: string | null = null;
      try {
        path =
          resolveNativeSessionPath({
            provider: query.harness,
            ...(credentialRoot ? { credentialRoot } : {}),
            ...(query.nativeSessionId ? { nativeSessionId: query.nativeSessionId } : {}),
          }) ?? null;
      } catch {
        path = null;
      }
      return { ...query, path };
    });
  }

  async resolveThreadServerRequest(payload: ResolveThreadServerRequestPayload): Promise<void> {
    const craftedSession = this.craftedSessionsByThread.get(payload.threadId);
    if (!craftedSession) {
      await this.threadSessionManager.resolveThreadServerRequest(payload);
      return;
    }
    const active = this.sessionHandoffCoordinator.assertActiveExecution(
      payload.threadId,
      payload.execution,
    );
    if (!craftedSession.respondToRequest) {
      throw new Error(`Crafted thread ${payload.threadId} does not support request resolution.`);
    }
    const requestId = String(payload.requestId);
    const pending = this.craftedRequestsByThread.get(payload.threadId)?.get(requestId);
    if (!pending) {
      throw new Error(`Crafted thread ${payload.threadId} has no pending request ${requestId}.`);
    }
    // v0.9 F1 origin binding: the request must have been opened under the
    // Segment that is still active, so a stale-origin request (e.g. answered
    // after a handoff) can never resolve its response into the new Segment.
    if (
      !pending.execution ||
      pending.execution.segmentId !== active.id ||
      pending.execution.runtimeSessionId !== active.runtimeSessionId ||
      pending.execution.bindingEpoch !== active.bindingEpoch
    ) {
      throw new SessionHandoffError(
        "HANDOFF_EXECUTION_STALE",
        "failed",
        `Crafted request ${requestId} originated on a stale Runtime Segment binding.`,
      );
    }
    const resolution: CraftRequestResolution = resolveCraftedRequest(pending, payload.response);
    await craftedSession.respondToRequest(requestId, resolution);
    this.craftedRequestsByThread.get(payload.threadId)?.delete(requestId);
  }

  async requestSessionSwitch(payload: RequestSessionSwitchPayload): Promise<SessionSwitchResult> {
    return this.sessionHandoffCoordinator.requestSwitch(payload);
  }

  cancelSessionSwitch(threadId: string, requestId: string): void {
    this.sessionHandoffCoordinator.cancelQueued(threadId, requestId);
  }

  readSessionSwitchState(threadId: string): SessionSwitchState | null {
    return this.sessionHandoffCoordinator.readState(threadId) ?? null;
  }

  async sendThreadInput(payload: SendThreadInputPayload): Promise<void> {
    const session = this.craftedSessionsByThread.get(payload.threadId);
    if (!session) {
      await this.threadSessionManager.sendThreadInput(payload);
      return;
    }
    if (this.sessionHandoffCoordinator.hasQueuedSwitch(payload.threadId)) {
      throw new SessionHandoffError(
        "HANDOFF_SWITCH_QUEUED",
        "queued",
        "A Runtime switch is queued; the next Prompt cannot race the source Segment.",
      );
    }
    // Follow-up prompts must keep talking even when the renderer dropped the
    // execution envelope (reload, missed session-switch-state). Bind to the
    // live session's current Segment; a stale caller envelope still fails.
    const execution =
      payload.execution ??
      this.sessionHandoffCoordinator.executionEnvelope(payload.threadId, session);
    this.sessionHandoffCoordinator.assertActiveExecution(payload.threadId, execution);
    // Same-turn pool failover (crafted-lane counterpart of the legacy chat
    // lane's tryPoolFailover): when the bound pool row dies mid-conversation,
    // rebuild on the next usable row and replay the turn in place instead of
    // banner-signing "quota exhausted" while usable accounts wait. Sessions
    // without a pool binding keep the direct behavior below.
    const failoverPlan = this.craftedPlansByThread.get(payload.threadId);
    const failoverLocation = this.craftProjectLocationByThread.get(payload.threadId);
    const failoverBinding = this.craftedSessionBindings.get(payload.threadId);
    if (payload.config || payload.userMessageItemId) {
      const command = {
        prompt: payload.prompt,
        ...(payload.userMessageItemId ? { userMessageItemId: payload.userMessageItemId } : {}),
        ...(payload.config
          ? {
              overrides: {
                model: payload.config.model,
                permissionConfig: permissionConfigSchema.parse(payload.config),
              },
            }
          : {}),
      };
      if (failoverPlan && failoverLocation && failoverBinding) {
        await this.runCraftedTurnWithPoolFailover({
          threadId: payload.threadId,
          harnessKind: failoverPlan.runtimeBinding.harnessKind,
          plan: failoverPlan,
          projectLocation: failoverLocation,
          provider: failoverBinding.provider,
          failedAccountId: failoverBinding.accountId,
          runTurn: (target) => target.startTurn(command),
        });
        return;
      }
      await session.startTurn(command);
    } else {
      if (failoverPlan && failoverLocation && failoverBinding) {
        await this.runCraftedTurnWithPoolFailover({
          threadId: payload.threadId,
          harnessKind: failoverPlan.runtimeBinding.harnessKind,
          plan: failoverPlan,
          projectLocation: failoverLocation,
          provider: failoverBinding.provider,
          failedAccountId: failoverBinding.accountId,
          runTurn: (target) => target.sendPrompt(payload.prompt),
        });
        return;
      }
      await session.sendPrompt(payload.prompt);
    }
  }

  async interruptThread(payload: InterruptThreadPayload): Promise<void> {
    const session = this.craftedSessionsByThread.get(payload.threadId);
    if (!session) {
      await this.threadSessionManager.interruptThread(payload);
      return;
    }
    // Bump the failover epoch first: a quota failure racing this Stop must
    // not rebuild + replay a turn the user just killed (same role as the
    // legacy lane's turn generation).
    this.craftedFailoverEpochByThread.set(
      payload.threadId,
      (this.craftedFailoverEpochByThread.get(payload.threadId) ?? 0) + 1,
    );
    // Stop must never fail closed on a missing/stale execution envelope: a
    // dropped handoff event must not leave the user unable to stop a running
    // turn. Interrupt is idempotent and touches no credentials, so fencing is
    // relaxed to a best-effort request.
    try {
      this.sessionHandoffCoordinator.assertActiveExecution(payload.threadId, payload.execution);
    } catch (error) {
      console.warn(
        "[supervisor] interrupt execution fence failed; interrupting anyway:",
        error instanceof Error ? error.message : String(error),
      );
    }
    const turnId = session.getSnapshot().activeTurnId;
    this.armCraftedInterruptWatchdog(payload.threadId, session, turnId);
    try {
      await session.interrupt(turnId);
    } catch (error) {
      console.error(
        "[supervisor] native interrupt rejected; watchdog will force-stop the turn:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Crafted-path force-stop watchdog. Native runtimes acknowledge Stop with a
   * `turn.completed` event; if the provider ignores the interrupt (or the
   * request errored without a local settle), close the turn locally at the
   * deadline so the renderer never stays wedged in "working" with a dead
   * Stop button.
   */
  private armCraftedInterruptWatchdog(
    threadId: string,
    session: CraftSession,
    turnId: string | undefined,
  ): void {
    const previous = this.craftedInterruptWatchdogs.get(threadId);
    if (previous) clearTimeout(previous);
    const sessionId = session.id;
    const watchdog = setTimeout(() => {
      this.craftedInterruptWatchdogs.delete(threadId);
      const current = this.craftedSessionsByThread.get(threadId);
      if (!current || current.id !== sessionId) return;
      const snapshot = current.getSnapshot();
      if (snapshot.activeTurnId !== turnId || snapshot.activeTurnStatus !== "running") return;
      this.emit({
        type: "thread-runtime-event",
        threadId,
        event: {
          type: "turn.completed",
          threadId,
          turnId: turnId ?? "",
          state: "interrupted",
        },
      });
      console.warn(
        "[supervisor] crafted turn did not acknowledge interrupt in time; closed locally:",
        threadId,
      );
      // Retire the unresponsive Session as well: painting an interrupted row
      // alone leaves the provider running and the pending craft call unresolved.
      void current.terminate().catch((error) => {
        console.error("[supervisor] force-stop session teardown failed:", error);
      });
    }, CRAFTED_INTERRUPT_FORCE_STOP_MS);
    this.craftedInterruptWatchdogs.set(threadId, watchdog);
  }

  private clearCraftedInterruptWatchdog(threadId: string): void {
    const watchdog = this.craftedInterruptWatchdogs.get(threadId);
    if (watchdog) {
      clearTimeout(watchdog);
      this.craftedInterruptWatchdogs.delete(threadId);
    }
  }

  async setPendingSteer(payload: SetPendingSteerPayload): Promise<void> {
    const session = this.craftedSessionsByThread.get(payload.threadId);
    if (!session) {
      await this.threadSessionManager.setPendingSteer(payload);
      return;
    }
    try {
      this.sessionHandoffCoordinator.assertActiveExecution(payload.threadId, payload.execution);
    } catch (error) {
      console.warn(
        "[supervisor] steer execution fence failed; continuing best-effort:",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (session.steer) {
      await session.steer(payload.prompt);
      return;
    }
    // The runtime has no native steer. The user must still be able to keep
    // talking: interrupt the running turn and send the new message as a fresh
    // turn once the interrupt settles, instead of wedging the conversation.
    const snapshot = session.getSnapshot();
    if (snapshot.activeTurnStatus === "running" && snapshot.activeTurnId) {
      this.armCraftedInterruptWatchdog(payload.threadId, session, snapshot.activeTurnId);
      try {
        await session.interrupt(snapshot.activeTurnId);
      } catch (error) {
        console.error(
          "[supervisor] steer-fallback interrupt rejected; watchdog will force-stop:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    await session.sendPrompt(payload.prompt);
  }

  async clearPendingSteer(payload: ClearPendingSteerPayload): Promise<void> {
    if (!this.craftedSessionsByThread.has(payload.threadId)) {
      await this.threadSessionManager.clearPendingSteer(payload);
      return;
    }
    this.sessionHandoffCoordinator.assertActiveExecution(payload.threadId, payload.execution);
  }

  selectAccount(accountId: string): AccountView {
    const account = this.accountStore.select(accountId);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  setAccountEnabled(accountId: string, enabled: boolean): AccountView {
    const account = this.accountStore.setEnabled(accountId, enabled);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  renameAccount(payload: AccountRenamePayload): AccountView {
    const account = this.accountStore.rename(payload.accountId, payload.label);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  reorderAccounts(provider: string, orderedAccountIds: string[]): AccountView[] {
    const accounts = this.accountStore.reorder(provider, orderedAccountIds);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return accounts;
  }

  resolveAccount(payload: AccountResolutionRequest): AccountResolution {
    return this.accountResolver.resolve(payload);
  }

  setAccountPoolScheduling(payload: AccountPoolConfigPayload): ProviderPoolConfig {
    const config = this.accountStore.setPoolSchedulingMode(payload.provider, payload.scheduling);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return config;
  }

  getAccountPoolScheduling(payload: AccountProviderPayload): ProviderPoolConfig {
    return this.accountStore.poolConfig(payload.provider ?? "grok");
  }

  /** Sign-out / trash-delete: drop the provider's cached snapshot everywhere. */
  forgetProviderUsage(providerId: string): void {
    this.usageService.forgetProvider(providerId);
  }

  getTokenUsageCapabilities(): import("@/shared/contracts").TokenUsageCapabilities {
    return this.tokenUsageAdapter.inspectCapabilities();
  }

  async getTokenUsage(payload: TokenUsagePayload): Promise<TokenUsageResponse> {
    const response = await this.tokenUsageAdapter.getUsage(payload);
    this.emit({ type: "token-usage", response });
    return response;
  }

  createCodexProfile(payload: CodexProfileCreatePayload): AccountView {
    const account = this.codexProfileService.createEmpty(payload.label);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  createKimiProfile(payload: KimiProfileCreatePayload): AccountView {
    const account = this.kimiProfileService.createEmpty(payload.label);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  importKimiProfile(payload: KimiProfileImportPayload): AccountView {
    const account = this.kimiProfileService.importCredential(payload);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  importKimiApiKey(payload: KimiProfileApiKeyPayload): AccountView {
    const account = this.kimiProfileService.importApiKey(payload);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  async startKimiProfileLogin(payload: KimiProfileLoginPayload): Promise<KimiProfileLoginResult> {
    const record = this.accountStore.getRecord(payload.accountId);
    if (!record)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${payload.accountId}'.`);
    if (record.provider !== "kimi") {
      throw new AccountControlError(
        "ACCOUNT_RUNTIME_UNSUPPORTED",
        "Kimi profile login can only target a Kimi account.",
      );
    }
    const hostShellKind = process.platform === "win32" ? "windows" : "posix";
    if (payload.projectLocation.kind !== hostShellKind) {
      throw new AccountControlError(
        "ACCOUNT_RUNTIME_UNSUPPORTED",
        "Managed Kimi profile login requires a host-native project location.",
        { accountId: payload.accountId },
      );
    }
    const kimiHome = this.kimiProfileService.managedKimiHome(payload.accountId);
    try {
      await this.threadSessionManager.startShellWithEnvironment(
        {
          shellId: payload.shellId,
          projectLocation: payload.projectLocation,
          cwdOverride: managedKimiLoginCwd(kimiHome),
          ...(process.platform === "win32"
            ? { windowsShellRuntime: payload.windowsShellRuntime ?? "powershell" }
            : {}),
        },
        managedKimiProcessEnvironment(kimiHome),
      );
      await this.threadSessionManager.writeTerminal({
        threadId: payload.shellId,
        data: `${buildKimiLoginScript(hostShellKind, payload.completionToken, kimiHome)}\r`,
      });
    } catch (error) {
      await this.threadSessionManager
        .closeThread({ threadId: payload.shellId })
        .catch(() => undefined);
      throw error;
    }
    return {
      shellId: payload.shellId,
      label: record.label,
      completionToken: payload.completionToken,
    };
  }

  completeKimiProfileLogin(accountId: string): AccountView {
    const account = this.kimiProfileService.completeLogin(accountId);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  importCodexProfile(payload: CodexProfileImportPayload): AccountView {
    const account = this.codexProfileService.importAuthJson(payload);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  /** Move the freshly signed-in Antigravity OAuth bundle into the pool. */
  importAntigravityProfile(payload: { accountId?: string }): AccountView {
    const account = this.antigravityProfileService.importHostLogin(payload.accountId);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  /**
   * Apply a pool Antigravity account as the host `agy` login. Overwrites the
   * single OS-credential-store login (explicit opt-in per row); the pool rows
   * themselves are untouched.
   */
  async applyAntigravityHostLogin(
    accountId: string,
  ): Promise<import("@/shared/contracts").AntigravityHostLoginResult> {
    const result = await this.antigravityProfileService.applyAccountToHostLogin(accountId);
    return { applied: true as const, ...result };
  }

  /** 把表单验证通过的 OpenAI 兼容配置导入为号池账号（追加或编辑）。 */
  importOpenAiCompatibleProfile(payload: { accountId?: string }): AccountView {
    const account = this.openAiCompatibleProfileService.importStaging(payload.accountId);
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    return account;
  }

  getOpenAiCompatibleProfile(payload: {
    accountId: string;
  }): import("@/shared/contracts").OpenAiCompatibleProfileConfig {
    return this.openAiCompatibleProfileService.getConfig(payload.accountId);
  }

  /** 按渠道列出可用模型（管理模型页）；无动态列表的渠道返回空。 */
  async listChannelModels(payload: {
    provider: string;
    accountId?: string;
  }): Promise<{ models: string[] }> {
    if (payload.provider === "openai-compatible" && payload.accountId) {
      return {
        models: await this.openAiCompatibleProfileService
          .listModels(payload.accountId)
          .catch(() => []),
      };
    }
    if (payload.provider === "antigravity") {
      return { models: await this.antigravityProfileService.listModels().catch(() => []) };
    }
    return { models: [] };
  }

  /**
   * 管理模型页的模型加入门禁：用账号密封 Key 对单个模型做一次真实
   * Responses-first 探测，通过才允许加入首页/已选名单。Key 永不离开
   * supervisor；从不抛错，只返回 `{ok:false,…}` 供 UI 显示。
   */
  async verifyChannelModel(payload: {
    provider: string;
    accountId?: string | undefined;
    model: string;
  }): Promise<import("@/shared/contracts").VerifyChannelModelResponse> {
    if (payload.provider !== "openai-compatible" || !payload.accountId) {
      return { ok: false, code: "unsupported", error: "该渠道的模型无需验证即可使用。" };
    }
    try {
      const result = await this.openAiCompatibleProfileService.verifyModel(
        payload.accountId,
        payload.model,
      );
      return { ok: true, validatedProtocol: result.validatedProtocol };
    } catch (error) {
      if (error instanceof AccountControlError) {
        return {
          ok: false,
          code: error.code,
          error: error.message,
        };
      }
      return { ok: false, code: "probe_failed", error: "验证失败，请检查后重试。" };
    }
  }

  async startCodexProfileLogin(
    payload: CodexProfileLoginPayload,
  ): Promise<CodexProfileLoginResult> {
    const record = this.accountStore.getRecord(payload.accountId);
    if (!record) {
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${payload.accountId}'.`);
    }
    if (record.provider !== "codex") {
      throw new AccountControlError(
        "ACCOUNT_RUNTIME_UNSUPPORTED",
        "Codex profile login can only target a Codex account.",
      );
    }
    if (!record.enabled) {
      throw new AccountControlError(
        "ACCOUNT_RUNTIME_UNSUPPORTED",
        "The selected Codex account is disabled.",
        { accountId: payload.accountId },
      );
    }
    const hostShellKind = process.platform === "win32" ? "windows" : "posix";
    if (payload.projectLocation.kind !== hostShellKind) {
      throw new AccountControlError(
        "ACCOUNT_RUNTIME_UNSUPPORTED",
        "Managed Codex profile login requires a host-native project location; the isolated credential scope cannot be projected into WSL or another host environment.",
        {
          accountId: payload.accountId,
          locationKind: payload.projectLocation.kind,
          hostPlatform: process.platform,
        },
      );
    }
    const codexHome = this.codexProfileService.managedCodexHome(payload.accountId);
    const script = buildCodexLoginScript(hostShellKind, payload.completionToken);
    try {
      await this.threadSessionManager.startShellWithEnvironment(
        {
          shellId: payload.shellId,
          projectLocation: payload.projectLocation,
          cwdOverride: managedCodexLoginCwd(codexHome),
          ...(process.platform === "win32"
            ? { windowsShellRuntime: payload.windowsShellRuntime ?? "powershell" }
            : {}),
        },
        managedCodexProcessEnvironment(codexHome),
      );
      // The login cwd helper rewrites the canonical managed config, but a
      // concurrent writer (e.g. a Router overlay sync) could re-pollute the
      // managed home between that write and the spawn. Scrub immediately
      // before handing the shell to the official CLI so `codex login` can
      // never die parsing a stale Router catalog.
      scrubManagedCodexConfig(codexHome);
      await this.threadSessionManager.writeTerminal({
        threadId: payload.shellId,
        data: `${script}\r`,
      });
    } catch (error) {
      await this.threadSessionManager
        .closeThread({ threadId: payload.shellId })
        .catch(() => undefined);
      throw error;
    }
    return {
      shellId: payload.shellId,
      label: record.label,
      completionToken: payload.completionToken,
    };
  }
  async refreshAccountQuota(accountId: string): Promise<AccountView> {
    const record = this.accountStore.getRecord(accountId);
    if (!record)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    // v0.5 T07: route quota collection by the account's own provider so Grok
    // rows never go through the Codex collector.
    const provider = record.provider;
    // v0.5 T09: per-account refresh lock coalesces concurrent refreshes.
    const inFlight = this.accountRefreshLocks.get(accountId);
    if (inFlight) return inFlight as Promise<AccountView>;
    const refresh = (async () => {
      const account =
        provider === "grok"
          ? await this.grokProfileService.collectQuota(
              accountId,
              this.usageService.getHostForAccountAdapter(),
              { recoverInferenceMark: true },
            )
          : provider === "antigravity"
            ? await this.antigravityProfileService.collectQuota(
                accountId,
                this.usageService.getHostForAccountAdapter(),
              )
            : provider === "openai-compatible"
              ? await this.openAiCompatibleProfileService.collectQuota(
                  accountId,
                  this.usageService.getHostForAccountAdapter(),
                )
              : provider === "kimi"
                ? await this.kimiProfileService.collectQuota(
                    accountId,
                    this.usageService.getHostForAccountAdapter(),
                  )
                : await this.codexProfileService.collectQuota(
                    accountId,
                    this.usageService.getHostForAccountAdapter(),
                  );
      this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
      return account;
    })().finally(() => {
      this.accountRefreshLocks.delete(accountId);
    });
    this.accountRefreshLocks.set(accountId, refresh);
    return refresh;
  }

  /** Create a pending isolated Grok login home (no AccountStore row yet). */
  createGrokProfileLogin(payload: GrokProfileLoginCreatePayload): GrokProfileLoginCreateResult {
    const pendingRef = `grok-pending:${crypto.randomUUID()}`;
    const home = createPendingGrokHome(this.accountStore.managedRoot, payload.label);
    this.grokPendingLogins.set(pendingRef, {
      label: payload.label,
      home,
      createdAt: Date.now(),
    });
    return { pendingRef, label: payload.label };
  }

  /** Run the official Grok device-auth login inside the pending managed home. */
  async startGrokProfileLogin(payload: GrokProfileLoginPayload): Promise<GrokProfileLoginResult> {
    const pending = this.grokPendingLogins.get(payload.pendingRef);
    if (!pending) {
      throw new AccountControlError(
        "ACCOUNT_NOT_FOUND",
        "Unknown pending Grok login; start a new one first.",
      );
    }
    const hostShellKind = process.platform === "win32" ? "windows" : "posix";
    if (payload.projectLocation.kind !== hostShellKind) {
      throw new AccountControlError(
        "ACCOUNT_RUNTIME_UNSUPPORTED",
        "Managed Grok profile login requires a host-native project location; the pending GROK_HOME cannot be projected into WSL or another host environment.",
        {
          locationKind: payload.projectLocation.kind,
          hostPlatform: process.platform,
        },
      );
    }
    const script = buildGrokLoginScript(hostShellKind, payload.completionToken);
    try {
      await this.threadSessionManager.startShellWithEnvironment(
        {
          shellId: payload.shellId,
          projectLocation: payload.projectLocation,
          cwdOverride: managedGrokLoginCwd(pending.home),
          ...(process.platform === "win32"
            ? { windowsShellRuntime: payload.windowsShellRuntime ?? "powershell" }
            : {}),
        },
        managedGrokProcessEnvironment(pending.home),
      );
      await this.threadSessionManager.writeTerminal({
        threadId: payload.shellId,
        data: `${script}\r`,
      });
    } catch (error) {
      await this.threadSessionManager
        .closeThread({ threadId: payload.shellId })
        .catch(() => undefined);
      throw error;
    }
    return {
      shellId: payload.shellId,
      label: pending.label,
      completionToken: payload.completionToken,
    };
  }

  /** Promote a completed pending Grok login into a managed account (identity-gated). */
  completeGrokProfileLogin(payload: GrokProfileCompletePayload): AccountView {
    const pending = this.grokPendingLogins.get(payload.pendingRef);
    if (!pending) {
      throw new AccountControlError(
        "ACCOUNT_NOT_FOUND",
        "Unknown pending Grok login; start a new one first.",
      );
    }
    try {
      const account = this.grokProfileService.importAuthJson({
        label: pending.label,
        profileRoot: pending.home,
      });
      this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
      this.grokPendingLogins.delete(payload.pendingRef);
      return account;
    } catch (error) {
      // No official identity => never insert an AccountStore row. Drop the
      // pending home handle so a failed login cannot be reused.
      this.grokPendingLogins.delete(payload.pendingRef);
      this.removeGrokPendingHome(pending.home);
      throw error;
    }
  }

  /** Abandon a pending Grok login without touching the AccountStore. */
  cancelGrokProfileLogin(payload: GrokProfileCancelPayload): void {
    const pending = this.grokPendingLogins.get(payload.pendingRef);
    if (!pending) return;
    this.grokPendingLogins.delete(payload.pendingRef);
    this.removeGrokPendingHome(pending.home);
  }

  /**
   * Poll a pending Grok login: when the official auth.json written into the
   * pending home carries an identity, promote it and signal `done`. Lets the
   * renderer close the login overlay as soon as the official flow completes,
   * without waiting for the CLI to write its OSC marker or exit.
   */
  pollGrokProfileLogin(payload: GrokProfilePollPayload): GrokProfilePollResult {
    const pending = this.grokPendingLogins.get(payload.pendingRef);
    if (!pending) return { done: false };
    const authPath = join(pending.home, "auth.json");
    if (!existsSync(authPath)) return { done: false };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(authPath, "utf8"));
    } catch {
      return { done: false };
    }
    const found = grokAuthContainer(parsed);
    if (!found || !grokAccountIdentityFromContainer(found.container)) return { done: false };
    const account = this.completeGrokProfileLogin({ pendingRef: payload.pendingRef });
    return { done: true, account };
  }

  /**
   * Best-effort cleanup of a pending Grok login home. Only deletes a directory
   * that resolves inside the account store's managed root, so a stray value can
   * never target an arbitrary path.
   */
  private removeGrokPendingHome(home: string): void {
    const managedRoot = resolve(this.accountStore.managedRoot);
    const resolvedHome = resolve(home);
    const rel = relative(managedRoot, resolvedHome);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      return;
    }
    rmSync(resolvedHome, { recursive: true, force: true });
  }

  async getNativeHarnessControlPlane(
    payload: NativeHarnessControlPlanePayload = {},
  ): Promise<NativeHarnessControlPlaneEntry[]> {
    const descriptors = payload.harnessKind
      ? Object.values(NATIVE_HARNESS_DESCRIPTORS).filter(
          (descriptor) => descriptor.harnessKind === payload.harnessKind,
        )
      : Object.values(NATIVE_HARNESS_DESCRIPTORS);
    const wslDistros = await this.agentStatusService.listWslDistros();
    const { windows, wsl } = await this.agentStatusService.getAgentStatuses({ wslDistros });
    const statuses = [...windows, ...wsl];
    // An empty account record is only a pending profile shell. Do not expose
    // it as an authenticated/configured profile until a provider credential
    // or a successful provider-specific status has been recorded.
    const configuredProfiles = new Set(
      this.accountStore
        .records()
        .filter((account) =>
          ["available", "quota-low", "quota-exhausted", "auth-expired"].includes(account.status),
        )
        .map((account) => account.provider)
        .filter((provider): provider is string => provider.length > 0),
    );
    // AgentStatusService is the provider-owned source for native auth signals
    // (Grok/Kimi credential probes and the Antigravity soft keyring signal),
    // while AccountStore only owns explicit CraftStation account bindings.
    for (const status of statuses) {
      if (status.installed && status.authState === "authenticated") {
        configuredProfiles.add(status.kind);
      }
    }
    const diagnostics = new Map<string, readonly NativeHarnessDiagnostic[]>();
    for (const [harnessKind, adapter] of this.nativeHarnessAdapters) {
      const records = [
        ...(adapter.getDiagnostics?.() ?? []),
        ...(this.nativeHarnessSessions.get(harnessKind)?.getDiagnostics?.() ?? []),
      ];
      if (records.length > 0) diagnostics.set(harnessKind, records);
    }
    return projectNativeHarnessControlPlane({
      descriptors,
      statuses,
      profileConfigured: configuredProfiles,
      environmentKind: process.platform === "win32" ? "windows" : "posix",
      diagnostics,
    });
  }

  async getCraftingModelInventory(
    payload: CraftingModelInventoryPayload,
  ): Promise<CraftingModelInventory> {
    const discover =
      this._craftingModelDiscovery ??
      (async (location: ProjectLocation) => {
        const probe = await probeCodexCapabilities(location, {
          timeoutMs: 12_000,
          label: "crafting-model-inventory",
        });
        return probe?.models?.map((model) => ({
          id: model.id,
          displayName: model.label,
        }));
      });

    try {
      const models = await discover(payload.projectLocation);
      if (!models?.length) {
        return {
          status: "unavailable",
          source: "codex-app-server-model-list",
          models: [],
          diagnostic: {
            code: "RUNTIME_UNAVAILABLE",
            message: "Official Codex model inventory is unavailable.",
            remediation:
              "Verify the Codex app-server installation and authentication, then refresh.",
          },
        };
      }
      return {
        status: "ready",
        source: "codex-app-server-model-list",
        models: models.map((model) => ({ ...model })),
      };
    } catch {
      return {
        status: "unavailable",
        source: "codex-app-server-model-list",
        models: [],
        diagnostic: {
          code: "PROTOCOL_MISMATCH",
          message: "Official Codex model discovery failed.",
          remediation: "Update the official Codex runtime and retry discovery.",
        },
      };
    }
  }

  async resolveCraftingCompatibility(
    payload: ResolveCompatibilityPayload,
  ): Promise<ResolveCompatibilityResult> {
    const entries = await this.getNativeHarnessControlPlane({});
    const harnessRef = entries
      .map((entry) => ({
        harnessItemId: `harness:${entry.descriptor.harnessKind}`,
        harnessKind: entry.descriptor.harnessKind,
        descriptorId: entry.descriptor.id,
        displayName: entry.descriptor.label,
        vendor: entry.descriptor.vendor,
        official: entry.descriptor.official,
        status: entry.status,
        transport: entry.descriptor.transport,
      }))
      .find((ref) => ref.harnessItemId === payload.harnessRef);

    // The renderer resolves the full SelectedModelEntry for its inventory; the
    // Supervisor only needs the provider kind to decide the compatibility tier.
    // OpenCode route readiness is a discovery fact, not craft history: the
    // control plane reports installed+authenticated as `ready`. (The previous
    // `nativeHarnessAdapters.has("opencode")` signal could only turn true
    // inside a successful craft, so the workbench gate deadlocked every
    // OpenCode combination before the first craft.)
    const openCodeRouteReady = entries.some(
      (entry) => entry.descriptor.harnessKind === "opencode" && entry.status === "ready",
    );
    const modelVendor = modelProviderFromEntryRef(payload.modelEntryRef);
    if (!modelVendor) {
      return resolveCompatibility({
        modelEntry: {
          entryId: payload.modelEntryRef,
          source: payload.modelEntryRef.startsWith("custom:") ? "custom" : "agent",
          providerKind: "unknown",
          providerSurfaceKey: "unknown",
          providerLabel: "Unknown provider",
          channelLabel: "Unknown provider",
          modelId: payload.modelEntryRef,
          displayName: payload.modelEntryRef,
        },
        harnessRef,
        harnessReady: false,
        compatibilityBridgeReady: this.isCompatibilityBridgeStartableForHost(),
      });
    }

    const result = resolveCompatibility({
      modelEntry: {
        entryId: payload.modelEntryRef,
        source: "agent",
        providerKind: modelVendor,
        providerSurfaceKey: harnessRef?.harnessKind ?? "",
        providerLabel: harnessRef?.displayName ?? "",
        channelLabel: harnessRef?.displayName ?? "",
        modelId: payload.modelEntryRef,
        displayName: payload.modelEntryRef,
        ...(payload.providerProfileRef ? { accountId: payload.providerProfileRef } : {}),
      },
      harnessRef,
      harnessReady: harnessRef?.status === "ready",
      openCodeRouteReady,
      // Idle sidecar is startable: spawn starts it. Only a missing binary
      // fail-closes the compatibility route.
      compatibilityBridgeReady: this.isCompatibilityBridgeStartableForHost(),
    });
    return result;
  }

  /** Safe Compatibility Bridge projection for the Components inventory. */
  getCompatibilityBridgeStatus(): CompatibilityBridgeStatusView {
    const status = this.compatibilityBridgeService.getStatus();
    const installed =
      status.running || Boolean(this.resolveCompatibilityBridgeBinaryForHost().binaryPath);
    return compatibilityBridgeStatusSchema.parse({
      running: status.running,
      installed,
      ...(status.endpoint ? { endpoint: status.endpoint } : {}),
      ...(status.pid !== undefined ? { pid: status.pid } : {}),
    });
  }

  /**
   * One-click Compatibility Bridge start for the Components inventory.
   * Resolves the sidecar binary (env → PATH → bundled `.tools/cpa/`), points
   * the long-lived singleton the compatibility gate reads at it, and awaits
   * the authenticated `/healthz` probe. Throws a remediation-carrying error
   * when no binary is found or the sidecar never becomes ready — never a
   * fake "running" state.
   */
  async startCompatibilityBridge(options?: {
    cwd?: string;
    existsSync?: (path: string) => boolean;
    resolveOnPath?: (command: string) => string | undefined;
  }): Promise<CompatibilityBridgeStatusView> {
    const service = this.compatibilityBridgeService;
    if (service.getStatus().running) return this.getCompatibilityBridgeStatus();
    const resolution = this.resolveCompatibilityBridgeBinaryForHost(options);
    if (!resolution.binaryPath) {
      throw new Error(
        `CLIProxyAPI sidecar binary not found. Searched: ${resolution.searched.join(" · ")}. ` +
          `Click 安装 in the 组件 column, or run 合成 to download the official release.`,
      );
    }
    service.configure({ binaryPath: resolution.binaryPath });
    try {
      await service.start();
    } catch (error) {
      throw new Error(
        `Compatibility Bridge failed to start from '${resolution.binaryPath}': ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    return this.getCompatibilityBridgeStatus();
  }

  /** Stop the Compatibility Bridge sidecar; idempotent when already stopped. */
  async stopCompatibilityBridge(): Promise<CompatibilityBridgeStatusView> {
    await this.compatibilityBridgeService.stop();
    return this.getCompatibilityBridgeStatus();
  }

  async installCompatibilityBridge(): Promise<CompatibilityBridgeStatusView> {
    const destDir = compatibilityBridgeUserToolsDir(this.baseDir);
    mkdirSync(destDir, { recursive: true });
    await installCliProxyApiBinary({ destDir });
    return this.getCompatibilityBridgeStatus();
  }

  async ensureCompatibilityBridge(): Promise<CompatibilityBridgeStatusView> {
    if (this.compatibilityBridgeService.getStatus().running) {
      return this.getCompatibilityBridgeStatus();
    }
    let resolution = this.resolveCompatibilityBridgeBinaryForHost();
    if (!resolution.binaryPath) {
      await this.installCompatibilityBridge();
      resolution = this.resolveCompatibilityBridgeBinaryForHost();
    }
    if (!resolution.binaryPath) {
      throw new Error("CLIProxyAPI 安装完成但仍找不到可执行文件，请重试或检查网络。");
    }
    return this.startCompatibilityBridge();
  }

  async craftAgent(payload: CraftAgentPayload): Promise<CraftAgentResult> {
    let entityId: string | undefined;
    let sessionId: string | undefined;
    let accountBinding: AccountBinding | undefined;
    let craftedThreadId: string | undefined;
    let craftedSession: CraftSession | undefined;
    // True once the first turn runs inside pool failover: the helper owns
    // quota write-back from then on, so the catch below must not mark (and
    // rotate hosts) a second time for the same failure.
    let failoverArmed = false;
    try {
      const created = await this.createCraftingAdapter(
        payload.craftPlan,
        payload.projectLocation,
        payload.mcpServers,
        payload.accountId,
        payload.accountMode,
      );
      const { adapter, plan } = created;
      accountBinding = created.accountBinding;
      const entity = await adapter.spawnEntity(plan);
      const session = await adapter.createSession(entity);
      entityId = entity.id;
      craftedSession = session;
      sessionId = session.id;
      craftedThreadId = plan.threadId ?? session.threadId;
      if (craftedThreadId) {
        this.craftMcpCandidatesByThread.set(craftedThreadId, payload.mcpServers ?? []);
        this.craftProjectLocationByThread.set(craftedThreadId, payload.projectLocation);
      }
      this.registerCraftedSession(
        craftedThreadId,
        plan.runtimeBinding.harnessKind,
        session,
        accountBinding,
        plan,
        entity.id,
      );
      const firstTurn: ((target: CraftSession) => Promise<TurnResult | PromptResult>) | undefined =
        payload.prompt.trim().length > 0
          ? payload.userMessageItemId
            ? (target: CraftSession) =>
                target.startTurn({
                  prompt: payload.prompt,
                  userMessageItemId: payload.userMessageItemId,
                })
            : (target: CraftSession) => target.sendPrompt(payload.prompt)
          : undefined;
      const useFailover = !!firstTurn && !!accountBinding && !!craftedThreadId;
      if (useFailover) failoverArmed = true;
      const response = firstTurn
        ? useFailover
          ? await this.runCraftedTurnWithPoolFailover({
              threadId: craftedThreadId!,
              harnessKind: plan.runtimeBinding.harnessKind,
              plan,
              projectLocation: payload.projectLocation,
              provider: accountBinding!.provider,
              failedAccountId: accountBinding!.accountId,
              runTurn: firstTurn,
            })
          : await firstTurn(session)
        : { response: "" };
      // Same staleness rule as resume: report the session + binding the
      // failover may have moved the thread to.
      const launchedBinding =
        (craftedThreadId ? this.craftedSessionBindings.get(craftedThreadId) : undefined) ??
        accountBinding;
      const launchedSession =
        (craftedThreadId ? this.craftedSessionsByThread.get(craftedThreadId) : undefined) ??
        session;
      return {
        // CraftStation owns the stable user-visible Thread identity. A native
        // runtime may allocate a different provider Session/thread UUID, but
        // that identity belongs to the Runtime Segment and must not replace
        // the CraftStation Thread key used by IPC and session handoff.
        threadId: plan.threadId ?? launchedSession.threadId ?? "",
        entityId: launchedSession.entityId,
        sessionId: launchedSession.id,
        ...(launchedSession.sessionRef ? { sessionRef: launchedSession.sessionRef } : {}),
        response: response?.response ?? "",
        ...(launchedBinding ? { accountBinding: launchedBinding } : {}),
      };
    } catch (error) {
      // The native ACP session normally observes this before projecting the
      // failure. Keep the Supervisor boundary defensive as well: custom
      // adapters and a first-turn rejection may bypass that callback. Skipped
      // only for the failure the pool failover already marked (same provider
      // quota shape) — anything else, notably Antigravity auth deaths, still
      // needs this write-back, and the helper never marks those.
      const failoverMarked =
        failoverArmed &&
        !!accountBinding &&
        POOL_FAILOVER_PROVIDERS.has(accountBinding.provider) &&
        isPoolQuotaErrorForProvider(accountBinding.provider, error);
      if (!failoverMarked) {
        if (accountBinding?.provider === "grok") {
          this.handleGrokNativePromptError(accountBinding.accountId, error);
        } else if (accountBinding?.provider === "antigravity") {
          this.handleAntigravityNativePromptError(accountBinding.accountId, error);
        }
      }
      // Launch contract is all-or-nothing: a failed launch keeps no session.
      // Terminate the currently registered one (failover may have swapped it
      // since `craftedSession` was captured) as well as the captured one.
      const doomed =
        (craftedThreadId ? this.craftedSessionsByThread.get(craftedThreadId) : undefined) ??
        craftedSession;
      if (doomed) {
        await doomed.terminate().catch(() => undefined);
        if (craftedSession && craftedSession !== doomed) {
          await craftedSession.terminate().catch(() => undefined);
        }
        if (craftedThreadId) this.releaseCraftedSession(craftedThreadId);
      } else if (accountBinding) {
        // Resolution succeeded but spawning/opening the session failed before
        // a lifecycle owner existed. Do not leave the account delete guard set.
        this.releaseCraftedBinding(accountBinding);
      }
      if (error instanceof CraftingError) {
        throw new Error(
          JSON.stringify(enrichCraftingError(error, payload.craftPlan, entityId, sessionId)),
          { cause: error },
        );
      }
      throw error;
    } finally {
      // A craft call is exactly one turn: reap subagent children the turn
      // leaves behind so the next call starts clean (see observeParentTurnEnd).
      if (craftedThreadId) {
        try {
          this.subagentRunManager.completeTurn(craftedThreadId);
        } catch {
          // Reaping is best-effort; the turn result stays authoritative.
        }
      }
    }
  }

  async resumeCraftAgent(payload: ResumeCraftAgentPayload): Promise<CraftAgentResult> {
    const threadId = payload.craftPlan.threadId;
    const live = threadId ? this.craftedSessionsByThread.get(threadId) : undefined;
    if (live && live.status !== "terminated" && live.status !== "error") {
      const activePlan = this.craftedPlansByThread.get(threadId!);
      const binding = this.craftedSessionBindings.get(threadId!);
      // A renderer reload must reattach to the owned Session, not spawn a
      // second handle with the same native identity and stale subscriptions.
      // Changing a composition/account still requires the handoff boundary.
      // Exception: the stored account may name a row that automatic pool
      // failover already proved dead and moved away from — that drift is
      // healed history, not a plan violation.
      const accountMismatch = !!payload.accountId && binding?.accountId !== payload.accountId;
      const healedDrift =
        !!payload.accountId &&
        (this.craftedFailoverTriedByThread.get(threadId!)?.has(payload.accountId) ?? false);
      if (
        activePlan?.id !== payload.craftPlan.id ||
        activePlan.recipeId !== payload.craftPlan.recipeId ||
        activePlan.resultItemId !== payload.craftPlan.resultItemId ||
        activePlan.runtimeBinding.harnessKind !== payload.craftPlan.runtimeBinding.harnessKind ||
        activePlan.runtimeBinding.modelId !== payload.craftPlan.runtimeBinding.modelId ||
        activePlan.runtimeBinding.vendor !== payload.craftPlan.runtimeBinding.vendor ||
        activePlan.runtimeBinding.routeType !== payload.craftPlan.runtimeBinding.routeType ||
        activePlan.workspace !== payload.craftPlan.workspace ||
        (live.nativeSessionRef ?? live.sessionRef) !== payload.sessionRef ||
        (accountMismatch && !healedDrift)
      )
        throw new Error("HANDOFF_ACTIVE_PLAN_MISMATCH");
      if (payload.prompt?.trim() && live.status === "busy")
        throw new Error("Cannot resume with a new prompt while the crafted Session is busy.");
      const resumeLocation =
        payload.projectLocation ?? this.craftProjectLocationByThread.get(threadId!);
      if (resumeLocation) this.craftProjectLocationByThread.set(threadId!, resumeLocation);
      const response = payload.prompt?.trim()
        ? binding && activePlan && resumeLocation
          ? await this.runCraftedTurnWithPoolFailover({
              threadId: threadId!,
              harnessKind: activePlan.runtimeBinding.harnessKind,
              plan: activePlan,
              projectLocation: resumeLocation,
              provider: binding.provider,
              failedAccountId: binding.accountId,
              runTurn: (target) =>
                target.startTurn({
                  prompt: payload.prompt!,
                  ...(payload.userMessageItemId
                    ? { userMessageItemId: payload.userMessageItemId }
                    : {}),
                  ...(payload.craftPlan.overrides
                    ? { overrides: payload.craftPlan.overrides }
                    : {}),
                }),
            })
          : await live.startTurn({
              prompt: payload.prompt,
              ...(payload.userMessageItemId
                ? { userMessageItemId: payload.userMessageItemId }
                : {}),
              ...(payload.craftPlan.overrides ? { overrides: payload.craftPlan.overrides } : {}),
            })
        : undefined;
      this.publishCraftedSessionState(threadId!, live);
      // The turn above may have rotated the pool binding via failover;
      // report the session + binding the thread actually runs on now, not
      // the ones it started the turn with, so the renderer persists the
      // live row (and its fresh native ref) instead of the dead one.
      const effectiveBinding = this.craftedSessionBindings.get(threadId!) ?? binding;
      const effectiveSession = this.craftedSessionsByThread.get(threadId!) ?? live;
      return {
        threadId: threadId!,
        entityId: effectiveSession.entityId,
        sessionId: effectiveSession.id,
        sessionRef:
          effectiveSession.nativeSessionRef ?? effectiveSession.sessionRef ?? payload.sessionRef,
        response: response?.response ?? "",
        ...(effectiveBinding ? { accountBinding: effectiveBinding } : {}),
      };
    }
    if (live) {
      await live.terminate();
      this.releaseCraftedSession(threadId!);
    }
    let entityId: string | undefined;
    let sessionId: string | undefined;
    let accountBinding: AccountBinding | undefined;
    let craftedThreadId: string | undefined;
    let craftedSession: CraftSession | undefined;
    // Same failover-armed rule as craftAgent: the helper owns quota
    // write-back once the first turn runs inside it.
    let failoverArmed = false;
    try {
      let created: Awaited<ReturnType<SupervisorRuntime["createCraftingAdapter"]>>;
      let resumedOnFallbackAccount = false;
      try {
        created = await this.createCraftingAdapter(
          payload.craftPlan,
          payload.projectLocation,
          payload.mcpServers,
          payload.accountId,
        );
      } catch (error) {
        // The stored binding is stickiness, not a user-explicit pin (resume
        // carries no accountMode): when that row died since, fall back instead
        // of bricking the thread on it — the crafted-lane counterpart of the
        // legacy chat lane's dead-binding restart. Explicit pins keep failing
        // closed (see craftAgent). A dead third-party channel falls back to
        // the next validated channel for the same model, never to the
        // subscription pool (auto would bind the wrong credential for a
        // channel model).
        const storedThirdParty = !!payload.accountId && isThirdPartyAccountId(payload.accountId);
        const poolGone =
          error instanceof AccountControlError &&
          (error.code === "ACCOUNT_POOL_EXHAUSTED" || error.code === "ACCOUNT_UNAVAILABLE");
        const channelUnprojectable =
          storedThirdParty &&
          error instanceof AccountControlError &&
          (error.code === "ACCOUNT_PROJECTION_FAILED" || error.code === "ACCOUNT_NOT_FOUND");
        if (payload.accountId && (poolGone || channelUnprojectable)) {
          if (storedThirdParty) {
            const next = this.resolveNextThirdPartyChannel({
              threadId: payload.craftPlan.threadId,
              modelId: payload.craftPlan.runtimeBinding.modelId,
              failedAccountId: payload.accountId,
              excludedAccountIds: [payload.accountId],
            });
            created = await this.createCraftingAdapter(
              payload.craftPlan,
              payload.projectLocation,
              payload.mcpServers,
              next.accountId,
              "explicit",
            );
          } else {
            created = await this.createCraftingAdapter(
              payload.craftPlan,
              payload.projectLocation,
              payload.mcpServers,
              undefined,
              "auto",
            );
          }
          resumedOnFallbackAccount = true;
        } else {
          throw error;
        }
      }
      const { adapter, plan } = created;
      accountBinding = created.accountBinding;
      const entity = await adapter.spawnEntity({ ...plan, sessionRef: payload.sessionRef });
      // A fallback account cannot resume the previous account's native
      // session (the ref belongs to another credential home): start fresh.
      // History loss is the same trade the legacy dead-binding restart
      // makes; the renderer transcript stays intact.
      const session = resumedOnFallbackAccount
        ? await adapter.createSession(entity)
        : await adapter.resumeSession(entity, payload.sessionRef);
      entityId = entity.id;
      craftedSession = session;
      sessionId = session.id;
      craftedThreadId = plan.threadId ?? session.threadId;
      if (craftedThreadId) {
        this.craftMcpCandidatesByThread.set(craftedThreadId, payload.mcpServers ?? []);
        this.craftProjectLocationByThread.set(craftedThreadId, payload.projectLocation);
      }
      this.registerCraftedSession(
        craftedThreadId,
        plan.runtimeBinding.harnessKind,
        session,
        accountBinding,
        plan,
        entity.id,
      );
      const firstTurn: ((target: CraftSession) => Promise<TurnResult | PromptResult>) | undefined =
        payload.prompt?.trim()
          ? payload.userMessageItemId
            ? (target: CraftSession) =>
                target.startTurn({
                  prompt: payload.prompt!,
                  userMessageItemId: payload.userMessageItemId,
                })
            : (target: CraftSession) => target.sendPrompt(payload.prompt!)
          : undefined;
      const useFailover = !!firstTurn && !!accountBinding && !!craftedThreadId;
      if (useFailover) failoverArmed = true;
      const response = firstTurn
        ? useFailover
          ? await this.runCraftedTurnWithPoolFailover({
              threadId: craftedThreadId!,
              harnessKind: plan.runtimeBinding.harnessKind,
              plan,
              projectLocation: payload.projectLocation,
              provider: accountBinding!.provider,
              failedAccountId: accountBinding!.accountId,
              runTurn: firstTurn,
            })
          : await firstTurn(session)
        : { response: "" };
      // Same staleness rule as the live branch: report the session + binding
      // the failover may have moved the thread to.
      const rebuiltBinding =
        (craftedThreadId ? this.craftedSessionBindings.get(craftedThreadId) : undefined) ??
        accountBinding;
      const rebuiltSession =
        (craftedThreadId ? this.craftedSessionsByThread.get(craftedThreadId) : undefined) ??
        session;
      return {
        threadId: plan.threadId ?? rebuiltSession.threadId ?? "",
        entityId: rebuiltSession.entityId,
        sessionId: rebuiltSession.id,
        ...(rebuiltSession.sessionRef
          ? { sessionRef: rebuiltSession.sessionRef }
          : session.sessionRef
            ? { sessionRef: session.sessionRef }
            : {}),
        response: response?.response ?? "",
        ...(rebuiltBinding ? { accountBinding: rebuiltBinding } : {}),
      };
    } catch (error) {
      // Same skip rule as craftAgent: the failover helper already marked the
      // dead row when the first turn ran inside it; every other failure
      // still needs this write-back.
      const failoverMarked =
        failoverArmed &&
        !!accountBinding &&
        POOL_FAILOVER_PROVIDERS.has(accountBinding.provider) &&
        isPoolQuotaErrorForProvider(accountBinding.provider, error);
      if (!failoverMarked) {
        if (accountBinding?.provider === "grok") {
          this.handleGrokNativePromptError(accountBinding.accountId, error);
        } else if (accountBinding?.provider === "antigravity") {
          this.handleAntigravityNativePromptError(accountBinding.accountId, error);
        }
      }
      // Unlike craftAgent's all-or-nothing launch, a failed resume must keep
      // the thread usable: when failover swapped the session mid-flight and
      // then exhausted the pool, the last session stays registered so the
      // next submit retries instead of bricking on "unknown session". Only
      // tear down when nothing newer took over.
      const current = craftedThreadId
        ? this.craftedSessionsByThread.get(craftedThreadId)
        : undefined;
      if (!current || current === craftedSession) {
        if (craftedSession) {
          await craftedSession.terminate().catch(() => undefined);
          if (craftedThreadId) this.releaseCraftedSession(craftedThreadId);
        } else if (accountBinding) {
          this.releaseCraftedBinding(accountBinding);
        }
      }
      if (error instanceof CraftingError) {
        throw new Error(
          JSON.stringify(enrichCraftingError(error, payload.craftPlan, entityId, sessionId)),
          { cause: error },
        );
      }
      throw error;
    } finally {
      if (craftedThreadId) {
        try {
          this.subagentRunManager.completeTurn(craftedThreadId);
        } catch {
          // Reaping is best-effort; the turn result stays authoritative.
        }
      }
    }
  }

  private async createCraftingAdapter(
    craftPlan: CraftAgentPayload["craftPlan"],
    projectLocation: ProjectLocation,
    candidateMcpServers: McpServer[] | undefined,
    accountId?: string,
    accountMode?: "explicit" | "selected" | "auto" | "preferred",
    /**
     * Pool accounts to skip for this resolution (same-turn failover's tried
     * set). Fresh starts pass nothing; failover rebuilds pass the turn's
     * tried ids so a re-resolution can never land back on an account that
     * already died this turn, even if its quota write-back hasn't landed.
     */
    excludedAccountIds?: readonly string[] | undefined,
    /**
     * Same-channel protocol-flip override for the Kimi provider table
     * (`responses` ↔ `chat_completions`). Set by channel failover when the
     * validated wire type 400s on the real workload; only meaningful with
     * an explicit third-party `accountId`.
     */
    thirdPartyProtocol?: "responses" | "chat_completions" | undefined,
  ): Promise<{
    adapter: import("@/shared/crafting").HarnessRuntimeAdapter;
    plan: CraftAgentPayload["craftPlan"];
    accountBinding?: AccountBinding;
  }> {
    const plan = {
      ...craftPlan,
      workspace: resolveThreadWorkspace(projectLocation, craftPlan.threadId ?? craftPlan.id),
      runtimeBinding: {
        ...craftPlan.runtimeBinding,
        environment: {
          kind: projectLocation.kind,
          ...(projectLocation.kind === "wsl" ? { distro: projectLocation.distro } : {}),
        },
      },
    };
    ensureThreadWorkspace(projectLocation, plan.workspace);

    const isCompatibilityRoute = plan.runtimeBinding.routeType === "compatibility";
    if (isCompatibilityRoute) {
      const sourceVendor = plan.ingredients.model?.vendor ?? plan.runtimeBinding.vendor;
      const sourceProvider = (
        {
          openai: "codex",
          codex: "codex",
          moonshot: "kimi",
          kimi: "kimi",
          xai: "grok",
          grok: "grok",
        } as Record<string, string>
      )[sourceVendor];
      // CPA 绑定模型来源账号，不能从目标 Harness 的订阅池取凭据。
      if (!accountId && sourceProvider && this.accountStore.records(sourceProvider).length > 0) {
        accountId = this.accountResolver.resolve({ provider: sourceProvider, mode: "auto" }).account
          .accountId;
      }
      // CPA owns provider translation; its target factory reuses the selected
      // Harness session seam so tools, permissions and resume stay intact.
      const adapter = this._compatibilityRuntimeAdapterFactory
        ? await Promise.resolve(
            this._compatibilityRuntimeAdapterFactory(plan.runtimeBinding.harnessKind, accountId),
          )
        : await this.createDefaultCompatibilityRuntimeAdapter(
            plan.runtimeBinding.harnessKind,
            accountId,
            projectLocation,
            candidateMcpServers,
          );
      if (!adapter) {
        throw CraftingError.runtimeUnavailable(
          plan.runtimeBinding.harnessKind,
          "Compatibility Bridge sidecar is unavailable (CLIPROXY_BINARY_PATH not configured or adapter factory declined).",
          "Install the CLIProxyAPI sidecar and configure its binary path to enable the Compatibility route.",
        );
      }
      const sourceAccount = accountId ? this.accountStore.getRecord(accountId) : undefined;
      return {
        adapter: this.ownedHarnessRuntimes.own(adapter),
        plan,
        ...(sourceAccount
          ? {
              accountBinding: {
                accountId: sourceAccount.accountId,
                provider: sourceAccount.provider,
                credentialScopeRef: sourceAccount.credentialScopeRef,
                reason: "explicit" as const,
                boundAt: Date.now(),
              },
            }
          : {}),
      };
    }

    let accountRoot: string | undefined;
    let accountEnv: Record<string, string> | undefined;
    let accountBinding: AccountBinding | undefined;
    const explicitRecord = accountId ? this.accountStore.getRecord(accountId) : undefined;
    const managedProvider =
      (plan.runtimeBinding.harnessKind === "codex" ||
        plan.runtimeBinding.harnessKind === "opencode" ||
        plan.runtimeBinding.harnessKind === "muse" ||
        plan.runtimeBinding.harnessKind === "kimi" ||
        plan.runtimeBinding.harnessKind === "grok" ||
        plan.runtimeBinding.harnessKind === "deepseek") &&
      explicitRecord?.provider === "openai-compatible"
        ? "openai-compatible"
        : plan.runtimeBinding.harnessKind === "codex"
          ? "codex"
          : plan.runtimeBinding.harnessKind === "grok"
            ? "grok"
            : plan.runtimeBinding.harnessKind === "kimi"
              ? "kimi"
              : plan.runtimeBinding.harnessKind === "antigravity"
                ? "antigravity"
                : plan.runtimeBinding.harnessKind === "opencode"
                  ? (plan.runtimeBinding.providerID ?? plan.runtimeBinding.vendor)
                  : undefined;
    const hasCredentialedManagedAccount = managedProvider
      ? this.accountStore
          .records(managedProvider)
          .some((account) => this.hasManagedCredential(managedProvider, account))
      : false;
    if (managedProvider && (accountId || hasCredentialedManagedAccount)) {
      // v0.5: provider-pool scheduling drives auto selection; the legacy
      // selectedAccountId marker no longer routes auto sessions. Explicit
      // per-session overrides still never fall back.
      const resolution = this.accountResolver.resolve({
        provider: managedProvider,
        mode: accountMode ?? (accountId ? "explicit" : "auto"),
        ...(accountId ? { explicitAccountId: accountId } : {}),
        // Same-turn failover's tried set (see createCraftingAdapter): never
        // re-resolve onto an account that already died this turn. Explicit
        // overrides ignore it — they never fall back by contract.
        ...(excludedAccountIds?.length ? { excludedAccountIds: [...excludedAccountIds] } : {}),
      });
      if (managedProvider === "antigravity") {
        // B-mode (user-mandated): Antigravity sessions always execute on the
        // shared host login, which follows the resolved pool row. No per-
        // session ADC credential is published: the upstream CLI skips its
        // model catalog for ADC sessions, so pool-bound spawns can never
        // validate a model. accountBinding still records the followed row for
        // display and quota attribution.
        await this.ensureAntigravityHostFollowsPool(resolution.account.accountId);
      }
      const profileSpec = prepareNativeProfile(managedProvider, {
        accountId: resolution.account.accountId,
        credentialRoot: this.accountStore.credentialRoot(resolution.account.accountId),
        credentialScopeRef: resolution.account.credentialScopeRef,
      });
      accountBinding = {
        accountId: resolution.account.accountId,
        provider: resolution.account.provider,
        credentialScopeRef: resolution.account.credentialScopeRef,
        reason: resolution.reason,
        boundAt: Date.now(),
        ...(resolution.account.providerAccountId
          ? { providerAccountId: resolution.account.providerAccountId }
          : {}),
        ...(resolution.account.maskedIdentity
          ? { maskedIdentity: resolution.account.maskedIdentity }
          : {}),
      };
      if (managedProvider === "openai-compatible") {
        if (plan.runtimeBinding.harnessKind === "opencode") {
          const runtime = this.openAiCompatibleProfileService.prepareOpenCodeRuntime(
            resolution.account.accountId,
            plan.runtimeBinding.modelId,
          );
          accountRoot = runtime.configDir;
          accountEnv = runtime.env;
        } else if (plan.runtimeBinding.harnessKind === "muse") {
          const runtime = this.openAiCompatibleProfileService.prepareMuseRuntime(
            resolution.account.accountId,
          );
          accountRoot = runtime.isolationDir;
          accountEnv = runtime.env;
        } else if (
          plan.runtimeBinding.harnessKind === "kimi" ||
          plan.runtimeBinding.harnessKind === "grok" ||
          plan.runtimeBinding.harnessKind === "deepseek"
        ) {
          const runtime = this.openAiCompatibleProfileService.prepareVendorCompatRuntime(
            resolution.account.accountId,
            plan.runtimeBinding.harnessKind,
            plan.runtimeBinding.modelId,
            thirdPartyProtocol,
          );
          accountEnv = runtime.env;
        } else {
          const runtime = this.openAiCompatibleProfileService.prepareCodexRuntime(
            resolution.account.accountId,
          );
          accountRoot = runtime.codexHome;
          accountEnv = runtime.env;
        }
      } else if (managedProvider === "antigravity") {
        // B-mode: ambient host execution (see above). accountBinding was set
        // from the followed row; no pool credential is projected and no
        // profile identity is verified against an ADC file.
      } else {
        accountRoot = this.accountStore.credentialRoot(resolution.account.accountId);
        accountEnv = profileSpec.env;
        verifyProfileIdentity(managedProvider, accountRoot, resolution.account);
      }
    }

    const mcpServers = await this.resolveCraftingMcpServers(
      plan,
      projectLocation,
      candidateMcpServers,
    );
    const skills = await this.resolveCraftingSkills(plan, projectLocation);
    const adapter = this._customCraftingAdapter
      ? this._customCraftingAdapter(plan, projectLocation)
      : plan.runtimeBinding.harnessKind === "codex"
        ? new NativeCodexRuntimeAdapter({
            ...(accountRoot
              ? {
                  codexHome: accountRoot,
                  ...(managedProvider === "openai-compatible"
                    ? { profileMode: "endpoint" as const }
                    : {}),
                  ...(accountEnv ? { baseSpawnEnv: accountEnv } : {}),
                }
              : {}),
            ...(accountBinding ? { accountBinding } : {}),
            ...(mcpServers !== undefined ? { mcpServers } : {}),
            ...(skills.segments.length > 0 ? { skillSegments: skills.segments } : {}),
            ...(skills.inlineInstructions
              ? { inlineSkillInstructions: skills.inlineInstructions }
              : {}),
          })
        : createNativeHarnessRuntimeAdapter(plan.runtimeBinding.harnessKind, {
            projectLocation,
            ...(mcpServers !== undefined ? { mcpServers } : {}),
            ...(skills.segments.length > 0 ? { skillSegments: skills.segments } : {}),
            ...(skills.inlineInstructions
              ? { inlineSkillInstructions: skills.inlineInstructions }
              : {}),
            runtimeOptions: {
              ...(plan.runtimeBinding.options ?? {}),
            },
            ...(plan.runtimeBinding.profileRef
              ? { profileRef: plan.runtimeBinding.profileRef }
              : {}),
            ...(accountBinding ? { accountBinding } : {}),
            ...(plan.runtimeBinding.harnessKind === "opencode"
              ? {
                  openCodeRuntimeBindingResolver: this.openCodeRuntimeBindingResolver,
                  openCodeServerPool: this.openCodeServerPool,
                  // Evidence-based readiness (replaces the permanent
                  // "unverified" stub): reaching this point means the adapter
                  // factory accepted the plan and any managed account already
                  // passed identity verification upstream. A bound account is
                  // cited by id; otherwise the route runs on the OpenCode
                  // harness's own discovery-authenticated ambient auth, and
                  // any live failure surfaces as the real server/CLI error at
                  // spawn instead of a pre-emptive block here.
                  openCodeReadinessProvider: ({ providerID, modelID }) =>
                    accountBinding
                      ? {
                          status: "ready" as const,
                          reason: `Managed ${accountBinding.provider} account ${accountBinding.accountId} credential verified for OpenCode route '${providerID}:${modelID}'.`,
                        }
                      : {
                          status: "ready" as const,
                          reason: `No managed account bound; OpenCode route '${providerID}:${modelID}' uses the harness ambient auth verified at discovery.`,
                        },
                }
              : {}),
            ...(accountEnv ? { baseSpawnEnv: accountEnv } : {}),
            ...(accountBinding && plan.runtimeBinding.harnessKind === "grok"
              ? {
                  onPromptError: (error: unknown) =>
                    this.handleGrokNativePromptError(accountBinding!.accountId, error),
                }
              : {}),
          });
    if (!adapter) {
      throw CraftingError.runtimeUnavailable(
        plan.runtimeBinding.harnessKind,
        `No native Harness adapter is registered for '${plan.runtimeBinding.harnessKind}'.`,
      );
    }
    if (!adapter.supports(plan)) {
      throw CraftingError.runtimeUnavailable(
        plan.runtimeBinding.harnessKind,
        `No production runtime adapter is available for '${plan.runtimeBinding.harnessKind}'.`,
      );
    }
    const ownedAdapter = this.ownedHarnessRuntimes.own(adapter);
    if (!this._customCraftingAdapter) {
      this.nativeHarnessAdapters.set(plan.runtimeBinding.harnessKind, ownedAdapter);
    }
    return { adapter: ownedAdapter, plan, ...(accountBinding ? { accountBinding } : {}) };
  }

  private hasManagedCredential(
    provider: string,
    account: { accountId: string; credentialRoot: string },
  ): boolean {
    // Resolve through the store so legacy rows that escape the managed root
    // self-heal (dev vs prod copy) instead of probing a foreign directory.
    // An unrepairable row is not credentialed: the pool then reports an
    // explicit pool error instead of failing mid-creation with a path error.
    let root: string;
    try {
      root = this.accountStore.credentialRoot(account.accountId);
    } catch {
      return false;
    }
    if (provider === "grok" || provider === "codex") {
      return existsSync(join(root, "auth.json"));
    }
    if (provider === "kimi") {
      return existsSync(join(root, "credentials", "kimi-code.json"));
    }
    if (provider === "antigravity") {
      // Antigravity credentials live in the sealed vault, not in the profile
      // directory; a refresh token is what makes the account schedulable.
      return this.antigravityProfileService.hasRefreshToken(account.accountId);
    }
    return true;
  }

  /**
   * B-mode host follow: serialize concurrent ensures per row and converge the
   * host `agy` login on the resolved pool row. Throws when the row cannot be
   * published (unknown row, missing credential, OS write failure) so the
   * session start fails loud instead of sending as the wrong identity.
   */
  private ensureAntigravityHostFollowsPool(accountId: string): Promise<void> {
    const inFlight = this.antigravityHostFollowInFlight.get(accountId);
    if (inFlight) return inFlight;
    const pending = this.antigravityProfileService
      .ensureHostFollowsAccount(accountId)
      .then(() => undefined)
      .finally(() => {
        if (this.antigravityHostFollowInFlight.get(accountId) === pending) {
          this.antigravityHostFollowInFlight.delete(accountId);
        }
      });
    this.antigravityHostFollowInFlight.set(accountId, pending);
    return pending;
  }

  /**
   * Next usable third-party channel serving the same model — the channel
   * catalog counterpart of subscription pool scheduling. Skips disabled and
   * unschedulable rows, protocol-mismatched channels, rows cooling down
   * from a quota death, and the same-turn tried set. Throws an explicit
   * pool-exhausted error when nothing remains — never a silent ambient
   * fallback, and never the subscription pool: a channel model must only
   * run on a validated channel credential.
   */
  private resolveNextThirdPartyChannel(input: {
    threadId?: string | undefined;
    modelId?: string | undefined;
    failedAccountId?: string | undefined;
    excludedAccountIds?: readonly string[] | undefined;
  }): { accountId: string; reason: string } {
    const modelId = input.modelId?.trim();
    const poolExhausted = (detail: string) =>
      new AccountControlError(
        "ACCOUNT_POOL_EXHAUSTED",
        `No usable OpenAI-compatible channel for model '${modelId || "unknown"}' in the channel pool.（${detail}）` +
          "去「渠道与额度」添加渠道或等待额度恢复后再试。",
        { provider: THIRD_PARTY_CHANNEL_PROVIDER },
      );
    if (!modelId) throw poolExhausted("该厂商尚无账号");
    // The replacement must speak the same protocol the dead row proved:
    // a Responses-only Codex route can never run on a chat_completions row.
    const protocol = input.failedAccountId
      ? this.openAiCompatibleProfileService.getDescriptor(input.failedAccountId)?.validatedProtocol
      : undefined;
    const now = Date.now();
    const excluded = new Set(input.excludedAccountIds ?? []);
    const next = this.openAiCompatibleProfileService
      .channelAccountsServingModel({ modelId, ...(protocol ? { protocol } : {}) })
      .filter((accountId) => !excluded.has(accountId))
      .filter((accountId) => (this.thirdPartyChannelCooldownUntil.get(accountId) ?? 0) <= now)[0];
    if (!next) {
      const tried = [...excluded].length > 0 ? "同回合已试过其余渠道均失败" : "没有可用渠道";
      throw poolExhausted(tried);
    }
    console.log(
      `[account] channel selected: thread=${input.threadId ?? "unknown"} model=${modelId} account=${next} reason=priority`,
    );
    return { accountId: next, reason: "priority" };
  }

  /**
   * Pool-first chat-session authorization (see ThreadSessionManagerOptions).
   * Providers with a managed account pool must never fall back to the ambient
   * host CLI login: a resolvable pool returns the account's scope env, an
   * unusable pool throws, and only a provider with NO credentialed pool
   * accounts returns undefined (ambient fallback).
   *
   * Antigravity is the B-mode exception (user-mandated): sessions always run
   * on the shared host login, which follows the resolved pool row (see
   * ensureAntigravityHostFollowsPool). The returned binding still names the
   * followed row; the env stays ambient (no ADC projection).
   *
   * Resolution retries briefly on a transient all-unusable pool: a running
   * sibling session's CLI rewrites its credential file atomically (Kimi's
   * rename cycle on `kimi-code.json`), which makes `credentialAvailable`
   * flicker false for a few milliseconds and used to fail an unrelated
   * session start with `Structured runtime session creation failed`.
   */
  private async resolveAccountSessionEnv(input: {
    provider: string;
    threadId: string;
    model?: string | undefined;
    thirdPartyAccountId?: string | undefined;
    thirdPartyProtocol?: "responses" | "chat_completions" | undefined;
    excludedAccountIds?: readonly string[] | undefined;
  }): Promise<{ accountId: string; reason: string; env: Record<string, string> } | undefined> {
    // Third-party launches bypass the subscription pool entirely. A
    // third-party model must NEVER fail with "No usable X account in the
    // provider pool" — the pool is simply not consulted on this path.
    if (input.thirdPartyAccountId) {
      return this.resolveThirdPartySessionEnv(
        input as {
          provider: string;
          threadId: string;
          model?: string | undefined;
          thirdPartyAccountId: string;
          thirdPartyProtocol?: "responses" | "chat_completions" | undefined;
        },
      );
    }
    const provider =
      input.provider === "codex" ||
      input.provider === "grok" ||
      input.provider === "kimi" ||
      input.provider === "antigravity"
        ? input.provider
        : undefined;
    if (!provider) return undefined;
    const hasCredentialedManagedAccount = this.accountStore
      .records(provider)
      .some((account) => this.hasManagedCredential(provider, account));
    if (!hasCredentialedManagedAccount) return undefined;
    // Throws ACCOUNT_POOL_EXHAUSTED when every account is unusable — that is
    // the explicit all-failed error, not a silent ambient fallback.
    let resolution: AccountResolution | undefined;
    try {
      resolution = this.accountResolver.resolve({
        provider,
        mode: "auto",
        ...(input.excludedAccountIds?.length
          ? { excludedAccountIds: [...input.excludedAccountIds] }
          : {}),
      });
    } catch (error) {
      const retryable =
        error instanceof AccountControlError &&
        (error.code === "ACCOUNT_POOL_EXHAUSTED" || error.code === "ACCOUNT_UNAVAILABLE");
      if (!retryable) throw error;
      for (let attempt = 1; attempt <= ACCOUNT_RESOLUTION_RETRIES && !resolution; attempt += 1) {
        await sleep(ACCOUNT_RESOLUTION_RETRY_DELAY_MS);
        try {
          resolution = this.accountResolver.resolve({
            provider,
            mode: "auto",
            ...(input.excludedAccountIds?.length
              ? { excludedAccountIds: [...input.excludedAccountIds] }
              : {}),
          });
          console.warn(
            `[account] pool resolution recovered after retry ${attempt}: provider=${provider} thread=${input.threadId}`,
          );
        } catch {
          if (attempt === ACCOUNT_RESOLUTION_RETRIES) throw error;
        }
      }
      if (!resolution) throw error;
    }
    const root = this.accountStore.credentialRoot(resolution.account.accountId);
    if (provider === "antigravity") {
      // B-mode (user-mandated): the session executes on the shared host
      // login, which follows the resolved pool row. Return the row for
      // binding display with an ambient (credential-free) env.
      await this.ensureAntigravityHostFollowsPool(resolution.account.accountId);
      console.log(
        `[account] pool account selected: provider=${provider} thread=${input.threadId} account=${resolution.account.accountId} reason=${resolution.reason}`,
      );
      return { accountId: resolution.account.accountId, reason: resolution.reason, env: {} };
    }
    const profileSpec = prepareNativeProfile(provider, {
      accountId: resolution.account.accountId,
      credentialRoot: root,
      credentialScopeRef: resolution.account.credentialScopeRef,
    });
    const env = profileSpec.env;
    console.log(
      `[account] pool account selected: provider=${provider} thread=${input.threadId} account=${resolution.account.accountId} reason=${resolution.reason}`,
    );
    return { accountId: resolution.account.accountId, reason: resolution.reason, env };
  }

  /**
   * Chat-lane third-party credential projection (pool bypass).
   *
   * The launching harness keeps running its own official agent loop; only the
   * credential source changes (third-party base URL + key + verified model +
   * verified protocol projected through the harness's official custom-provider
   * surface). Credential source stays sticky: callers record
   * `provider: "openai-compatible"` on the session binding from the returned
   * account id, so restarts/resumes re-enter this path instead of the pool.
   *
   * Implemented chat-lane projections: Codex+responses, Muse+responses,
   * OpenCode (any protocol), and Kimi/Grok/DeepSeek via vendor CLI env
   * (API key + Base URL). Anything else throws THIRD_PARTY_HARNESS_INCOMPATIBLE.
   */
  private resolveThirdPartySessionEnv(input: {
    provider: string;
    threadId: string;
    model?: string | undefined;
    thirdPartyAccountId: string;
    /**
     * Same-channel protocol-flip override (see
     * `isThirdPartyProtocolFlipError`): rewrites the Kimi provider table to
     * the other wire type on the same credential instead of walking to
     * another account.
     */
    thirdPartyProtocol?: "responses" | "chat_completions" | undefined;
  }): { accountId: string; reason: string; env: Record<string, string> } {
    const record = this.accountStore.getRecord(input.thirdPartyAccountId);
    if (!record || record.provider !== "openai-compatible") {
      throw new AccountControlError(
        "ACCOUNT_NOT_FOUND",
        "第三方 API 账号不存在或已删除，请重新选择模型。",
        { accountId: input.thirdPartyAccountId, provider: input.provider },
      );
    }
    const descriptor = this.openAiCompatibleProfileService.getDescriptor(record.accountId);
    if (!descriptor?.validatedProtocol) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "该第三方 API 尚未通过真实兼容性验证，请先验证后再使用。",
        { accountId: record.accountId, provider: input.provider },
      );
    }
    const protocol = descriptor.validatedProtocol;
    if (input.provider === "codex" && protocol === "responses") {
      const runtime = this.openAiCompatibleProfileService.prepareCodexRuntime(record.accountId);
      console.log(
        `[account] third-party session bound: provider=codex thread=${input.threadId} account=${record.accountId} protocol=responses`,
      );
      return {
        accountId: record.accountId,
        reason: "third-party",
        env: { ...runtime.env, CODEX_HOME: runtime.codexHome },
      };
    }
    if (input.provider === "muse" && protocol === "responses") {
      const runtime = this.openAiCompatibleProfileService.prepareMuseRuntime(record.accountId);
      console.log(
        `[account] third-party session bound: provider=muse thread=${input.threadId} account=${record.accountId} protocol=responses`,
      );
      return {
        accountId: record.accountId,
        reason: "third-party",
        env: runtime.env,
      };
    }
    if (
      input.provider === "opencode" ||
      (input.provider === "codex" && protocol === "chat_completions")
    ) {
      const runtime = this.openAiCompatibleProfileService.prepareOpenCodeRuntime(
        record.accountId,
        input.model,
      );
      console.log(
        `[account] third-party session bound: provider=opencode thread=${input.threadId} account=${record.accountId} protocol=${protocol}`,
      );
      return {
        accountId: record.accountId,
        reason: "third-party",
        env: runtime.env,
      };
    }
    if (input.provider === "kimi" || input.provider === "grok" || input.provider === "deepseek") {
      const runtime = this.openAiCompatibleProfileService.prepareVendorCompatRuntime(
        record.accountId,
        input.provider,
        input.model,
        input.thirdPartyProtocol,
      );
      console.log(
        `[account] third-party session bound: provider=${input.provider} thread=${input.threadId} account=${record.accountId} protocol=${protocol}`,
      );
      return {
        accountId: record.accountId,
        reason: "third-party",
        env: runtime.env,
      };
    }
    const wanted =
      input.provider === "codex" ||
      input.provider === "kimi" ||
      input.provider === "grok" ||
      input.provider === "antigravity" ||
      input.provider === "opencode" ||
      input.provider === "muse"
        ? input.provider
        : undefined;
    throw new AccountControlError(
      "THIRD_PARTY_HARNESS_INCOMPATIBLE",
      wanted
        ? `该第三方 API（${protocol === "responses" ? "Responses" : "Chat Completions"}）暂不支持直连 ${wanted} Harness；请选择 OpenCode、Codex 或 Muse Harness 或为该模型配置原生订阅账号。`
        : `该第三方 API 暂不支持在 ${input.provider} 上运行；请选择 OpenCode、Codex 或 Muse Harness 或为该模型配置原生订阅账号。`,
      {
        accountId: record.accountId,
        provider: input.provider,
        protocol,
        ...(input.model ? { model: input.model } : {}),
      },
    );
  }

  private async resolveCraftingMcpServers(
    plan: CraftAgentPayload["craftPlan"],
    projectLocation: ProjectLocation,
    candidates: McpServer[] | undefined,
  ): Promise<ResolvedMcpServer[] | undefined> {
    const config = nativeRuntimeExecutionConfigForPlan(plan);
    const explicitIds = config.mcpServerIds;
    const mode = config.capabilityMode ?? (explicitIds !== undefined ? "creative" : "auto");
    const harnessKind = plan.runtimeBinding.harnessKind;
    const adapter = this.adapters.get(harnessKind as AgentKind);
    const runtimeSupport = adapter?.capabilities;

    const resolution = await resolveCapabilities({
      harnessKind,
      agentKind: this.adapters.has(harnessKind as AgentKind) ? harnessKind : undefined,
      mode,
      projectLocation,
      candidateMcpServers: candidates,
      runtimeSupport,
      explicitMcpServerIds: explicitIds,
      builtInMcpCandidates: this.builtInMcpCandidates(projectLocation),
    });

    if (mode === "creative" && explicitIds && explicitIds.length > 0) {
      const missingOrDisabled = resolution.diagnostics.skipped.filter(
        (item) =>
          item.kind === "mcp" && (item.reason === "not-found" || item.reason === "disabled"),
      );
      if (missingOrDisabled.length > 0) {
        throw CraftingError.runtimeUnavailable(
          harnessKind,
          `CraftPlan selected unavailable MCP server ids: ${missingOrDisabled.map((i) => i.id).join(", ")}.`,
        );
      }
    }

    if (resolution.mcpServers.length === 0 && resolution.builtInMcpServerIds.length === 0) {
      return undefined;
    }

    let selected = resolution.mcpServers;
    selected = await this.mcpOAuthService.applyAuthorization(selected);
    selected = await prepareMcpToolFilters(selected, projectLocation);

    // Capability-resolved built-ins (currently computer-use) join the same
    // injected MCP list: the AgentAdapter receives one merged, secret-free set.
    const builtInServers: ResolvedMcpServer[] = [];
    for (const builtInId of resolution.builtInMcpServerIds) {
      if (builtInId !== "computer-use") continue;
      const httpConfig = resolveComputerUseMcpHttpConfig(
        projectLocation,
        plan.threadId ? { threadId: plan.threadId } : undefined,
      );
      if (!httpConfig) continue;
      builtInServers.push({
        id: "computer-use",
        name: BUILT_IN_MCP_SERVER_NAMES["computer-use"],
        timeoutMs: DEFAULT_MCP_SERVER_TIMEOUT_MS,
        transport: { type: "http", url: httpConfig.url, headers: httpConfig.headers },
      });
    }
    const merged: ResolvedMcpServer[] = [
      ...selected.map(({ description: _description, enabled: _enabled, ...server }) => server),
      ...builtInServers,
    ];
    if (merged.length === 0) return undefined;
    return merged;
  }

  /**
   * Built-in MCP candidates for capability resolution. Availability is honest:
   * computer-use requires a supported host platform, a configured launch
   * endpoint, and a project location that can reach the loopback ingress.
   */
  private builtInMcpCandidates(projectLocation: ProjectLocation): BuiltInMcpCandidate[] {
    const hostPlatformOk = process.platform === "win32" || process.platform === "darwin";
    const endpointConfigured = readComputerUseMcpEnv() !== null;
    const isWsl = projectLocation.kind === "wsl";
    const available = hostPlatformOk && endpointConfigured && !isWsl;
    const unavailableReason = !hostPlatformOk
      ? `computer-use is unsupported on ${process.platform}.`
      : isWsl
        ? "computer-use cannot reach the host loopback ingress from a WSL project."
        : endpointConfigured
          ? undefined
          : "computer-use MCP launch endpoint is not configured.";
    return [
      {
        id: "computer-use",
        name: "computer_use",
        available,
        ...(unavailableReason ? { unavailableReason } : {}),
      },
    ];
  }

  private async resolveCraftingSkills(
    plan: CraftAgentPayload["craftPlan"],
    projectLocation: ProjectLocation,
  ): Promise<{ segments: PromptSegment[]; inlineInstructions?: string }> {
    const config = nativeRuntimeExecutionConfigForPlan(plan);
    const explicitSkills = config.skills;
    const mode = config.capabilityMode ?? (explicitSkills !== undefined ? "creative" : "auto");
    const harnessKind = plan.runtimeBinding.harnessKind;
    const agentKind = this.adapters.has(harnessKind as AgentKind)
      ? (harnessKind as AgentKind)
      : undefined;

    if (agentKind) await this.skillsService.prepareForLaunch(projectLocation, agentKind);
    const scan = await this.skillsService.scan({
      projectLocation,
      ...(agentKind ? { agentKind } : {}),
      presentationMode: "gui",
    });

    const eligibleSkills = agentKind
      ? scan.skills.filter((skill) => scan.effectiveSkillIds.includes(skill.id))
      : scan.skills.filter((skill) => skill.enabled && skill.valid);

    const resolution = await resolveCapabilities({
      harnessKind,
      agentKind,
      mode,
      projectLocation,
      availableSkills: eligibleSkills,
      explicitSkillIds: explicitSkills,
    });

    if (mode === "creative" && explicitSkills && explicitSkills.length > 0) {
      for (const requestedSkill of explicitSkills) {
        const matches = eligibleSkills.filter(
          (skill) =>
            skill.id === requestedSkill ||
            skill.name.toLowerCase() === requestedSkill.toLowerCase(),
        );
        if (matches.length !== 1) {
          throw CraftingError.runtimeUnavailable(
            harnessKind,
            matches.length === 0
              ? `CraftPlan selected unavailable skill '${requestedSkill}'.`
              : `CraftPlan skill '${requestedSkill}' is ambiguous; select its stable skill id.`,
          );
        }
      }
    }

    if (resolution.skills.length === 0) return { segments: [] };

    const selected = resolution.skills;
    const invocationFor = (name: string): string => {
      if (scan.invocation === "slash") return `/${name}`;
      if (scan.invocation === "dollar") return `$${name}`;
      return `Use the '${name}' skill for this request.`;
    };
    let segments: PromptSegment[] = selected.map((skill) => ({
      kind: "skill",
      name: skill.name,
      path: skill.skillFilePath,
      invocation: invocationFor(skill.name),
      provider: skill.providerLabel,
      scope: skill.scope,
      ...(skill.pluginId ? { pluginId: skill.pluginId } : {}),
      ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
    }));
    segments = await this.skillsService.filterPluginSkillSegments(segments, {
      ...(agentKind ? { agentKind } : {}),
      projectLocation,
      presentationMode: "gui",
    });
    const explicitInvocation = Boolean(explicitSkills?.length);
    const inlineInstructions = await this.skillsService.buildTurnSkillInjection({
      agentKind: agentKind ?? harnessKind,
      projectLocation,
      segments,
      intent: explicitInvocation ? "invoked" : "available",
    });
    // Auto exposes enabled skills for discovery; it must not manufacture a
    // user invocation of every installed skill on every turn.
    return {
      segments: explicitInvocation ? segments : [],
      ...(inlineInstructions ? { inlineInstructions } : {}),
    };
  }

  private async prepareHandoffTarget(
    craftPlan: CraftAgentPayload["craftPlan"],
    projectLocation: ProjectLocation,
    accountId?: string,
    accountMode?: "explicit" | "selected" | "auto" | "preferred",
  ): Promise<PreparedTargetRuntime> {
    // The handoff target plan compiles from model+harness slots only, so it
    // carries no MCP capability fields, and the renderer sends no candidates
    // along the switch request. Reuse the source conversation's snapshot —
    // otherwise the rebuilt session comes up with MCP entirely missing.
    const mcpCandidates = craftPlan.threadId
      ? this.craftMcpCandidatesByThread.get(craftPlan.threadId)
      : undefined;
    const effectivePlan = this.inheritHandoffCapabilityConfig(craftPlan);
    let binding: AccountBinding | undefined;
    try {
      const created = await this.createCraftingAdapter(
        effectivePlan,
        projectLocation,
        mcpCandidates,
        accountId,
        accountMode,
      );
      binding = created.accountBinding;
      // Failover rebuilds reuse the handoff target's location snapshot; keep
      // it fresh here too so a post-switch failover rebuilds in place.
      if (craftPlan.threadId) {
        this.craftProjectLocationByThread.set(craftPlan.threadId, projectLocation);
      }
      const entity = await created.adapter.spawnEntity(created.plan);
      const session = await created.adapter.createSession(entity);
      return {
        entity,
        session,
        plan: created.plan,
        ...(binding ? { accountBinding: binding } : {}),
      };
    } catch (error) {
      if (binding) this.releaseCraftedBinding(binding);
      throw error;
    }
  }

  /**
   * Carry the source plan's capability configuration (capability mode, explicit
   * MCP server ids, explicit skills) onto the handoff target plan. The target
   * compiles fresh from model+harness slots and would otherwise resolve
   * capabilities in auto mode with an empty candidate set — a silent semantic
   * drift from the conversation the user is continuing.
   */
  private inheritHandoffCapabilityConfig(
    target: CraftAgentPayload["craftPlan"],
  ): CraftAgentPayload["craftPlan"] {
    const source = target.threadId ? this.craftedPlansByThread.get(target.threadId) : undefined;
    if (!source) return target;
    const sourceConfig = nativeRuntimeExecutionConfigForPlan(source);
    const targetConfig = nativeRuntimeExecutionConfigForPlan(target);
    const patch: Record<string, unknown> = {};
    if (sourceConfig.capabilityMode && !targetConfig.capabilityMode) {
      patch.capabilityMode = sourceConfig.capabilityMode;
    }
    if (sourceConfig.mcpServerIds && !targetConfig.mcpServerIds) {
      patch.mcpServerIds = sourceConfig.mcpServerIds;
    }
    if (sourceConfig.skills && !targetConfig.skills) {
      patch.skills = sourceConfig.skills;
    }
    if (Object.keys(patch).length === 0) return target;
    return {
      ...target,
      overrides: { ...(target.overrides ?? {}), ...patch },
    } as CraftAgentPayload["craftPlan"];
  }

  private registerCraftedSession(
    threadId: string | undefined,
    harnessKind: string,
    session: CraftSession,
    binding: AccountBinding | undefined,
    plan?: CraftAgentPayload["craftPlan"],
    entityId?: string,
    segment?: import("@/shared/sessionHandoff").RuntimeSegment,
  ): void {
    if (!threadId) return;
    this.craftedSessionsByThread.set(threadId, session);
    if (plan) this.craftedPlansByThread.set(threadId, plan);
    this.nativeHarnessSessions.set(harnessKind, session);
    if (binding) this.craftedSessionBindings.set(threadId, binding);
    else this.craftedSessionBindings.delete(threadId);
    const ensuredInitialSegment =
      segment || !plan || !entityId
        ? undefined
        : this.sessionHandoffCoordinator.ensureInitialSegment({
            threadId,
            plan,
            entityId,
            session,
          });
    const activeSegment = segment ?? ensuredInitialSegment;
    let subscriptions = this.craftedSessionUnsubscribers.get(threadId);
    if (!subscriptions) {
      subscriptions = new Map();
      this.craftedSessionUnsubscribers.set(threadId, subscriptions);
    }
    // Rollback re-registers the original source Session. Its existing listener
    // already carries the source Segment identity, so subscribing twice would
    // duplicate every subsequent canonical event.
    if (subscriptions.has(session.id)) return;
    const unsubscribe = session.subscribe((event) => {
      const execution =
        activeSegment && activeSegment.runtimeSessionId === session.id
          ? {
              segmentId: activeSegment.id,
              runtimeSessionId: session.id,
              bindingEpoch: activeSegment.bindingEpoch,
              ...(event.nativeEnvelope?.sequence !== undefined
                ? { eventSequence: event.nativeEnvelope.sequence }
                : {}),
            }
          : this.sessionHandoffCoordinator.executionEnvelope(threadId, session);
      const fencedEvent = execution ? { ...event, execution } : event;
      if (!this.sessionHandoffCoordinator.acceptsEvent(threadId, fencedEvent)) return;
      if (fencedEvent.type === "request.opened") {
        let requests = this.craftedRequestsByThread.get(threadId);
        if (!requests) {
          requests = new Map();
          this.craftedRequestsByThread.set(threadId, requests);
        }
        requests.set(fencedEvent.requestId, fencedEvent);
      } else if (fencedEvent.type === "request.resolved") {
        this.craftedRequestsByThread.get(threadId)?.delete(fencedEvent.requestId);
      }
      const pending = this.pendingHandoffEvents.get(threadId);
      if (pending) pending.push(fencedEvent);
      else {
        this.emit({ type: "thread-runtime-event", threadId, event: fencedEvent });
        this.publishCraftedSessionState(threadId, session, fencedEvent);
      }
      // The runtime acknowledged the interrupt with a real turn completion:
      // disarm the force-stop watchdog.
      if (fencedEvent.type === "turn.completed") this.clearCraftedInterruptWatchdog(threadId);
      void this.sessionHandoffCoordinator.onRuntimeEvent(threadId, fencedEvent);
      if (
        fencedEvent.type === "session.exited" &&
        this.craftedSessionsByThread.get(threadId) === session
      ) {
        this.releaseCraftedSession(threadId);
      }
    });
    subscriptions.set(session.id, unsubscribe);
    if (activeSegment) {
      const activeEntityId = activeSegment.entityId ?? entityId;
      if (!activeEntityId) {
        throw new Error("HANDOFF_RUNTIME_SEGMENT_ENTITY_MISSING");
      }
      const markerId = `runtime-segment:${activeSegment.id}`;
      const marker = {
        type: "item.started" as const,
        threadId,
        itemId: markerId,
        itemType: "runtime_segment" as const,
        payload: {
          segmentId: activeSegment.id,
          ordinal: activeSegment.ordinal,
          recipeId: activeSegment.recipeId,
          craftPlanId: activeSegment.craftPlanId,
          modelId: activeSegment.runtimeBinding.modelId,
          harnessKind: activeSegment.runtimeBinding.harnessKind,
          entityId: activeEntityId,
          runtimeSessionId: activeSegment.runtimeSessionId ?? session.id,
          ...(activeSegment.nativeSessionRef
            ? { nativeSessionRef: activeSegment.nativeSessionRef }
            : {}),
          bindingEpoch: activeSegment.bindingEpoch,
        },
        execution: {
          segmentId: activeSegment.id,
          runtimeSessionId: activeSegment.runtimeSessionId ?? session.id,
          bindingEpoch: activeSegment.bindingEpoch,
        },
      };
      const publishMarker = (event: import("@/shared/contracts").RuntimeEvent) => {
        const pending = this.pendingHandoffEvents.get(threadId);
        if (pending) pending.push(event);
        else this.emit({ type: "thread-runtime-event", threadId, event });
      };
      publishMarker(marker);
      publishMarker({ ...marker, type: "item.completed" });
    }
    // v0.9 F1: the FIRST crafted Segment never runs a handoff transaction, so
    // without this publish the renderer never learns the active execution
    // binding and every fenced active command fails closed. Reuse the existing
    // session-switch-state channel (phase="active" + activeSegment) so the
    // renderer's single envelope accessor stays the only epoch source; the
    // durable copy lets readSessionSwitchState re-seed after a reload instead
    // of clearing the binding.
    if (ensuredInitialSegment) {
      const now = new Date().toISOString();
      const bindingState: import("@/shared/sessionHandoff").SessionSwitchState = {
        requestId: `segment:${ensuredInitialSegment.id}`,
        threadId,
        mode: "after-current-turn",
        phase: "active",
        sourceSegmentId: ensuredInitialSegment.id,
        targetBinding: ensuredInitialSegment.runtimeBinding,
        ...(plan ? { targetCraftPlan: craftPlanSchema.parse(sanitizePortableRecord(plan)) } : {}),
        ...(binding ? { activeAccountBinding: binding } : {}),
        activeSegment: ensuredInitialSegment,
        requestedAt: ensuredInitialSegment.activatedAt ?? ensuredInitialSegment.createdAt,
        updatedAt: now,
      };
      this.runtimeSegmentLedger.saveSwitchState(bindingState);
      this.emit({ type: "session-switch-state", threadId, state: bindingState });
    }
    if (!this.pendingHandoffEvents.has(threadId))
      this.publishCraftedSessionState(threadId, session);
  }

  /** Canonical content alone does not update the desktop's thread-state
   * channel. Publish only lifecycle boundaries, never per-token snapshots. */
  private publishCraftedSessionState(
    threadId: string,
    session: CraftSession,
    event?: import("@/shared/contracts").RuntimeEvent,
  ): void {
    if (
      event &&
      ![
        "turn.started",
        "turn.completed",
        "request.opened",
        "request.resolved",
        "session.exited",
        "error",
      ].includes(event.type)
    )
      return;
    if (this.craftedSessionsByThread.get(threadId) !== session) return;
    const request = this.craftedRequestsByThread.get(threadId)?.values().next().value;
    let status: import("@/shared/contracts").ThreadStatus;
    let attention: import("@/shared/contracts").ThreadAttention;
    if (event?.type === "session.exited") {
      status = "inactive";
      attention = "none";
    } else if (
      event?.type === "error" ||
      (event?.type === "turn.completed" && event.state === "failed")
    ) {
      status = "error";
      attention = "error";
    } else if (request) {
      status = request.requestType === "tool_user_input" ? "needs_reply" : "needs_approval";
      attention = status;
    } else if (
      event?.type === "turn.started" ||
      (event?.type !== "turn.completed" && session.status === "busy")
    ) {
      status = "working";
      attention = "working";
    } else {
      status = "idle";
      attention = "none";
    }
    const providerSessionId = session.nativeSessionRef ?? session.sessionRef;
    this.emit({
      type: "thread-state",
      threadId,
      status,
      attention,
      canResumeWithConfig: Boolean(providerSessionId),
      ...(providerSessionId
        ? { sessionRef: { providerSessionId, discoveredAt: new Date().toISOString() } }
        : {}),
      ...(event?.type === "error" ? { errorMessage: event.message } : {}),
    });
  }

  private releaseCraftedBinding(binding: AccountBinding): void {
    for (const [threadId, candidate] of this.craftedSessionBindings) {
      if (candidate === binding) this.craftedSessionBindings.delete(threadId);
    }
  }

  private releaseCraftedSession(threadId: string): void {
    for (const unsubscribe of this.craftedSessionUnsubscribers.get(threadId)?.values() ?? []) {
      unsubscribe();
    }
    this.craftedSessionUnsubscribers.delete(threadId);
    const session = this.craftedSessionsByThread.get(threadId);
    this.craftedSessionsByThread.delete(threadId);
    this.craftedPlansByThread.delete(threadId);
    this.craftedRequestsByThread.delete(threadId);
    this.craftMcpCandidatesByThread.delete(threadId);
    this.craftProjectLocationByThread.delete(threadId);
    this.craftedFailoverTriedByThread.delete(threadId);
    this.craftedFailoverEpochByThread.delete(threadId);
    for (const [harnessKind, candidate] of this.nativeHarnessSessions) {
      if (candidate === session) this.nativeHarnessSessions.delete(harnessKind);
    }
    this.craftedSessionBindings.delete(threadId);
    this.pendingHandoffEvents.delete(threadId);
    this.handoffSourceBindings.delete(threadId);
    this.clearCraftedInterruptWatchdog(threadId);
  }

  /**
   * Turn-end reaping for subagent runs (user-mandated): when a parent turn
   * finishes (completed/failed), its still-running children are cancelled so
   * a new turn never inherits orphans. Interrupted turns are excluded on
   * purpose — steer-resume continues them, and the interrupt path already
   * owns foreground cancellation. No-op for threads without live runs.
   */
  private observeParentTurnEnd(
    threadId: string,
    event: import("@/shared/contracts").RuntimeEvent,
  ): void {
    if (event.type !== "turn.completed") return;
    if (event.state !== "completed" && event.state !== "failed") return;
    if (!threadId) return;
    try {
      this.subagentRunManager.completeTurn(threadId);
    } catch (error) {
      console.warn("[supervisor] failed to reap subagent runs on turn end:", error);
    }
  }

  /**
   * A Grok ACP prompt can reject with a generic -32603 while carrying the
   * provider's actionable quota signal in `data.message`, or end "normally"
   * while streaming the exhaustion as an in-stream error message. Both shapes
   * mark the account: without the write-back the pool keeps resolving the
   * dead account and same-turn failover has nothing to advance to. Keep the
   * account pool's state tied to the session's immutable binding; never mark
   * the selected account or another account just because the UI selection
   * changed.
   */
  private handleGrokNativePromptError(accountId: string, error: unknown): void {
    if (!isGrokPoolQuotaError(error)) return;
    const message = resolveAcpPromptRpcErrorMessage(error);
    try {
      this.accountStore.updateStatus(accountId, "quota-exhausted", {
        lastError: message,
        lastQuotaAt: Date.now(),
      });
      this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    } catch (statusError) {
      // The provider error remains authoritative for the current turn. A
      // metadata lock/corruption must not replace it with bookkeeping noise.
      console.warn("[supervisor] failed to record Grok quota exhaustion:", statusError);
    }
  }

  /**
   * Kimi counterpart to handleGrokNativePromptError: same contract (quota
   * marks the BOUND account only; anything else leaves pool state alone).
   * 429 rate-limiting and 401/403 auth failures never mark — the former
   * recovers on its own, the latter needs a human re-login.
   */
  private handleKimiNativePromptError(accountId: string, error: unknown): void {
    if (!isKimiPoolQuotaError(error)) return;
    const message = "Kimi 额度已耗尽";
    try {
      this.accountStore.updateStatus(accountId, "quota-exhausted", {
        lastError: message,
        lastQuotaAt: Date.now(),
      });
      this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    } catch (statusError) {
      console.warn("[supervisor] failed to record Kimi quota exhaustion:", statusError);
    }
  }

  /**
   * Codex counterpart to handleGrokNativePromptError: same contract. Only
   * the verified exhausted shape marks; rate-limit nudges and `willRetry`
   * warnings never do.
   */
  private handleCodexNativePromptError(accountId: string, error: unknown): void {
    if (!isCodexPoolQuotaError(error)) return;
    const message = error instanceof Error ? error.message : String(error ?? "");
    try {
      this.accountStore.updateStatus(accountId, "quota-exhausted", {
        lastError: message,
        lastQuotaAt: Date.now(),
      });
      this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    } catch (statusError) {
      console.warn("[supervisor] failed to record Codex quota exhaustion:", statusError);
    }
  }

  /**
   * Antigravity counterpart to handleGrokNativePromptError: the same
   * rotate-after-failure contract the standalone switchers (agy-cli-manager /
   * agm / agy-swap) implement externally. A first-turn quota or auth failure
   * marks the BOUND account only, so the next session resolves a different
   * pool row instead of retrying the dead one. Anything else — notably
   * `invalid model selection` and project/API configuration errors — leaves
   * pool state untouched.
   */
  private handleAntigravityNativePromptError(accountId: string, error: unknown): void {
    const raw = error instanceof Error ? error.message : String(error ?? "");
    const message = raw.trim().slice(0, 300);
    const quota = isAntigravityQuotaError(message);
    const auth = !quota && isAntigravityAuthError(message);
    if (!quota && !auth) return;
    try {
      this.accountStore.updateStatus(accountId, quota ? "quota-exhausted" : "auth-expired", {
        ...(message ? { lastError: message } : {}),
        lastQuotaAt: Date.now(),
      });
      this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
    } catch (statusError) {
      // Same contract as Grok: bookkeeping must not replace the turn error.
      console.warn("[supervisor] failed to record Antigravity account failure:", statusError);
      return;
    }
    // Rotate-after-failure for the host login: when the failed row is also
    // what the host currently holds, follow with the next usable pool row so
    // ambient sessions keep working. Best-effort and silent: the turn error
    // above stays authoritative.
    void this.antigravityProfileService
      .rotateHostAfterFailure(accountId, () => {
        try {
          return {
            accountId: this.accountResolver.resolve({ provider: "antigravity", mode: "auto" })
              .account.accountId,
          };
        } catch {
          return undefined;
        }
      })
      .then((rotation) => {
        if (rotation.rotated) {
          console.log(
            `[account] antigravity host login rotated after failure: account=${rotation.accountId}`,
          );
        }
      })
      .catch((rotationError) => {
        console.warn("[supervisor] failed to rotate Antigravity host login:", rotationError);
      });
  }

  /**
   * Quota write-back for crafted-lane turns, mirroring the chat lane's
   * `handleAccountPromptError`: a prompt rejected for quota marks the BOUND
   * account exhausted so the pool scheduler skips it on the next session.
   * Each provider handler re-checks its own matcher, so calling this for an
   * already-marked account or a non-quota error is a no-op. The crafted
   * native adapter only wires `onPromptError` for Grok — Kimi/Codex rows
   * depend on this call, otherwise a dead row never gets marked and every
   * failover attempt re-resolves onto it. Third-party channels cool down
   * instead of store-marking (the relay quota poller resets every row).
   */
  private writeCraftedQuotaMark(
    provider: string,
    accountId: string | undefined,
    error: unknown,
  ): void {
    if (!accountId) return;
    if (provider === THIRD_PARTY_CHANNEL_PROVIDER) {
      if (thirdPartyFailureKind(error) === "quota") {
        this.thirdPartyChannelCooldownUntil.set(
          accountId,
          Date.now() + QUOTA_INFERENCE_MARK_TTL_MS,
        );
      }
      return;
    }
    if (provider === "grok") {
      this.handleGrokNativePromptError(accountId, error);
    } else if (provider === "kimi") {
      this.handleKimiNativePromptError(accountId, error);
    } else if (provider === "codex") {
      this.handleCodexNativePromptError(accountId, error);
    } else if (provider === "antigravity") {
      this.handleAntigravityNativePromptError(accountId, error);
    }
  }

  /**
   * Whether a third-party channel row is scheduler-usable for failover:
   * enabled, schedulable status, and not cooling down from a quota death.
   * (Descriptor presence is enforced by the channel query itself.)
   */
  private isThirdPartyChannelUsable(accountId: string): boolean {
    const record = this.accountStore.getRecord(accountId);
    return (
      !!record &&
      record.provider === THIRD_PARTY_CHANNEL_PROVIDER &&
      record.enabled &&
      (record.status === "available" || record.status === "quota-low") &&
      (this.thirdPartyChannelCooldownUntil.get(accountId) ?? 0) <= Date.now()
    );
  }

  /** Failover notice identities (providerAccountId → masked → label). */
  private describeCraftedPoolAccount(provider: string, accountId: string): string | undefined {
    const view = this.accountStore.get(accountId);
    if (!view || view.provider !== provider) return undefined;
    return (
      view.providerAccountId?.trim() ||
      view.maskedIdentity?.trim() ||
      view.label.trim() ||
      undefined
    );
  }

  /**
   * Same-turn pool failover for crafted (native-harness) sessions — the
   * crafted-lane counterpart of the legacy chat lane's `tryPoolFailover`.
   *
   * A crafted session is bound to its pool account at creation and never
   * re-resolves: without this, a thread whose account dies mid-conversation
   * banners "quota exhausted" on every turn forever while usable pool rows
   * wait. On a quota error we rebuild on the next usable account (same plan,
   * same prompt, same painted user-message id) and replay the turn in place,
   * so `sendThreadInput` still resolves with the follow-up answer. Only the
   * truthfully empty pool still surfaces the quota banner.
   *
   * Open to every subscription pool (grok/kimi/codex/antigravity) with a
   * provider-dispatched quota matcher, plus sticky third-party channels
   * (ChatGPT-via-relay and every other channel model), which walk the
   * channel catalog for the same model instead of a subscription pool.
   * Compatibility routes and auth failures stay fail-closed. Never throws
   * bookkeeping noise: rebuild declines resolve to the original quota error.
   *
   * Returns undefined (instead of throwing) when the chain is superseded by
   * a handoff/close or by an explicit Stop mid-flight: like the legacy
   * lane's generation guard, a raced turn is dropped silently because the
   * newer flow already owns the outcome.
   */
  private async runCraftedTurnWithPoolFailover<R>(input: {
    threadId: string;
    harnessKind: string;
    plan: CraftAgentPayload["craftPlan"];
    projectLocation: ProjectLocation;
    provider: string;
    failedAccountId: string | undefined;
    runTurn: (session: CraftSession) => Promise<R>;
  }): Promise<R | undefined> {
    const startedSession = this.craftedSessionsByThread.get(input.threadId);
    if (!startedSession) throw new Error(`Unknown crafted session: ${input.threadId}`);
    // Non-pool lanes keep the historical direct behavior: no resolution,
    // no rebuild, the provider error propagates untouched.
    if (
      !isPoolRotationProvider(input.provider) ||
      input.plan.runtimeBinding.routeType === "compatibility"
    ) {
      return input.runTurn(startedSession);
    }
    const thirdPartyChannel = input.provider === THIRD_PARTY_CHANNEL_PROVIDER;
    const epochAtStart = this.craftedFailoverEpochByThread.get(input.threadId) ?? 0;
    let session = startedSession;
    let failedAccountId = input.failedAccountId;
    const tried = new Set<string>();
    let lastError: unknown;
    let flippedThisTurn = false;
    // Fast path for a binding the scheduler already knows is dead (the
    // common repeated-submit shape): skip burning the turn on it and go
    // straight to the next usable row, mirroring the legacy lane's
    // dead-binding restart. The first real attempt still runs normally when
    // the row looks usable.
    let skipFirstAttempt = false;
    if (failedAccountId) {
      skipFirstAttempt = thirdPartyChannel
        ? !this.isThirdPartyChannelUsable(failedAccountId)
        : (() => {
            const bound = this.accountStore.getRecord(failedAccountId);
            return (
              !bound ||
              bound.provider !== input.provider ||
              !bound.enabled ||
              (bound.status !== "available" && bound.status !== "quota-low")
            );
          })();
    }
    const isFailoverFuel = (error: unknown): boolean =>
      thirdPartyChannel
        ? thirdPartyFailureKind(error) !== undefined
        : isPoolQuotaErrorForProvider(input.provider, error);
    for (let attempt = 0; ; attempt++) {
      let flipProbe: Error | undefined;
      if (!skipFirstAttempt) {
        try {
          const result = await input.runTurn(session);
          if (thirdPartyChannel) {
            const quotaFailure = readCraftedChannelFailure(result);
            if (quotaFailure) {
              lastError = quotaFailure;
            } else {
              // A resolved failed turn carrying 400-class text fuels a
              // protocol flip, never a channel walk.
              const flipFailure = readCraftedFlipFailure(result);
              if (!flipFailure) return result;
              flipProbe = flipFailure;
            }
          } else {
            const quotaFailure = readCraftedQuotaFailure(input.provider, result);
            if (!quotaFailure) return result;
            lastError = projectCraftedQuotaError(input.provider, quotaFailure);
          }
        } catch (error) {
          if (!isFailoverFuel(error)) {
            flipProbe = error instanceof Error ? error : new Error(String(error));
          } else {
            lastError = thirdPartyChannel ? error : projectCraftedQuotaError(input.provider, error);
          }
        }
      } else {
        skipFirstAttempt = false;
        lastError = new Error(
          `No usable ${input.provider} account in the provider pool (bound row ${failedAccountId} is spent). ` +
            `去「渠道与额度」添加账号或等待额度恢复后再试。`,
        );
      }
      // Same-channel protocol flip (third-party only; subscription lanes
      // never reach here with flipProbe set): a 400 means the channel and
      // credential are fine but the validated wire type 400s on the real
      // workload — rewrite the Kimi provider table to the other type on the
      // SAME row and replay. At most one flip per turn; the row is never
      // added to the tried set (it isn't dead). Deliberately quiet (log line
      // only, no toast): the channel never changed.
      if (flipProbe !== undefined) {
        if (!thirdPartyChannel) throw flipProbe;
        const flipped =
          !flippedThisTurn && failedAccountId
            ? this.flipThirdPartyChannelProtocol(failedAccountId, flipProbe)
            : undefined;
        if (!flipped) throw flipProbe;
        flippedThisTurn = true;
        if (attempt >= MAX_POOL_FAILOVER_ATTEMPTS_PER_TURN) break;
        if ((this.craftedFailoverEpochByThread.get(input.threadId) ?? 0) !== epochAtStart) {
          return undefined;
        }
        if (this.craftedSessionsByThread.get(input.threadId) !== session) {
          return undefined;
        }
        const reflipped = await this.rebuildCraftedSessionForProtocolFlip(
          input.threadId,
          input.plan,
          input.projectLocation,
          flipped.accountId,
          flipped.protocol,
        ).catch((rebuildError) => {
          console.warn(
            `[account] crafted channel protocol flip declined: provider=${input.provider} thread=${input.threadId} attempt=${attempt + 1} account=${failedAccountId} reason=${rebuildError instanceof Error ? rebuildError.message : String(rebuildError)}`,
          );
          return undefined;
        });
        if (!reflipped) throw flipProbe;
        if (this.craftedSessionsByThread.get(input.threadId) !== session) {
          await reflipped.session.terminate().catch(() => undefined);
          return undefined;
        }
        await session.terminate().catch(() => undefined);
        this.registerCraftedSession(
          input.threadId,
          input.harnessKind,
          reflipped.session,
          reflipped.binding,
          input.plan,
          reflipped.entityId,
        );
        console.log(
          `[account] crafted channel protocol flip: provider=${input.provider} thread=${input.threadId} attempt=${attempt + 1} account=${failedAccountId} to=${flipped.protocol}`,
        );
        session = reflipped.session;
        // failedAccountId intentionally unchanged (same row); tried untouched.
        lastError = flipProbe;
        continue;
      }
      // The quota write-back usually already ran via the adapter's
      // onPromptError; re-mark here so providers without that wiring
      // (Kimi/Codex on the crafted lane) still advance the scheduler.
      this.writeCraftedQuotaMark(input.provider, failedAccountId, lastError);
      if (failedAccountId) tried.add(failedAccountId);
      if (attempt >= MAX_POOL_FAILOVER_ATTEMPTS_PER_TURN) break;
      if ((this.craftedFailoverEpochByThread.get(input.threadId) ?? 0) !== epochAtStart) {
        // An explicit Stop landed mid-chain: drop the raced turn silently —
        // the interrupt path already owns the outcome.
        return undefined;
      }
      if (this.craftedSessionsByThread.get(input.threadId) !== session) {
        // Superseded (handoff/close/rebuild raced us): the newer flow owns
        // the turn, keep its outcome instead of bookkeeping noise.
        return undefined;
      }
      const rebuilt = await this.rebuildCraftedSessionForFailover(
        input.threadId,
        input.plan,
        input.projectLocation,
        [...tried],
        thirdPartyChannel
          ? {
              modelId: input.plan.runtimeBinding.modelId,
              failedAccountId,
            }
          : undefined,
      ).catch((rebuildError) => {
        // Never silent: a declined failover surfaces the original quota
        // error, so without this line a broken restart looks exactly like
        // "no failover".
        console.warn(
          `[account] crafted pool failover declined: provider=${input.provider} thread=${input.threadId} attempt=${attempt + 1} from=${failedAccountId ?? "ambient"} reason=${rebuildError instanceof Error ? rebuildError.message : String(rebuildError)}`,
        );
        return undefined;
      });
      if (!rebuilt) throw lastError;
      if (this.craftedSessionsByThread.get(input.threadId) !== session) {
        // Superseded while rebuilding: drop the orphan (avoid a leaked CLI
        // process) and the raced turn with it.
        await rebuilt.session.terminate().catch(() => undefined);
        return undefined;
      }
      await session.terminate().catch(() => undefined);
      this.registerCraftedSession(
        input.threadId,
        input.harnessKind,
        rebuilt.session,
        rebuilt.binding,
        input.plan,
        rebuilt.entityId,
      );
      this.craftedFailoverTriedByThread.set(input.threadId, new Set(tried));
      console.log(
        `[account] crafted pool failover: provider=${input.provider} thread=${input.threadId} attempt=${attempt + 1} from=${failedAccountId} to=${rebuilt.binding.accountId}`,
      );
      const describe = (accountId: string | undefined) =>
        (accountId && this.describeCraftedPoolAccount(input.provider, accountId)) ||
        accountId ||
        "ambient";
      this.emit({
        type: "thread-pool-failover",
        threadId: input.threadId,
        provider: input.provider,
        fromAccount: describe(failedAccountId),
        toAccount: describe(rebuilt.binding.accountId),
      });
      session = rebuilt.session;
      failedAccountId = rebuilt.binding.accountId;
    }
    throw lastError;
  }

  /**
   * Same-channel protocol-flip target: validates that `error` is a genuine
   * 400-class wire-type failure and returns the SAME channel with the other
   * Kimi provider-table type. Undefined = fail closed (non-400, unknown
   * model, auth wording, or unknown current type).
   */
  private flipThirdPartyChannelProtocol(
    failedAccountId: string,
    error: unknown,
  ): { accountId: string; protocol: "responses" | "chat_completions" } | undefined {
    if (!isThirdPartyProtocolFlipError(error)) return undefined;
    const current =
      this.openAiCompatibleProfileService.getDescriptor(failedAccountId)?.validatedProtocol;
    const flipped =
      current === "responses"
        ? ("chat_completions" as const)
        : current === "chat_completions"
          ? ("responses" as const)
          : undefined;
    if (!flipped) return undefined;
    return { accountId: failedAccountId, protocol: flipped };
  }

  /**
   * Rebuild a crafted session on the SAME third-party channel with a flipped
   * Kimi provider-table type (see `flipThirdPartyChannelProtocol`). The
   * channel row is reused explicitly — never pool-scheduled — so a flip can
   * never land on a different credential.
   */
  private async rebuildCraftedSessionForProtocolFlip(
    threadId: string,
    plan: CraftAgentPayload["craftPlan"],
    projectLocation: ProjectLocation,
    channelId: string,
    protocol: "responses" | "chat_completions",
  ): Promise<{ session: CraftSession; binding: AccountBinding; entityId: string } | undefined> {
    const created = await this.createCraftingAdapter(
      plan,
      projectLocation,
      this.craftMcpCandidatesByThread.get(threadId),
      channelId,
      "explicit",
      undefined,
      protocol,
    );
    if (!created.accountBinding) return undefined;
    const entity = await created.adapter.spawnEntity(created.plan);
    const session = await created.adapter.createSession(entity);
    return { session, binding: created.accountBinding, entityId: entity.id };
  }

  /**
   * Rebuild a crafted session on the next usable pool row for failover:
   * same plan, pool-scheduled account excluding every row that already died
   * this turn. Third-party channels resolve the next validated row for the
   * same model and bind it explicitly. Returns undefined when no usable row
   * remains (the caller surfaces the original quota error). A missing pool
   * binding is also a decline — failover must never silently drop a managed
   * session onto the ambient host login.
   */
  private async rebuildCraftedSessionForFailover(
    threadId: string,
    plan: CraftAgentPayload["craftPlan"],
    projectLocation: ProjectLocation,
    triedAccountIds: string[],
    channel?: { modelId: string; failedAccountId: string | undefined },
  ): Promise<{ session: CraftSession; binding: AccountBinding; entityId: string } | undefined> {
    if (channel) {
      const next = this.resolveNextThirdPartyChannel({
        threadId,
        modelId: channel.modelId,
        failedAccountId: channel.failedAccountId,
        excludedAccountIds: triedAccountIds,
      });
      const created = await this.createCraftingAdapter(
        plan,
        projectLocation,
        this.craftMcpCandidatesByThread.get(threadId),
        next.accountId,
        "explicit",
      );
      if (!created.accountBinding) return undefined;
      const entity = await created.adapter.spawnEntity(created.plan);
      const session = await created.adapter.createSession(entity);
      return { session, binding: created.accountBinding, entityId: entity.id };
    }
    const created = await this.createCraftingAdapter(
      plan,
      projectLocation,
      this.craftMcpCandidatesByThread.get(threadId),
      undefined,
      "auto",
      triedAccountIds,
    );
    if (!created.accountBinding) return undefined;
    const entity = await created.adapter.spawnEntity(created.plan);
    const session = await created.adapter.createSession(entity);
    return { session, binding: created.accountBinding, entityId: entity.id };
  }

  /**
   * Stop every live thread running `agentKind`. Deleting an ACP registry agent
   * goes through here first: the thread's process is the agent, so leaving it
   * running would keep an uninstalled agent alive (and on Windows keep a lock on
   * the install directory being removed). Per-thread failures are logged, never
   * fatal — one stuck session must not block the removal.
   */
  private async closeThreadsForAgentKind(agentKind: AgentKind): Promise<void> {
    const threadIds = [...this.sessions.values()]
      .filter((session) => session.agentKind === agentKind)
      .map((session) => session.threadId);
    await Promise.all(
      threadIds.map((threadId) =>
        this.threadSessionManager.closeThread({ threadId }).catch((error) => {
          console.warn(
            `[supervisor] failed to close thread ${threadId} while removing ${agentKind}:`,
            error,
          );
        }),
      ),
    );
  }

  getAvailableWindowsShells() {
    return process.platform === "win32" ? this.getCachedAvailableWindowsShells() : [];
  }

  private getCachedAvailableWindowsShells() {
    const now = Date.now();
    if (this.availableWindowsShellsCache && now - this.availableWindowsShellsCache.ts < 60_000) {
      return this.availableWindowsShellsCache.shells;
    }
    const shells = detectWindowsShells(resolveExecutablePath);
    this.availableWindowsShellsCache = { shells, ts: now };
    return shells;
  }

  private resolveWindowsPowerShell(): WindowsShellPreference {
    const settings = this.sharedSettingsCache.readFresh();
    const detected = selectWindowsPowerShell(
      settings.windowsInternalShellPath,
      this.getCachedAvailableWindowsShells(),
    );
    if (detected) {
      return { shell: detected.path, kind: detected.kind, args: ["-NoLogo"] };
    }
    const legacy = getWindowsSystemCommand("WindowsPowerShell\\v1.0\\powershell.exe");
    if (existsSync(legacy)) {
      return { shell: legacy, kind: "powershell", args: ["-NoLogo"] };
    }
    return { shell: getWindowsSystemCommand("cmd.exe"), kind: "cmd", args: [] };
  }

  private resolveWindowsShell(
    runtime: "preferred" | "powershell" = "preferred",
  ): WindowsShellPreference {
    if (process.platform !== "win32") {
      return { shell: process.env.SHELL || "/bin/bash", kind: "cmd", args: [] };
    }
    if (runtime === "powershell") {
      return this.resolveWindowsPowerShell();
    }
    const settings = this.sharedSettingsCache.readFresh();
    if (settings.windowsShellPath !== WINDOWS_SHELL_AUTO && existsSync(settings.windowsShellPath)) {
      return selectWindowsShell(settings, [
        {
          path: settings.windowsShellPath,
          kind: inferWindowsShellKind(settings.windowsShellPath),
        },
      ]);
    }
    return selectWindowsShell(settings, this.getCachedAvailableWindowsShells());
  }

  async getOwnSubagentsSpawnableAgents(contextTags: readonly string[] = []) {
    const { windows } = await this.agentStatusService.getAgentStatuses({ wslDistros: [] });
    const settings: CrossagentVisibilitySettings = this.sharedSettingsCache.read();
    return buildSpawnableAgents(this.adapters, windows, settings, contextTags);
  }

  async getOwnSubagentsRoutingSnapshot(): Promise<CrossagentRoutingState> {
    const { windows } = await this.agentStatusService.getAgentStatuses({ wslDistros: [] });
    const settings = this.sharedSettingsCache.read();
    return {
      ranked: crossagentRoutingSnapshot(
        buildSpawnableAgents(this.adapters, windows, settings),
        crossagentRankingPreferences(settings),
      ),
      providers: listCrossagentEligibleProviders(this.adapters, windows, settings),
    };
  }

  confirmOwnSubagentsRoutingOverride(payload: ConfirmOwnSubagentsRoutingOverridePayload): void {
    this.routingOverridePersistence.confirm(payload);
  }

  /** Distinct WSL distros hosting a live `antigravity` session (the only
   * locations the usage scanner needs — native scanning is host-wide). */
  private getActiveAntigravityWslDistros(): string[] {
    const distros = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.agentKind !== "antigravity" || session.ptyExited) continue;
      if (session.projectLocation.kind === "wsl") distros.add(session.projectLocation.distro);
    }
    return [...distros];
  }

  /**
   * True when the user actively uses WSL: a watched (non-disabled) project
   * lives in a distro, or a live session does. Gates the usage credential
   * WSL fallback so it never boots a distro on its own.
   */
  private hasActiveWslContext(): boolean {
    if (this._projectWatcher?.hasWslProjects()) return true;
    for (const session of this.sessions.values()) {
      if (!session.ptyExited && session.projectLocation.kind === "wsl") return true;
    }
    return false;
  }

  async gitRemoveWorktree(payload: GitRemoveWorktreePayload): Promise<void> {
    await this.prepareWorktreeRemovals([payload.path]);
    return this.gitService.removeWorktree(
      payload.projectLocation,
      payload.path,
      payload.force,
      payload.deleteBranch,
      payload.expectedBranch,
      payload.expectedOwnerToken,
    );
  }

  async removeExperimentWorktrees(
    payload: RemoveExperimentWorktreesPayload,
  ): Promise<RemoveExperimentWorktreesResult> {
    return this.gitService.removeExperimentWorktrees(payload, async (worktrees) => {
      await this.prepareWorktreeRemovals(worktrees.map((worktree) => worktree.path));
    });
  }

  async captureExperimentSnapshot(
    payload: CaptureExperimentSnapshotPayload,
  ): Promise<CaptureExperimentSnapshotResult> {
    const snapshot = await this.gitService.captureExperimentSnapshot(payload);
    return toPublicExperimentSnapshot(snapshot);
  }

  async judgeExperimentSnapshot(
    payload: JudgeExperimentSnapshotPayload,
  ): Promise<JudgeExperimentSnapshotResult> {
    if (payload.mode === "responses") {
      const snapshot = captureExperimentResponseSnapshot(
        payload,
        (threadId) => this.threadSessionManager.readTerminalScrollback(threadId),
        (candidate) => {
          this.emit({
            type: "experiment-judge-progress",
            experimentId: payload.experimentId,
            progress: {
              kind: "captured-response",
              threadId: candidate.threadId,
              characters: candidate.characters,
            },
          });
        },
      );
      this.emit({
        type: "experiment-judge-progress",
        experimentId: payload.experimentId,
        progress: { kind: "judging" },
      });
      const judgement = await this.generationService.judgeExperiment({
        experimentId: payload.experimentId,
        projectLocation: payload.projectLocation,
        agentKind: payload.agentKind,
        ...(payload.model ? { model: payload.model } : {}),
        ...(payload.effort ? { effort: payload.effort } : {}),
        ...(payload.fast !== undefined ? { fast: payload.fast } : {}),
        mode: "responses",
        prompt: payload.prompt,
        candidates: snapshot.candidates,
      });
      return { hash: snapshot.hash, ...judgement };
    }

    const snapshot = await this.gitService.captureExperimentSnapshot(payload, (candidate) => {
      this.emit({
        type: "experiment-judge-progress",
        experimentId: payload.experimentId,
        progress: {
          kind: "captured",
          threadId: candidate.threadId,
          files: candidate.files,
          insertions: candidate.insertions,
          deletions: candidate.deletions,
          ...(candidate.omittedFiles ? { omittedFiles: candidate.omittedFiles } : {}),
        },
      });
    });
    if (snapshot.candidates.every((candidate) => !candidate.diff.trim())) {
      throw new Error(msg("experiment.judge.noChanges"));
    }
    this.emit({
      type: "experiment-judge-progress",
      experimentId: payload.experimentId,
      progress: { kind: "judging" },
    });
    const judgement = await this.generationService.judgeExperiment({
      experimentId: payload.experimentId,
      projectLocation: payload.projectLocation,
      agentKind: payload.agentKind,
      ...(payload.model ? { model: payload.model } : {}),
      ...(payload.effort ? { effort: payload.effort } : {}),
      ...(payload.fast !== undefined ? { fast: payload.fast } : {}),
      mode: "changes",
      prompt: payload.prompt,
      candidates: snapshot.candidates.map((candidate) => ({
        threadId: candidate.threadId,
        diff: candidate.diff,
        ...(candidate.omittedFiles ? { omittedFiles: candidate.omittedFiles } : {}),
      })),
    });
    return { ...toPublicExperimentSnapshot(snapshot), ...judgement };
  }

  private async prepareWorktreeRemovals(paths: readonly string[]): Promise<void> {
    const normalizePath = (path: string) => normalizeWorktreePathForComparison(path, true);
    const normalizedTargets = new Set(paths.map(normalizePath));
    const threadIds = new Set<string>();

    for (const [threadId, session] of this.sessions) {
      const sessionPath =
        session.projectLocation.kind === "wsl"
          ? session.projectLocation.uncPath
          : session.projectLocation.path;
      if (normalizedTargets.has(normalizePath(sessionPath))) {
        threadIds.add(threadId);
      }
    }

    for (const [threadId, shell] of this.shellSessions) {
      const shellPath = shell.worktreePath ? normalizePath(shell.worktreePath) : undefined;
      if (shellPath && normalizedTargets.has(shellPath)) {
        threadIds.add(threadId);
      }
    }

    await Promise.all(
      [...threadIds].map((threadId) =>
        this.threadSessionManager.closeThread({ threadId }).catch((error) => {
          console.warn(
            `[supervisor] failed to close thread ${threadId} during worktree removal:`,
            error,
          );
        }),
      ),
    );
    await Promise.all(paths.map((path) => this.projectWatcher.unwatchWorktree(path)));
  }

  async gitPruneWorktrees(payload: GitPruneWorktreesPayload): Promise<void> {
    const managedRoots = await this.collectManagedWorktreeRoots(payload.projectLocation);
    return this.gitService.pruneWorktrees(
      payload.projectLocation,
      payload.activeWorktreePaths,
      managedRoots,
    );
  }

  /**
   * The worktree roots CraftStation considers "managed" for prune: the built-in
   * default, the resolved global root (custom base or project-relative), and the
   * project-relative root. Per-project custom bases are excluded on purpose so we
   * never auto-delete a user-chosen directory.
   */
  private async collectManagedWorktreeRoots(location: ProjectLocation): Promise<string[]> {
    const settings = this.sharedSettingsCache.read();
    const builtIn = await resolveBuiltInWorktreeRoot(location);
    const global = resolveWorktreePlacement(settings, undefined, location);
    const projectRelative = resolveWorktreePlacement(
      settings,
      { mode: "project-relative" },
      location,
    );
    const roots = [builtIn, global.root, projectRelative.root].filter((root): root is string =>
      Boolean(root),
    );
    return [...new Set(roots)];
  }

  async relocateProject(payload: RelocateProjectPayload): Promise<RelocateProjectResult> {
    const { newLocation } = payload;

    // The moved repo's linked worktrees still point their `.git` files at the old
    // main-repo path; `worktree repair` rewrites those back-pointers. This also
    // implicitly validates that `newLocation` is a real git repository (it errors
    // otherwise), which we surface to the caller.
    const repairedWorktrees = await this.gitService.repairWorktrees(newLocation);

    // Path-keyed caches were built under the old location identity; drop them so
    // the next read recomputes against the new path.
    this.projectTreeService.invalidateAllCaches();
    this.fileIndexService.invalidateCacheForLocation(newLocation);

    // Re-point the file watcher at the new path (idempotent: replaces the old entry).
    this.projectWatcher.watch(payload.projectId, newLocation);

    return { repairedWorktrees };
  }

  /** Fetch, then pull (merge or rebase) when behind, then push when ahead. */
  async gitSync(payload: GitSyncPayload, rebase: boolean): Promise<GitSyncResult> {
    const location = payload.projectLocation;
    const remote = payload.remote ?? "origin";
    await this.gitService.fetch(location, remote, false);

    const status = await this.gitService.getStatus(location);
    let pulled = false;
    let pushed = false;

    if (status.behind > 0) {
      if (rebase) {
        await this.gitService.pullRebase(location, remote);
      } else {
        await this.gitService.pull(location, remote);
      }
      pulled = true;
    }

    const afterPull = pulled ? await this.gitService.getStatus(location) : status;
    if (afterPull.ahead > 0) {
      await this.gitService.push(location, remote);
      pushed = true;
    }

    return { pulled, pushed };
  }

  async gitProjectSnapshot(payload: GitProjectSnapshotPayload): Promise<GitProjectSnapshotResult> {
    const { projectLocation, includeGhCheck } = payload;
    if (projectLocation.kind === "wsl") {
      return this.gitService.batchedWslProjectSnapshot(projectLocation, includeGhCheck);
    }
    const [statusResult, branchesResult, worktreesResult, ghResult] = await Promise.allSettled([
      this.gitService.getStatus(projectLocation),
      this.gitService.listBranches(projectLocation, true),
      this.gitService.listWorktrees(projectLocation),
      includeGhCheck
        ? this.githubService.checkGhAvailable(projectLocation).then((r) => r.available)
        : Promise.resolve<boolean | null>(null),
    ]);
    return {
      status: statusResult.status === "fulfilled" ? statusResult.value : null,
      branches: branchesResult.status === "fulfilled" ? branchesResult.value : null,
      worktrees: worktreesResult.status === "fulfilled" ? worktreesResult.value.worktrees : null,
      ghAvailable: ghResult.status === "fulfilled" ? ghResult.value : null,
    };
  }

  async cloneRepo(payload: CloneRepoPayload): Promise<CloneRepoResult> {
    const { parentLocation, name, source } = payload;
    if (source.kind === "github") {
      return this.githubService.cloneRepo(
        parentLocation,
        name,
        source.nameWithOwner,
        source.account,
      );
    }
    return this.gitService.cloneFromUrl(parentLocation, name, source.url);
  }

  async detectSetupScript(payload: DetectSetupScriptPayload): Promise<DetectSetupScriptResult> {
    const candidates: { file: string; command: string }[] = [
      { file: "pnpm-lock.yaml", command: "pnpm install" },
      { file: "bun.lockb", command: "bun install" },
      { file: "bun.lock", command: "bun install" },
      { file: "yarn.lock", command: "yarn install" },
      { file: "package-lock.json", command: "npm install" },
      { file: "poetry.lock", command: "poetry install" },
      { file: "Pipfile.lock", command: "pipenv install" },
      { file: "requirements.txt", command: "pip install -r requirements.txt" },
      { file: "Cargo.lock", command: "cargo fetch" },
      { file: "go.sum", command: "go mod download" },
      { file: "Gemfile.lock", command: "bundle install" },
      { file: "composer.lock", command: "composer install" },
    ];

    const location = payload.projectLocation;
    if (location.kind === "wsl") {
      if (!this.wslBridgeClient) return {};
      const paths = candidates.map((candidate) => joinProjectPosixPath(location, candidate.file));
      const { stats } = await this.wslBridgeClient.stat(location, paths);
      for (let index = 0; index < candidates.length; index += 1) {
        if (stats[index]?.isFile) {
          return { setupScript: candidates[index]!.command };
        }
      }
      return {};
    }

    const dir = location.path;
    for (const candidate of candidates) {
      if (existsSync(join(dir, candidate.file))) {
        return { setupScript: candidate.command };
      }
    }
    return {};
  }

  releaseWslBridgeIfUnused(distro: string): void {
    const hasLiveSession = [...this.sessions.values()].some(
      (session) =>
        session.status !== "inactive" &&
        session.projectLocation.kind === "wsl" &&
        session.projectLocation.distro === distro,
    );
    if (!hasLiveSession) {
      this.wslHookBridge?.releaseBridge(distro);
    }
  }

  dispose(): void {
    // The public shutdown hook is intentionally fire-and-forget. Close the
    // supervisor-owned SQLite handle synchronously so Windows can release the
    // DB/WAL files before a caller removes a temporary data directory.
    this.runtimeSegmentLedger.close();
    void this.disposeAsync();
  }

  async disposeAsync(): Promise<void> {
    this.disposeWindowsPowerShellPreference();
    this.disposeWslCredentialProjectScope();
    this.routingOverridePersistence.dispose();
    this.usageService.stop();
    this.mcpProbeService.dispose();
    this.mcpOAuthService.dispose();
    this.lspManager.dispose();
    await this._projectWatcher?.dispose();
    await Promise.allSettled(
      [...this.craftedSessionsByThread.entries()].map(async ([threadId, session]) => {
        await session.terminate().catch(() => undefined);
        this.sessionHandoffCoordinator.terminateActive(threadId);
        this.releaseCraftedSession(threadId);
      }),
    );
    await this.ownedHarnessRuntimes.dispose();
    await this.compatibilityBridgeService.stop();
    this.nativeHarnessAdapters.clear();
    await this.threadSessionManager.dispose();
    this.ownSubagentsMcpIngress.dispose();
    this.sharedSettingsCache.dispose();
    await this.cliHookPluginCoordinator.dispose().catch((error) => {
      console.warn("[supervisor] CLI hook plugin coordinator dispose failed:", error);
    });
    await this.openCodeServerPool.dispose();
    this.runtimeSegmentLedger.close();
    const { shutdownSpawnedOpenCodeServers } = await import("./agents/opencode/sdkClient");
    shutdownSpawnedOpenCodeServers();
    const { shutdownSpawnedCodexAppServers } = await import("./agents/codex/serverPool");
    shutdownSpawnedCodexAppServers();
  }

  private handlePtyData(session: SessionRuntime, data: string): void {
    this.threadSessionManager.handlePtyDataForTests(session, data);
  }

  private spawnThread(input: unknown): unknown {
    return this.threadSessionManager.spawnThreadForTests(
      input as Parameters<typeof this.threadSessionManager.spawnThreadForTests>[0],
    );
  }
}
