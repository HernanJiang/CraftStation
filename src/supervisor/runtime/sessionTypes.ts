import type { IPty } from "node-pty";
import type {
  AgentKind,
  AgentSlashCommand,
  ProjectLocation,
  PromptSegment,
  SessionRef,
  TerminalSize,
  ThreadAttention,
  ThreadConfig,
  ThreadPresentationMode,
  ThreadStatus,
  McpLaunchSnapshot,
} from "@/shared/contracts";
import type { TranscriptBuffer } from "@/shared/transcriptBuffer";
import type {
  AgentAdapter,
  AgentNativePlugin,
  StructuredSessionHandle,
  TerminalStatusHint,
} from "../agents/base";

export interface QueuedStructuredTurn {
  prompt: string;
  config: ThreadConfig;
  segments?: PromptSegment[];
  /** Canonical turn id retained across interrupt/restart admission. */
  turnId?: string;
  userMessageItemId?: string;
  /** Inlined SKILL.md instructions for skills the provider can't load natively. */
  inlineInstructions?: string;
  /**
   * Same-turn pool-failover chain state. Incremented each time a quota-dead
   * pool account is swapped for the next usable one within this turn; the
   * tried ids bound the chain so a pool that never marks progress still
   * terminates instead of respawning forever. The tried ids are also passed
   * as resolution exclusions, so a re-resolution can never land back on an
   * account that already died this turn even if its quota write-back hasn't
   * landed (or failed to land) yet.
   */
  poolFailoverAttempt?: number;
  poolTriedAccountIds?: string[];
  /**
   * Craft-Harness retry chain state. Incremented each time this turn is
   * automatically replayed after a network/transport interruption; carried on
   * the turn object (like the failover chain) so the chain terminates at the
   * configured cap even across session rebuilds.
   */
  turnRetryAttempt?: number;
  /**
   * Failover context carry-over ("前情提要"), rendered from the thread
   * transcript at failover time. restartThread prepends it to the SENT
   * prompt only — the painted user message stays the raw prompt.
   */
  historyPreface?: string;
  /**
   * Fallback `/goal` block for THIS turn only, prepended to the SENT prompt
   * ahead of `historyPreface` — the painted user message stays the raw
   * prompt, so a persistent goal never masquerades as user-typed text. The
   * renderer re-sends it every turn while `thread.goal` is active (the
   * supervisor keeps no goal state); native-goal threads omit it. Intentionally
   * NOT consumed: the prepend is pure (turn.prompt is never mutated), so
   * failover replays cannot double-prepend.
   */
  goalContext?: string;
}

/**
 * Single staged steer message held while we wait for the agent to ack the
 * cancel notification (the gap between `connection.cancel` / `turn/interrupt`
 * fire and the in-flight prompt resolving with `cancelled` stopReason).
 *
 * Replace-latest semantics: a second submit-while-working overwrites the slot
 * rather than queueing. There is no multi-message queue surface — the user's
 * intent is "redirect", and stacking redirects is rarely what they want.
 */
export interface PendingSteerSlot extends QueuedStructuredTurn {
  /** Stable id allocated at stage time. Used by edit/clear IPC and renderer dedupe. */
  id: string;
  /** Wall-clock timestamp the slot was staged or last edited. */
  stagedAt: number;
}

export interface SessionRuntime {
  instanceId: string;
  threadId: string;
  agentKind: AgentKind;
  adapter: AgentAdapter;
  pty?: IPty;
  projectLocation: ProjectLocation;
  config: ThreadConfig;
  /** Effective provider launch config with globally disabled MCP cleared. */
  launchConfig?: ThreadConfig;
  /** MCP launch snapshot reused by restart and recovery paths. */
  mcpLaunchSnapshot: McpLaunchSnapshot;
  /** Provider-native plugin packages that replace matching CraftStation contributions. */
  nativePlugins?: readonly AgentNativePlugin[];
  sessionRef?: SessionRef;
  slashCommands?: AgentSlashCommand[];
  status: ThreadStatus;
  attention: ThreadAttention;
  canResumeWithConfig: boolean;
  terminalSize: TerminalSize;
  launchPrompt: string;
  outputLength: number;
  structuredSession?: StructuredSessionHandle | undefined;
  /** Releases temporary resources created specifically for this PTY launch. */
  launchCleanup?: (() => void) | undefined;
  /** Mode the thread was launched in. Preserved for restart / recovery flows. */
  presentationMode?: ThreadPresentationMode;
  ignoreExit?: boolean;
  ptyExited?: boolean;
  autoResponseEmitted?: boolean;
  sessionRefDiscoveryStarted?: boolean;
  /**
   * Set when the invalid-session recovery path replaced a dead provider-native
   * session with a FRESH native session under the same thread id. The thread's
   * UI history is retained, but provider-side context before this point is
   * gone — readers must treat pre-recovery history as a fork marker, never as
   * a live continuation.
   */
  recoveredFromInvalidRef?: boolean | undefined;
  stopSessionRefWatcher?: (() => void) | undefined;
  pendingLaunchPrompt?: string | undefined;
  pendingTerminalPreInputs?: string[][] | undefined;
  pendingTerminalWriteInFlight?: boolean | undefined;
  pendingTerminalPrompt?: string | undefined;
  pendingTerminalSegments?: PromptSegment[] | undefined;
  /**
   * Single staged steer message. Set when the user submits while the thread
   * is `working`; cleared when the in-flight turn resolves with `cancelled`
   * stopReason and the slot is drained as the next prompt, or when the user
   * explicitly aborts via `clearPendingSteer`. Replace-latest on edit.
   */
  pendingSteer?: PendingSteerSlot | undefined;
  structuredTurnInterruptRequested?: boolean | undefined;
  /**
   * Force-stop watchdog for a structured (GUI) turn. Armed when the user
   * requests a stop and reset on any inbound sign of life (status update or
   * runtime event) while the interrupt is still pending. If it fires, the
   * session is treated as stale/disconnected: the structured session is
   * disposed and the thread is forced into a stopped `error` state so the UI
   * does not hang on "waiting for agent to stop" forever.
   * Cleared on stop-acknowledged, PTY exit, teardown, and `clearSessionTimers`.
   */
  structuredInterruptWatchdog?: ReturnType<typeof setTimeout> | undefined;
  /**
   * GUI Codex launches optimistically enter `working` before the app-server
   * listener is attached. Codex then replays the newly opened thread's idle
   * state before the first turn has been submitted; suppress that transient
   * idle so the renderer does not close and reopen the same launch turn.
   */
  suppressInitialStructuredIdle?: boolean | undefined;
  prevChunk: string;
  /**
   * ANSI-stripped text from the **latest** PTY `data` chunk (post OSC extract).
   * Used for `detectTerminalStatus` / `getLatestTerminalStatusHint` so L2 never
   * scans merged scrollback from `prevChunk`.
   */
  lastStrippedPtyChunk: string;
  /**
   * Bytes held between PTY `data` events when an OSC 9/777/99 sequence is
   * split across reads (no BEL/ST yet in this chunk).
   */
  ptyOscCarry?: string;
  lastStatusChangeAt?: number | undefined;
  pendingStatusHint?:
    | {
        status: ThreadStatus;
        attention: ThreadAttention;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  workingSilenceTimer?: ReturnType<typeof setTimeout> | undefined;
  outputTranscript?: TranscriptBuffer | undefined;
  /**
   * True when `CRAFTSTATION_HOOK_URL` (and related vars) were injected into the
   * agent PTY at spawn (L1 path: host or WSL bridge → HookIngress). Used so the
   * UI can show Enhanced (Hooks) before the first routed hook event. If the CLI
   * blocks hooks from running, OSC/title hints can promote the session back to
   * terminal parsing until a real hook event arrives. Cleared on PTY exit.
   */
  cliHookEnvInjected?: boolean;
  /**
   * Set the first time we receive a CLI hook plugin event (hook POST) for this
   * session. Once true, terminal status from TUI parsing (L2 /
   * `detectTerminalStatus`) is disabled — hooks own thread status. Cleared on
   * PTY exit.
   */
  hasCliHookPluginActivity?: boolean;
  /** Timestamp of the last CLI hook plugin event — diagnostic / cache freshness. */
  lastCliHookPluginActivityAt?: number;
  /**
   * True after OSC/title status hints prove that hook env was injected but no
   * hook event is actually arriving. While this is true, L2 terminal parsing is
   * allowed again; any real hook event takes ownership back.
   */
  cliHookTerminalFallbackActive?: boolean;
  cliHookTerminalFallbackTimer?: ReturnType<typeof setTimeout> | undefined;
  /**
   * Armed when the user sends an interrupt keystroke (Esc alone, or Ctrl+C)
   * while hooks are active and the session is in a busy status. Claude Code
   * emits no hook on user interrupts (`Stop` is suppressed on user interrupt
   * per docs; `PostToolUseFailure` only fires if a tool was executing), so
   * without this fallback the UI stays stuck. If no hook event flips state
   * within the grace window, we transition to `idle` locally.
   * Cleared by `applyCliHookPluginState`, PTY exit, and `clearSessionTimers`.
   */
  userInterruptRecoveryTimer?: ReturnType<typeof setTimeout> | undefined;
  /**
   * Pool account this session's spawn environment was bound to (set when the
   * provider has a managed account pool; cleared for ambient sessions). Lets
   * same-turn pool failover detect whether a re-resolution actually moved to
   * a fresh account instead of respawning onto the same dead one.
   */
  poolAccountId?: string;
  poolProvider?: string;
  /**
   * Transcript preface stashed by a manual provider switch, consumed by the
   * next submitted turn (StructuredTurnQueue prepends it to the SENT prompt
   * only). Lets the new harness continue with context without replaying
   * anything. Cleared on consume; dropped with the thread.
   */
  pendingHistoryPreface?: string;
  /** Queued-launch sibling of `QueuedStructuredTurn.goalContext` (one-shot). */
  pendingLaunchGoalContext?: string | undefined;
}

export interface ShellSessionRuntime {
  instanceId: string;
  shellId: string;
  pty: IPty;
  projectLocation: ProjectLocation;
  outputLength: number;
  outputTranscript: TranscriptBuffer;
  worktreePath?: string;
  ptyExited?: boolean;
  ignoreExit?: boolean;
}

export interface ThreadOutputPipelineCallbacks {
  onRecoverInvalidSessionRef(session: SessionRuntime): void;
  onStartQueuedLaunchPrompt(session: SessionRuntime): void;
  onStartSessionRefDiscovery(session: SessionRuntime): void;
}

export interface ThreadOutputPipelineHooks extends ThreadOutputPipelineCallbacks {
  emitState(session: SessionRuntime, errorMessage?: string): void;
  getLatestTerminalStatusHint(session: SessionRuntime): TerminalStatusHint | null;
}
