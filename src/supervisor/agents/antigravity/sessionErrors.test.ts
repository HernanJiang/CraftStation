import { describe, expect, it } from "vitest";
import { isAntigravityAuthError, isAntigravityQuotaError } from "./sessionErrors";

describe("antigravity session errors", () => {
  it("matches quota exhaustion shapes", () => {
    expect(isAntigravityQuotaError("RESOURCE_EXHAUSTED (code 429): Individual quota reached")).toBe(
      true,
    );
    expect(isAntigravityQuotaError("quota exceeded for model")).toBe(true);
    expect(isAntigravityQuotaError("quota exhausted, resets tomorrow")).toBe(true);
  });

  it("matches auth shapes", () => {
    expect(isAntigravityAuthError("not logged into Antigravity, please sign in")).toBe(true);
    expect(isAntigravityAuthError("authentication failed")).toBe(true);
    expect(isAntigravityAuthError("unauthenticated")).toBe(true);
  });

  it("rejects model, project, and transport errors", () => {
    expect(isAntigravityQuotaError('invalid model selection "gemini-3.6-flash"')).toBe(false);
    expect(isAntigravityQuotaError("project not found")).toBe(false);
    expect(isAntigravityAuthError("transport closed")).toBe(false);
    expect(isAntigravityAuthError("quota exceeded")).toBe(false);
  });
});
