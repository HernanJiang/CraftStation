import { z } from "zod";

import { accountBindingSchema } from "./contracts/accountBinding";
import { projectLocationSchema } from "./contracts/common";
import {
  compositionProvenanceSchema,
  craftPlanSchema,
  runtimeBindingSchema,
} from "./crafting/types";

export const runtimeSegmentStatusSchema = z.enum([
  "preparing",
  "active",
  "inactive",
  "failed",
  "rolled_back",
  "terminated",
]);
export type RuntimeSegmentStatus = z.infer<typeof runtimeSegmentStatusSchema>;

export const runtimeExecutionEnvelopeSchema = z.object({
  segmentId: z.string().min(1),
  runtimeSessionId: z.string().min(1),
  bindingEpoch: z.number().int().positive(),
  eventSequence: z.number().int().nonnegative().optional(),
});
export type RuntimeExecutionEnvelope = z.infer<typeof runtimeExecutionEnvelopeSchema>;

export const runtimeSegmentSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  bindingEpoch: z.number().int().positive(),
  status: runtimeSegmentStatusSchema,
  craftPlanId: z.string().min(1),
  recipeId: z.string().min(1),
  resultItemId: z.string().min(1),
  runtimeBinding: runtimeBindingSchema,
  entityId: z.string().min(1).optional(),
  runtimeSessionId: z.string().min(1).optional(),
  nativeSessionRef: z.string().min(1).optional(),
  predecessorSegmentId: z.string().min(1).optional(),
  checkpointId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  activatedAt: z.string().datetime().optional(),
  deactivatedAt: z.string().datetime().optional(),
  failureCode: z.string().min(1).optional(),
});
export type RuntimeSegment = z.infer<typeof runtimeSegmentSchema>;

const checkpointMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  itemId: z.string().min(1),
});

export const conversationCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  threadId: z.string().min(1),
  sourceSegmentId: z.string().min(1),
  sourceRuntimeSessionId: z.string().min(1).optional(),
  sourceNativeSessionRef: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  taskSummary: z.string(),
  currentState: z.string(),
  importantDecisions: z.array(z.string()),
  importantResults: z.array(z.string()),
  workspaceChanges: z.array(z.string()),
  recentCompletedMessages: z.array(checkpointMessageSchema),
  anchors: z.object({
    firstIncludedItemId: z.string().min(1).optional(),
    lastIncludedItemId: z.string().min(1).optional(),
    lastCompletedTurnAnchorItemId: z.string().min(1).optional(),
  }),
  projection: z.object({
    policy: z.literal("summary-state-results-recent-turns"),
    maxCharacters: z.number().int().positive(),
    maxRecentMessages: z.number().int().positive(),
    truncated: z.boolean(),
    redactions: z.number().int().nonnegative(),
  }),
  provenance: z.object({
    recipeId: z.string().min(1),
    craftPlanId: z.string().min(1),
    modelId: z.string().min(1),
    harnessKind: z.string().min(1),
  }),
});
export type ConversationCheckpoint = z.infer<typeof conversationCheckpointSchema>;

export const sessionSwitchModeSchema = z.enum(["after-current-turn", "abort-current-turn"]);
export type SessionSwitchMode = z.infer<typeof sessionSwitchModeSchema>;

export const sessionSwitchPhaseSchema = z.enum([
  "queued",
  "interrupting_source",
  "preparing",
  "checkpointed",
  "target_starting",
  "target_ready",
  "activating",
  "active",
  "rolling_back",
  "rolled_back",
  "failed",
  "cancelled",
]);
export type SessionSwitchPhase = z.infer<typeof sessionSwitchPhaseSchema>;

export const sessionSwitchDiagnosticSchema = z.object({
  correlationId: z.string().min(1),
  phase: sessionSwitchPhaseSchema,
  operation: z.string().min(1),
  code: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
  rollback: z.enum(["not-required", "succeeded", "failed"]).optional(),
});
export type SessionSwitchDiagnostic = z.infer<typeof sessionSwitchDiagnosticSchema>;

export const sessionSwitchStateSchema = z.object({
  requestId: z.string().min(1),
  threadId: z.string().min(1),
  mode: sessionSwitchModeSchema,
  phase: sessionSwitchPhaseSchema,
  sourceSegmentId: z.string().min(1),
  targetSegmentId: z.string().min(1).optional(),
  targetBinding: runtimeBindingSchema,
  /** Exact immutable target plan retained for crash-safe native Session recovery. */
  targetCraftPlan: craftPlanSchema.optional(),
  /** Renderer-facing provenance used to persist the new current combination. */
  targetProvenance: compositionProvenanceSchema.optional(),
  /** Present only after checkpoint bootstrap and target activation completed. */
  activeSegment: runtimeSegmentSchema.optional(),
  activeAccountBinding: accountBindingSchema.optional(),
  requestedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  diagnostic: sessionSwitchDiagnosticSchema.optional(),
});
export type SessionSwitchState = z.infer<typeof sessionSwitchStateSchema>;

export const requestSessionSwitchPayloadSchema = z.object({
  threadId: z.string().min(1),
  projectLocation: projectLocationSchema,
  targetCraftPlan: craftPlanSchema,
  targetProvenance: compositionProvenanceSchema.optional(),
  mode: sessionSwitchModeSchema,
  prompt: z.string().default(""),
  accountId: z.string().min(1).optional(),
  accountMode: z.enum(["explicit", "preferred", "selected", "auto"]).optional(),
});
export type RequestSessionSwitchPayload = z.infer<typeof requestSessionSwitchPayloadSchema>;

export const cancelSessionSwitchPayloadSchema = z.object({
  threadId: z.string().min(1),
  requestId: z.string().min(1),
});
export type CancelSessionSwitchPayload = z.infer<typeof cancelSessionSwitchPayloadSchema>;

export const readSessionSwitchStatePayloadSchema = z.object({ threadId: z.string().min(1) });
export type ReadSessionSwitchStatePayload = z.infer<typeof readSessionSwitchStatePayloadSchema>;

export const sessionSwitchResultSchema = z.object({
  requestId: z.string().min(1),
  disposition: z.enum(["queued", "activated", "rolled_back", "failed"]),
  state: sessionSwitchStateSchema,
});
export type SessionSwitchResult = z.infer<typeof sessionSwitchResultSchema>;
