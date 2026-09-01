import { z } from "zod";
import { projectLocationSchema, type ProjectLocation } from "../contracts";

export const craftingModelInventoryPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
});

export interface CraftingModelInventoryPayload {
  projectLocation: ProjectLocation;
}

export interface CraftingDiscoveredModel {
  id: string;
  displayName: string;
  contextWindow?: number;
  supportsStreaming?: boolean;
  supportsToolCalling?: boolean;
}

export interface CraftingModelInventory {
  status: "ready" | "unavailable";
  source: "codex-app-server-model-list";
  models: CraftingDiscoveredModel[];
  diagnostic?: {
    code: "RUNTIME_UNAVAILABLE" | "PROTOCOL_MISMATCH";
    message: string;
    remediation: string;
  };
}
