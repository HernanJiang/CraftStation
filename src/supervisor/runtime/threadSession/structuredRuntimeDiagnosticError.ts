export type StructuredRuntimeFailureClass = "session-creation" | "transport" | "turn";

const STRUCTURED_RUNTIME_FAILURE_MESSAGES: Record<StructuredRuntimeFailureClass, string> = {
  "session-creation": "Structured runtime session creation failed.",
  transport: "Structured runtime transport failed.",
  turn: "Structured runtime turn failed.",
};

/**
 * Privacy-safe structured-runtime failure identity.
 *
 * Provider errors can contain prompts, command output, paths, and credentials,
 * so telemetry receives only this stable class and message. The raw failure is
 * still logged locally and shown to the user by the owning runtime boundary.
 */
export class StructuredRuntimeDiagnosticError extends Error {
  override readonly name = "StructuredRuntimeDiagnosticError";
  readonly failureClass: StructuredRuntimeFailureClass;
  readonly diagnosticProvider: string | undefined;

  constructor(
    failureClass: StructuredRuntimeFailureClass,
    diagnosticProvider?: string,
    /** Optional short cause tail for account-control style errors (no secrets). */
    causeHint?: string,
  ) {
    super(
      causeHint
        ? `${STRUCTURED_RUNTIME_FAILURE_MESSAGES[failureClass]} 原因：${causeHint}`
        : STRUCTURED_RUNTIME_FAILURE_MESSAGES[failureClass],
    );
    this.failureClass = failureClass;
    this.diagnosticProvider = diagnosticProvider;
  }
}

export function structuredRuntimeFeatureArea(failureClass: StructuredRuntimeFailureClass): string {
  return `structured-runtime-${failureClass}`;
}

/** Short, secret-free cause for the GUI error strip. */
export function structuredRuntimeCauseHint(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const line = error.message.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  if (!line || line.length > 220) return undefined;
  if (/sk-[a-z0-9]|api[_-]?key|bearer |password|authorization:/iu.test(line)) return undefined;
  return line;
}
