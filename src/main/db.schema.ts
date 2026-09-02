import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  locationKind: text("location_kind").notNull(), // "windows" | "wsl" | "posix"
  locationPath: text("location_path"), // for windows/posix
  locationDistro: text("location_distro"), // for wsl
  locationLinuxPath: text("location_linux_path"), // for wsl
  locationUncPath: text("location_unc_path"), // for wsl
  lastDraftConfig: text("last_draft_config"), // JSON
  scripts: text("scripts"), // JSON
  searchSettings: text("search_settings"), // JSON
  worktreeLocation: text("worktree_location"), // JSON
  mcpServers: text("mcp_servers"), // JSON
  ghAccount: text("gh_account"), // JSON
  workspaceId: text("workspace_id"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  agentKind: text("agent_kind").notNull(), // provider kind
  /** Optional id of a user-registered ACP instance backing this thread. */
  agentInstanceId: text("agent_instance_id"),
  config: text("config").notNull(), // JSON
  status: text("status").notNull(),
  attention: text("attention").notNull(),
  threadStatusSource: text("thread_status_source"), // "cli_hook" | "terminal_parse" | "server"
  canResumeWithConfig: integer("can_resume_with_config", { mode: "boolean" })
    .notNull()
    .default(false),
  sessionRef: text("session_ref"), // JSON
  compositionProvenance: text("composition_provenance"), // JSON
  /** Immutable account binding captured when a composed Codex session starts. */
  accountBinding: text("account_binding"), // JSON
  terminalPrompt: text("terminal_prompt"), // JSON
  worktreePath: text("worktree_path"),
  worktreeBranch: text("worktree_branch"),
  prNumber: integer("pr_number"),
  groupId: text("group_id"),
  groupName: text("group_name"),
  /** Orchestrator thread that created this one via the Crossagents MCP. */
  parentThreadId: text("parent_thread_id"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  doneAt: text("done_at"),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  /** "terminal" (xterm-backed PTY) vs "gui" (renderer-native chat). */
  presentationMode: text("presentation_mode").notNull().default("terminal"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  activeTurnStartedAt: text("active_turn_started_at"),
  lastTurnStartedAt: text("last_turn_started_at"),
  lastTurnEndedAt: text("last_turn_ended_at"),
});

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
});

export const remoteCommandReceipts = sqliteTable("remote_command_receipts", {
  commandId: text("command_id").primaryKey(),
  route: text("route").notNull(),
  state: text("state").notNull(),
  response: text("response"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const prWatches = sqliteTable(
  "pr_watches",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull(),
    headBranch: text("head_branch").notNull(),
    worktreePath: text("worktree_path"),
    watchEnabled: integer("watch_enabled", { mode: "boolean" }).notNull().default(true),
    autoMerge: integer("auto_merge", { mode: "boolean" }).notNull().default(false),
    agentKind: text("agent_kind"),
    config: text("config"),
    lastCommentCursor: text("last_comment_cursor"),
    lastReviewCommentCursor: text("last_review_comment_cursor"),
    lastReviewCursor: text("last_review_cursor"),
    lastCheckKey: text("last_check_key"),
    activeThreadId: text("active_thread_id"),
    lastError: text("last_error"),
    blockedReason: text("blocked_reason"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.prNumber] }),
  }),
);

/**
 * Per-project notes panel content. One row per project, keyed by project id.
 * `doc` holds the TipTap (ProseMirror) JSON for the free-form notes editor;
 * `todos` holds the structured to-do list. Kept in its own table (rather than a
 * `projects` column synced via `dbSyncAll`) so editing notes does not rewrite
 * the entire projects+threads snapshot on every keystroke. Orphan rows are
 * cleaned up explicitly on project deletion (see db.ts), so no FK is declared —
 * this avoids an insert/sync ordering race for a brand-new project.
 */
export const projectNotes = sqliteTable("project_notes", {
  projectId: text("project_id").primaryKey(),
  doc: text("doc"), // JSON (TipTap document), nullable when empty
  todos: text("todos").notNull().default("[]"), // JSON array of NotesTodoItem
  updatedAt: text("updated_at").notNull(),
});

/**
 * Persisted canonical chat items per thread (for renderer-native chat mode).
 * Mirrors the renderer's `RuntimeChatItem` shape so we can hydrate the chat
 * UI when the user reopens a thread.
 */
export const threadRuntimeItems = sqliteTable(
  "thread_runtime_items",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    position: integer("position").notNull(),
    type: text("type").notNull(),
    state: text("state").notNull(),
    payload: text("payload"), // JSON, nullable
    streams: text("streams"), // JSON of Partial<Record<RuntimeContentStreamKind, string>>
    parentItemId: text("parent_item_id"), // sub-agent parent tool_call id, nullable
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.itemId] }),
  }),
);

/**
 * Latest provider-reported context-window usage per thread. One row per
 * thread; rewritten alongside the runtime snapshot so the indicator can
 * recover after app restart or session resume (providers only emit fresh
 * `context.updated` values on the next assistant response).
 */
export const threadContextUsage = sqliteTable("thread_context_usage", {
  threadId: text("thread_id")
    .primaryKey()
    .references(() => threads.id, { onDelete: "cascade" }),
  usage: text("usage").notNull(),
});

/**
 * Frozen per-turn timing windows. One row per completed turn (first user
 * input → thread settles back to idle), in chronological order via `idx`.
 * `anchorItemId` points at the last canonical item present when the turn
 * closed; the chat surface renders the inline "Worked for X" beneath that row.
 */
export const threadCompletedTurns = sqliteTable(
  "thread_completed_turns",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at").notNull(),
    anchorItemId: text("anchor_item_id"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.idx] }),
  }),
);

export const runtimeSegments = sqliteTable("runtime_segments", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  bindingEpoch: integer("binding_epoch").notNull(),
  status: text("status").notNull(),
  craftPlanId: text("craft_plan_id").notNull(),
  recipeId: text("recipe_id").notNull(),
  resultItemId: text("result_item_id").notNull(),
  runtimeBinding: text("runtime_binding").notNull(),
  entityId: text("entity_id"),
  runtimeSessionId: text("runtime_session_id"),
  nativeSessionRef: text("native_session_ref"),
  predecessorSegmentId: text("predecessor_segment_id"),
  checkpointId: text("checkpoint_id"),
  createdAt: text("created_at").notNull(),
  activatedAt: text("activated_at"),
  deactivatedAt: text("deactivated_at"),
  failureCode: text("failure_code"),
});

export const conversationCheckpoints = sqliteTable("conversation_checkpoints", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  sourceSegmentId: text("source_segment_id").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessionSwitchTransactions = sqliteTable("session_switch_transactions", {
  requestId: text("request_id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  phase: text("phase").notNull(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Durable one-to-one dialogue identity between two long-lived app threads. */
export const threadConversationLinks = sqliteTable(
  "thread_conversation_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    participantAThreadId: text("participant_a_thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    participantBThreadId: text("participant_b_thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    participants: uniqueIndex("idx_thread_conversation_links_participants").on(
      table.projectId,
      table.participantAThreadId,
      table.participantBThreadId,
    ),
  }),
);

/** Durable request/reply transaction and outbox claim for cross-thread dialogue. */
export const threadExchanges = sqliteTable(
  "thread_exchanges",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id")
      .notNull()
      .references(() => threadConversationLinks.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    sourceThreadId: text("source_thread_id").notNull(),
    targetThreadId: text("target_thread_id").notNull(),
    sequence: integer("sequence").notNull(),
    deliveryMode: text("delivery_mode").notNull(),
    status: text("status").notNull(),
    request: text("request").notNull(),
    contextCapsule: text("context_capsule"),
    sourceProvenance: text("source_provenance").notNull(),
    targetProvenance: text("target_provenance").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestItemId: text("request_item_id").notNull(),
    deliveryBaselineTurnIndex: integer("delivery_baseline_turn_index"),
    deliveryAnchorItemId: text("delivery_anchor_item_id"),
    replyTurnIndex: integer("reply_turn_index"),
    replyAnchorItemId: text("reply_anchor_item_id"),
    replyExcerpt: text("reply_excerpt"),
    causalParentExchangeId: text("causal_parent_exchange_id"),
    hopDepth: integer("hop_depth").notNull(),
    error: text("error"),
    claimToken: text("claim_token"),
    claimExpiresAt: text("claim_expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deliveredAt: text("delivered_at"),
    repliedAt: text("replied_at"),
  },
  (table) => ({
    sourceIdempotency: uniqueIndex("idx_thread_exchanges_source_idempotency").on(
      table.sourceThreadId,
      table.idempotencyKey,
    ),
    linkSequenceUnique: uniqueIndex("idx_thread_exchanges_link_sequence_unique").on(
      table.linkId,
      table.sequence,
    ),
    targetStatusSequence: index("idx_thread_exchanges_target_status_sequence").on(
      table.targetThreadId,
      table.status,
      table.sequence,
    ),
    sourceUpdated: index("idx_thread_exchanges_source_updated").on(
      table.sourceThreadId,
      table.updatedAt,
    ),
    linkSequence: index("idx_thread_exchanges_link_sequence").on(table.linkId, table.sequence),
  }),
);
