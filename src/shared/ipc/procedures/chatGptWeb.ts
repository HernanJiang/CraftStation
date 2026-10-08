import { defineNoArgProcedure, definePayloadProcedure } from "../core";
import { webChatIdSchema, webChatSendSchema, type WebChatSession } from "../../chatGptWeb";
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
};
