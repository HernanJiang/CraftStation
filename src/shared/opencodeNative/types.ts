import { z } from "zod";

export const openCodeModelFamilySchema = z.enum([
  "openai",
  "xai",
  "google",
  "deepseek",
  "moonshot",
  "muse",
]);
export type OpenCodeModelFamily = z.infer<typeof openCodeModelFamilySchema>;

export const openCodeAuthModeSchema = z.enum(["api-key", "oauth", "vertex", "profile", "unknown"]);
export type OpenCodeAuthMode = z.infer<typeof openCodeAuthModeSchema>;

export const openCodeKimiRouteSchema = z.enum(["moonshot-native", "openai-compatible"]);
export type OpenCodeKimiRoute = z.infer<typeof openCodeKimiRouteSchema>;

export const openCodeCapabilityStateSchema = z.enum([
  "supported",
  "unsupported",
  "unverified",
  "unavailable",
]);
export type OpenCodeCapabilityState = z.infer<typeof openCodeCapabilityStateSchema>;

export const openCodeCapabilityMatrixSchema = z.object({
  streaming: openCodeCapabilityStateSchema,
  toolCalling: openCodeCapabilityStateSchema,
  fileAccess: openCodeCapabilityStateSchema,
  shellExecution: openCodeCapabilityStateSchema,
  reasoning: openCodeCapabilityStateSchema,
  context: openCodeCapabilityStateSchema,
  compaction: openCodeCapabilityStateSchema,
  mcp: openCodeCapabilityStateSchema,
  subagents: openCodeCapabilityStateSchema,
  usage: openCodeCapabilityStateSchema,
});
export type OpenCodeCapabilityMatrix = z.infer<typeof openCodeCapabilityMatrixSchema>;

export const modelProviderBindingSchema = z.object({
  harnessKind: z.literal("opencode"),
  modelFamily: openCodeModelFamilySchema,
  providerID: z.string().min(1),
  modelID: z.string().min(1),
  authMode: openCodeAuthModeSchema,
  authRef: z.string().min(1).optional(),
  profileRef: z.string().min(1).optional(),
  kimiRoute: openCodeKimiRouteSchema.optional(),
  capabilities: openCodeCapabilityMatrixSchema,
});
export type ModelProviderBinding = z.infer<typeof modelProviderBindingSchema>;

export interface OpenCodeProviderFact {
  readonly family: OpenCodeModelFamily;
  readonly providerID: string;
  readonly route?: OpenCodeKimiRoute;
  readonly authModes: readonly OpenCodeAuthMode[];
  readonly representativeModels: readonly string[];
  readonly facts: readonly string[];
}

export type OpenCodeMatrixStatus = "verified" | "unverified" | "unavailable";

export type OpenCodeExecutableReadinessStatus =
  | "ready"
  | "unverified"
  | "unavailable"
  | "auth-required"
  | "implementation-missing";

export interface OpenCodeExecutableReadinessQuery {
  readonly providerID: string;
  readonly modelID: string;
  readonly authRef?: string;
  readonly profileRef?: string;
}

export interface OpenCodeExecutableReadiness {
  readonly status: OpenCodeExecutableReadinessStatus;
  readonly reason: string;
  /** Stable evidence identifier only; never a credential or raw provider payload. */
  readonly evidenceRef?: string;
}

export type OpenCodeExecutableReadinessProvider = (
  query: OpenCodeExecutableReadinessQuery,
) => OpenCodeExecutableReadiness;

export interface OpenCodeCompatibilityRecord {
  readonly id: string;
  readonly family: OpenCodeModelFamily;
  readonly providerID: string;
  readonly modelID: string;
  readonly authMode: OpenCodeAuthMode;
  readonly kimiRoute?: OpenCodeKimiRoute;
  readonly status: OpenCodeMatrixStatus;
  readonly capabilities: OpenCodeCapabilityMatrix;
  readonly evidence: string;
}
