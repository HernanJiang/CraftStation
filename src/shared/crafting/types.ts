import { z } from "zod";

import { nativeHarnessEnvironmentSchema } from "./nativeHarness";

export const compatibilityStatusSchema = z.enum([
  "NATIVE",
  "SUPPORTED",
  "EXPERIMENTAL",
  "INCOMPATIBLE",
]);
export type CompatibilityStatus = z.infer<typeof compatibilityStatusSchema>;

export const itemKindSchema = z.enum(["model", "harness", "result", "custom"]);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const itemMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  vendor: z.string().min(1),
  source: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  compatibilityStatus: compatibilityStatusSchema.default("SUPPORTED"),
});
export type ItemMetadata = z.infer<typeof itemMetadataSchema>;

export const componentSchema = z
  .object({
    kind: z.string().min(1),
  })
  .passthrough();
export type Component = z.infer<typeof componentSchema>;

export const modelCapabilityComponentSchema = componentSchema.extend({
  kind: z.literal("model_capability"),
  vendor: z.string().min(1),
  modelId: z.string().min(1),
  contextWindow: z.number().positive().optional(),
  supportsStreaming: z.boolean().default(true),
  supportsToolCalling: z.boolean().default(true),
  defaultSettings: z.record(z.string(), z.unknown()).optional(),
});
export type ModelCapabilityComponent = z.infer<typeof modelCapabilityComponentSchema>;

export const harnessRuntimeComponentSchema = componentSchema.extend({
  kind: z.literal("harness_runtime"),
  harnessKind: z.string().min(1),
  supportedVendors: z.array(z.string()).min(1),
  executionMode: z.enum(["structured_session", "terminal_pty"]).default("structured_session"),
});
export type HarnessRuntimeComponent = z.infer<typeof harnessRuntimeComponentSchema>;

export const itemSchema = z.object({
  id: z.string().min(1),
  kind: itemKindSchema,
  metadata: itemMetadataSchema,
  components: z.array(componentSchema).default([]),
});
export type Item = z.infer<typeof itemSchema>;

export const ingredientProvenanceSchema = z.object({
  slot: z.string().min(1),
  itemId: z.string().min(1),
  itemVersion: z.string().min(1),
  vendor: z.string().min(1),
  kind: itemKindSchema,
});
export type IngredientProvenance = z.infer<typeof ingredientProvenanceSchema>;

export const runtimeBindingSchema = z.object({
  harnessKind: z.string().min(1),
  modelId: z.string().min(1),
  vendor: z.string().min(1),
  runtimeAdapterId: z.string().min(1),
  /** Provider identity is explicit for provider-hosted runtimes such as OpenCode. */
  providerID: z.string().min(1).optional(),
  /** Supervisor-owned reference; this is never an API credential value. */
  authRef: z.string().min(1).optional(),
  profileRef: z.string().min(1).optional(),
  /** Route classification: native official pairing vs compatibility bridge */
  routeType: z.enum(["native", "compatibility"]).optional(),
  /** Selected account identity (opaque ID), secret-free */
  accountId: z.string().min(1).optional(),
  /** Protocol exposed by or targeted by compatibility bridge */
  compatibilityProtocol: z.string().min(1).optional(),
  /** Loopback host:port endpoint for CLIProxyAPI sidecar, strictly without token or secret */
  compatibilityBridgeEndpoint: z.string().min(1).optional(),
  environment: nativeHarnessEnvironmentSchema.optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});
export type RuntimeBinding = z.infer<typeof runtimeBindingSchema>;

export const compositionProvenanceSchema = z.object({
  recipeId: z.string().min(1),
  recipeVersion: z.string().min(1),
  craftedAt: z.string().min(1),
  ingredients: z.record(z.string(), ingredientProvenanceSchema),
  /**
   * Optional for backward compatibility with provenance written before the
   * Native Harness seam. When present it keeps the selected provider profile
   * and execution environment sticky across recovery.
   */
  runtimeBinding: runtimeBindingSchema.optional(),
});
export type CompositionProvenance = z.infer<typeof compositionProvenanceSchema>;

export const reasoningEffortSchema = z.enum(["low", "medium", "high"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const serviceTierSchema = z.enum(["default", "flex", "fast", "priority"]);
export type ServiceTier = z.infer<typeof serviceTierSchema>;

export const approvalPolicySchema = z.enum(["always", "auto", "never", "on-demand"]);
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const capabilityModeSchema = z.enum(["auto", "efficient", "creative"]);
export type CapabilityMode = z.infer<typeof capabilityModeSchema>;

export const runtimeOverridesSchema = z.object({
  model: z.string().optional(),
  capabilityMode: capabilityModeSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  serviceTier: serviceTierSchema.optional(),
  approvalPolicy: approvalPolicySchema.optional(),
  permissionProfile: z.string().optional(),
  mcpServerIds: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  compaction: z.record(z.string(), z.unknown()).optional(),
  profileRef: z.string().optional(),
  accountId: z.string().optional(),
  customSettings: z.record(z.string(), z.unknown()).optional(),
});
export type RuntimeOverrides = z.infer<typeof runtimeOverridesSchema>;

export const craftPlanSchema = z.object({
  id: z.string().min(1),
  recipeId: z.string().min(1),
  resultItemId: z.string().min(1),
  ingredients: z.record(z.string(), ingredientProvenanceSchema),
  runtimeBinding: runtimeBindingSchema,
  workspace: z.string().optional(),
  sessionRef: z.string().optional(),
  threadId: z.string().optional(),
  createdAt: z.string().min(1),
  overrides: runtimeOverridesSchema.optional(),
});
export type CraftPlan = z.infer<typeof craftPlanSchema>;

export const resultItemSchema = itemSchema.extend({
  kind: z.literal("result"),
  provenance: compositionProvenanceSchema,
  craftPlan: craftPlanSchema,
});
export type ResultItem = z.infer<typeof resultItemSchema>;

export const craftContextSchema = z.object({
  workspace: z.string().optional(),
  sessionRef: z.string().optional(),
  threadId: z.string().optional(),
  authRef: z.string().min(1).optional(),
  profileRef: z.string().min(1).optional(),
  environment: nativeHarnessEnvironmentSchema.optional(),
  clientProperties: z.record(z.string(), z.unknown()).optional(),
  overrides: runtimeOverridesSchema.optional(),
});
export type CraftContext = z.infer<typeof craftContextSchema>;

export type SlotSelection = Item | "auto" | undefined;

export interface CraftingGrid {
  slots: Record<string, SlotSelection>;
}

export interface ResolvedGrid {
  ingredients: Record<string, Item>;
  unresolvedSlots: string[];
}

export interface RecipeSlotRequirement {
  slot: string;
  requiredKind: ItemKind;
  description?: string;
  allowedVendors?: string[];
}

export interface Recipe {
  id: string;
  name: string;
  version: string;
  description: string;
  compatibilityStatus: CompatibilityStatus;
  requirements: Record<string, RecipeSlotRequirement>;
  /** Optional native recipe metadata used by the Craft Table quick-fill UI. */
  harnessItemId?: string;
  modelVendors?: readonly string[];
  matches(ingredients: Record<string, Item>): boolean;
  compile(ingredients: Record<string, Item>, context: CraftContext): CraftPlan;
}

export const craftingPhaseSchema = z.enum([
  "resolve",
  "validate",
  "compile",
  "runtime",
  "recovery",
]);
export type CraftingPhase = z.infer<typeof craftingPhaseSchema>;

export const craftingErrorCodeSchema = z.enum([
  "ITEM_NOT_FOUND",
  "UNRESOLVED_SLOT",
  "INVALID_RECIPE",
  "RECIPE_NOT_FOUND",
  "INCOMPATIBLE_COMBINATION",
  "RUNTIME_UNAVAILABLE",
  "COMPILATION_ERROR",
  "AUTH_REQUIRED",
  "PROTOCOL_MISMATCH",
  "EXECUTION_FAILED",
  "RECOVERY_FAILED",
]);
export type CraftingErrorCode = z.infer<typeof craftingErrorCodeSchema>;

export interface CraftingErrorDetail {
  code: CraftingErrorCode;
  phase: CraftingPhase;
  message: string;
  details?: Record<string, unknown>;
  remediation?: string;
}

export interface CraftValidationResult {
  valid: boolean;
  resolvedIngredients?: Record<string, Item>;
  matchedRecipe?: Recipe;
  errors: CraftingErrorDetail[];
}

export interface CraftResult {
  success: boolean;
  resultItem?: ResultItem;
  craftPlan?: CraftPlan;
  recipe?: Recipe;
  errors?: CraftingErrorDetail[];
}
