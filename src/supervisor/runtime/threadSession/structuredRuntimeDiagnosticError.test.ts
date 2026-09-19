import { describe, expect, it } from "vitest";
import { AccountControlError } from "@/shared/contracts";
import { classifySupervisorFailure } from "@/supervisor/diagnostics/sentry";
import {
  StructuredRuntimeDiagnosticError,
  structuredRuntimeCauseHint,
} from "./structuredRuntimeDiagnosticError";

describe("structured runtime diagnostic privacy", () => {
  it("does not project arbitrary short provider text into the diagnostic identity", () => {
    expect(structuredRuntimeCauseHint(new Error("private user prompt"))).toBeUndefined();
    expect(structuredRuntimeCauseHint(new Error("sk-fixture-secret"))).toBeUndefined();
  });

  it("keeps actionable account guidance while classifying by stable failure identity", () => {
    const account = new AccountControlError(
      "ACCOUNT_NOT_FOUND",
      "Selected account is unavailable.",
    );
    const hint = structuredRuntimeCauseHint(account);
    expect(hint).toBe(account.message);
    const error = new StructuredRuntimeDiagnosticError("session-creation", "codex", hint);
    expect(error.message).toContain(account.message);
    expect(classifySupervisorFailure(error, "startThread")).toMatchObject({
      errorClass: "session-creation-failed",
      domain: "structured-runtime",
      treatment: "capture",
    });
    const diagnostic = new StructuredRuntimeDiagnosticError(
      error.failureClass,
      error.diagnosticProvider,
    );
    expect(diagnostic.message).toBe("Structured runtime session creation failed.");
    expect(
      structuredRuntimeCauseHint(new AccountControlError("ACCOUNT_NOT_FOUND", "api_key=fixture")),
    ).toBeUndefined();
  });
});
