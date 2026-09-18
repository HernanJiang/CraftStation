import type { SupervisorEvent } from "@/shared/ipc";
import type {
  AgentKind,
  BuiltInMcpServerId,
  McpServer,
  ResolvedMcpServer,
  ProjectLocation,
  PromptSegment,
  ThreadServerRequestId,
  ThreadPresentationMode,
} from "@/shared/contracts";
import type { CrossagentMcpHttpConfig } from "@/supervisor/agents/crossagentMcp";
import type { WslHostAccessResolver } from "@/supervisor/wsl/hostAccess";
import type { AgentAdapter, AgentNativePlugin } from "../../agents/base";
import type { WindowsShellPreference } from "../../shellPreference";

export interface ThreadSessionManagerOptions {
  emit(event: SupervisorEvent): void;
  isDev: boolean;
  logsDir: string;
  settingsPath: string;
  readDisableCliHookPlugin(): boolean;
  /**
   * Craft-Harness turn retry policy (max extra attempts + fixed interval),
   * read live from shared settings on every failure so changes apply without
   * restarting sessions.
   */
  readTurnRetryPolicy(): { maxAttempts: number; intervalMs: number };
  adapters: Map<AgentKind, AgentAdapter>;
  resolveWindowsShell(runtime?: "preferred" | "powershell"): WindowsShellPreference;
  /**
   * Optional: provides CLI hook plugin ingress env vars + extra CLI args injected
   * into every agent PTY spawn. The supervisor boots a single
   * `HookIngress` and exposes this hook so the manager doesn't depend on
   * `node:http` itself.
   */
  resolvePluginEnvForSpawn?(input: {
    threadId: string;
    agentKind: AgentKind;
    projectLocation: ProjectLocation;
    mcpServers?: readonly ResolvedMcpServer[];
  }): Promise<{ env: Record<string, string>; extraArgs: string[] } | undefined>;
  wslBridge?: {
    ensureBridge(distro: string): Promise<{ baseUrl: string; secret: string } | undefined>;
  };
  /**
   * Optional: Own Subagents MCP hooks. When a thread launches with
   * `config.crossagentMcp === true`, the manager registers it with the ingress
   * and threads the resulting http config into the structured session / launch
   * options. An interrupt cancels turn-scoped children while preserving explicit
   * background runs; close cancels everything and unregisters the thread. All
   * heavy lifting lives in the crossagentMcp module — these are thin hooks only.
   */
  ownSubagentsMcp?: {
    register(
      threadId: string,
      disabledTools?: readonly string[],
    ): CrossagentMcpHttpConfig | undefined;
    registerProviderSession(
      threadId: string,
      disabledTools?: readonly string[],
    ): CrossagentMcpHttpConfig | undefined;
    unregister(threadId: string): void;
    cancelForeground(threadId: string): void;
    cancelAll(threadId: string): void;
    /**
     * Try to route a server-request resolution to a subagent child run. Returns
     * `true` when the id belonged to a subagent (namespaced under a run) and was
     * handled; `false` to fall through to the normal session resolve path.
     */
    resolveChildRequest(requestId: ThreadServerRequestId, response: unknown): boolean;
  };
  /**
   * Optional: resolves how a WSL distro reaches host-bound services (NAT
   * gateway IP vs. mirrored-mode loopback) so built-in MCP URLs can be
   * rewritten — or left as-is — for agents launched inside a WSL distro.
   * Windows-only in practice; absent/undefined on macOS/Linux, which makes the
   * WSL rewrite path inert.
   */
  wslHostAccess?: WslHostAccessResolver;
  /**
   * Optional: attaches stored OAuth `Authorization` headers to user-configured
   * HTTP/SSE MCP servers just before a launch fans them out to the provider
   * config builders. Tokens are refreshed by the supervisor's OAuth service.
   */
  applyMcpServerAuthorization?(servers: McpServer[]): Promise<McpServer[]>;
  /** Skills and MCPs contributed by enabled Agent Plugins for one provider launch. */
  resolvePluginLaunchContributions?(
    projectLocation: ProjectLocation,
    agentKind: AgentKind,
  ): Promise<{
    mcpServers: McpServer[];
    builtInMcpServerIds: BuiltInMcpServerId[];
    nativePlugins: AgentNativePlugin[];
  }>;
  /** Wrap servers with disabled tools in CraftStation's same-environment filtering proxy. */
  prepareMcpToolFilters?(
    servers: McpServer[],
    projectLocation: ProjectLocation,
  ): Promise<McpServer[]>;
  /** Synchronize CraftStation-owned provider skill projections before a new agent process starts. */
  prepareSkillsForLaunch?(projectLocation: ProjectLocation, agentKind: AgentKind): Promise<void>;
  /** Enforce plugin skill policy before a segment reaches a provider. */
  filterPluginSkillSegments?(input: {
    agentKind: AgentKind;
    projectLocation: ProjectLocation;
    presentationMode?: ThreadPresentationMode;
    nativePlugins?: readonly AgentNativePlugin[];
    segments: PromptSegment[];
  }): Promise<PromptSegment[]>;
  /**
   * Portable-skills fallback for structured turns: returns inline SKILL.md
   * instructions for skill segments the provider can't load natively, or
   * `undefined` when nothing needs inlining. Must never throw.
   */
  buildSkillTurnInjection?(input: {
    agentKind: AgentKind;
    projectLocation: ProjectLocation;
    segments: readonly PromptSegment[];
    nativePlugins?: readonly AgentNativePlugin[];
  }): Promise<string | undefined>;
  /**
   * Portable-skills fallback for terminal (PTY) turns: replaces skill segments
   * the agent's CLI can't resolve natively with a short path-hint sentence.
   * Must never throw; returns the segments to type.
   */
  rewriteTerminalSkillSegments?(input: {
    agentKind: AgentKind;
    projectLocation: ProjectLocation;
    segments: PromptSegment[];
    nativePlugins?: readonly AgentNativePlugin[];
  }): Promise<PromptSegment[]>;
  /**
   * Pool-first account authorization for structured sessions. Given the base
   * provider kind, returns the managed pool account's process environment
   * (e.g. `CODEX_HOME` / pinned `GROK_HOME`) so the session uses the pool
   * credential instead of the ambient host CLI login. Return `undefined` only
   * when the provider has no managed pool (ambient fallback). Throw when a
   * pool exists but no account is usable — that must surface as a start
   * failure, never a silent ambient fallback. The returned env must not
   * contain secret values, only scope redirections.
   *
   * Third-party launches (`thirdPartyAccountId` set) bypass the subscription
   * pool entirely: the supervisor projects the validated third-party
   * credential into the harness's official custom-provider surface and
   * records `provider: "openai-compatible"` on the binding so restarts and
   * resumes stay on the third-party credential (sticky source). Incompatible
   * harness/protocol pairs throw an explicit error suggesting a compatible
   * harness — never a pool error, never a silent harness swap.
   */
  resolveAccountSessionEnv?(input: {
    provider: string;
    threadId: string;
    /** Launch model id (for third-party descriptor matching/diagnostics). */
    model?: string | undefined;
    /**
     * Launch-time explicit third-party account (an `openai-compatible` usage
     * account id). Never a subscription account id.
     */
    thirdPartyAccountId?: string | undefined;
    /**
     * Pool accounts to skip for this resolution (same-turn failover's tried
     * set). Pool scheduling only; explicit pins are never rerouted.
     */
    excludedAccountIds?: readonly string[] | undefined;
  }): Promise<{ accountId: string; reason: string; env: Record<string, string> } | undefined>;
  /**
   * Usability probe for a pool-bound session's account (mirrors the
   * scheduler's usable rule: enabled and available/quota-low). The submit
   * path uses it to restart onto the next usable pool row BEFORE sending
   * when the bound account has since died — so a thread never burns a turn
   * on an account the scheduler would no longer pick. Absent = assume
   * usable (no proactive restart).
   */
  isPoolAccountUsable?: (provider: string, accountId: string) => boolean;
  /**
   * Whether the provider has ANY scheduler-usable pool row right now.
   * Lets same-turn failover also rescue sessions that were bound before pool
   * adoption (or via ambient login): with nowhere to go it stays fail-closed
   * instead of burning a pointless restart. Absent = assume none.
   */
  hasUsablePoolAccount?: (provider: string) => boolean;
  /**
   * Human-readable pool account identity for failover notices
   * ("Grok账号x@y.zz额度已耗尽，已切换到…"). Absent = raw account id.
   */
  describePoolAccount?: (provider: string, accountId: string) => string | undefined;
  /**
   * Observe provider errors from chat-lane sessions bound to a pool account
   * (same seam as the craftAgent lane's `onPromptError`). Runtime owners use
   * this to write quota exhaustion back onto the account row so the pool
   * scheduler skips it on the next session; must never replace the original
   * prompt failure.
   */
  handleAccountPromptError?(input: { provider: string; accountId: string; error: unknown }): void;
}
