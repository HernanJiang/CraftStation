import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn } from "node-pty";
import {
  applyHomeScopePermissions,
  type UnrestrictedPermissionCapabilities,
} from "@/shared/agents/unrestrictedPermissions";
import {
  type AgentKind,
  type CloseThreadPayload,
  type ProjectLocation,
  type PromptSegment,
  type SessionRef,
  type StartThreadPayload,
  type StartThreadResult,
  type TerminalSize,
  type ThreadAttention,
  type ThreadConfig,
  type ThreadPresentationMode,
  type ThreadStatus,
  type BuiltInMcpServerId,
  type McpLaunchSnapshot,
  type ResolvedMcpServer,
  BUILT_IN_MCP_SERVER_NAMES,
  DEFAULT_MCP_SERVER_TIMEOUT_MS,
  isMcpServerSupportedByRuntime,
  resolveComposerMcpScope,
  resolveEnabledMcpServers,
  supportsMcpAtProjectLocation,
  baseAgentKind,
  AccountControlError,
} from "@/shared/contracts";
import type { McpThreadIdentity } from "@/shared/browserMcpThread";
import { resolveAgentPresentationMode } from "@/shared/agentStatus";
import type { AgentNativePlugin } from "@/supervisor/agents/base";
import {
  resolveBrowserMcpHttpConfigForLaunch,
  type BrowserMcpHttpConfig,
} from "@/supervisor/agents/browserMcp";
import {
  resolveCrossagentMcpHttpConfigForLaunch,
  type CrossagentMcpHttpConfig,
} from "@/supervisor/agents/crossagentMcp";
import {
  resolveCrossagentsPeerMcpHttpConfigForLaunch,
  type CrossagentsPeerMcpHttpConfig,
} from "@/supervisor/agents/crossagentsPeerMcp";
import {
  resolveComputerUseMcpHttpConfigForLaunch,
  type ComputerUseMcpHttpConfig,
} from "@/supervisor/agents/computerUseMcp";
import {
  resolveChromeMcpHttpConfigForLaunch,
  type ChromeMcpHttpConfig,
} from "@/supervisor/agents/chromeMcp";
import {
  resolveAppControlsMcpHttpConfigForLaunch,
  type AppControlsMcpHttpConfig,
} from "@/supervisor/agents/appControlsMcp";
import {
  type AgentAdapter,
  type AgentLaunchOptions,
  type CommandSpec,
  type StructuredSessionHandle,
  createKnownSessionRef,
  defaultFormatPromptSegments,
  injectWslEnv,
  primeProjectShellEnv,
  resolveLaunchSpec,
  mergeSpawnEnv,
} from "../../agents/base";
import { captureSupervisorException } from "../../diagnostics/sentry";
import { wrapHeaderBearingHttpMcpAsStdio } from "../../mcp/McpToolFilterService";
import { ensureThreadWorkspace } from "../threadWorkspace";
import { resolveThreadWorkspace } from "@/shared/homeScope";
import { ensureNodePtySpawnHelperExecutable } from "../../nodePty";
import type { QueuedStructuredTurn, SessionRuntime } from "../sessionTypes";
import type { ThreadOutputPipeline } from "../threadOutputPipeline";
import { rewriteSegmentsForWsl } from "../threadAttachments";
import {
  composeInlineTurnInstructions,
  readChatLanguageDirective,
  readCustomGlobalPrompt,
} from "../chatLanguage";
import {
  OPENCODE_GO_RESPONSES_BASE_URL,
  applyMuseForeignLaunchArgs,
  buildMuseForeignChildEnv,
  museForeignProviderFromModel,
  readOpenCodeGoApiKey,
} from "../../agents/muse/foreignEndpoint";
import { applyLaunchArgsConfigRewrite, mergeCliHookExtraArgs } from "./cliHookArgs";
import type { CliHookSessionCoordinator } from "./cliHookPlugin";
import { shouldPrimeNativeProjectShellEnv } from "./helpers";
import type { ThreadSessionManagerOptions } from "./managerOptions";
import type { PtyLifecycle } from "./ptyLifecycle";
import type { RuntimeEventRouter } from "./runtimeEventRouter";
import {
  StructuredRuntimeDiagnosticError,
  structuredRuntimeFeatureArea,
} from "./structuredRuntimeDiagnosticError";
import { describeSpawnFailure, sanitizeEnv, sanitizedProcessEnv } from "./spawnDiagnostics";
import type { SessionRuntimeLifecycle } from "./sessionRuntimeLifecycle";
import { getIterm2StatusL2TerminalEnv, resolveTerminalColorEnv } from "./terminalEnv";

export interface SpawnThreadInput {
  threadId: string;
  agentKind: AgentKind;
  adapter: AgentAdapter;
  projectLocation: ProjectLocation;
  config: ThreadConfig;
  initialSize: TerminalSize;
  launchPrompt: string;
  command?: CommandSpec;
  /**
   * Extra env injected into the agent PTY (merged on top of agentEnv +
   * provider spawnEnv). Currently used by the CLI hook ingress to ferry
   * `CRAFTSTATION_HOOK_URL` / `CRAFTSTATION_HOOK_SECRET` / `CRAFTSTATION_THREAD_ID` etc.
   */
  extraEnv?: Record<string, string>;
  structuredSession?: StructuredSessionHandle;
  sessionRef?: SessionRef;
  pendingLaunchPrompt?: string;
  /**
   * Fallback `/goal` block for the queued launch turn only. Prepended to the
   * SENT launch prompt (never painted — the optimistic paint already used the
   * raw prompt). Terminal launches instead fold it visibly into
   * `pendingTerminalPrompt` at the call site.
   */
  pendingLaunchGoalContext?: string;
  pendingTerminalPreInputs?: string[][];
  pendingTerminalPrompt?: string;
  pendingTerminalSegments?: PromptSegment[];
  presentationMode?: ThreadPresentationMode;
  initialStatus?: ThreadStatus;
  initialAttention?: ThreadAttention;
  suppressInitialStructuredIdle?: boolean;
  mcpLaunchSnapshot: McpLaunchSnapshot;
  launchConfig?: ThreadConfig;
  nativePlugins?: readonly AgentNativePlugin[];
  /**
   * Pool account the spawn environment was bound to (set when the provider
   * has a managed account pool). Lets same-turn pool failover tell whether a
   * re-resolution actually moved to a fresh account. Absent for ambient
   * sessions — never treat those as pool-switchable.
   */
  poolAccountId?: string;
  poolProvider?: string;
}

/**
 * Reconcile a persisted thread surface with the adapter's current contract.
 * This is intentionally capability-driven: when an adapter removes terminal
 * presentation after gaining a native structured runtime, old threads must
 * not keep reopening the retired TUI. Providers that still advertise both
 * surfaces preserve the user's explicit choice.
 */
export function resolveSupportedPresentationMode(
  adapter: {
    capabilities: {
      presentationMode?: ThreadPresentationMode;
      presentationModes?: readonly ThreadPresentationMode[] | undefined;
    };
  },
  requested: ThreadPresentationMode | undefined,
): ThreadPresentationMode {
  return resolveAgentPresentationMode(adapter.capabilities, requested);
}

/**
 * Per-launch config with plugin-bundled built-in MCPs enabled and globally
 * hard-disabled servers cleared. Together with the `resolve*ForLaunch` gates,
 * this keeps both policies at one provider boundary. The original per-thread
 * config stays on `SessionRuntime`; plugin contributions stay in its launch
 * snapshot for restart and recovery.
 */
export function effectiveLaunchConfig(
  config: ThreadConfig,
  disabledBuiltInMcpServerIds: readonly BuiltInMcpServerId[],
  pluginBuiltInMcpServerIds: readonly BuiltInMcpServerId[] = [],
): ThreadConfig {
  if (disabledBuiltInMcpServerIds.length === 0 && pluginBuiltInMcpServerIds.length === 0) {
    return config;
  }
  const next = { ...config };
  if (pluginBuiltInMcpServerIds.includes("browser")) next.browserMcp = true;
  // Legacy "crossagents" plugin/disabled entries predate the split: they
  // always meant the ephemeral channel. The peer channel has its own id.
  if (pluginBuiltInMcpServerIds.includes("own-subagents")) next.crossagentMcp = true;
  if (pluginBuiltInMcpServerIds.includes("crossagents")) next.crossagentMcp = true;
  if (pluginBuiltInMcpServerIds.includes("computer-use")) next.computerUse = true;
  if (pluginBuiltInMcpServerIds.includes("chrome")) next.chromeMcp = true;
  if (disabledBuiltInMcpServerIds.includes("browser")) next.browserMcp = false;
  if (disabledBuiltInMcpServerIds.includes("own-subagents")) next.crossagentMcp = false;
  if (disabledBuiltInMcpServerIds.includes("crossagents")) {
    // Legacy id: an explicit hard-disable keeps BOTH new servers off,
    // mirroring the settings migration (explicit opt-out wins over defaults).
    next.crossagentMcp = false;
    next.crossagentsMcp = false;
  }
  if (disabledBuiltInMcpServerIds.includes("computer-use")) next.computerUse = false;
  if (disabledBuiltInMcpServerIds.includes("chrome")) next.chromeMcp = false;
  return next;
}

/**
 * Launch config for a workspace: MCP flag gating plus Home-scope unrestricted
 * approval/sandbox so every agent (not just ACP) can read and write anywhere
 * when the session is the projectless Home folder.
 */
export function workspaceLaunchConfig(
  location: ProjectLocation,
  config: ThreadConfig,
  adapter: { capabilities: UnrestrictedPermissionCapabilities },
  disabledBuiltInMcpServerIds: readonly BuiltInMcpServerId[],
  pluginBuiltInMcpServerIds: readonly BuiltInMcpServerId[] = [],
): ThreadConfig {
  return applyHomeScopePermissions(
    location,
    effectiveLaunchConfig(config, disabledBuiltInMcpServerIds, pluginBuiltInMcpServerIds),
    adapter.capabilities,
  );
}

/**
 * Launch config for providers that declare `mcpConfigSource: "agentSettings"`:
 * the built-in MCP flags come from the provider's saved settings
 * (`sharedSettings.agentSettings[kind]`) instead of the per-thread composer
 * flags. Crossagents remains off unless the provider explicitly supports
 * trusted routing. Pooled GUI runtimes use one provider-session credential;
 * terminal runtimes use their existing per-thread credential.
 */
export function applyAgentSettingsMcpFlags(
  config: ThreadConfig,
  agentSettings: Record<string, boolean | string>,
  disabledBuiltInMcpServerIds: readonly BuiltInMcpServerId[],
  crossagentRoutingAvailable: boolean,
): ThreadConfig {
  return effectiveLaunchConfig(
    {
      ...config,
      browserMcp: agentSettings.browserMcp === true,
      chromeMcp: agentSettings.chromeMcp === true,
      computerUse: agentSettings.computerUse === true,
      crossagentMcp: crossagentRoutingAvailable && agentSettings.crossagentMcp === true,
    },
    disabledBuiltInMcpServerIds,
  );
}

export function usesProviderSessionCrossagentRouting(
  adapter:
    | {
        capabilities: {
          presentationMode: ThreadPresentationMode;
          crossagentMcpRouting?: AgentAdapter["capabilities"]["crossagentMcpRouting"];
        };
      }
    | undefined,
  presentationMode: ThreadPresentationMode | undefined,
  crossagentThreadId: string | undefined,
): boolean {
  return (
    adapter?.capabilities.crossagentMcpRouting === "provider-session" &&
    (presentationMode ?? adapter.capabilities.presentationMode) !== "terminal" &&
    crossagentThreadId !== undefined
  );
}

export function composeResolvedMcpServers(
  snapshot: McpLaunchSnapshot,
  browserMcp: BrowserMcpHttpConfig | undefined,
  ownSubagentsMcp: CrossagentMcpHttpConfig | undefined,
  computerUseMcp: ComputerUseMcpHttpConfig | undefined,
  chromeMcp: ChromeMcpHttpConfig | undefined,
  appControlsMcp: AppControlsMcpHttpConfig | undefined,
  crossagentsPeerMcp?: CrossagentsPeerMcpHttpConfig | undefined,
): ResolvedMcpServer[] {
  const http = (
    id: BuiltInMcpServerId,
    config:
      | {
          url: string;
          headers: Record<string, string>;
          disabledTools?: readonly string[];
        }
      | undefined,
    timeoutMs = DEFAULT_MCP_SERVER_TIMEOUT_MS,
    approvalMode?: "approve",
  ): ResolvedMcpServer | undefined =>
    config
      ? {
          id,
          name: BUILT_IN_MCP_SERVER_NAMES[id],
          timeoutMs,
          transport: { type: "http", url: config.url, headers: config.headers },
          ...(config.disabledTools && config.disabledTools.length > 0
            ? { disabledTools: [...config.disabledTools] }
            : {}),
          ...(approvalMode ? { approvalMode } : {}),
        }
      : undefined;
  return [
    ...snapshot.mcpServers,
    http("browser", browserMcp),
    http("own-subagents", ownSubagentsMcp, 300_000, "approve"),
    http("computer-use", computerUseMcp),
    http("chrome", chromeMcp),
    http("app-controls", appControlsMcp),
    http("crossagents", crossagentsPeerMcp, 120_000, "approve"),
  ].filter((server): server is ResolvedMcpServer => server !== undefined);
}

/**
 * Everything the spawn pipeline borrows from the manager. The pipeline owns
 * process creation (structured-session bring-up, argv assembly, PTY spawn,
 * runtime construction); the injected lifecycle owns registration and event
 * bindings, while the manager keeps terminal I/O, teardown, and ref recovery.
 */
export interface SpawnPipelineContext {
  options: ThreadSessionManagerOptions;
  sessions: Map<string, SessionRuntime>;
  pendingStartInterrupts: Set<string>;
  pendingStartAborts: Set<string>;
  ptyLifecycle: PtyLifecycle;
  outputPipeline: ThreadOutputPipeline;
  runtimeEventRouter: RuntimeEventRouter;
  sessionRuntimeLifecycle: Pick<SessionRuntimeLifecycle, "attach">;
  cliHookPlugin: CliHookSessionCoordinator;
  closeThread(payload: CloseThreadPayload): Promise<void>;
  failStructuredSession(session: SessionRuntime, error: unknown): void;
  failThreadLaunch(threadId: string, error: unknown): void;
  /**
   * Same-turn pool failover (see StructuredTurnQueueContext.tryPoolFailover).
   * Restart replay failures chain through it so one turn walks the pool until
   * an account answers or the chain budget is spent.
   */
  tryPoolFailover?(
    session: SessionRuntime,
    turn: QueuedStructuredTurn,
    error: unknown,
  ): Promise<boolean>;
  isCurrentSession(session: SessionRuntime): boolean;
  resolveAgentSettings(adapter: AgentAdapter): Record<string, boolean | string>;
  emitOptimisticUserMessage(
    threadId: string,
    prompt: string,
    segments?: PromptSegment[],
    requestedItemId?: string,
    requestedTurnId?: string,
  ): string;
}

/**
 * Spawn orchestration for agent threads: initial launches, restarts of
 * inactive-but-resumable threads, and the shared `spawnThread` runtime-session
 * assembly they (and invalid-session-ref recovery) all funnel through.
 * Extracted from `ThreadSessionManager`.
 */

/**
 * True when resuming a known session ref failed because the ref is stale —
 * the CLI lost the session, or it lives under a different account home than
 * the one just resolved (pool rotation, re-login). Anything else (auth,
 * network, model errors) must still fail honestly instead of silently
 * forking a fresh session.
 */
export function isStaleSessionRefError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /can't be resumed|not\s+found|no such |\bunknown session\b|invalid (conversation|session)|does not exist|no.?rollout/i.test(
    message,
  );
}

/**
 * Open a structured thread with the known ref, falling back to a fresh
 * session when the ref is stale. Returns the opened provider id (undefined
 * when the handle reports none) and whether it is fresh. Non-stale failures
 * rethrow untouched.
 */
export async function openStructuredThreadWithRefFallback(
  handle: StructuredSessionHandle,
  launchConfig: ThreadConfig,
  sessionRef: SessionRef | undefined,
  threadId: string,
): Promise<{ threadId: string | undefined; fresh: boolean }> {
  if (!sessionRef) {
    return { threadId: await handle.openThread?.(launchConfig, undefined), fresh: true };
  }
  try {
    return { threadId: await handle.openThread?.(launchConfig, sessionRef), fresh: false };
  } catch (error) {
    if (!isStaleSessionRefError(error)) throw error;
    console.warn(
      `[account] stale session ref ${sessionRef.providerSessionId}, opening a fresh session instead (thread=${threadId}).`,
    );
    return { threadId: await handle.openThread?.(launchConfig, undefined), fresh: true };
  }
}

export class SpawnPipeline {
  constructor(private readonly ctx: SpawnPipelineContext) {}

  async startThreadInner(
    payload: StartThreadPayload & { threadId: string },
  ): Promise<StartThreadResult> {
    const ctx = this.ctx;
    await ctx.closeThread({ threadId: payload.threadId });
    if (ctx.pendingStartAborts.delete(payload.threadId)) {
      ctx.pendingStartInterrupts.delete(payload.threadId);
      return { threadId: payload.threadId };
    }

    ensureThreadWorkspace(
      payload.projectLocation,
      resolveThreadWorkspace(payload.projectLocation, payload.threadId),
    );
    const adapter = this.requireAdapter(payload.agentKind);
    const isServerControlled = adapter.capabilities.liveInputMode === "server";
    // Per-thread mode wins over the adapter default. Chat-mode threads route
    // input/output through the structured session even for adapters whose
    // `liveInputMode` is "terminal".
    const requestedPresentation = resolveSupportedPresentationMode(
      adapter,
      payload.presentationMode,
    );
    const usesTerminalPresentation = requestedPresentation === "terminal";
    const useStructuredFlow = isServerControlled || !usesTerminalPresentation;
    const pluginContributions = (await ctx.options.resolvePluginLaunchContributions?.(
      payload.projectLocation,
      payload.agentKind,
    )) ?? { mcpServers: [], builtInMcpServerIds: [], nativePlugins: [] };
    const nativePlugins = pluginContributions.nativePlugins;
    const wslSegments = payload.segments
      ? await rewriteSegmentsForWsl(payload.segments, payload.projectLocation, {
          preserveImageAttachments: useStructuredFlow,
          preservePdfAttachments:
            useStructuredFlow && adapter.capabilities.readsPdfAttachmentsFromHost === true,
        })
      : undefined;
    // Terminal skills fallback: skill segments the CLI can't resolve natively
    // become short path-hint text before the prompt is typed into the PTY.
    // Structured turns keep the raw segments (they use inline injection).
    const policySegments = wslSegments?.some((segment) => segment.kind === "skill")
      ? ((await ctx.options.filterPluginSkillSegments?.({
          agentKind: payload.agentKind,
          projectLocation: payload.projectLocation,
          presentationMode: requestedPresentation,
          nativePlugins,
          segments: wslSegments,
        })) ?? wslSegments)
      : wslSegments;
    const effectiveSegments =
      !useStructuredFlow && policySegments?.some((segment) => segment.kind === "skill")
        ? ((await ctx.options.rewriteTerminalSkillSegments?.({
            agentKind: payload.agentKind,
            projectLocation: payload.projectLocation,
            nativePlugins,
            segments: policySegments,
          })) ?? policySegments)
        : policySegments;
    const initialPrompt =
      effectiveSegments && effectiveSegments.length > 0
        ? (adapter.formatPromptSegments?.(effectiveSegments) ??
          defaultFormatPromptSegments(effectiveSegments))
        : payload.prompt.trim();
    // Portable-skills fallback for the initial structured turn: inline SKILL.md
    // instructions for invoked skills this provider can't load natively.
    const skillInstructions =
      useStructuredFlow && effectiveSegments?.some((segment) => segment.kind === "skill")
        ? await ctx.options.buildSkillTurnInjection?.({
            agentKind: payload.agentKind,
            projectLocation: payload.projectLocation,
            nativePlugins,
            segments: effectiveSegments,
          })
        : undefined;
    const inlineSkillInstructions = useStructuredFlow
      ? composeInlineTurnInstructions(
          readChatLanguageDirective(ctx.options.settingsPath),
          readCustomGlobalPrompt(ctx.options.settingsPath),
          skillInstructions,
        )
      : undefined;
    const shouldQueueInitialPrompt =
      !payload.sessionRef &&
      isServerControlled &&
      usesTerminalPresentation &&
      initialPrompt.length > 0 &&
      adapter.isReadyForInitialPrompt !== undefined;

    // Optimistic user_message: for GUI threads with a fresh prompt, surface
    // the user's typed text in the chat pane immediately — before the slow
    // structured-session work (process spawn + ACP handshake +
    // newSession/loadSession) runs. When the renderer has already painted an
    // optimistic message and shipped its id with the payload, we reuse that
    // id end-to-end so the chat pane never sees a duplicate.
    const optimisticTurnId =
      !usesTerminalPresentation && initialPrompt.length > 0 && !payload.sessionRef
        ? `turn-${randomUUID()}`
        : undefined;
    const optimisticUserMessageItemId = optimisticTurnId
      ? ctx.emitOptimisticUserMessage(
          payload.threadId,
          initialPrompt,
          effectiveSegments,
          payload.userMessageItemId,
          optimisticTurnId,
        )
      : undefined;
    const mcpLaunchSnapshotBase = {
      disabledBuiltInMcpServerIds: payload.disabledBuiltInMcpServerIds ?? [],
      disabledBuiltInMcpTools: payload.disabledBuiltInMcpTools ?? {},
      pluginBuiltInMcpServerIds: pluginContributions.builtInMcpServerIds,
    };
    const optimisticMcpLaunchSnapshot: McpLaunchSnapshot = {
      mcpServers: [],
      ...mcpLaunchSnapshotBase,
    };
    const optimisticLaunchConfig = this.resolveMcpLaunchConfig(
      workspaceLaunchConfig(
        payload.projectLocation,
        payload.config,
        adapter,
        optimisticMcpLaunchSnapshot.disabledBuiltInMcpServerIds,
        optimisticMcpLaunchSnapshot.pluginBuiltInMcpServerIds,
      ),
      optimisticMcpLaunchSnapshot,
      adapter,
      payload.threadId,
    );
    if (optimisticUserMessageItemId) {
      this.emitOptimisticWorkingState(
        payload.threadId,
        payload.config,
        optimisticLaunchConfig,
        requestedPresentation,
      );
    }

    // Prime the user's interactive-shell env (fnm / nvm / asdf / mise cd-hooks
    // applied at the project root) before any agent process — structured or
    // PTY — is spawned. Electron-from-Finder inherits launchd's skeleton PATH,
    // so without this the spawned CLI picks up homebrew node instead of the
    // project-pinned version. Memoized per cwd; the later prime before the PTY
    // launch is a no-op after this.
    if (shouldPrimeNativeProjectShellEnv(payload.projectLocation)) {
      await primeProjectShellEnv(payload.projectLocation.path);
    }
    await this.ctx.options.prepareSkillsForLaunch?.(payload.projectLocation, payload.agentKind);

    const mcpIdentity = {
      threadId: payload.threadId,
      title: initialPrompt.split("\n", 1)[0]?.trim() ?? "",
    };
    // Every provider translator keys its output record by `server.name`, so a
    // plugin server sharing a name with a user-configured one would silently
    // replace it — dropping the user's headers and tokens. The user's own
    // servers win; the colliding plugin server is skipped.
    const userMcpServers = payload.mcpServers ?? [];
    const userMcpServerNames = new Set(userMcpServers.map((server) => server.name));
    const pluginMcpServers = pluginContributions.mcpServers.filter(
      (server) => !userMcpServerNames.has(server.name),
    );
    let mcpServers = resolveEnabledMcpServers([...userMcpServers, ...pluginMcpServers]);
    if (this.ctx.options.applyMcpServerAuthorization) {
      mcpServers = await this.ctx.options.applyMcpServerAuthorization(mcpServers);
    }
    if (this.ctx.options.prepareMcpToolFilters) {
      mcpServers = await this.ctx.options.prepareMcpToolFilters(
        mcpServers,
        payload.projectLocation,
      );
    }
    const mcpLaunchSnapshot: McpLaunchSnapshot = {
      mcpServers,
      ...mcpLaunchSnapshotBase,
    };
    const launchConfig = this.resolveMcpLaunchConfig(
      workspaceLaunchConfig(
        payload.projectLocation,
        payload.config,
        adapter,
        mcpLaunchSnapshot.disabledBuiltInMcpServerIds,
        mcpLaunchSnapshot.pluginBuiltInMcpServerIds,
      ),
      mcpLaunchSnapshot,
      adapter,
      payload.threadId,
    );
    const resolvedMcpServers = await this.resolveMcpServersForLaunch({
      location: payload.projectLocation,
      config: launchConfig,
      mcpLaunchSnapshot,
      identity: mcpIdentity,
      crossagentThreadId: payload.threadId,
      adapter,
      presentationMode: requestedPresentation,
    });
    const { handle: structuredSession, poolAccount: initialPoolAccount } =
      await this.createStructuredSession(
        adapter,
        payload.threadId,
        payload.agentKind,
        payload.projectLocation,
        launchConfig,
        resolvedMcpServers,
        mcpIdentity,
        payload.sessionRef,
        requestedPresentation,
        // Launch-time explicit third-party binding (pool bypass). Undefined =
        // legacy pool/ambient path, unchanged.
        payload.thirdPartyAccountId
          ? { thirdPartyAccountId: payload.thirdPartyAccountId }
          : undefined,
      );
    if (await this.abortPendingStart(payload.threadId, structuredSession)) {
      return { threadId: payload.threadId };
    }

    if (structuredSession?.activate) {
      try {
        await structuredSession.activate();
      } catch (error) {
        await structuredSession.dispose();
        if (ctx.pendingStartInterrupts.delete(payload.threadId)) {
          return { threadId: payload.threadId };
        }
        ctx.failThreadLaunch(payload.threadId, error);
        throw error;
      }
    }
    if (await this.abortPendingStart(payload.threadId, structuredSession)) {
      return { threadId: payload.threadId };
    }

    let openedStructuredThreadId: string | undefined;
    if (structuredSession?.openThread) {
      try {
        // A stale ref (rotated pool account, CLI-side loss) falls back to a
        // fresh session inside the helper instead of bricking the reopen.
        openedStructuredThreadId = (
          await openStructuredThreadWithRefFallback(
            structuredSession,
            launchConfig,
            payload.sessionRef,
            payload.threadId,
          )
        ).threadId;
      } catch (error) {
        await structuredSession.dispose();
        if (ctx.pendingStartInterrupts.delete(payload.threadId)) {
          return { threadId: payload.threadId };
        }
        ctx.failThreadLaunch(payload.threadId, error);
        throw error;
      }
    }
    if (await this.abortPendingStart(payload.threadId, structuredSession)) {
      return { threadId: payload.threadId };
    }

    if (!usesTerminalPresentation) {
      if (!structuredSession) {
        throw new Error(
          `Agent ${payload.agentKind} does not support ${requestedPresentation} presentation.`,
        );
      }
      const resolvedSessionRef =
        payload.sessionRef ??
        (openedStructuredThreadId ? createKnownSessionRef(openedStructuredThreadId) : undefined);
      const startInterrupted = ctx.pendingStartInterrupts.delete(payload.threadId);
      const session = this.spawnThread({
        threadId: payload.threadId,
        adapter,
        agentKind: payload.agentKind,
        projectLocation: payload.projectLocation,
        config: payload.config,
        initialSize: payload.initialSize,
        launchPrompt: "",
        structuredSession,
        ...(resolvedSessionRef ? { sessionRef: resolvedSessionRef } : {}),
        presentationMode: requestedPresentation,
        ...(initialPoolAccount
          ? {
              poolAccountId: initialPoolAccount.accountId,
              poolProvider: initialPoolAccount.provider,
            }
          : {}),
        initialStatus: optimisticUserMessageItemId && !startInterrupted ? "working" : "idle",
        initialAttention: optimisticUserMessageItemId && !startInterrupted ? "working" : "none",
        suppressInitialStructuredIdle:
          optimisticUserMessageItemId !== undefined && !startInterrupted,
        mcpLaunchSnapshot,
        launchConfig,
        nativePlugins,
      });
      if (
        !startInterrupted &&
        !payload.sessionRef &&
        initialPrompt.length > 0 &&
        structuredSession.startTurn
      ) {
        const startOptions = {
          ...(payload.agentKind === "opencode" && optimisticTurnId
            ? { turnId: optimisticTurnId }
            : {}),
          ...(optimisticUserMessageItemId
            ? { userMessageItemId: optimisticUserMessageItemId }
            : {}),
          ...(inlineSkillInstructions ? { inlineInstructions: inlineSkillInstructions } : {}),
        };
        void structuredSession
          .startTurn(
            initialPrompt,
            launchConfig,
            effectiveSegments,
            Object.keys(startOptions).length > 0 ? startOptions : undefined,
          )
          .catch((error) => {
            if (ctx.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
              return;
            }
            ctx.failStructuredSession(session, error);
          });
      }
      return { threadId: payload.threadId };
    }

    if (
      !payload.sessionRef &&
      useStructuredFlow &&
      initialPrompt.length > 0 &&
      !shouldQueueInitialPrompt &&
      structuredSession?.startTurn
    ) {
      void structuredSession
        .startTurn(
          initialPrompt,
          launchConfig,
          effectiveSegments,
          inlineSkillInstructions ? { inlineInstructions: inlineSkillInstructions } : undefined,
        )
        .catch((error) => {
          console.error("[supervisor] initial turn failed:", error);
          const activeSession = ctx.sessions.get(payload.threadId);
          if (!activeSession) {
            return;
          }
          ctx.failStructuredSession(activeSession, error);
        });
    }

    if (shouldQueueInitialPrompt) {
      await structuredSession?.ensureResumeArtifacts?.();
    }

    const deferToTerminal = adapter.shouldDeferPromptToTerminal?.(payload.config) ?? false;
    // Use `initialPrompt` (the adapter-formatted version with `~/` shortening
    // and WSL path rewriting) so attachments hand off cleanly as the launch
    // arg instead of being staged for a deferred PTY-write.
    const launchPrompt = useStructuredFlow || deferToTerminal ? "" : initialPrompt;
    const launchOptionsWithMcp = this.composeLaunchOptions(
      adapter,
      structuredSession?.launchOptions,
      resolvedMcpServers,
    );
    const argv = payload.sessionRef
      ? adapter.buildResumeArgv(
          payload.projectLocation,
          launchConfig,
          launchPrompt,
          payload.sessionRef,
          launchOptionsWithMcp,
        )
      : adapter.buildLaunchArgv(
          payload.projectLocation,
          launchConfig,
          launchPrompt,
          payload.sessionRef,
          launchOptionsWithMcp,
        );

    // Append CLI hook plugin args (e.g. Claude `--settings <path>`); env vars
    // (`CRAFTSTATION_HOOK_URL`, `CRAFTSTATION_HOOK_SECRET`, `CRAFTSTATION_THREAD_ID`,
    // `CRAFTSTATION_AGENT_KIND`, `CRAFTSTATION_HOOK_PROTOCOL_VERSION`) flow through
    // `spawnThread` → `agentEnv` so they end up in the PTY env on every
    // platform (WSL, win32, posix). Failure to resolve plugin extras silently
    // degrades to L2 — the supervisor must never block thread creation on
    // the hook-plugin plumbing.
    const cliHookExtras = await ctx.cliHookPlugin.resolveCliHookPluginExtras(
      payload.threadId,
      payload.agentKind,
      payload.projectLocation,
      resolvedMcpServers,
    );
    if (cliHookExtras.extraArgs.length > 0) {
      argv.args = mergeCliHookExtraArgs(
        adapter,
        argv.args,
        cliHookExtras.extraArgs,
        launchPrompt,
        payload.sessionRef,
      );
    }
    argv.args = await applyLaunchArgsConfigRewrite(
      adapter,
      argv.args,
      payload.config,
      payload.projectLocation,
    );
    const museForeignEnv = await this.resolveMuseForeignExtraEnv({
      agentKind: payload.agentKind,
      threadId: payload.threadId,
      model: payload.config.model,
      thirdPartyAccountId: payload.thirdPartyAccountId,
      projectLocation: payload.projectLocation,
    });
    argv.args = applyMuseForeignLaunchArgs(argv.args, museForeignEnv);
    if (shouldPrimeNativeProjectShellEnv(payload.projectLocation)) {
      await primeProjectShellEnv(payload.projectLocation.path);
    }
    const command = resolveLaunchSpec(payload.projectLocation, argv);

    const keepStructuredSession = structuredSession && useStructuredFlow;
    if (structuredSession && !keepStructuredSession) {
      await structuredSession.dispose();
    }
    if (ctx.pendingStartAborts.delete(payload.threadId)) {
      ctx.pendingStartInterrupts.delete(payload.threadId);
      if (structuredSession && keepStructuredSession) {
        await structuredSession.dispose();
      }
      command.cleanup?.();
      return { threadId: payload.threadId };
    }

    const resolvedSessionRef = payload.sessionRef ?? command.sessionRef;
    this.spawnThread({
      threadId: payload.threadId,
      adapter,
      agentKind: payload.agentKind,
      projectLocation: payload.projectLocation,
      config: payload.config,
      initialSize: payload.initialSize,
      launchPrompt,
      command,
      ...(this.mergeLaunchExtraEnv(museForeignEnv, cliHookExtras.env)
        ? { extraEnv: this.mergeLaunchExtraEnv(museForeignEnv, cliHookExtras.env)! }
        : {}),
      ...(keepStructuredSession ? { structuredSession } : {}),
      ...(resolvedSessionRef ? { sessionRef: resolvedSessionRef } : {}),
      mcpLaunchSnapshot,
      launchConfig,
      nativePlugins,
      ...(payload.thirdPartyAccountId
        ? { poolAccountId: payload.thirdPartyAccountId, poolProvider: "openai-compatible" }
        : {}),
      ...(shouldQueueInitialPrompt ? { pendingLaunchPrompt: initialPrompt } : {}),
      ...(payload.goalContext ? { pendingLaunchGoalContext: payload.goalContext } : {}),
      presentationMode: requestedPresentation,
      ...(deferToTerminal && !useStructuredFlow
        ? (() => {
            const preInputs = adapter.buildTerminalPreInputs?.(payload.config);
            // Terminal has no send/paint split: the goal block is folded
            // visibly into the launch message (honest — the user sees exactly
            // what the CLI receives). Later terminal turns do not re-assert.
            const terminalPrompt =
              payload.goalContext && initialPrompt.length > 0
                ? `${payload.goalContext}\n\n${initialPrompt}`
                : (payload.goalContext ?? initialPrompt);
            return {
              ...(preInputs ? { pendingTerminalPreInputs: preInputs } : {}),
              pendingTerminalPrompt: terminalPrompt,
              ...(effectiveSegments ? { pendingTerminalSegments: effectiveSegments } : {}),
            };
          })()
        : {}),
    });

    return { threadId: payload.threadId };
  }

  async restartThread(session: SessionRuntime, turn: QueuedStructuredTurn): Promise<void> {
    const ctx = this.ctx;
    const { prompt, config } = turn;
    if (!session.sessionRef) {
      throw new Error("Session cannot be restarted without a known session reference.");
    }
    const mcpLaunchSnapshot = session.mcpLaunchSnapshot;

    const isServerControlled = session.adapter.capabilities.liveInputMode === "server";
    const usesTerminalPresentation =
      (session.presentationMode ?? session.adapter.capabilities.presentationMode) === "terminal";
    const useStructuredFlow = isServerControlled || !usesTerminalPresentation;
    session.ignoreExit = true;
    ctx.outputPipeline.clearSessionTimers(session);
    // Subagent maps from the prior session would otherwise leak across resume:
    // any unsubscribed buffers, lingering child→parent entries, and overlay
    // subscriptions from the dead session are stale once the structured
    // session is replaced. `closeThread` already does this on full teardown.
    ctx.runtimeEventRouter.clearAllForThread(session.threadId);
    await session.structuredSession?.dispose();
    if (session.structuredSession) {
      await sleep(150);
    }
    ctx.ptyLifecycle.kill(session);
    if (!ctx.isCurrentSession(session)) {
      return;
    }

    // Prime the user's interactive-shell env before respawning. See the same
    // call in `startThreadInner` — must run before the structured-session
    // spawn so the child inherits the project-pinned PATH, not launchd's.
    if (shouldPrimeNativeProjectShellEnv(session.projectLocation)) {
      await primeProjectShellEnv(session.projectLocation.path);
    }
    await this.ctx.options.prepareSkillsForLaunch?.(session.projectLocation, session.agentKind);
    if (!ctx.isCurrentSession(session)) {
      return;
    }

    const mcpIdentity = { threadId: session.threadId };
    const launchConfig = this.resolveMcpLaunchConfig(
      workspaceLaunchConfig(
        session.projectLocation,
        config,
        session.adapter,
        mcpLaunchSnapshot.disabledBuiltInMcpServerIds,
        mcpLaunchSnapshot.pluginBuiltInMcpServerIds,
      ),
      mcpLaunchSnapshot,
      session.adapter,
      session.threadId,
    );
    const resolvedMcpServers = await this.resolveMcpServersForLaunch({
      location: session.projectLocation,
      config: launchConfig,
      mcpLaunchSnapshot,
      identity: mcpIdentity,
      crossagentThreadId: session.threadId,
      adapter: session.adapter,
      ...(session.presentationMode ? { presentationMode: session.presentationMode } : {}),
    });
    const { handle: structuredSession, poolAccount: restartPoolAccount } =
      await this.createStructuredSession(
        session.adapter,
        session.threadId,
        session.agentKind,
        session.projectLocation,
        launchConfig,
        resolvedMcpServers,
        mcpIdentity,
        session.sessionRef,
        session.presentationMode,
        // Sticky credential source: a session bound to a third-party account
        // re-enters the pool bypass on restart instead of the subscription pool.
        session.poolProvider === "openai-compatible" && session.poolAccountId
          ? { thirdPartyAccountId: session.poolAccountId }
          : undefined,
        // Same-turn failover's tried set: never re-resolve onto an account
        // that already died this turn, even if its quota write-back hasn't
        // landed (or failed to land) yet.
        turn.poolTriedAccountIds,
      );
    if (!ctx.isCurrentSession(session)) {
      await structuredSession?.dispose();
      return;
    }

    if (structuredSession?.activate) {
      try {
        await structuredSession.activate();
      } catch (error) {
        await structuredSession.dispose();
        throw error;
      }
    }
    if (!ctx.isCurrentSession(session)) {
      await structuredSession?.dispose();
      return;
    }

    let freshSessionRef: SessionRef | undefined;
    if (structuredSession?.openThread) {
      try {
        // Failover turns start a FRESH session on the new account; so does
        // any restart whose re-resolution landed on a different account than
        // the dead binding (the old ref belongs to the previous account's
        // credential home and can never resume cross-account). Capture the
        // fresh id the new session reports so later restarts/resumes keep
        // working; when the handle reports none, keep the old ref as a best
        // effort (Antigravity's invalid-session recovery covers staleness).
        // A stale ref under the SAME account (CLI lost the session) falls
        // back to fresh inside the helper instead of bricking the thread.
        const switchedAccount =
          !!restartPoolAccount &&
          !!session.poolAccountId &&
          restartPoolAccount.accountId !== session.poolAccountId;
        const failoverFresh = turn.poolFailoverAttempt !== undefined || switchedAccount;
        const opened = await openStructuredThreadWithRefFallback(
          structuredSession,
          launchConfig,
          failoverFresh ? undefined : session.sessionRef,
          session.threadId,
        );
        if (!opened.fresh) {
          // Resumed natively: a carried preface would duplicate the history
          // the resumed session already owns.
          delete turn.historyPreface;
        } else if (typeof opened.threadId === "string" && opened.threadId.length > 0) {
          freshSessionRef = createKnownSessionRef(opened.threadId);
        } else {
          freshSessionRef = session.sessionRef;
        }
      } catch (error) {
        await structuredSession.dispose();
        throw error;
      }
    }
    if (!ctx.isCurrentSession(session)) {
      await structuredSession?.dispose();
      return;
    }

    if (!usesTerminalPresentation) {
      if (!structuredSession) {
        throw new Error(`Thread ${session.threadId} cannot restart without a structured session.`);
      }
      const restarted = this.spawnThread({
        threadId: session.threadId,
        agentKind: session.agentKind,
        adapter: session.adapter,
        projectLocation: session.projectLocation,
        config,
        initialSize: session.terminalSize,
        launchPrompt: "",
        structuredSession,
        sessionRef: freshSessionRef ?? session.sessionRef,
        mcpLaunchSnapshot,
        launchConfig,
        ...(restartPoolAccount
          ? {
              poolAccountId: restartPoolAccount.accountId,
              poolProvider: restartPoolAccount.provider,
            }
          : {}),
        ...(session.nativePlugins ? { nativePlugins: session.nativePlugins } : {}),
        ...(session.presentationMode ? { presentationMode: session.presentationMode } : {}),
      });
      if (prompt.trim().length > 0 && structuredSession.startTurn) {
        // Retry/recovery callers preserve the id of a user message that was
        // already broadcast before the old session stopped. Reuse it without
        // emitting another turn.started + item pair. A missing id means this
        // path owns the first canonical paint and must emit it now.
        const turnId = turn.turnId ?? `turn-${randomUUID()}`;
        const optimisticItemId =
          turn.userMessageItemId ??
          ctx.emitOptimisticUserMessage(session.threadId, prompt, turn.segments, undefined, turnId);
        const startOptions = {
          ...(session.agentKind === "opencode" ? { turnId } : {}),
          userMessageItemId: optimisticItemId,
          ...(turn.inlineInstructions ? { inlineInstructions: turn.inlineInstructions } : {}),
        };
        // Failover context carry-over goes to the MODEL only: the painted
        // user message above stays the raw prompt so the chat never shows
        // system preface text as if the user typed it.
        const sendPrompt = turn.historyPreface ? `${turn.historyPreface}\n\n${prompt}` : prompt;
        void structuredSession
          .startTurn(sendPrompt, launchConfig, turn.segments, startOptions)
          .catch(async (error) => {
            if (ctx.sessions.get(restarted.threadId)?.instanceId !== restarted.instanceId) {
              return;
            }
            if (await ctx.tryPoolFailover?.(restarted, turn, error)) return;
            ctx.failStructuredSession(restarted, error);
          });
      }
      return;
    }

    const launchPrompt = useStructuredFlow ? "" : prompt;
    const cliHookExtras = await ctx.cliHookPlugin.resolveCliHookPluginExtras(
      session.threadId,
      session.agentKind,
      session.projectLocation,
      resolvedMcpServers,
    );
    if (!ctx.isCurrentSession(session)) {
      await structuredSession?.dispose();
      return;
    }
    const argv = session.adapter.buildResumeArgv(
      session.projectLocation,
      launchConfig,
      launchPrompt,
      session.sessionRef,
      this.composeLaunchOptions(
        session.adapter,
        structuredSession?.launchOptions,
        resolvedMcpServers,
      ),
    );
    if (cliHookExtras.extraArgs.length > 0) {
      argv.args = mergeCliHookExtraArgs(
        session.adapter,
        argv.args,
        cliHookExtras.extraArgs,
        launchPrompt,
        session.sessionRef,
      );
    }
    argv.args = await applyLaunchArgsConfigRewrite(
      session.adapter,
      argv.args,
      config,
      session.projectLocation,
    );
    const museForeignEnv = await this.resolveMuseForeignExtraEnv({
      agentKind: session.agentKind,
      threadId: session.threadId,
      model: config.model,
      thirdPartyAccountId:
        session.poolProvider === "openai-compatible" ? session.poolAccountId : undefined,
      projectLocation: session.projectLocation,
    });
    argv.args = applyMuseForeignLaunchArgs(argv.args, museForeignEnv);
    if (shouldPrimeNativeProjectShellEnv(session.projectLocation)) {
      await primeProjectShellEnv(session.projectLocation.path);
    }
    if (!ctx.isCurrentSession(session)) {
      await structuredSession?.dispose();
      argv.cleanup?.();
      return;
    }
    const command = resolveLaunchSpec(session.projectLocation, argv);

    const keepStructuredSession = structuredSession && useStructuredFlow;
    if (structuredSession && !keepStructuredSession) {
      await structuredSession.dispose();
    }
    if (!ctx.isCurrentSession(session)) {
      if (structuredSession && keepStructuredSession) {
        await structuredSession.dispose();
      }
      command.cleanup?.();
      return;
    }

    this.spawnThread({
      threadId: session.threadId,
      agentKind: session.agentKind,
      adapter: session.adapter,
      projectLocation: session.projectLocation,
      config,
      initialSize: session.terminalSize,
      launchPrompt,
      command,
      ...(this.mergeLaunchExtraEnv(museForeignEnv, cliHookExtras.env)
        ? { extraEnv: this.mergeLaunchExtraEnv(museForeignEnv, cliHookExtras.env)! }
        : {}),
      ...(keepStructuredSession ? { structuredSession } : {}),
      sessionRef: session.sessionRef,
      mcpLaunchSnapshot,
      launchConfig,
      ...(session.nativePlugins ? { nativePlugins: session.nativePlugins } : {}),
      ...(session.presentationMode ? { presentationMode: session.presentationMode } : {}),
    });
  }

  /**
   * Switch a live logical thread to another harness/model without creating a
   * new user-visible thread. GUI structured threads only: prepares the new
   * provider runtime first (activate then openThread), commits it onto the
   * same threadId, then disposes the old session. The old sessionRef never
   * crosses providers. Failure rolls back to the original runtime. No prompt
   * is sent; the caller stashes the transcript preface for the next user turn.
   * Terminal threads throw an honest error (no cross-harness PTY resume).
   */
  async switchThreadProvider(
    session: SessionRuntime,
    agentKind: AgentKind,
    adapter: AgentAdapter,
    config: ThreadConfig,
    opts?: { thirdPartyAccountId?: string | undefined },
  ): Promise<{
    poolAccount?: { accountId: string; provider: string };
    sessionRef?: SessionRef;
  }> {
    const ctx = this.ctx;
    const liveThirdParty =
      session.poolProvider === "openai-compatible" ? session.poolAccountId : undefined;
    const sameCredentialSource = (liveThirdParty ?? "") === (opts?.thirdPartyAccountId ?? "");
    if (agentKind === session.agentKind && sameCredentialSource) {
      throw new Error("Thread is already on the requested provider.");
    }
    const usesTerminalPresentation =
      (session.presentationMode ?? session.adapter.capabilities.presentationMode) === "terminal";
    if (usesTerminalPresentation) {
      throw new Error("终端线程暂不支持跨模型切换，请新建对话。");
    }
    if (!adapter.createStructuredSession) {
      throw new Error(`The ${agentKind} provider cannot host GUI chat sessions.`);
    }
    const mcpLaunchSnapshot = session.mcpLaunchSnapshot;
    if (!ctx.isCurrentSession(session)) {
      throw new Error("Thread session was replaced during the provider switch.");
    }
    if (shouldPrimeNativeProjectShellEnv(session.projectLocation)) {
      await primeProjectShellEnv(session.projectLocation.path);
    }
    await this.ctx.options.prepareSkillsForLaunch?.(session.projectLocation, agentKind);
    if (!ctx.isCurrentSession(session)) {
      throw new Error("Thread session was replaced during the provider switch.");
    }
    const mcpIdentity = { threadId: session.threadId };
    const launchConfig = this.resolveMcpLaunchConfig(
      workspaceLaunchConfig(
        session.projectLocation,
        config,
        adapter,
        mcpLaunchSnapshot.disabledBuiltInMcpServerIds,
        mcpLaunchSnapshot.pluginBuiltInMcpServerIds,
      ),
      mcpLaunchSnapshot,
      adapter,
      session.threadId,
    );
    const resolvedMcpServers = await this.resolveMcpServersForLaunch({
      location: session.projectLocation,
      config: launchConfig,
      mcpLaunchSnapshot,
      identity: mcpIdentity,
      crossagentThreadId: session.threadId,
      adapter,
      ...(session.presentationMode ? { presentationMode: session.presentationMode } : {}),
    });
    // Model switches onto a third-party custom model carry the validated
    // account binding; otherwise the rebuilt session falls back to the
    // native pool with an unresolvable custom model id.
    const switchLaunchContext =
      opts?.thirdPartyAccountId !== undefined
        ? { thirdPartyAccountId: opts.thirdPartyAccountId }
        : undefined;
    const { handle: structuredSession, poolAccount } = await this.createStructuredSession(
      adapter,
      session.threadId,
      agentKind,
      session.projectLocation,
      launchConfig,
      resolvedMcpServers,
      mcpIdentity,
      undefined,
      session.presentationMode,
      switchLaunchContext,
      undefined,
    );
    if (!structuredSession) {
      throw new Error(`Thread ${session.threadId} cannot switch without a structured session.`);
    }

    // Prepare the replacement first. The live session stays active until the
    // new runtime is ready so a failed switch can roll back instead of
    // poisoning the thread with a disposed handle.
    let committed = false;
    try {
      // SDK sessions (OpenCode, Cursor, …) require activate() before
      // openThread(); calling openThread first throws "is not active".
      if (structuredSession.activate) {
        await structuredSession.activate();
      }
      if (!ctx.isCurrentSession(session)) {
        throw new Error("Thread session was replaced during the provider switch.");
      }
      let freshSessionRef: SessionRef | undefined;
      if (structuredSession.openThread) {
        const freshThreadId = await structuredSession.openThread(launchConfig, undefined);
        if (typeof freshThreadId === "string" && freshThreadId.length > 0) {
          freshSessionRef = createKnownSessionRef(freshThreadId);
        }
      }
      if (!ctx.isCurrentSession(session)) {
        throw new Error("Thread session was replaced during the provider switch.");
      }

      session.ignoreExit = true;
      ctx.outputPipeline.clearSessionTimers(session);
      ctx.runtimeEventRouter.clearAllForThread(session.threadId);
      try {
        this.spawnThread({
          threadId: session.threadId,
          agentKind,
          adapter,
          projectLocation: session.projectLocation,
          config,
          initialSize: session.terminalSize,
          launchPrompt: "",
          structuredSession,
          ...(freshSessionRef ? { sessionRef: freshSessionRef } : {}),
          mcpLaunchSnapshot,
          launchConfig,
          ...(poolAccount
            ? { poolAccountId: poolAccount.accountId, poolProvider: poolAccount.provider }
            : {}),
          ...(session.nativePlugins ? { nativePlugins: session.nativePlugins } : {}),
          ...(session.presentationMode ? { presentationMode: session.presentationMode } : {}),
        });
      } catch (error) {
        session.ignoreExit = false;
        throw error;
      }
      committed = true;
      await session.structuredSession?.dispose().catch(() => undefined);
      ctx.ptyLifecycle.kill(session);
      return {
        ...(poolAccount ? { poolAccount } : {}),
        ...(freshSessionRef ? { sessionRef: freshSessionRef } : {}),
      };
    } catch (error) {
      if (!committed) {
        await structuredSession.dispose().catch(() => undefined);
      }
      throw error;
    }
  }

  spawnThread(input: SpawnThreadInput): SessionRuntime {
    const ctx = this.ctx;
    const mcpLaunchSnapshot =
      input.mcpLaunchSnapshot ?? ({ mcpServers: [], disabledBuiltInMcpServerIds: [] } as const);
    // `thread-reset` is only consumed by the terminal panel (renderer scrollback
    // reset) and the renderer-side runtime-event/server-request slice clear.
    // GUI threads have no terminal scrollback, and clearing the slice would
    // wipe the optimistic user_message we may have already painted ahead of
    // structured-session setup. Skip the reset for any GUI-presentation
    // thread (initial launch, resume, restart all run through here).
    const isGuiPresentation =
      input.presentationMode !== undefined && input.presentationMode !== "terminal";
    if (!isGuiPresentation) {
      ctx.options.emit({ type: "thread-reset", threadId: input.threadId });
    }

    const agentEnv = this.resolveAgentProcessEnv(input.adapter);
    const cliHookEnvInjected = Boolean(input.extraEnv?.CRAFTSTATION_HOOK_URL);
    // `baseSpawnEnv` underlies every lane; the location-specific `spawnEnv`
    // layers on top so a provider can still override per platform.
    const providerEnv = mergeSpawnEnv(
      input.adapter.baseSpawnEnv,
      input.projectLocation.kind === "wsl"
        ? input.adapter.spawnEnv?.wsl
        : input.adapter.spawnEnv?.native,
    );
    if (providerEnv) {
      Object.assign(agentEnv, providerEnv);
    }
    if (input.extraEnv) {
      Object.assign(agentEnv, input.extraEnv);
    }
    Object.assign(
      agentEnv,
      getIterm2StatusL2TerminalEnv({
        adapter: input.adapter,
        disableCliHookPlugin: ctx.options.readDisableCliHookPlugin(),
        cliHookEnvInjected,
      }),
    );
    const terminalEnv = resolveTerminalColorEnv(input.projectLocation);
    const terminalAgentEnv = { ...agentEnv, ...terminalEnv };
    const command = input.command
      ? injectWslEnv(input.command, input.projectLocation, terminalAgentEnv)
      : undefined;
    let pty;
    if (command) {
      ensureNodePtySpawnHelperExecutable();
      const ptyEnv = {
        ...sanitizedProcessEnv,
        ...(command.env ?? {}),
        ...agentEnv,
        ...terminalEnv,
      };
      try {
        pty = spawn(command.command, command.args, {
          name: process.platform === "win32" ? "xterm-color" : terminalEnv.TERM,
          cols: input.initialSize.cols,
          rows: input.initialSize.rows,
          cwd: command.cwd ?? process.cwd(),
          env: ptyEnv,
        });
      } catch (error) {
        try {
          command.cleanup?.();
        } catch {
          // Best-effort cleanup must not hide the spawn failure.
        }
        throw new Error(
          describeSpawnFailure(
            "agent",
            {
              command: command.command,
              args: command.args,
              ...(command.cwd ? { cwd: command.cwd } : {}),
            },
            sanitizeEnv(ptyEnv),
            error,
          ),
          { cause: error },
        );
      }
    }
    const session: SessionRuntime = {
      instanceId: randomUUID(),
      threadId: input.threadId,
      agentKind: input.agentKind,
      adapter: input.adapter,
      ...(pty ? { pty } : {}),
      ...(pty && command?.cleanup ? { launchCleanup: command.cleanup } : {}),
      projectLocation: input.projectLocation,
      config: input.config,
      mcpLaunchSnapshot,
      ...(input.nativePlugins ? { nativePlugins: input.nativePlugins } : {}),
      launchConfig:
        input.launchConfig ??
        workspaceLaunchConfig(
          input.projectLocation,
          input.config,
          input.adapter,
          mcpLaunchSnapshot.disabledBuiltInMcpServerIds,
          mcpLaunchSnapshot.pluginBuiltInMcpServerIds,
        ),
      terminalSize: input.initialSize,
      launchPrompt: input.launchPrompt,
      ...(input.sessionRef ? { sessionRef: input.sessionRef } : {}),
      status: input.initialStatus ?? "launching",
      attention: input.initialAttention ?? "none",
      canResumeWithConfig: input.sessionRef !== undefined,
      outputLength: 0,
      pendingLaunchPrompt: input.pendingLaunchPrompt,
      ...(input.pendingLaunchGoalContext
        ? { pendingLaunchGoalContext: input.pendingLaunchGoalContext }
        : {}),
      pendingTerminalPreInputs: input.pendingTerminalPreInputs,
      pendingTerminalPrompt: input.pendingTerminalPrompt,
      pendingTerminalSegments: input.pendingTerminalSegments,
      ...(input.presentationMode ? { presentationMode: input.presentationMode } : {}),
      ...(input.poolAccountId ? { poolAccountId: input.poolAccountId } : {}),
      ...(input.poolProvider ? { poolProvider: input.poolProvider } : {}),
      ...(input.suppressInitialStructuredIdle ? { suppressInitialStructuredIdle: true } : {}),
      prevChunk: "",
      lastStrippedPtyChunk: "",
      ptyOscCarry: "",
      ...(cliHookEnvInjected ? { cliHookEnvInjected: true } : {}),
      ...(input.structuredSession ? { structuredSession: input.structuredSession } : {}),
    };

    ctx.sessionRuntimeLifecycle.attach(session);

    return session;
  }

  /** Fold provider-neutral MCP descriptors into every launch path. */
  composeLaunchOptions(
    adapter: AgentAdapter,
    launchOptions: AgentLaunchOptions | undefined,
    mcpServers: readonly ResolvedMcpServer[],
  ): AgentLaunchOptions {
    return {
      ...(launchOptions ?? {}),
      agentSettings: this.ctx.resolveAgentSettings(adapter),
      ...(mcpServers.length > 0 ? { mcpServers } : {}),
    };
  }

  async resolveMcpServersForLaunch({
    location,
    config,
    mcpLaunchSnapshot,
    identity,
    crossagentThreadId,
    adapter,
    presentationMode,
  }: {
    location: ProjectLocation;
    config: ThreadConfig;
    mcpLaunchSnapshot: McpLaunchSnapshot;
    identity?: McpThreadIdentity;
    crossagentThreadId?: string;
    adapter?: AgentAdapter;
    presentationMode?: ThreadPresentationMode;
  }): Promise<ResolvedMcpServer[]> {
    if (
      adapter &&
      (!supportsMcpAtProjectLocation(adapter.capabilities, location) ||
        resolveComposerMcpScope(
          adapter.capabilities.mcpScope,
          presentationMode ?? adapter.capabilities.presentationMode,
        ) === "none")
    ) {
      return [];
    }
    const providerSessionCrossagents = usesProviderSessionCrossagentRouting(
      adapter,
      presentationMode,
      crossagentThreadId,
    );
    if (adapter?.capabilities.mcpConfigSource === "agentSettings") {
      // Provider-level MCP: flags come from the provider's settings page. Drop
      // the general MCP identity; GUI provider-session routing uses its own
      // shared credential, while terminal routing keeps the thread token.
      config = this.resolveMcpLaunchConfig(config, mcpLaunchSnapshot, adapter, crossagentThreadId);
      identity = undefined;
      if (adapter.capabilities.crossagentMcpRouting !== "provider-session") {
        crossagentThreadId = undefined;
      }
    }
    const browserMcp = await this.resolveBrowserMcpForLaunch(
      location,
      config,
      mcpLaunchSnapshot,
      identity,
    );
    const ownSubagentsMcp = crossagentThreadId
      ? await this.resolveOwnSubagentsMcpForLaunch(
          crossagentThreadId,
          location,
          config,
          mcpLaunchSnapshot,
          providerSessionCrossagents,
        )
      : undefined;
    const peerThreadId = crossagentThreadId ?? identity?.threadId;
    const crossagentsPeerMcp = peerThreadId
      ? await this.resolveCrossagentsPeerMcpForLaunch(
          peerThreadId,
          location,
          config,
          mcpLaunchSnapshot,
        )
      : undefined;
    const computerUseMcp = this.resolveComputerUseMcpForLaunch(
      location,
      config,
      mcpLaunchSnapshot,
      identity,
    );
    const chromeMcp = this.resolveChromeMcpForLaunch(location, config, mcpLaunchSnapshot, identity);
    const appControlsMcp = await this.resolveAppControlsMcpForLaunch(
      location,
      mcpLaunchSnapshot,
      identity,
    );
    const resolved = composeResolvedMcpServers(
      mcpLaunchSnapshot,
      browserMcp,
      ownSubagentsMcp,
      computerUseMcp,
      chromeMcp,
      appControlsMcp,
      crossagentsPeerMcp,
    );
    if (!adapter) return resolved;
    const secretFree =
      adapter.capabilities.requiresSecretFreeMcpConfig === true ||
      adapter.capabilities.supportsMcpHttpHeaders === false;
    const projected = secretFree
      ? await wrapHeaderBearingHttpMcpAsStdio(resolved, location)
      : resolved;
    const supported = projected.filter((server) =>
      isMcpServerSupportedByRuntime(server, adapter.capabilities),
    );
    if (supported.length !== resolved.length) {
      const skippedNames = resolved
        .filter((server) => !supported.includes(server))
        .map((server) => server.name)
        .join(", ");
      // Provider-visible names only: never log URLs, headers, env, or arguments.
      console.warn(`[supervisor] ${adapter.kind} skipped unsupported MCP servers: ${skippedNames}`);
    }
    return supported;
  }

  resolveMcpLaunchConfig(
    config: ThreadConfig,
    mcpLaunchSnapshot: McpLaunchSnapshot,
    adapter: AgentAdapter,
    crossagentThreadId?: string,
  ): ThreadConfig {
    if (adapter.capabilities.mcpConfigSource !== "agentSettings") return config;
    const withProviderSettings = applyAgentSettingsMcpFlags(
      config,
      this.ctx.resolveAgentSettings(adapter),
      mcpLaunchSnapshot.disabledBuiltInMcpServerIds,
      adapter.capabilities.crossagentMcpRouting === "provider-session" &&
        crossagentThreadId !== undefined,
    );
    return effectiveLaunchConfig(
      withProviderSettings,
      mcpLaunchSnapshot.disabledBuiltInMcpServerIds,
      mcpLaunchSnapshot.pluginBuiltInMcpServerIds,
    );
  }

  async resolveBrowserMcpForLaunch(
    location: ProjectLocation,
    config: ThreadConfig,
    mcpLaunchSnapshot: McpLaunchSnapshot,
    identity?: McpThreadIdentity,
  ): Promise<BrowserMcpHttpConfig | undefined> {
    if (mcpLaunchSnapshot.disabledBuiltInMcpServerIds.includes("browser")) return undefined;
    const enabled = config.browserMcp === true;
    if (!enabled) return undefined;
    const cfg = await resolveBrowserMcpHttpConfigForLaunch(
      location,
      enabled,
      this.ctx.options.wslBridge,
      {
        ...identity,
        disabledTools: mcpLaunchSnapshot.disabledBuiltInMcpTools?.browser ?? [],
      },
    );
    return cfg;
  }

  /**
   * Resolve the computer-use MCP http config for a launch when the thread opted
   * in (`config.computerUse === true`). Unlike browser MCP there is no
   * force-disable ctx gate — computer-use scope gating happens in the renderer,
   * so the per-thread config flag is authoritative. The resolver declines for
   * WSL projects by design (computer-use is disabled for WSL). Parallel to
   * `resolveBrowserMcpForLaunch`.
   */
  resolveComputerUseMcpForLaunch(
    location: ProjectLocation,
    config: ThreadConfig,
    mcpLaunchSnapshot: McpLaunchSnapshot,
    identity?: McpThreadIdentity,
  ): ComputerUseMcpHttpConfig | undefined {
    const enabled = config.computerUse === true;
    return resolveComputerUseMcpHttpConfigForLaunch(location, enabled, {
      ...identity,
      disabledTools: mcpLaunchSnapshot.disabledBuiltInMcpTools?.["computer-use"] ?? [],
    });
  }

  /**
   * Resolve the external-Chrome MCP http config for a launch when the thread
   * opted in (`config.chromeMcp === true`). Mirrors
   * {@link resolveComputerUseMcpForLaunch}: the per-thread config flag is
   * authoritative (scope gating lives in the renderer) and the resolver declines
   * for WSL projects by design.
   */
  resolveChromeMcpForLaunch(
    location: ProjectLocation,
    config: ThreadConfig,
    mcpLaunchSnapshot: McpLaunchSnapshot,
    identity?: McpThreadIdentity,
  ): ChromeMcpHttpConfig | undefined {
    const enabled = config.chromeMcp === true;
    return resolveChromeMcpHttpConfigForLaunch(location, enabled, {
      ...identity,
      disabledTools: mcpLaunchSnapshot.disabledBuiltInMcpTools?.chrome ?? [],
    });
  }

  resolveAppControlsMcpForLaunch(
    location: ProjectLocation,
    mcpLaunchSnapshot: McpLaunchSnapshot,
    identity?: McpThreadIdentity,
  ): Promise<AppControlsMcpHttpConfig | undefined> {
    if (mcpLaunchSnapshot.disabledBuiltInMcpServerIds.includes("app-controls")) {
      return Promise.resolve(undefined);
    }
    return resolveAppControlsMcpHttpConfigForLaunch(location, this.ctx.options.wslHostAccess, {
      ...identity,
      disabledTools: mcpLaunchSnapshot.disabledBuiltInMcpTools?.["app-controls"] ?? [],
    });
  }

  /**
   * Resolve the Own Subagents (ephemeral child) MCP http config for a launch
   * when the thread opted in (`config.crossagentMcp === true`). Registers the
   * (idempotent — reuses an existing token), then rewrites the loopback URL to
   * the WSL → host gateway IP for NAT-mode WSL projects (mirrored-mode WSL and
   * native projects pass through unchanged). Parallel to
   * `resolveBrowserMcpForLaunch`.
   */
  async resolveOwnSubagentsMcpForLaunch(
    threadId: string,
    location: ProjectLocation,
    config: ThreadConfig,
    mcpLaunchSnapshot: McpLaunchSnapshot,
    providerSessionRouting = false,
  ): Promise<CrossagentMcpHttpConfig | undefined> {
    if (config.crossagentMcp !== true) {
      this.ctx.options.ownSubagentsMcp?.unregister(threadId);
      return undefined;
    }
    const disabledTools =
      mcpLaunchSnapshot.disabledBuiltInMcpTools?.["own-subagents"] ??
      mcpLaunchSnapshot.disabledBuiltInMcpTools?.crossagents ??
      [];
    const native = providerSessionRouting
      ? this.ctx.options.ownSubagentsMcp?.registerProviderSession(threadId, disabledTools)
      : this.ctx.options.ownSubagentsMcp?.register(threadId, disabledTools);
    return resolveCrossagentMcpHttpConfigForLaunch(
      native,
      location,
      this.ctx.options.wslHostAccess,
    );
  }

  /**
   * Resolve the persistent Crossagents peer-channel MCP http config for a
   * launch. The peer channel is default-ON: only an explicit
   * `config.crossagentsMcp === false` or a hard disable of the `crossagents`
   * built-in server opts out. Served by the main-process ingress (shared
   * token + per-thread `?thread=` identity), so no per-thread registration
   * exists to unwind — resolving to undefined simply omits the descriptor.
   */
  async resolveCrossagentsPeerMcpForLaunch(
    threadId: string,
    location: ProjectLocation,
    config: ThreadConfig,
    mcpLaunchSnapshot: McpLaunchSnapshot,
  ): Promise<CrossagentsPeerMcpHttpConfig | undefined> {
    if (config.crossagentsMcp === false) return undefined;
    if (mcpLaunchSnapshot.disabledBuiltInMcpServerIds.includes("crossagents")) return undefined;
    const disabledTools = mcpLaunchSnapshot.disabledBuiltInMcpTools?.crossagents;
    return resolveCrossagentsPeerMcpHttpConfigForLaunch(location, this.ctx.options.wslHostAccess, {
      threadId,
      ...(disabledTools ? { disabledTools } : {}),
    });
  }

  private mergeLaunchExtraEnv(
    ...envs: Array<Record<string, string> | undefined>
  ): Record<string, string> | undefined {
    const merged: Record<string, string> = {};
    for (const env of envs) {
      if (!env) continue;
      Object.assign(merged, env);
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private async resolveMuseForeignExtraEnv(input: {
    agentKind: AgentKind;
    threadId: string;
    model?: string | undefined;
    thirdPartyAccountId?: string | undefined;
    projectLocation?: ProjectLocation;
  }): Promise<Record<string, string> | undefined> {
    if (baseAgentKind(input.agentKind) !== "muse") return undefined;
    if (input.thirdPartyAccountId) {
      const accountEnv = await this.ctx.options.resolveAccountSessionEnv?.({
        provider: "muse",
        threadId: input.threadId,
        model: input.model,
        thirdPartyAccountId: input.thirdPartyAccountId,
      });
      return accountEnv?.env;
    }
    if (museForeignProviderFromModel(input.model ?? "") !== "opencode-go") return undefined;
    const apiKey = readOpenCodeGoApiKey();
    if (!apiKey) {
      throw new AccountControlError(
        "ACCOUNT_NOT_FOUND",
        "OpenCode Go 未授权，无法把 Muse Spark 接到 Muse Code。请先在「模型与用量」登录 OpenCode Go。",
        { provider: "opencode-go" },
      );
    }
    const wsl = input.projectLocation?.kind === "wsl";
    return buildMuseForeignChildEnv({
      apiKey,
      baseUrl: OPENCODE_GO_RESPONSES_BASE_URL,
      isolationDir: wsl
        ? `/tmp/craftstation-muse-go/${input.threadId}`
        : join(tmpdir(), "craftstation-muse-go", input.threadId),
      createIsolationDir: !wsl,
    });
  }

  private resolveAgentProcessEnv(adapter: AgentAdapter): Record<string, string> {
    const settingDefs = adapter.capabilities.settingDefs ?? [];
    if (settingDefs.length === 0) {
      return {};
    }

    const agentValues = this.ctx.resolveAgentSettings(adapter);
    const env: Record<string, string> = {};
    for (const definition of settingDefs) {
      if (definition.platforms && !definition.platforms.includes(process.platform)) {
        continue;
      }
      const value = agentValues[definition.key] ?? definition.default;
      if (definition.type === "toggle") {
        if (value) {
          Object.assign(env, definition.env);
        }
      } else if (definition.type === "select") {
        env[definition.envVar] = String(value);
      }
    }
    return env;
  }

  private requireAdapter(kind: AgentKind): AgentAdapter {
    const adapter = this.ctx.options.adapters.get(kind);
    if (!adapter) {
      throw new Error(`Unsupported agent adapter: ${kind}`);
    }
    return adapter;
  }

  private async createStructuredSession(
    adapter: AgentAdapter,
    threadId: string,
    agentKind: AgentKind,
    projectLocation: ProjectLocation,
    config: ThreadConfig,
    mcpServers: readonly ResolvedMcpServer[],
    mcpIdentity: McpThreadIdentity | undefined,
    sessionRef?: SessionRef,
    presentationMode?: ThreadPresentationMode,
    launchContext?: { thirdPartyAccountId?: string | undefined },
    /**
     * Pool accounts to skip for this resolution (same-turn failover's tried
     * set). Fresh starts pass nothing; restarts pass the turn's tried ids so
     * a re-resolution can never land back on an account that already died
     * this turn, even if its quota write-back hasn't landed.
     */
    excludedAccountIds?: readonly string[] | undefined,
  ): Promise<{
    handle: StructuredSessionHandle | undefined;
    poolAccount?: { accountId: string; provider: string };
  }> {
    if (!adapter.createStructuredSession) {
      return { handle: undefined };
    }
    try {
      // Pool-first authorization: when the provider has a managed account pool,
      // the session must use the pool credential (env-scope redirection), never
      // the ambient host CLI login. A resolution failure throws and fails the
      // start — it must not degrade to the ambient account.
      // Third-party launches (explicit validated account) bypass the pool:
      // see resolveAccountSessionEnv's third-party branch.
      const thirdPartyAccountId = launchContext?.thirdPartyAccountId;
      const accountEnv = await this.ctx.options.resolveAccountSessionEnv?.({
        provider: baseAgentKind(agentKind),
        threadId,
        model: config.model,
        ...(thirdPartyAccountId ? { thirdPartyAccountId } : {}),
        ...(excludedAccountIds?.length ? { excludedAccountIds: [...excludedAccountIds] } : {}),
      });
      // Credential-source stickiness: third-party sessions record the
      // third-party provider so restarts/resumes re-enter the pool bypass
      // instead of the subscription pool.
      const effectiveProvider = thirdPartyAccountId
        ? "openai-compatible"
        : baseAgentKind(agentKind);
      const baseSpawnEnv = accountEnv
        ? { ...adapter.baseSpawnEnv, ...accountEnv.env }
        : adapter.baseSpawnEnv;
      if (accountEnv) {
        console.log(
          `[account] structured session bound to pool account: provider=${effectiveProvider} thread=${threadId} account=${accountEnv.accountId} reason=${accountEnv.reason}`,
        );
      }
      const handle = await adapter.createStructuredSession({
        threadId,
        projectLocation,
        config,
        agentSettings: this.ctx.resolveAgentSettings(adapter),
        ...(baseSpawnEnv ? { baseSpawnEnv } : {}),
        ...(mcpIdentity ? { mcpIdentity } : {}),
        ...(mcpServers.length > 0 || adapter.capabilities.mcpConfigSource === "agentSettings"
          ? { mcpServers }
          : {}),
        ...(sessionRef ? { sessionRef } : {}),
        ...(presentationMode ? { presentationMode } : {}),
        ...(accountEnv
          ? {
              // Chat-lane equivalent of the craftAgent lane's onPromptError:
              // quota failures write back onto the pool account so the next
              // session resolution skips it.
              onPromptError: (error: unknown) =>
                this.ctx.options.handleAccountPromptError?.({
                  provider: effectiveProvider,
                  accountId: accountEnv.accountId,
                  error,
                }),
              // Async quota failures (Codex turn/completed notifications)
              // settle before any rejection can reach the turn queue: replay
              // the carried prompt on the next usable pool account via the
              // normal failover path. The carried user-message id prevents a
              // duplicate user row; the write-back above already marked the
              // dead account before this runs.
              onPoolQuotaTurnFailed: (failedTurn) => {
                const runtime = this.ctx.sessions.get(threadId);
                if (!runtime) return;
                const turn: QueuedStructuredTurn = {
                  prompt: failedTurn.prompt,
                  config: failedTurn.config,
                  ...(failedTurn.segments ? { segments: failedTurn.segments } : {}),
                  ...(failedTurn.userMessageItemId
                    ? { userMessageItemId: failedTurn.userMessageItemId }
                    : {}),
                };
                void (async () => {
                  try {
                    await this.ctx.tryPoolFailover?.(runtime, turn, failedTurn.error);
                  } catch {
                    // Declines and restart failures surface through the
                    // original quota banner; never replace it here.
                  }
                })();
              },
            }
          : {}),
      });
      return {
        handle,
        ...(accountEnv
          ? {
              poolAccount: {
                accountId: accountEnv.accountId,
                provider: effectiveProvider,
              },
            }
          : {}),
      };
    } catch (error) {
      console.error("[supervisor] structured session creation failed:", error);
      // Account-control failures are already user-facing, secret-free messages
      // (e.g. "No usable kimi account in the provider pool."). Surface them so
      // the GUI error strip explains WHY the start failed instead of a bare
      // diagnostic line the user cannot act on.
      const causeHint = error instanceof AccountControlError ? error.message : undefined;
      const diagnosticError = new StructuredRuntimeDiagnosticError(
        "session-creation",
        agentKind,
        causeHint,
      );
      if (presentationMode === "gui") {
        // The startThread IPC boundary owns GUI startup failures. Throw one
        // privacy-safe classified error instead of capturing here and then
        // manufacturing a second "does not support GUI" failure below.
        throw diagnosticError;
      }
      // Terminal presentation can safely fall back to its PTY path when the
      // optional structured helper cannot be created, so report once here.
      captureSupervisorException(diagnosticError, {
        "craftstation.feature_area": structuredRuntimeFeatureArea("session-creation"),
        ...(presentationMode ? { "craftstation.presentation": presentationMode } : {}),
        "craftstation.provider": agentKind,
        "craftstation.runtime_kind": "structured",
      });
      return { handle: undefined };
    }
  }

  private async abortPendingStart(
    threadId: string,
    structuredSession: StructuredSessionHandle | undefined,
  ): Promise<boolean> {
    if (!this.ctx.pendingStartAborts.delete(threadId)) {
      return false;
    }
    this.ctx.pendingStartInterrupts.delete(threadId);
    await structuredSession?.dispose();
    return true;
  }

  private emitOptimisticWorkingState(
    threadId: string,
    config: ThreadConfig,
    launchConfig: ThreadConfig,
    presentationMode: ThreadPresentationMode,
  ): void {
    this.ctx.options.emit({
      type: "thread-state",
      threadId,
      status: "working",
      attention: "working",
      config,
      launchConfig,
      canResumeWithConfig: false,
      threadStatusSource: "server",
      presentationMode,
    });
  }
}
