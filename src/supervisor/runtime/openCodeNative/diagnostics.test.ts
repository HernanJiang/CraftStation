import { describe, expect, it } from "vitest";
import { buildOpenCodeNativeDiagnostic, diagnosticPhase, safeMessage } from "./diagnostics";

describe("OpenCode native diagnostic contract", () => {
  it.each([
    ["transport.connect", "readiness"],
    ["session.create", "start"],
    ["session.get", "resume"],
    ["session.promptAsync", "turn"],
    ["session.abort", "interrupt"],
    ["sse.reconnect", "readiness"],
    ["session.delete", "dispose"],
    ["server.child-exit", "dispose"],
  ] as const)("maps %s to %s", (operation, phase) => {
    const record = buildOpenCodeNativeDiagnostic({
      correlationId: `corr:${operation}`,
      operation,
      code: operation === "session.delete" ? "CLEANUP_FAILED" : "NATIVE_EXECUTION_FAILED",
      message: "operation failed",
    });
    expect(diagnosticPhase(operation)).toBe(phase);
    expect(record).toMatchObject({ operation, phase, correlationId: `corr:${operation}` });
  });

  it("redacts Basic/Bearer/query and nested secret material without replacement corruption", () => {
    const record = buildOpenCodeNativeDiagnostic({
      correlationId: "corr:redaction",
      operation: "session.promptAsync",
      code: "NATIVE_EXECUTION_FAILED",
      message:
        "Basic dXNlcjpwYXNz Bearer token-value api_key=sk-secret https://x.test?a=1&token=query-secret",
      details: {
        nested: {
          password: "nested-password",
          child: { authorization: "Bearer nested-token" },
        },
      },
    });
    const serialized = JSON.stringify(record);
    for (const secret of [
      "dXNlcjpwYXNz",
      "token-value",
      "sk-secret",
      "query-secret",
      "nested-password",
      "nested-token",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("$1");
    expect(safeMessage("api_key=abc")).toBe("api_key=[REDACTED]");
  });

  it("redacts header, JSON, camelCase, auth/oauth and credential-shaped secret values", () => {
    const secrets = [
      "header-bearer-secret",
      "header-basic-secret",
      "json-api-secret",
      "nested-auth-secret",
      "nested-oauth-secret",
      "nested-credential-secret",
    ];
    const record = buildOpenCodeNativeDiagnostic({
      correlationId: "corr:structured-redaction",
      operation: "transport.connect",
      code: "RUNTIME_UNAVAILABLE",
      message:
        'Authorization: Bearer header-bearer-secret; Proxy-Authorization=Basic header-basic-secret; {"apiKey":"json-api-secret"}',
      details: {
        auth: { value: "nested-auth-secret" },
        oauth: { access: "nested-oauth-secret" },
        credential: { value: "nested-credential-secret" },
      },
    });

    const serialized = JSON.stringify(record);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("$1");
  });

  it("redacts escaped JSON scalars and nested credential carriers", () => {
    const secrets = [
      "escaped-api-secret",
      "escaped-access-secret",
      "escaped-refresh-secret",
      "escaped-auth-secret",
      "escaped-oauth-secret",
      "escaped-credential-secret",
    ];
    const message = [
      String.raw`payload={\"apiKey\":\"escaped-api-secret\"}`,
      String.raw`tokens={\"accessToken\":\"escaped-access-secret\",\"refreshToken\":\"escaped-refresh-secret\"}`,
      String.raw`nested={\"auth\":{\"value\":\"escaped-auth-secret\"}}`,
      String.raw`nested={\"oauth\":{\"value\":\"escaped-oauth-secret\"}}`,
      String.raw`nested={\"credential\":{\"value\":\"escaped-credential-secret\"}}`,
    ].join(" ");

    const sanitized = safeMessage(message);
    for (const secret of secrets) expect(sanitized).not.toContain(secret);
    expect(sanitized).not.toContain("$1");
  });
});
