import { z } from "zod";
import type { LspMessagePayload, LspStartPayload, LspStopPayload } from "../../lsp";
import { definePayloadProcedure } from "../core";

export const lspProcedures = {
  lspStart: definePayloadProcedure<LspStartPayload, void, "supervisor">(
    "lspStart",
    "supervisor",
    z.custom<LspStartPayload>(),
  ),
  lspStop: definePayloadProcedure<LspStopPayload, void, "supervisor">(
    "lspStop",
    "supervisor",
    z.custom<LspStopPayload>(),
  ),
  lspSendMessage: definePayloadProcedure<LspMessagePayload, unknown, "supervisor">(
    "lspSendMessage",
    "supervisor",
    z.custom<LspMessagePayload>(),
  ),
} as const;
