import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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
  GrokProfileCompletePayload,
  GrokProfileCancelPayload,
  GrokProfilePollPayload,
  GrokProfilePollResult,
  ProviderPoolConfig,
} from "@/shared/contracts";
import type {
  CraftSession,
  HarnessRuntimeAdapter,
  NativeHarnessDiagnostic,
  NativeHarnessControlPlaneEntry,
  NativeHarnessControlPlanePayload,
} from "@/shared/crafting";
import { AccountControlError } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import type {
  CraftAgentPayload,
  CraftAgentResult,
  ResumeCraftAgentPayload,
} from "@/shared/ipc/schemas";
import { crossagentRankingPreferences } from "@/shared/crossagentRanking";
import type { CrossagentRoutingState } from "@/shared/crossagentRanking";
import type { ConfirmCrossagentRoutingOverridePayload } from "@/shared/ipc/procedures/mcp";
import { msg } from "@/shared/messages";
import { resolvePoracodeBaseDir, resolvePoracodePaths } from "@/shared/poracodePaths";
import { joinProjectPosixPath } from "@/shared/wsl";
import { prefetchNativeNodeRuntime } from "./runtime/prefetchNativeNode";
import {
  setSessionFsBridgeClient,
  setWslProcessBridgeClient,
  type AgentAdapter,
  type AgentNativePlugin,
} from "./agents/base";
import { setWslAttachmentBridgeClient } from "./runtime/threadAttachments";
import { FileIndexService } from "./fileIndex";
import { GitService, resolveBuiltInWorktreeRoot, type CapturedExperimentSnapshot } from "./git";
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
import { CrossagentMcpIngress } from "./crossagentMcp/CrossagentMcpIngress";
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
import { hookDebugEnvelope, isPoracodeHookDebug } from "./runtime/hookDebug";
import { SupervisorSharedSettingsCache } from "./runtime/supervisorSharedSettings";
import { WslBridgeServer } from "./wsl/bridge";
import { WslBridgeClient } from "./wsl/bridge/client";
import { resolveWslHelpersDir } from "./wsl/wslDeploy";
import { resolveWslHostAccess } from "./wsl/hostAccess";
import { McpOAuthService } from "./mcp/McpOAuthService";
import { McpProbeService } from "./mcp/McpProbeService";
import { prepareMcpToolFilters } from "./mcp/McpToolFilterService";
import { ExternalMcpDiscoveryService } from "./mcp/ExternalMcpDiscoveryService";
import { SkillsService } from "./skills/SkillsService";
import { dropSkillSegmentsOnPolicyFailure } from "./skills/pluginSkillPolicy";
import { PluginRegistry, resolvePluginMcpServers } from "./plugins";
import { captureExperimentResponseSnapshot } from "./experimentResponseSnapshot";
import { NativeCodexRuntimeAdapter } from "./runtime/nativeCodex";
import { AppServerProcessHost } from "./runtime/nativeCodex/appServerProcessHost";
import { CraftingError } from "@/shared/crafting/errors";
import { AccountResolver } from "./runtime/accountResolver";
import { AccountStore } from "./runtime/accountStore";
import { createNativeHarnessRuntimeAdapter } from "./runtime/nativeHarness";
import {
  isAcpPromptQuotaExhaustedError,
  resolveAcpPromptRpcErrorMessage,
} from "./agents/acp/sessionErrors";
import {
  createRuntimeLedgerTokenUsageScanner,
  TokenUsageAdapter,
} from "./runtime/tokenUsageAdapter";
import {
  CodexProfileService,
  buildCodexLoginScript,
  managedCodexLoginCwd,
  managedCodexProcessEnvironment,
} from "./runtime/codexProfiles";
import {
  GrokProfileService,
  buildGrokLoginScript,
  createPendingGrokHome,
  managedGrokLoginCwd,
  managedGrokProcessEnvironment,
  grokAccountIdentityFromContainer,
} from "./runtime/grokProfiles";
import { AntigravityProfileService } from "./runtime/antigravityProfiles";
import { OpenAiCompatibleProfileService } from "./runtime/openaiCompatibleProfiles";
import { grokAuthContainer } from "./runtime/grokCredentials";
import { NATIVE_HARNESS_DESCRIPTORS } from "./runtime/nativeHarness/descriptors";
import { projectNativeHarnessControlPlane } from "./runtime/nativeHarness/controlPlane";

export { detectWslAgentStatuses, writeSubmittedPrompt };

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
  private readonly craftedSessionUnsubscribers = new Map<string, () => void>();
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
  readonly tokenUsageAdapter: TokenUsageAdapter;
  readonly codexProfileService: CodexProfileService;
  readonly grokProfileService: GrokProfileService;
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
  private readonly crossagentMcpIngress: CrossagentMcpIngress;
  private readonly subagentRunManager: SubagentRunManager;
  private readonly routingOverridePersistence: RoutingOverridePersistence;
  private readonly disposeWslCredentialProjectScope: () => void;
  private readonly disposeWindowsPowerShellPreference: () => void;
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
        for (const listener of this.runtimeEventSubscribers) listener(event.threadId, event.event);
      } else if (event.type === "thread-runtime-events") {
        for (const listener of this.runtimeEventSubscribers) {
          for (const runtimeEvent of event.events) listener(event.threadId, runtimeEvent);
        }
      } else if (event.type === "thread-runtime-events-multi") {
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
    const rawBaseDir = process.env.PORACODE_DATA_DIR?.trim();
    const envBaseDir =
      rawBaseDir && rawBaseDir !== "undefined" && isAbsolute(rawBaseDir) ? rawBaseDir : undefined;
    const baseDir = envBaseDir ?? resolvePoracodeBaseDir();
    this.baseDir = baseDir;
    this.mcpOAuthService = new McpOAuthService({ baseDir });
    this.mcpProbeService = new McpProbeService({
      applyAuthorization: (server) => this.mcpOAuthService.applyAuthorizationToServer(server),
    });
    const paths = resolvePoracodePaths(baseDir);
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
      bundledPluginsDir: () => process.env.PORACODE_BUNDLED_PLUGINS_DIR?.trim() || undefined,
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
        if (isPoracodeHookDebug()) {
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
          if (isPoracodeHookDebug()) {
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
        ...(process.env.PORACODE_HOOK_PORT
          ? { preferredPort: Number(process.env.PORACODE_HOOK_PORT) }
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
          if (isPoracodeHookDebug()) {
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

    // Crossagents: an in-process MCP server (CrossagentMcpIngress)
    // lets any agent spawn the other connected agents as subagents. The run
    // manager owns child structured sessions; the ingress mints per-thread
    // tokens and routes tools/call to the caller's parent thread. The run
    // manager's host is the thread session manager (assigned just below — the
    // closures resolve it lazily at call time).
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
    this.crossagentMcpIngress = new CrossagentMcpIngress({
      runManager: this.subagentRunManager,
      getSpawnableAgents: (tags) => this.getCrossagentSpawnableAgents(tags),
      resolveProviderSessionThreadId: (sessionId) =>
        this.threadSessionManager.getThreadIdByProviderSessionId(sessionId),
      // User-configured routing guidance, read live from shared settings (the
      // cache invalidates on file change) so edits take effect on the next turn
      // without a supervisor restart. Empty/whitespace-only = no guidance.
      getRoutingGuide: () => {
        const guide = this.sharedSettingsCache.read().crossagentRoutingGuide.trim();
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
          type: "crossagent-selection-used",
          selections: validSelections,
        });
      },
      listRoutingOverrides: () => this.sharedSettingsCache.read().crossagentRoutingOverrides,
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
    void this.crossagentMcpIngress.start().catch((error) => {
      console.warn("[supervisor] Crossagents MCP ingress failed to start:", error);
    });

    this.threadSessionManager = new ThreadSessionManager({
      emit,
      isDev: this.isDev,
      logsDir: this.logsDir,
      settingsPath: this.settingsPath,
      readDisableCliHookPlugin: () => this.sharedSettingsCache.read().disableCliHookPlugin,
      adapters: this.adapters,
      resolveWindowsShell: (runtime) => this.resolveWindowsShell(runtime),
      ...(this.wslHookBridge ? { wslBridge: this.wslHookBridge } : {}),
      resolvePluginEnvForSpawn: (input) =>
        this.cliHookPluginCoordinator.resolvePluginEnvForSpawn(input),
      crossagentMcp: {
        register: (threadId, disabledTools) =>
          this.crossagentMcpIngress.registerThread(threadId, disabledTools),
        registerProviderSession: (threadId, disabledTools) =>
          this.crossagentMcpIngress.registerProviderSessionThread(threadId, disabledTools),
        unregister: (threadId) => this.crossagentMcpIngress.unregisterThread(threadId),
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
    this.accountResolver = new AccountResolver(this.accountStore);
    this.tokenUsageAdapter = new TokenUsageAdapter(
      createRuntimeLedgerTokenUsageScanner(paths.dbPath),
    );
    this.codexProfileService = new CodexProfileService({ store: this.accountStore });
    this.grokProfileService = new GrokProfileService({ store: this.accountStore });
    this.antigravityProfileService = new AntigravityProfileService({
      store: this.accountStore,
      cacheDir: paths.cacheDir,
    });
    this.openAiCompatibleProfileService = new OpenAiCompatibleProfileService({
      store: this.accountStore,
      cacheDir: paths.cacheDir,
    });
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
    this.accountStore.remove(accountId);
    if (removed?.provider === "antigravity") {
      // The sealed OAuth bundle lives outside the managed credential dir.
      this.antigravityProfileService.destroyCredentials(accountId);
    }
    if (removed?.provider === "openai-compatible") {
      this.openAiCompatibleProfileService.destroyCredentials(accountId);
    }
    this.emit({ type: "usage-accounts", accounts: this.accountStore.list() });
  }

  /** Close either a crafted native session or a regular terminal/ACP thread. */
  async closeThread(payload: { threadId: string }): Promise<void> {
    const craftedSession = this.craftedSessionsByThread.get(payload.threadId);
    if (craftedSession) {
      try {
        await craftedSession.terminate();
      } finally {
        this.releaseCraftedSession(payload.threadId);
      }
      return;
    }
    await this.threadSessionManager.closeThread(payload);
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
    const statuses = (await this.agentStatusService.getAgentStatuses({ wslDistros: [] })).windows;
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

  async craftAgent(payload: CraftAgentPayload): Promise<CraftAgentResult> {
    let entityId: string | undefined;
    let sessionId: string | undefined;
    let accountBinding: AccountBinding | undefined;
    let craftedThreadId: string | undefined;
    let craftedSession: CraftSession | undefined;
    try {
      const created = this.createCraftingAdapter(
        payload.craftPlan,
        payload.projectLocation,
        payload.accountId,
        payload.accountMode,
      );
      const { adapter, plan } = created;
      accountBinding = created.accountBinding;
      const entity = await adapter.spawnEntity(plan);
      entityId = entity.id;
      const session = await adapter.createSession(entity);
      craftedSession = session;
      sessionId = session.id;
      craftedThreadId = session.threadId ?? plan.threadId;
      this.registerCraftedSession(
        craftedThreadId,
        plan.runtimeBinding.harnessKind,
        session,
        accountBinding,
      );
      const response =
        payload.prompt.trim().length > 0
          ? await session.sendPrompt(payload.prompt)
          : { response: "" };
      return {
        // The official app-server allocates the authoritative thread UUID.
        // Keep the CraftPlan request identity separate from the live Session
        // identity and return the latter to IPC callers.
        threadId: session.threadId ?? plan.threadId ?? "",
        entityId: entity.id,
        sessionId: session.id,
        response: response.response,
        ...(accountBinding ? { accountBinding } : {}),
      };
    } catch (error) {
      // The native ACP session normally observes this before projecting the
      // failure. Keep the Supervisor boundary defensive as well: custom
      // adapters and a first-turn rejection may bypass that callback.
      if (accountBinding?.provider === "grok") {
        this.handleGrokNativePromptError(accountBinding.accountId, error);
      }
      if (craftedSession) {
        await craftedSession.terminate().catch(() => undefined);
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
    }
  }

  async resumeCraftAgent(payload: ResumeCraftAgentPayload): Promise<CraftAgentResult> {
    let entityId: string | undefined;
    let sessionId: string | undefined;
    let accountBinding: AccountBinding | undefined;
    let craftedThreadId: string | undefined;
    let craftedSession: CraftSession | undefined;
    try {
      const created = this.createCraftingAdapter(
        payload.craftPlan,
        payload.projectLocation,
        payload.accountId,
      );
      const { adapter, plan } = created;
      accountBinding = created.accountBinding;
      const entity = await adapter.spawnEntity({ ...plan, sessionRef: payload.sessionRef });
      entityId = entity.id;
      const session = await adapter.resumeSession(entity, payload.sessionRef);
      craftedSession = session;
      sessionId = session.id;
      craftedThreadId = session.threadId ?? plan.threadId;
      this.registerCraftedSession(
        craftedThreadId,
        plan.runtimeBinding.harnessKind,
        session,
        accountBinding,
      );
      const response = payload.prompt?.trim()
        ? await session.sendPrompt(payload.prompt)
        : { response: "" };
      return {
        threadId: session.threadId ?? plan.threadId ?? "",
        entityId: entity.id,
        sessionId: session.id,
        response: response.response,
        ...(accountBinding ? { accountBinding } : {}),
      };
    } catch (error) {
      if (accountBinding?.provider === "grok") {
        this.handleGrokNativePromptError(accountBinding.accountId, error);
      }
      if (craftedSession) {
        await craftedSession.terminate().catch(() => undefined);
        if (craftedThreadId) this.releaseCraftedSession(craftedThreadId);
      } else if (accountBinding) {
        this.releaseCraftedBinding(accountBinding);
      }
      if (error instanceof CraftingError) {
        throw new Error(
          JSON.stringify(enrichCraftingError(error, payload.craftPlan, entityId, sessionId)),
          { cause: error },
        );
      }
      throw error;
    }
  }

  private createCraftingAdapter(
    craftPlan: CraftAgentPayload["craftPlan"],
    projectLocation: ProjectLocation,
    accountId?: string,
    accountMode?: "explicit" | "selected" | "auto",
  ): {
    adapter: import("@/shared/crafting").HarnessRuntimeAdapter;
    plan: CraftAgentPayload["craftPlan"];
    accountBinding?: AccountBinding;
  } {
    const plan = {
      ...craftPlan,
      workspace: projectLocation.kind === "wsl" ? projectLocation.linuxPath : projectLocation.path,
      runtimeBinding: {
        ...craftPlan.runtimeBinding,
        environment: {
          kind: projectLocation.kind,
          ...(projectLocation.kind === "wsl" ? { distro: projectLocation.distro } : {}),
        },
      },
    };

    let accountRoot: string | undefined;
    let accountEnv: Record<string, string> | undefined;
    let accountBinding: AccountBinding | undefined;
    const explicitRecord = accountId ? this.accountStore.getRecord(accountId) : undefined;
    const managedProvider =
      plan.runtimeBinding.harnessKind === "codex" &&
      explicitRecord?.provider === "openai-compatible"
        ? "openai-compatible"
        : plan.runtimeBinding.harnessKind === "codex"
          ? "codex"
          : plan.runtimeBinding.harnessKind === "grok"
            ? "grok"
            : undefined;
    if (managedProvider && (accountId || this.accountStore.list(managedProvider).length > 0)) {
      // v0.5: provider-pool scheduling drives auto selection; the legacy
      // selectedAccountId marker no longer routes auto sessions. Explicit
      // per-session overrides still never fall back.
      const resolution = this.accountResolver.resolve({
        provider: managedProvider,
        mode: accountMode ?? (accountId ? "explicit" : "auto"),
        ...(accountId ? { explicitAccountId: accountId } : {}),
      });
      accountBinding = {
        accountId: resolution.account.accountId,
        provider: resolution.account.provider,
        credentialScopeRef: resolution.account.credentialScopeRef,
        reason: resolution.reason,
        boundAt: Date.now(),
      };
      if (managedProvider === "openai-compatible") {
        const runtime = this.openAiCompatibleProfileService.prepareCodexRuntime(
          resolution.account.accountId,
        );
        accountRoot = runtime.codexHome;
        accountEnv = runtime.env;
      } else {
        accountRoot = this.accountStore.credentialRoot(resolution.account.accountId);
      }
    }

    const adapter = this._customCraftingAdapter
      ? this._customCraftingAdapter(plan, projectLocation)
      : plan.runtimeBinding.harnessKind === "codex"
        ? new NativeCodexRuntimeAdapter({
            ...(accountRoot
              ? {
                  host: new AppServerProcessHost({
                    codexHome: accountRoot,
                    ...(accountEnv ? { env: accountEnv } : {}),
                  }),
                }
              : {}),
            ...(accountBinding ? { accountBinding } : {}),
          })
        : createNativeHarnessRuntimeAdapter(plan.runtimeBinding.harnessKind, {
            projectLocation,
            ...(plan.runtimeBinding.profileRef
              ? { profileRef: plan.runtimeBinding.profileRef }
              : {}),
            ...(accountBinding ? { accountBinding } : {}),
            ...(accountRoot && plan.runtimeBinding.harnessKind === "grok"
              ? { baseSpawnEnv: managedGrokProcessEnvironment(accountRoot) }
              : {}),
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
    if (!this._customCraftingAdapter) {
      this.nativeHarnessAdapters.set(plan.runtimeBinding.harnessKind, adapter);
    }
    return { adapter, plan, ...(accountBinding ? { accountBinding } : {}) };
  }

  private registerCraftedSession(
    threadId: string | undefined,
    harnessKind: string,
    session: CraftSession,
    binding: AccountBinding | undefined,
  ): void {
    if (!threadId) return;
    const previousUnsubscribe = this.craftedSessionUnsubscribers.get(threadId);
    previousUnsubscribe?.();
    this.craftedSessionsByThread.set(threadId, session);
    this.nativeHarnessSessions.set(harnessKind, session);
    if (binding) this.craftedSessionBindings.set(threadId, binding);
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "session.exited") this.releaseCraftedSession(threadId);
    });
    this.craftedSessionUnsubscribers.set(threadId, unsubscribe);
  }

  private releaseCraftedBinding(binding: AccountBinding): void {
    for (const [threadId, candidate] of this.craftedSessionBindings) {
      if (candidate === binding) this.craftedSessionBindings.delete(threadId);
    }
  }

  private releaseCraftedSession(threadId: string): void {
    this.craftedSessionUnsubscribers.get(threadId)?.();
    this.craftedSessionUnsubscribers.delete(threadId);
    const session = this.craftedSessionsByThread.get(threadId);
    this.craftedSessionsByThread.delete(threadId);
    for (const [harnessKind, candidate] of this.nativeHarnessSessions) {
      if (candidate === session) this.nativeHarnessSessions.delete(harnessKind);
    }
    this.craftedSessionBindings.delete(threadId);
  }

  /**
   * A Grok ACP prompt can reject with a generic -32603 while carrying the
   * provider's actionable quota signal in `data.message`. Keep the account
   * pool's state tied to the session's immutable binding; never mark the
   * selected account or another account just because the UI selection changed.
   */
  private handleGrokNativePromptError(accountId: string, error: unknown): void {
    if (!isAcpPromptQuotaExhaustedError(error)) return;
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

  async getCrossagentSpawnableAgents(contextTags: readonly string[] = []) {
    const { windows } = await this.agentStatusService.getAgentStatuses({ wslDistros: [] });
    const settings: CrossagentVisibilitySettings = this.sharedSettingsCache.read();
    return buildSpawnableAgents(this.adapters, windows, settings, contextTags);
  }

  async getCrossagentRoutingSnapshot(): Promise<CrossagentRoutingState> {
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

  confirmCrossagentRoutingOverride(payload: ConfirmCrossagentRoutingOverridePayload): void {
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
   * The worktree roots Poracode considers "managed" for prune: the built-in
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
        this.releaseCraftedSession(threadId);
      }),
    );
    await this.threadSessionManager.dispose();
    this.crossagentMcpIngress.dispose();
    this.sharedSettingsCache.dispose();
    await this.cliHookPluginCoordinator.dispose().catch((error) => {
      console.warn("[supervisor] CLI hook plugin coordinator dispose failed:", error);
    });
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
