import { z } from "zod";

/**
 * The capability vocabulary is deliberately small and descriptive. It is a
 * reporting contract, not an instruction to implement a universal capability
 * runtime. Provider adapters remain the owners of the native semantics.
 */
export const nativeHarnessCapabilitySchema = z.enum([
  "discovery",
  "auth",
  "profile",
  "start",
  "resume",
  "multi_turn",
  "streaming",
  "events",
  "tool_execution",
  "file_access",
  "shell_execution",
  "permission",
  "mcp",
  "skills",
  "subagents",
  "context",
  "compaction",
  "interrupt",
  "cleanup",
  "diagnostics",
]);
export type NativeHarnessCapability = z.infer<typeof nativeHarnessCapabilitySchema>;

/**
 * These values intentionally preserve the distinction between a provider
 * limitation, an unfinished CraftStation implementation and a machine that
 * cannot currently run the provider. They are not booleans and must not be
 * collapsed to "supported" by the renderer.
 */
export const nativeHarnessCapabilityStateSchema = z.enum([
  "supported+integrated",
  "native unsupported",
  "implementation missing",
  "unavailable",
  "error",
]);
export type NativeHarnessCapabilityState = z.infer<typeof nativeHarnessCapabilityStateSchema>;

export const nativeHarnessTransportSchema = z.enum([
  "codex-app-server-json-rpc",
  "acp-stdio",
  "official-pty",
  "unavailable",
]);
export type NativeHarnessTransport = z.infer<typeof nativeHarnessTransportSchema>;

export const nativeHarnessEnvironmentSchema = z.object({
  kind: z.enum(["windows", "posix", "wsl"]),
  distro: z.string().min(1).optional(),
});
export type NativeHarnessEnvironment = z.infer<typeof nativeHarnessEnvironmentSchema>;

export const nativeHarnessDescriptorSchema = z.object({
  id: z.string().min(1),
  harnessKind: z.string().min(1),
  label: z.string().min(1),
  vendor: z.string().min(1),
  official: z.boolean(),
  transport: nativeHarnessTransportSchema,
  /**
   * `machineFacingBoundary` is an audit label only. It is never executed by
   * the renderer and must not contain a provider credential or filesystem path.
   */
  machineFacingBoundary: z.string().min(1),
  capabilities: z.record(z.string(), nativeHarnessCapabilityStateSchema),
  profileRef: z.string().min(1).optional(),
  environment: nativeHarnessEnvironmentSchema.optional(),
});
export type NativeHarnessDescriptor = z.infer<typeof nativeHarnessDescriptorSchema>;

export const nativeHarnessDiagnosticCodeSchema = z.enum([
  "RUNTIME_UNAVAILABLE",
  "RUNTIME_NOT_CONFIGURED",
  "AUTH_REQUIRED",
  "PROTOCOL_MISMATCH",
  "NATIVE_PROCESS_CRASHED",
  "NATIVE_SESSION_NOT_FOUND",
  "NATIVE_EXECUTION_FAILED",
  "CLEANUP_FAILED",
]);
export type NativeHarnessDiagnosticCode = z.infer<typeof nativeHarnessDiagnosticCodeSchema>;

export const nativeHarnessDiagnosticSchema = z.object({
  code: nativeHarnessDiagnosticCodeSchema,
  harnessKind: z.string().min(1),
  phase: z.enum(["discovery", "readiness", "start", "resume", "turn", "interrupt", "dispose"]),
  operation: z.string().min(1),
  message: z.string().min(1),
  correlationId: z.string().min(1).optional(),
  providerCode: z.string().min(1).optional(),
  remediation: z.string().min(1).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.string().datetime(),
});
export type NativeHarnessDiagnostic = z.infer<typeof nativeHarnessDiagnosticSchema>;

/**
 * A bounded reference to a provider-native event. Adapters may carry safe
 * structured metadata here, but must not put credentials, cookies or complete
 * user prompts into the envelope. The canonical RuntimeEvent remains the
 * renderer-facing projection.
 */
export const nativeEventEnvelopeSchema = z.object({
  harnessKind: z.string().min(1),
  source: z.enum(["native", "canonical-adapter"]),
  nativeType: z.string().min(1),
  providerSessionId: z.string().min(1).optional(),
  sequence: z.number().int().nonnegative().optional(),
  receivedAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type NativeEventEnvelope = z.infer<typeof nativeEventEnvelopeSchema>;

export interface NativeHarnessCapabilityDescriptor {
  readonly capability: NativeHarnessCapability;
  readonly state: NativeHarnessCapabilityState;
  readonly reason?: string;
}

/**
 * Renderer-facing descriptor. This is intentionally smaller than the native
 * adapter descriptor: profile refs, environment values, command paths and
 * native diagnostic details never cross the Supervisor IPC seam.
 */
export const nativeHarnessPublicDescriptorSchema = z.object({
  id: z.string().min(1),
  harnessKind: z.string().min(1),
  label: z.string().min(1),
  vendor: z.string().min(1),
  official: z.boolean(),
  transport: nativeHarnessTransportSchema,
  machineFacingBoundary: z.string().min(1),
  capabilities: z.record(z.string(), nativeHarnessCapabilityStateSchema),
});
export type NativeHarnessPublicDescriptor = z.infer<typeof nativeHarnessPublicDescriptorSchema>;

export const nativeHarnessControlPlaneStatusSchema = z.enum([
  "ready",
  "not-configured",
  "unavailable",
  "error",
]);
export type NativeHarnessControlPlaneStatus = z.infer<typeof nativeHarnessControlPlaneStatusSchema>;

export const nativeHarnessPublicDiagnosticSchema = z.object({
  code: nativeHarnessDiagnosticCodeSchema,
  harnessKind: z.string().min(1),
  phase: z.enum(["discovery", "readiness", "start", "resume", "turn", "interrupt", "dispose"]),
  operation: z.string().min(1),
  message: z.string().min(1),
  remediation: z.string().min(1).optional(),
});
export type NativeHarnessPublicDiagnostic = z.infer<typeof nativeHarnessPublicDiagnosticSchema>;

export const nativeHarnessControlPlaneEntrySchema = z.object({
  descriptor: nativeHarnessPublicDescriptorSchema,
  status: nativeHarnessControlPlaneStatusSchema,
  /** Only whether a profile is configured; the profile identity stays private. */
  profileConfigured: z.boolean(),
  /** Environment kind is safe to display; filesystem paths are deliberately absent. */
  environmentKind: z.enum(["windows", "posix", "wsl"]),
  diagnostics: z.array(nativeHarnessPublicDiagnosticSchema),
});
export type NativeHarnessControlPlaneEntry = z.infer<typeof nativeHarnessControlPlaneEntrySchema>;

export const nativeHarnessControlPlanePayloadSchema = z.object({
  harnessKind: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/u)
    .optional(),
});
export type NativeHarnessControlPlanePayload = z.infer<
  typeof nativeHarnessControlPlanePayloadSchema
>;

export interface NativeHarnessLifecycleContract {
  start(): Promise<void>;
  resume(sessionRef: string): Promise<void>;
  send(prompt: string): Promise<void>;
  interrupt(): Promise<void>;
  dispose(): Promise<void>;
}
