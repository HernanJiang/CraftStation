import { z } from "zod";
import { compositionProvenanceSchema } from "../crafting/types";
import { accountBindingSchema } from "./accountBinding";
import { agentSlashCommandSchema } from "./agent";
import { agentInstanceIdSchema } from "./agentInstance";
import {
  agentKindSchema,
  projectLocationSchema,
  sessionRefSchema,
  threadAttentionSchema,
  threadPresentationModeSchema,
  threadStatusSchema,
  type ThreadPresentationMode,
} from "./common";
import { threadConfigSchema } from "./config";
import {
  BUILT_IN_MCP_SERVER_IDS,
  builtInMcpDisabledToolsSchema,
  mcpServerListSchema,
} from "./mcpServer";
import { runtimeExecutionEnvelopeSchema } from "../sessionHandoff";

/** How thread status/attention is derived for terminal agents (supervisor → renderer). */
export const threadStatusSourceSchema = z.enum(["cli_hook", "terminal_parse", "server"]);
export type ThreadStatusSource = z.infer<typeof threadStatusSourceSchema>;

/**
 * Durable `/goal` prompt bound to a thread. Presence means active; absence
 * means no goal. Stopped goals are deleted, never tombstoned.
 * Deliberately no length cap — goals carry full task context.
 */
export const threadGoalSchema = z.object({
  prompt: z.string().trim().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  /** Fallback/local pause. Native Codex pause is owned by the harness goal item. */
  paused: z.boolean().optional(),
});
export type ThreadGoal = z.infer<typeof threadGoalSchema>;

export const threadSchema = z.object({
  id: z.string().min(1),
  /** Server-owned identity for a transient thread mirrored into a desktop client. */
  remoteServerId: z.string().min(1).optional(),
  remoteId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  title: z.string().min(1),
  agentKind: agentKindSchema,
  /** Optional reference to a user-registered ACP instance (Phase 7). */
  agentInstanceId: agentInstanceIdSchema.optional(),
  config: threadConfigSchema,
  status: threadStatusSchema,
  attention: threadAttentionSchema,
  canResumeWithConfig: z.boolean().default(false),
  sessionRef: sessionRefSchema.optional(),
  /**
   * CraftStation composition identity carried with the durable thread row so
   * a crafted thread can rebuild its CraftPlan after restart.
   */
  compositionProvenance: compositionProvenanceSchema.optional(),
  /** Immutable account selected when this Session was created. */
  accountBinding: accountBindingSchema.optional(),
  worktreePath: z.string().optional(),
  worktreeBranch: z.string().optional(),
  prNumber: z.number().optional(),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
  archived: z.boolean().default(false),
  /**
   * When the thread entered the archive (ISO). Source of truth for
   * archive-retention cleanup — never derived from updatedAt. Set on archive,
   * cleared on unarchive; legacy archived rows backfill from updatedAt on load.
   */
  archivedAt: z.string().min(1).optional(),
  done: z.boolean().default(false),
  doneAt: z.string().min(1).optional(),
  /**
   * Legacy section-local pin flag. Maintained as a mirror of `pinnedAt` for
   * backward compatibility; new code orders by `pinnedAt`.
   * @deprecated Use `pinnedAt` (null = unpinned).
   */
  starred: z.boolean().default(false),
  /**
   * Global pin time (epoch ms). Null/undefined = not pinned. Pin only changes
   * sidebar presentation priority — never projectId/workspace identity.
   * Sorted ascending so multiple pins order stably.
   */
  pinnedAt: z.number().int().nonnegative().nullable().optional(),
  /** "terminal" → xterm-backed PTY (current default); "gui" → renderer-native chat. */
  presentationMode: threadPresentationModeSchema.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  /** Start time of the currently live run window, if the thread is actively working. */
  activeTurnStartedAt: z.string().min(1).optional(),
  /** Start time of the most recently completed run window, if known. */
  lastTurnStartedAt: z.string().min(1).optional(),
  /** End time of the most recently completed run window, if known. */
  lastTurnEndedAt: z.string().min(1).optional(),
  /** Set by supervisor `thread-state`; not user-editable. */
  threadStatusSource: threadStatusSourceSchema.optional(),
  /** Latest error reason from the runtime, present when `status === "error"`. */
  errorMessage: z.string().optional(),
  slashCommands: z.array(agentSlashCommandSchema).optional(),
  /**
   * Id of the thread that created this thread as a child (e.g. via the
   * `craftstation` MCP `create_thread` tool). Persisted so child threads render
   * grouped with their parent in the sidebar; absent for user-created threads.
   */
  parentThreadId: z.string().min(1).optional(),
  /**
   * Set when this thread row was created by a Schedule firing (only
   * `threadTarget {kind:"new"}` runs ever create threads). Marks the thread as
   * an automated run session: cross-agent peer listing must not recommend it
   * as a research peer, and it is eligible for schedule-orphan cleanup.
   */
  scheduleOrigin: z
    .object({
      scheduleId: z.string().min(1),
      runId: z.string().min(1).optional(),
      occurrenceAt: z.string().nullable().optional(),
    })
    .optional(),
  /**
   * Memory-only Side Chat branch: a temporary fork that lives in the right
   * panel, never appears in the left sidebar, and is never written to SQLite
   * (see `dbStorage.saveAppStore`). Cleared when the user promotes the branch
   * to a formal thread ("save as formal"); the row is discarded on Side Chat
   * close while still ephemeral. Absent/false for every durable thread, so
   * existing rows and all existing parsers are unaffected.
   */
  isEphemeral: z.boolean().optional(),
  /**
   * Durable `/goal` prompt bound to this thread (CraftStation fallback goal).
   * Set/replaced only by an explicit `/goal + Prompt` submit, cleared only by
   * the Goal × stop. Survives reload, resume and model/provider/harness
   * switches because it rides the synced thread row (not any live session).
   * Native runtimes (Codex `thread/goal/*`) are registered separately per
   * session; this field is the fallback source of truth.
   */
  goal: threadGoalSchema.optional(),
});
export type Thread = z.infer<typeof threadSchema>;

/**
 * True for memory-only Side Chat branches. Use this predicate (rather than a
 * bare truthiness read) at every surface that lists durable threads so a
 * temporary branch can never leak into the left thread list, search, Home,
 * adjacent-thread navigation, or SQLite persistence.
 */
export function isEphemeralSideChatThread(thread: Pick<Thread, "isEphemeral">): boolean {
  return thread.isEphemeral === true;
}

export interface ThreadRuntimeSnapshot {
  threadId: string;
  status: z.infer<typeof threadStatusSchema>;
  attention: z.infer<typeof threadAttentionSchema>;
  config?: z.infer<typeof threadConfigSchema>;
  /** Effective launch-time config after plugin and global MCP policy is applied. */
  launchConfig?: z.infer<typeof threadConfigSchema>;
  sessionRef?: z.infer<typeof sessionRefSchema>;
  canResumeWithConfig: boolean;
  errorMessage?: string;
  threadStatusSource?: ThreadStatusSource;
  presentationMode?: ThreadPresentationMode;
  slashCommands?: z.infer<typeof agentSlashCommandSchema>[];
}

export interface TerminalShellSnapshot {
  terminalId: string;
  projectLocation: z.infer<typeof projectLocationSchema>;
  worktreePath?: string;
  outputLength: number;
}

export const terminalSizeSchema = z.object({
  cols: z.number().int().min(20).max(400),
  rows: z.number().int().min(5).max(200),
});
export type TerminalSize = z.infer<typeof terminalSizeSchema>;

/** Fallback PTY geometry used when a terminal is launched before its surface has measured. */
export const DEFAULT_TERMINAL_SIZE: TerminalSize = { cols: 120, rows: 30 };

export const promptSegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), content: z.string() }),
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("attachment"), path: z.string(), mimeType: z.string().optional() }),
  z.object({
    kind: z.literal("diff_comment"),
    path: z.string().min(1),
    lineNumber: z.number().int().positive(),
    side: z.enum(["old", "new"]),
    staged: z.boolean(),
    body: z.string().min(1),
  }),
  z.object({
    kind: z.literal("skill"),
    name: z.string().min(1),
    /**
     * Absolute path to the skill's SKILL.md. Absent for provider-native skills
     * the agent resolves by name (e.g. Claude's bundled skills reported through
     * the SDK), which have no on-disk file the app can read. Consumers must
     * treat a missing path as "nothing to read/inline/policy-match".
     */
    path: z.string().min(1).optional(),
    invocation: z.string().min(1),
    provider: z.string().min(1),
    scope: z.enum(["global", "project"]),
    pluginId: z.string().min(1).optional(),
    pluginName: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("mcp"), id: z.string().min(1), name: z.string().min(1) }),
]);
export type PromptSegment = z.infer<typeof promptSegmentSchema>;

export const startThreadPayloadSchema = z.object({
  threadId: z.string().min(1).optional(),
  projectLocation: projectLocationSchema,
  agentKind: agentKindSchema,
  agentInstanceId: agentInstanceIdSchema.optional(),
  config: threadConfigSchema,
  prompt: z.string().default(""),
  segments: z.array(promptSegmentSchema).optional(),
  initialSize: terminalSizeSchema,
  sessionRef: sessionRefSchema.optional(),
  presentationMode: threadPresentationModeSchema.optional(),
  /**
   * Launch-time explicit third-party account (an `openai-compatible` usage
   * account id validated through the real Responses/Chat probe). The
   * supervisor MUST bypass the subscription Account Pool for it and project
   * the third-party credential into the harness instead. Absent = legacy
   * pool/ambient path, unchanged. Never a subscription account id.
   */
  thirdPartyAccountId: z.string().min(1).optional(),
  /** Enabled custom MCP servers resolved by the renderer at launch time. */
  mcpServers: mcpServerListSchema.optional(),
  /** Built-in MCP ids hard-disabled when this launch snapshot was created. */
  disabledBuiltInMcpServerIds: z.array(z.enum(BUILT_IN_MCP_SERVER_IDS)).optional(),
  /** Supervisor-owned restrictions that must survive every restart of this thread. */
  invariantDisabledBuiltInMcpServerIds: z.array(z.enum(BUILT_IN_MCP_SERVER_IDS)).optional(),
  disabledBuiltInMcpTools: builtInMcpDisabledToolsSchema.optional(),
  /**
   * Renderer-allocated id for the user_message item the chat pane has already
   * painted optimistically. The supervisor reuses this id when emitting its
   * own canonical user_message events, so the renderer's per-id dedupe drops
   * the duplicate. Only set for GUI threads with a fresh prompt.
   */
  userMessageItemId: z.string().min(1).optional(),
  /**
   * Fallback goal block for the launch turn only. Same semantics as
   * {@link sendThreadInputPayloadSchema.goalContext}.
   */
  goalContext: z.string().min(1).optional(),
});
export type StartThreadPayload = z.infer<typeof startThreadPayloadSchema>;

export interface StartThreadResult {
  threadId: string;
}

export const sendThreadInputPayloadSchema = z.object({
  threadId: z.string().min(1),
  prompt: z.string().min(1),
  segments: z.array(promptSegmentSchema).optional(),
  config: threadConfigSchema,
  /** See {@link startThreadPayloadSchema.userMessageItemId}. */
  userMessageItemId: z.string().min(1).optional(),
  execution: runtimeExecutionEnvelopeSchema.optional(),
  /**
   * Fallback goal block for THIS turn only, prepended to the SENT prompt
   * (never painted as a user message — mirrors `historyPreface`). The
   * renderer re-sends it every turn while `thread.goal` is active; the
   * supervisor keeps no goal state. Omitted for native-goal threads.
   */
  goalContext: z.string().min(1).optional(),
});
export type SendThreadInputPayload = z.infer<typeof sendThreadInputPayloadSchema>;

export const interruptThreadPayloadSchema = z.object({
  threadId: z.string().min(1),
  execution: runtimeExecutionEnvelopeSchema.optional(),
});
export type InterruptThreadPayload = z.infer<typeof interruptThreadPayloadSchema>;

const goalObjectiveSchema = z.string().trim().min(1);

export const threadGoalControlSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), objective: goalObjectiveSchema }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("clear") }),
]);
export type ThreadGoalControl = z.infer<typeof threadGoalControlSchema>;

export const controlThreadGoalPayloadSchema = threadGoalControlSchema.and(
  z.object({ threadId: z.string().min(1) }),
);
export type ControlThreadGoalPayload = z.infer<typeof controlThreadGoalPayloadSchema>;

export const rollbackThreadConversationPayloadSchema = z.object({
  threadId: z.string().min(1),
  numTurns: z.number().int().min(0),
  config: threadConfigSchema.optional(),
});
export type RollbackThreadConversationPayload = z.infer<
  typeof rollbackThreadConversationPayloadSchema
>;

export const setPendingSteerPayloadSchema = z.object({
  threadId: z.string().min(1),
  prompt: z.string().min(1),
  segments: z.array(promptSegmentSchema).optional(),
  config: threadConfigSchema,
  execution: runtimeExecutionEnvelopeSchema.optional(),
});
export type SetPendingSteerPayload = z.infer<typeof setPendingSteerPayloadSchema>;

export const clearPendingSteerPayloadSchema = z.object({
  threadId: z.string().min(1),
  execution: runtimeExecutionEnvelopeSchema.optional(),
});
export type ClearPendingSteerPayload = z.infer<typeof clearPendingSteerPayloadSchema>;

/**
 * Renderer-visible representation of the single staged steer message that
 * sits in the supervisor between user submit-while-working and the agent
 * acknowledging the cancel. `null` (in IPC) clears the slot.
 */
export interface PendingSteerState {
  /** Stable id allocated by the supervisor at stage time. */
  id: string;
  /** Plaintext preview shown in the composer strip. */
  prompt: string;
  /** Optional structured segments (attachments, files, mentions). */
  segments?: PromptSegment[];
  /** Wall-clock timestamp the slot was staged or last edited. */
  stagedAt: number;
}

/**
 * Thread-metadata mutation issued by a remote client (the mobile PWA). Thread
 * metadata is owned by the desktop renderer's store (which persists it via
 * `dbSyncAll`), so these commands are forwarded main → renderer and applied
 * through the regular thread actions instead of writing to the DB directly.
 */
export const remoteThreadCommandSchema = z.discriminatedUnion("kind", [
  /**
   * Host lifecycle preflight for a freshly-created worktree. The paired
   * desktop enqueues setup before the host launches the thread. Keeping this
   * separate from `start` prevents the post-launch metadata mirror from
   * enqueueing setup a second time.
   */
  z.object({
    kind: z.literal("prepare-worktree"),
    threadId: z.string().min(1),
    projectId: z.string().min(1),
    worktreePath: z.string().min(1),
  }),
  z.object({
    kind: z.literal("start"),
    threadId: z.string().min(1),
    projectId: z.string().min(1),
    agentKind: agentKindSchema,
    agentInstanceId: agentInstanceIdSchema.optional(),
    config: threadConfigSchema,
    prompt: z.string(),
    /**
     * Explicit thread title (e.g. an orchestrator-provided ticket key). When
     * present the renderer uses it verbatim and skips AI title generation;
     * otherwise the title is derived from the prompt.
     */
    title: z.string().min(1).optional(),
    segments: z.array(promptSegmentSchema).optional(),
    presentationMode: threadPresentationModeSchema.optional(),
    userMessageItemId: z.string().min(1).optional(),
    worktreePath: z.string().min(1).optional(),
    worktreeBranch: z.string().optional(),
    prNumber: z.number().int().min(1).optional(),
    isNewWorktree: z.boolean().optional(),
    /**
     * Desktop-renderer hint. Remote clients send `start` to the HTTP server;
     * the server creates metadata and launches the supervisor directly, then
     * forwards the command with this set to false so the renderer mirrors the
     * row without launching the same session again.
     */
    launchRuntime: z.boolean().optional(),
    /**
     * Desktop-renderer hint. `false` mirrors the thread row without switching
     * the active view to it — used by orchestrator-created child threads so a
     * fan-out of `create_thread` calls doesn't steal the user's focus.
     * Omitted/`true` keeps the existing focus-switch behavior.
     */
    focus: z.boolean().optional(),
    /**
     * Id of the orchestrator thread that created this thread (see
     * {@link threadSchema}'s `parentThreadId`).
     */
    parentThreadId: z.string().min(1).optional(),
    /**
     * Sidebar group the new thread belongs to (orchestrator children join a
     * group shared with their parent so families render together).
     */
    groupId: z.string().min(1).optional(),
    groupName: z.string().min(1).optional(),
  }),
  // Assigns an existing thread to a sidebar group. Used to pull an
  // orchestrator parent into the group its children are created in; the
  // renderer owns thread metadata, so this routes through its store like the
  // other metadata commands instead of writing the DB directly.
  z.object({
    kind: z.literal("set-group"),
    threadId: z.string().min(1),
    groupId: z.string().min(1),
    groupName: z.string().min(1),
  }),
  z.object({ kind: z.literal("rename"), threadId: z.string().min(1), title: z.string().min(1) }),
  z.object({ kind: z.literal("acknowledge"), threadId: z.string().min(1) }),
  z.object({ kind: z.literal("set-done"), threadId: z.string().min(1), done: z.boolean() }),
  z.object({
    kind: z.literal("set-starred"),
    threadId: z.string().min(1),
    starred: z.boolean(),
  }),
  // Tags a remotely-started thread with its worktree so it groups under that
  // worktree. The supervisor launches in the dir (via projectLocation) but
  // never records this metadata; the desktop renderer owns it. `isNewWorktree`
  // means the remote client just created the worktree, so the desktop should
  // also prime its git state and run the project setup script (parity with a
  // local "new thread in worktree").
  z.object({
    kind: z.literal("set-worktree"),
    threadId: z.string().min(1),
    worktreePath: z.string().min(1),
    worktreeBranch: z.string().optional(),
    isNewWorktree: z.boolean().optional(),
  }),
  // Removes a worktree group from a remote client. The desktop renderer handles
  // this through its existing worktree cleanup path so scripts, terminals,
  // linked threads, git state, and persistence stay consistent with desktop.
  z.object({
    kind: z.literal("delete-worktree-group"),
    threadId: z.string().min(1),
    projectId: z.string().min(1),
    worktreePath: z.string().min(1),
    threadIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({ kind: z.literal("archive"), threadId: z.string().min(1) }),
  z.object({ kind: z.literal("unarchive"), threadId: z.string().min(1) }),
  z.object({ kind: z.literal("delete"), threadId: z.string().min(1) }),
]);
export type RemoteThreadCommand = z.infer<typeof remoteThreadCommandSchema>;

export const writeTerminalPayloadSchema = z.object({
  threadId: z.string().min(1),
  data: z.string().min(1),
});
export type WriteTerminalPayload = z.infer<typeof writeTerminalPayloadSchema>;

/**
 * Type text into a terminal-native thread's PTY input line WITHOUT submitting
 * it (no trailing carriage return). Used to route a browser element-picker
 * selection straight into a CLI agent's input so the user can review/extend it
 * before pressing Enter. `segments` is formatted through the adapter (so image
 * attachments become `@path` references and WSL paths are rewritten) and then
 * collapsed to a single line to avoid an accidental newline submit.
 */
export const stageThreadInputPayloadSchema = z.object({
  threadId: z.string().min(1),
  prompt: z.string(),
  segments: z.array(promptSegmentSchema).optional(),
});
export type StageThreadInputPayload = z.infer<typeof stageThreadInputPayloadSchema>;

export const resizeTerminalPayloadSchema = terminalSizeSchema.extend({
  threadId: z.string().min(1),
});
export type ResizeTerminalPayload = z.infer<typeof resizeTerminalPayloadSchema>;

export const closeThreadPayloadSchema = z.object({
  threadId: z.string().min(1),
  execution: runtimeExecutionEnvelopeSchema.optional(),
});
export type CloseThreadPayload = z.infer<typeof closeThreadPayloadSchema>;

/**
 * Switch a live logical thread to another harness/model without creating a
 * new user-visible thread. The supervisor prepares the new provider runtime
 * first, then replaces the active binding (never resumes the old sessionRef
 * cross-harness). Failure leaves the original session in place. The next
 * user turn carries the transcript preface. Returns the new binding so the
 * renderer can update the Thread row and record history.
 */
export const switchThreadProviderPayloadSchema = z.object({
  threadId: z.string().min(1),
  agentKind: agentKindSchema,
  config: threadConfigSchema,
  execution: runtimeExecutionEnvelopeSchema.optional(),
  /**
   * Launch-time explicit third-party account (same semantics as
   * {@link startThreadPayloadSchema.thirdPartyAccountId}). Model switches
   * onto a custom third-party model must carry it, or the rebuilt session
   * falls back to the native pool with an unresolvable custom model id.
   */
  thirdPartyAccountId: z.string().min(1).optional(),
});
export type SwitchThreadProviderPayload = z.infer<typeof switchThreadProviderPayloadSchema>;

export const switchThreadProviderResultSchema = z.object({
  threadId: z.string(),
  agentKind: agentKindSchema,
  sessionRef: sessionRefSchema.optional(),
  poolAccountId: z.string().min(1).optional(),
  poolProvider: z.string().min(1).optional(),
  canResumeWithConfig: z.boolean(),
});
export type SwitchThreadProviderResult = z.infer<typeof switchThreadProviderResultSchema>;

/** One native-session path lookup (copy menu / archive audit). */
export const nativeSessionPathQuerySchema = z.object({
  harness: z.string().min(1),
  model: z.string().optional(),
  nativeSessionId: z.string().min(1).optional(),
  poolAccountId: z.string().min(1).optional(),
});
export type NativeSessionPathQuery = z.infer<typeof nativeSessionPathQuerySchema>;

export const nativeSessionPathResultSchema = nativeSessionPathQuerySchema.extend({
  path: z.string().nullable(),
});
export type NativeSessionPathResult = z.infer<typeof nativeSessionPathResultSchema>;

export const nativeSessionPathQueryListSchema = z.array(nativeSessionPathQuerySchema);
export const nativeSessionPathResultListSchema = z.array(nativeSessionPathResultSchema);

export const threadServerRequestIdSchema = z.union([z.string().min(1), z.number()]);
export type ThreadServerRequestId = z.infer<typeof threadServerRequestIdSchema>;

export const resolveThreadServerRequestPayloadSchema = z.object({
  threadId: z.string().min(1),
  requestId: threadServerRequestIdSchema,
  method: z.string().min(1),
  response: z.unknown(),
  execution: runtimeExecutionEnvelopeSchema.optional(),
});
export type ResolveThreadServerRequestPayload = z.infer<
  typeof resolveThreadServerRequestPayloadSchema
>;

export const startShellPayloadSchema = z.object({
  shellId: z.string().min(1),
  projectLocation: projectLocationSchema,
  worktreePath: z.string().min(1).optional(),
  initialSize: terminalSizeSchema.optional(),
  /**
   * Start the shell in the user's home directory instead of the project path.
   * Used by one-shot installers that shouldn't run inside a (possibly
   * ephemeral) worktree.
   */
  startInHome: z.boolean().optional(),
  /**
   * Supervisor-only working directory override. Used by managed Codex login so
   * the official CLI cannot pick up the host ~/.codex Codex-Router overlay.
   */
  cwdOverride: z.string().min(1).optional(),
  /**
   * Native Windows shells default to the user's interactive preference.
   * Login/install overlays emit PowerShell, so they request a PowerShell host
   * even when the preferred interactive shell is cmd.
   */
  windowsShellRuntime: z.enum(["preferred", "powershell"]).optional(),
});
export type StartShellPayload = z.infer<typeof startShellPayloadSchema>;
