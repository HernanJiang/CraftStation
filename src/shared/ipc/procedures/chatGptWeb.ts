import { defineNoArgProcedure, definePayloadProcedure } from "../core";
import {
  webChatIdSchema,
  webChatSendSchema,
  webChatImportSchema,
  webChatDeleteSchema,
  webChatReasoningSchema,
  type WebChatSession,
  type WebChatConversation,
  type WebChatReasoning,
} from "../../chatGptWeb";
import type { z } from "zod";

type Id = z.infer<typeof webChatIdSchema>;
export const chatGptWebProcedures = {
  webChatList: defineNoArgProcedure<WebChatSession[], "main-local">("webChatList", "main-local"),
  webChatCreate: defineNoArgProcedure<WebChatSession, "main-local">("webChatCreate", "main-local"),
  webChatRead: definePayloadProcedure<Id, WebChatSession, "main-local">(
    "webChatRead",
    "main-local",
    webChatIdSchema,
  ),
  webChatReveal: definePayloadProcedure<Id, void, "main-local">(
    "webChatReveal",
    "main-local",
    webChatIdSchema,
  ),
  webChatSend: definePayloadProcedure<
    z.infer<typeof webChatSendSchema>,
    WebChatSession,
    "main-local"
  >("webChatSend", "main-local", webChatSendSchema),
  webChatStop: definePayloadProcedure<Id, WebChatSession, "main-local">(
    "webChatStop",
    "main-local",
    webChatIdSchema,
  ),
  webChatDiscover: definePayloadProcedure<Id, WebChatConversation[], "main-local">(
    "webChatDiscover",
    "main-local",
    webChatIdSchema,
  ),
  webChatImport: definePayloadProcedure<
    z.infer<typeof webChatImportSchema>,
    WebChatSession,
    "main-local"
  >("webChatImport", "main-local", webChatImportSchema),
  webChatDelete: definePayloadProcedure<z.infer<typeof webChatDeleteSchema>, void, "main-local">(
    "webChatDelete",
    "main-local",
    webChatDeleteSchema,
  ),
  webChatReasoning: definePayloadProcedure<Id, WebChatReasoning, "main-local">(
    "webChatReasoning",
    "main-local",
    webChatIdSchema,
  ),
  webChatSetReasoning: definePayloadProcedure<
    z.infer<typeof webChatReasoningSchema>,
    WebChatSession,
    "main-local"
  >("webChatSetReasoning", "main-local", webChatReasoningSchema),
};
