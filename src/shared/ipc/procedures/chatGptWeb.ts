import { defineNoArgProcedure, definePayloadProcedure } from "../core";
import {
  webChatIdSchema,
  webChatReadSchema,
  webChatRenameSchema,
  webChatRefreshSchema,
  webChatSendSchema,
  webChatImportSchema,
  webChatDeleteSchema,
  webChatReasoningSchema,
  webChatWidgetRequestSchema,
  webChatWidgetInputSchema,
  type WebChatWidgetFrame,
  type WebChatSession,
  type WebChatConversation,
  type WebChatReasoning,
} from "../../chatGptWeb";
import type { z } from "zod";

type Id = z.infer<typeof webChatIdSchema>;
export const chatGptWebProcedures = {
  webChatWidgetFrame: definePayloadProcedure<
    z.infer<typeof webChatWidgetRequestSchema>,
    WebChatWidgetFrame,
    "main-local"
  >("webChatWidgetFrame", "main-local", webChatWidgetRequestSchema),
  webChatWidgetInput: definePayloadProcedure<
    z.infer<typeof webChatWidgetInputSchema>,
    void,
    "main-local"
  >("webChatWidgetInput", "main-local", webChatWidgetInputSchema),
  webChatWidgetClose: definePayloadProcedure<
    z.infer<typeof webChatWidgetRequestSchema>,
    void,
    "main-local"
  >("webChatWidgetClose", "main-local", webChatWidgetRequestSchema),
  webChatList: defineNoArgProcedure<WebChatSession[], "main-local">("webChatList", "main-local"),
  webChatCreate: defineNoArgProcedure<WebChatSession, "main-local">("webChatCreate", "main-local"),
  webChatOpen: definePayloadProcedure<Id, WebChatSession, "main-local">(
    "webChatOpen",
    "main-local",
    webChatIdSchema,
  ),
  webChatRead: definePayloadProcedure<
    z.infer<typeof webChatReadSchema>,
    WebChatSession,
    "main-local"
  >("webChatRead", "main-local", webChatReadSchema),
  webChatReveal: definePayloadProcedure<Id, void, "main-local">(
    "webChatReveal",
    "main-local",
    webChatIdSchema,
  ),
  webChatRefresh: definePayloadProcedure<
    z.infer<typeof webChatRefreshSchema>,
    WebChatSession,
    "main-local"
  >("webChatRefresh", "main-local", webChatRefreshSchema),
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
  webChatForget: definePayloadProcedure<Id, void, "main-local">(
    "webChatForget",
    "main-local",
    webChatIdSchema,
  ),
  webChatRename: definePayloadProcedure<
    z.infer<typeof webChatRenameSchema>,
    WebChatSession,
    "main-local"
  >("webChatRename", "main-local", webChatRenameSchema),
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
