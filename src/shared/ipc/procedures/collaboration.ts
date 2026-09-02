import { z } from "zod";
import type { ThreadExchangeView, ThreadTargetSummary } from "../../threadCollaboration";
import {
  cancelThreadExchangePayloadSchema,
  listThreadCollaborationTargetsPayloadSchema,
  listThreadExchangesPayloadSchema,
  readThreadExchangePayloadSchema,
  threadDialogueRequestSchema,
  waitForThreadExchangePayloadSchema,
} from "../../threadCollaboration";
import { definePayloadProcedure } from "../core";

const actorSchema = z.object({ actorThreadId: z.string().min(1) });

export const collaborationProcedures = {
  listThreadCollaborationTargets: definePayloadProcedure<
    z.infer<typeof listThreadCollaborationTargetsPayloadSchema>,
    ThreadTargetSummary[],
    "main-local"
  >("listThreadCollaborationTargets", "main-local", listThreadCollaborationTargetsPayloadSchema),
  requestThreadDialogue: definePayloadProcedure<
    z.infer<typeof threadDialogueRequestSchema>,
    ThreadExchangeView,
    "main-local"
  >("requestThreadDialogue", "main-local", threadDialogueRequestSchema),
  listThreadExchanges: definePayloadProcedure<
    z.infer<typeof listThreadExchangesPayloadSchema> & { actorThreadId: string },
    ThreadExchangeView[],
    "main-local"
  >("listThreadExchanges", "main-local", listThreadExchangesPayloadSchema.and(actorSchema)),
  readThreadExchange: definePayloadProcedure<
    z.infer<typeof readThreadExchangePayloadSchema> & { actorThreadId: string },
    ThreadExchangeView,
    "main-local"
  >("readThreadExchange", "main-local", readThreadExchangePayloadSchema.and(actorSchema)),
  waitForThreadExchange: definePayloadProcedure<
    z.infer<typeof waitForThreadExchangePayloadSchema> & { actorThreadId: string },
    { timedOut: boolean; exchange: ThreadExchangeView },
    "main-local"
  >("waitForThreadExchange", "main-local", waitForThreadExchangePayloadSchema.and(actorSchema)),
  cancelThreadExchange: definePayloadProcedure<
    z.infer<typeof cancelThreadExchangePayloadSchema> & { actorThreadId: string },
    ThreadExchangeView,
    "main-local"
  >("cancelThreadExchange", "main-local", cancelThreadExchangePayloadSchema.and(actorSchema)),
} as const;
