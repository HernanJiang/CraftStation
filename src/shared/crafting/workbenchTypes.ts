import { z } from "zod";

/**
 * Serializable, secret-free DTOs for the CraftStation Workbench (v1.0.0).
 *
 * These types intentionally live apart from the runtime `types.ts` (Item,
 * Recipe, CraftPlan, RuntimeBinding). A StoredRecipe references materials by
 * stable, non-secret ids only; it is never the `Recipe` class (which carries
 * `matches()` / `compile()` functions and cannot be persisted).
 *
 * Rules enforced across this module:
 * - No API key, OAuth token, cookie, credential path or raw secret.
 * - Reasoning effort / context size / permission mode never enter a recipe's
 *   system name or identity.
 * - Provider/channel/account surfaces that differ are distinct materials.
 */

/** Product-facing compatibility tiers (the only three states the UI shows). */
export const workbenchUiStatusSchema = z.enum(["NATIVE", "CRAFTABLE", "IMPOSSIBLE"]);
export type WorkbenchUiStatus = z.infer<typeof workbenchUiStatusSchema>;

/** Internal compatibility tier, preserved for diagnosis; never rendered raw. */
export const workbenchInternalStatusSchema = z.enum([
  "NATIVE",
  "SUPPORTED",
  "EXPERIMENTAL",
  "INCOMPATIBLE",
  "UNAVAILABLE",
]);
export type WorkbenchInternalStatus = z.infer<typeof workbenchInternalStatusSchema>;

export const modelEntrySourceSchema = z.enum(["agent", "custom"]);
export type ModelEntrySource = z.infer<typeof modelEntrySourceSchema>;

/**
 * Stable projection of one user-selectable model material. The `entryId` is
 * the only identity a StoredRecipe/Workbench draft may reference.
 *
 * `agent` entries come from the "管理模型" roster; `custom` entries reuse the
 * existing SharedSettings.customModels.id (which already encodes provider,
 * account and modelId).
 */
export const selectedModelEntrySchema = z.object({
  entryId: z.string().min(1),
  source: modelEntrySourceSchema,
  providerKind: z.string().min(1),
  providerSurfaceKey: z.string().min(1),
  providerLabel: z.string().min(1),
  channelLabel: z.string().min(1),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  accountId: z.string().optional(),
  presentationMode: z.enum(["terminal", "gui"]).optional(),
  runtimeVariant: z.string().optional(),
  contextSize: z.string().optional(),
  contextWindow: z.number().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsToolCalling: z.boolean().optional(),
  capabilitySource: z.string().optional(),
});
export type SelectedModelEntry = z.infer<typeof selectedModelEntrySchema>;

export const harnessReferenceStatusSchema = z.enum([
  "ready",
  "not-configured",
  "unavailable",
  "error",
]);
export type HarnessReferenceStatus = z.infer<typeof harnessReferenceStatusSchema>;

/** Secret-free reference to one Harness material. Never holds a path/credential. */
export const harnessReferenceSchema = z.object({
  harnessItemId: z.string().min(1), // e.g. harness:codex
  harnessKind: z.string().min(1), // e.g. codex
  descriptorId: z.string().min(1), // e.g. native-harness:codex
  displayName: z.string().min(1),
  vendor: z.string().min(1),
  official: z.boolean(),
  version: z.string().optional(),
  status: harnessReferenceStatusSchema,
  transport: z.string().optional(),
});
export type HarnessReference = z.infer<typeof harnessReferenceSchema>;

export const capabilityEntryStateSchema = z.enum(["available", "missing", "degraded", "unknown"]);
export type CapabilityEntryState = z.infer<typeof capabilityEntryStateSchema>;

export const capabilityResolutionSourceSchema = z.enum([
  "native-harness",
  "compatibility-layer",
  "fallback-harness",
  "unavailable",
]);
export type CapabilityResolutionSource = z.infer<typeof capabilityResolutionSourceSchema>;

export const capabilityResolutionEntrySchema = z.object({
  name: z.string().min(1),
  state: capabilityEntryStateSchema,
  source: capabilityResolutionSourceSchema,
  reason: z.string().optional(),
});
export type CapabilityResolutionEntry = z.infer<typeof capabilityResolutionEntrySchema>;

export const publicCraftingDiagnosticSchema = z.object({
  code: z.string().min(1),
  phase: z.string().min(1),
  message: z.string().min(1),
  remediation: z.string().optional(),
});
export type PublicCraftingDiagnostic = z.infer<typeof publicCraftingDiagnosticSchema>;

/**
 * Result of a deterministic compatibility resolution over the current
 * four-cell (Model · Harness · Provider/Auth · Runtime) composition. Bound to a
 * versioned `resolutionKey` derived only from stable, non-secret identity.
 */
export const capabilityResolutionSchema = z.object({
  resolutionKey: z.string().min(1),
  createdAt: z.string().min(1),
  status: workbenchUiStatusSchema,
  internalStatus: workbenchInternalStatusSchema.optional(),
  source: z.enum(["native", "compatibility-layer", "unavailable"]),
  modelEntryRef: z.string().min(1),
  harnessRef: z.string().min(1),
  providerProfileRef: z.string().optional(),
  runtimeProfileRef: z.string().optional(),
  adapterId: z.string().optional(),
  adapterVersion: z.string().optional(),
  capabilities: z.array(capabilityResolutionEntrySchema).default([]),
  diagnostics: z.array(publicCraftingDiagnosticSchema).default([]),
});
export type CapabilityResolution = z.infer<typeof capabilityResolutionSchema>;

/** Serialized recipe identity: Harness · Model. Reasoning never enters here. */
export const storedRecipeSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  systemName: z.string().min(1),
  alias: z.string().optional(),
  modelEntryRef: z.string().min(1),
  harnessRef: z.string().min(1),
  providerProfileRef: z.string().optional(),
  authRef: z.string().optional(),
  runtimeProfileRef: z.string().optional(),
  packRef: z.string().optional(),
  /**
   * Homepage picker visibility for this recipe. Optional for backward
   * compatibility — absent means hidden. Toggled from 管理模型 →
   * 我的配方；visible recipes resolve to their underlying model in the
   * homepage model picker.
   */
  homepageVisible: z.boolean().optional(),
  compatibility: z.object({
    uiStatus: workbenchUiStatusSchema,
    internalStatus: workbenchInternalStatusSchema.optional(),
    adapterId: z.string().optional(),
    adapterVersion: z.string().optional(),
  }),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastKnownModel: z
    .object({
      displayName: z.string().min(1),
      modelId: z.string().min(1),
      providerLabel: z.string().min(1),
    })
    .optional(),
  lastKnownHarness: z
    .object({
      displayName: z.string().min(1),
      harnessKind: z.string().min(1),
    })
    .optional(),
});
export type StoredRecipe = z.infer<typeof storedRecipeSchema>;

/** Efficient (four-cell) workbench draft — independently persisted. */
export const efficientDraftSchema = z.object({
  modelEntryRef: z.string().optional(),
  harnessRef: z.string().optional(),
  packRef: z.string().optional(),
  reservedSlot: z.literal(true).default(true),
  providerProfileRef: z.string().optional(),
  runtimeProfileRef: z.string().optional(),
  resolution: capabilityResolutionSchema.optional(),
  resolutionKey: z.string().optional(),
});
export type EfficientDraft = z.infer<typeof efficientDraftSchema>;

export const EMPTY_EFFICIENT_DRAFT: EfficientDraft = { reservedSlot: true };

/** Creative (three-by-three) workbench draft — independently persisted. */
export const creativeSlotRefSchema = z.object({
  slot: z.string().min(1),
  kind: z.enum(["model", "harness", "pack", "component"]),
  ref: z.string().min(1),
});
export type CreativeSlotRef = z.infer<typeof creativeSlotRefSchema>;

export const creativeDraftSchema = z.object({
  slots: z.array(creativeSlotRefSchema.optional()).length(9).default([]),
  packRef: z.string().optional(),
  resolution: capabilityResolutionSchema.optional(),
  resolutionKey: z.string().optional(),
});
export type CreativeDraft = z.infer<typeof creativeDraftSchema>;

export const EMPTY_CREATIVE_DRAFT: CreativeDraft = { slots: Array(9).fill(undefined) };

export const workbenchModeSchema = z.enum(["efficient", "creative"]);
export type WorkbenchMode = z.infer<typeof workbenchModeSchema>;

export const pendingRecipeIntentSchema = z.object({
  recipeId: z.string().min(1),
});
export type PendingRecipeIntent = z.infer<typeof pendingRecipeIntentSchema>;

/** Full persisted state of the single Workbench store. */
export const craftingWorkbenchStateSchema = z.object({
  lastWorkbenchMode: workbenchModeSchema.default("efficient"),
  efficientDraft: efficientDraftSchema.default(EMPTY_EFFICIENT_DRAFT),
  creativeDraft: creativeDraftSchema.default(EMPTY_CREATIVE_DRAFT),
  recipes: z.array(storedRecipeSchema).default([]),
  selectedInspectorRef: z.string().optional(),
  pendingRecipeIntent: pendingRecipeIntentSchema.optional(),
});
export type CraftingWorkbenchState = z.infer<typeof craftingWorkbenchStateSchema>;

/** Compose the deterministic recipe system name: `Harness · Model`. */
export function composeRecipeSystemName(harnessName: string, modelName: string): string {
  return `${harnessName} · ${modelName}`;
}

/** Derive a stable recipe id from its two required material refs (non-secret). */
export function storedRecipeId(modelEntryRef: string, harnessRef: string): string {
  return `recipe:${harnessRef}:${modelEntryRef}`;
}
