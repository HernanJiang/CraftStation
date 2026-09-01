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
  "official-stream-json",
  "deepseek-json-rpc-stdio",
  "openai-compatible-http",
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
  "NATIVE_STDERR",
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
  correlationId: z.string().min(1).optional(),
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

/**
 * Supervisor-owned, secret-free execution settings projected from a CraftPlan.
 * Provider credentials remain in the provider's own login/configuration store.
 */
export const nativeRuntimeExecutionConfigSchema = z.object({
  workspace: z.string().min(1).optional(),
  model: z.string().min(1),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  serviceTier: z.enum(["default", "flex", "fast", "priority"]).optional(),
  approvalPolicy: z.enum(["always", "auto", "never", "on-demand"]).optional(),
  permissionProfile: z.string().min(1).optional(),
  profileRef: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  mcpServerIds: z.array(z.string().min(1)).optional(),
  skills: z.array(z.string().min(1)).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  compaction: z.record(z.string(), z.unknown()).optional(),
  customSettings: z.record(z.string(), z.unknown()).optional(),
});
export type NativeRuntimeExecutionConfig = z.infer<typeof nativeRuntimeExecutionConfigSchema>;

const SECRET_SETTING_KEY = /token|secret|cookie|password|authorization|api[_-]?key|credential/iu;
const INTERNAL_TRANSPORT_SETTING_KEYS = new Set([
  "configPath",
  "executablePath",
  "runtimeArgs",
  "runtimeCommand",
]);

function stringOption(options: Record<string, unknown>, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArrayOption(options: Record<string, unknown>, key: string): string[] | undefined {
  const value = options[key];
  if (!Array.isArray(value)) return undefined;
  const result = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  return result.length > 0 ? result : undefined;
}

function objectOption(
  options: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = options[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeRuntimeSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => safeRuntimeSettings(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SECRET_SETTING_KEY.test(key) && !INTERNAL_TRANSPORT_SETTING_KEYS.has(key))
      .map(([key, entry]) => [key, safeRuntimeSettings(entry)]),
  );
}

export function nativeRuntimeExecutionConfigForPlan(
  plan: import("./types").CraftPlan,
): NativeRuntimeExecutionConfig {
  const overrides = plan.overrides ?? {};
  const bindingOptions = plan.runtimeBinding.options ?? {};
  const safeCustomSettings = safeRuntimeSettings(bindingOptions) as Record<string, unknown>;
  const optionContext = objectOption(bindingOptions, "context");
  const optionCompaction = objectOption(bindingOptions, "compaction");
  return nativeRuntimeExecutionConfigSchema.parse({
    ...(plan.workspace ? { workspace: plan.workspace } : {}),
    model: overrides.model ?? plan.runtimeBinding.modelId,
    ...((overrides.reasoningEffort ?? stringOption(bindingOptions, "reasoningEffort"))
      ? {
          reasoningEffort:
            overrides.reasoningEffort ?? stringOption(bindingOptions, "reasoningEffort"),
        }
      : {}),
    ...((overrides.serviceTier ?? stringOption(bindingOptions, "serviceTier"))
      ? { serviceTier: overrides.serviceTier ?? stringOption(bindingOptions, "serviceTier") }
      : {}),
    ...((overrides.approvalPolicy ?? stringOption(bindingOptions, "approvalPolicy"))
      ? {
          approvalPolicy:
            overrides.approvalPolicy ?? stringOption(bindingOptions, "approvalPolicy"),
        }
      : {}),
    ...((overrides.permissionProfile ?? stringOption(bindingOptions, "permissionProfile"))
      ? {
          permissionProfile:
            overrides.permissionProfile ?? stringOption(bindingOptions, "permissionProfile"),
        }
      : {}),
    ...((overrides.profileRef ?? plan.runtimeBinding.profileRef)
      ? { profileRef: overrides.profileRef ?? plan.runtimeBinding.profileRef }
      : {}),
    ...(overrides.accountId || typeof bindingOptions.accountId === "string"
      ? { accountId: overrides.accountId ?? bindingOptions.accountId }
      : {}),
    ...((overrides.mcpServerIds ?? stringArrayOption(bindingOptions, "mcpServerIds"))
      ? {
          mcpServerIds: overrides.mcpServerIds ?? stringArrayOption(bindingOptions, "mcpServerIds"),
        }
      : {}),
    ...((overrides.skills ?? stringArrayOption(bindingOptions, "skills"))
      ? { skills: overrides.skills ?? stringArrayOption(bindingOptions, "skills") }
      : {}),
    ...((overrides.context ?? optionContext)
      ? { context: safeRuntimeSettings(overrides.context ?? optionContext) }
      : {}),
    ...((overrides.compaction ?? optionCompaction)
      ? { compaction: safeRuntimeSettings(overrides.compaction ?? optionCompaction) }
      : {}),
    ...(Object.keys(safeCustomSettings).length > 0 || overrides.customSettings
      ? {
          customSettings: safeRuntimeSettings({
            ...safeCustomSettings,
            ...(overrides.customSettings ?? {}),
          }) as Record<string, unknown>,
        }
      : {}),
  });
}
