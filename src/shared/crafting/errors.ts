import type { CraftingErrorCode, CraftingErrorDetail, CraftingPhase } from "./types";

export class CraftingError extends Error {
  readonly code: CraftingErrorCode;
  readonly phase: CraftingPhase;
  readonly details?: Record<string, unknown> | undefined;
  readonly remediation?: string | undefined;

  constructor(options: {
    code: CraftingErrorCode;
    phase: CraftingPhase;
    message: string;
    details?: Record<string, unknown> | undefined;
    remediation?: string | undefined;
  }) {
    super(options.message);
    this.name = "CraftingError";
    this.code = options.code;
    this.phase = options.phase;
    if (options.details !== undefined) {
      this.details = options.details;
    }
    if (options.remediation !== undefined) {
      this.remediation = options.remediation;
    }
    Object.setPrototypeOf(this, CraftingError.prototype);
  }

  toDetail(): CraftingErrorDetail {
    const detail: CraftingErrorDetail = {
      code: this.code,
      phase: this.phase,
      message: this.message,
    };
    if (this.details !== undefined) {
      detail.details = this.details;
    }
    if (this.remediation !== undefined) {
      detail.remediation = this.remediation;
    }
    return detail;
  }

  static missingItem(slot: string, remediation?: string): CraftingError {
    return new CraftingError({
      code: "ITEM_NOT_FOUND",
      phase: "resolve",
      message: `Required ingredient for slot '${slot}' is missing or not found in registry.`,
      details: { slot },
      remediation: remediation ?? `Please select a valid item for slot '${slot}'.`,
    });
  }

  static unresolvedSlot(slot: string, reason?: string, remediation?: string): CraftingError {
    return new CraftingError({
      code: "UNRESOLVED_SLOT",
      phase: "resolve",
      message: `Slot '${slot}' could not be resolved${reason ? `: ${reason}` : ""}.`,
      details: { slot, ...(reason !== undefined ? { reason } : {}) },
      remediation:
        remediation ?? `Ensure valid items or auto-resolvable bindings exist for slot '${slot}'.`,
    });
  }

  static recipeNotFound(details?: Record<string, unknown>, remediation?: string): CraftingError {
    return new CraftingError({
      code: "RECIPE_NOT_FOUND",
      phase: "validate",
      message: "No matching Recipe found for the given ingredients combination.",
      ...(details !== undefined ? { details } : {}),
      remediation: remediation ?? "Check selected model and harness compatibility in the registry.",
    });
  }

  static incompatibleCombination(
    message: string,
    details?: Record<string, unknown>,
    remediation?: string,
  ): CraftingError {
    return new CraftingError({
      code: "INCOMPATIBLE_COMBINATION",
      phase: "validate",
      message,
      ...(details !== undefined ? { details } : {}),
      remediation: remediation ?? "Select compatible items that satisfy the Recipe requirements.",
    });
  }

  static runtimeUnavailable(
    harnessKind: string,
    message?: string,
    remediation?: string,
  ): CraftingError {
    return new CraftingError({
      code: "RUNTIME_UNAVAILABLE",
      phase: "runtime",
      message: message ?? `Runtime for harness '${harnessKind}' is unavailable or not running.`,
      details: { harnessKind },
      remediation:
        remediation ??
        `Verify that the ${harnessKind} binary or service is installed and accessible.`,
    });
  }

  static compilationError(
    message: string,
    details?: Record<string, unknown>,
    remediation?: string,
  ): CraftingError {
    return new CraftingError({
      code: "COMPILATION_ERROR",
      phase: "compile",
      message,
      ...(details !== undefined ? { details } : {}),
      remediation: remediation ?? "Review the recipe definition and input ingredient parameters.",
    });
  }

  static authRequired(harnessKind: string, remediation?: string): CraftingError {
    return new CraftingError({
      code: "AUTH_REQUIRED",
      phase: "runtime",
      message: `Authentication is required to run harness '${harnessKind}'.`,
      details: { harnessKind },
      remediation: remediation ?? `Please sign in or configure credentials for ${harnessKind}.`,
    });
  }

  static protocolMismatch(
    harnessKind: string,
    message = `Native protocol for harness '${harnessKind}' is incompatible.`,
  ): CraftingError {
    return new CraftingError({
      code: "PROTOCOL_MISMATCH",
      phase: "runtime",
      message,
      details: { harnessKind },
      remediation: `Update the official ${harnessKind} runtime and retry.`,
    });
  }

  static executionFailed(
    message: string,
    details?: Record<string, unknown>,
    remediation?: string,
  ): CraftingError {
    return new CraftingError({
      code: "EXECUTION_FAILED",
      phase: "runtime",
      message,
      ...(details !== undefined ? { details } : {}),
      remediation: remediation ?? "Check runtime logs and diagnose the execution failure.",
    });
  }

  static recoveryFailed(
    message: string,
    details?: Record<string, unknown>,
    remediation?: string,
  ): CraftingError {
    return new CraftingError({
      code: "RECOVERY_FAILED",
      phase: "recovery",
      message,
      ...(details !== undefined ? { details } : {}),
      remediation:
        remediation ?? "Verify whether the session reference still exists or recreate the session.",
    });
  }
}

export function toCraftingErrorDetail(
  error: unknown,
  fallbackPhase: CraftingPhase = "runtime",
): CraftingErrorDetail {
  if (error instanceof CraftingError) {
    return error.toDetail();
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "EXECUTION_FAILED",
    phase: fallbackPhase,
    message,
    details: { originalError: message },
    remediation: "Inspect error details and retry.",
  };
}
