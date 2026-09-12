import { z } from "zod";

export const THREAD_COLLABORATION_MAX_HOP_DEPTH = 4;
export const THREAD_COLLABORATION_MAX_QUEUED_PER_SOURCE = 8;
export const THREAD_COLLABORATION_MAX_REQUEST_CHARS = 50_000;
export const THREAD_COLLABORATION_CONTEXT_BUDGET_CHARS = 12_000;
export const THREAD_COLLABORATION_REPLY_EXCERPT_CHARS = 8_000;

export const threadExchangeStatusSchema = z.enum([
  "created",
  "queued",
  "delivering",
  "delivered",
  "target_working",
  "needs_attention",
  "replied",
  "cancelling",
  "cancelled",
  "failed",
  "timed_out",
]);
export type ThreadExchangeStatus = z.infer<typeof threadExchangeStatusSchema>;

export const threadDeliveryModeSchema = z.enum(["after-current-turn", "interrupt-and-send"]);
export type ThreadDeliveryMode = z.infer<typeof threadDeliveryModeSchema>;

export const threadCollaborationErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().default(false),
});
export type ThreadCollaborationError = z.infer<typeof threadCollaborationErrorSchema>;

export const threadRuntimeProvenanceSchema = z.object({
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  modelId: z.string().min(1),
  harnessId: z.string().min(1),
  recipeId: z.string().min(1).optional(),
  craftPlanId: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  nativeSessionId: z.string().min(1).optional(),
  segmentId: z.string().min(1).optional(),
  runtimeEpoch: z.number().int().nonnegative().optional(),
  worktreePath: z.string().min(1).optional(),
  agentMcpSupported: z.boolean(),
});
export type ThreadRuntimeProvenance = z.infer<typeof threadRuntimeProvenanceSchema>;

export const threadContextCapsuleSchema = z.object({
  kind: z.literal("portable-context"),
  text: z.string().max(THREAD_COLLABORATION_CONTEXT_BUDGET_CHARS),
  sourceKinds: z.array(z.enum(["selected-message", "summary", "state", "recent-turn"])),
  redacted: z.boolean(),
  originalChars: z.number().int().nonnegative(),
});
export type ThreadContextCapsule = z.infer<typeof threadContextCapsuleSchema>;

export const threadContextSelectionSchema = z
  .object({
    selectedMessages: z.array(z.string()).max(20).optional(),
    summary: z.string().optional(),
    state: z.string().optional(),
    recentCompletedTurns: z.array(z.string()).max(8).optional(),
  })
  .optional();
export type ThreadContextSelection = z.infer<typeof threadContextSelectionSchema>;

export const threadDialogueRequestSchema = z.object({
  sourceThreadId: z.string().min(1),
  targetThreadId: z.string().min(1),
  request: z.string().trim().min(1).max(THREAD_COLLABORATION_MAX_REQUEST_CHARS),
  deliveryMode: threadDeliveryModeSchema.default("after-current-turn"),
  idempotencyKey: z.string().min(1).max(200),
  context: threadContextSelectionSchema,
  conversationLinkId: z.string().min(1).optional(),
  causalParentExchangeId: z.string().min(1).optional(),
  hopDepth: z.number().int().min(0).max(THREAD_COLLABORATION_MAX_HOP_DEPTH).default(0),
});
export type ThreadDialogueRequest = z.infer<typeof threadDialogueRequestSchema>;

export const threadConversationLinkSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  participantAThreadId: z.string().min(1),
  participantBThreadId: z.string().min(1),
  status: z.enum(["active", "closed"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type ThreadConversationLink = z.infer<typeof threadConversationLinkSchema>;

export const threadExchangeSchema = z.object({
  id: z.string().min(1),
  linkId: z.string().min(1),
  projectId: z.string().min(1),
  sourceThreadId: z.string().min(1),
  targetThreadId: z.string().min(1),
  sequence: z.number().int().positive(),
  deliveryMode: threadDeliveryModeSchema,
  status: threadExchangeStatusSchema,
  request: z.string(),
  contextCapsule: threadContextCapsuleSchema.nullable(),
  sourceProvenance: threadRuntimeProvenanceSchema,
  targetProvenance: threadRuntimeProvenanceSchema,
  idempotencyKey: z.string().min(1),
  requestItemId: z.string().min(1),
  deliveryBaselineTurnIndex: z.number().int().nonnegative().nullable(),
  deliveryAnchorItemId: z.string().nullable(),
  replyTurnIndex: z.number().int().nonnegative().nullable(),
  replyAnchorItemId: z.string().nullable(),
  replyExcerpt: z.string().nullable(),
  causalParentExchangeId: z.string().nullable(),
  hopDepth: z.number().int().nonnegative(),
  error: threadCollaborationErrorSchema.nullable(),
  claimToken: z.string().nullable(),
  claimExpiresAt: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  deliveredAt: z.string().nullable(),
  repliedAt: z.string().nullable(),
});
export type ThreadExchange = z.infer<typeof threadExchangeSchema>;

/** Renderer/remote-safe projection of an exchange. Durable delivery internals
 * and full request/context text stay inside the main-process module. */
export const threadExchangeViewSchema = threadExchangeSchema.omit({
  request: true,
  contextCapsule: true,
  idempotencyKey: true,
  claimToken: true,
  claimExpiresAt: true,
});
export type ThreadExchangeView = z.infer<typeof threadExchangeViewSchema>;

export function toThreadExchangeView(exchange: ThreadExchange): ThreadExchangeView {
  return threadExchangeViewSchema.parse(exchange);
}

export const threadTargetSummarySchema = z.object({
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  status: z.string().min(1),
  attention: z.string().min(1),
  provenance: threadRuntimeProvenanceSchema,
  sameWorktree: z.boolean(),
  crossWorktreeWarning: z.string().optional(),
  available: z.boolean(),
  /** True when the target's resolved Model AND Harness both match the source
   * and the two sides are not provably distinct native threads; such a
   * target is not selectable for cross-thread dialogue. Defaults so a
   * summary produced by an older host still parses on a newer client. */
  sameComposition: z.boolean().default(false),
});
export type ThreadTargetSummary = z.infer<typeof threadTargetSummarySchema>;

/** A target is selectable iff it is runtime-ready and not the same effective
 * peer as the source (different Model, different Harness, or a provably
 * distinct native session — see the service policy). */
export function isSelectableThreadTarget(
  target: Pick<ThreadTargetSummary, "available" | "sameComposition">,
): boolean {
  return target.available && !target.sameComposition;
}

export const listThreadCollaborationTargetsPayloadSchema = z.object({
  sourceThreadId: z.string().min(1),
  query: z.string().trim().max(200).optional(),
});

export const readThreadExchangePayloadSchema = z.object({ exchangeId: z.string().min(1) });

export const waitForThreadExchangePayloadSchema = z.object({
  exchangeId: z.string().min(1),
  afterUpdatedAt: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(0).max(120_000).default(30_000),
});

export const cancelThreadExchangePayloadSchema = z.object({ exchangeId: z.string().min(1) });

export const listThreadExchangesPayloadSchema = z.object({
  threadId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(30),
});
