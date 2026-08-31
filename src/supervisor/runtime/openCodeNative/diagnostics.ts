import type { NativeHarnessDiagnostic } from "@/shared/crafting";

const SECRET_NAME = String.raw`(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|password|cookie|secret|credential|oauth|auth)`;
const SECRET_KEY = new RegExp(SECRET_NAME, "iu");

function normalizeEscapedJsonQuotes(text: string): string {
  return text.replace(/\\(["'])/gu, (_match, quote: string) => quote);
}

export function safeMessage(value: unknown): string {
  const text = normalizeEscapedJsonQuotes(value instanceof Error ? value.message : String(value));
  return text
    .replace(
      new RegExp(
        String.raw`\b((?:proxy-)?authorization)\s*[:=]\s*(?:Basic|Bearer)\s+[^\s,;}"']+`,
        "giu",
      ),
      (_match, name: string) => `${name}=[REDACTED]`,
    )
    .replace(
      new RegExp(String.raw`(["']?)(auth|oauth|credential)\1\s*:\s*\{[^{}]{0,2000}\}`, "giu"),
      (_match, quote: string, name: string) =>
        quote ? `${quote}${name}${quote}:"[REDACTED]"` : `${name}=[REDACTED]`,
    )
    .replace(
      new RegExp(String.raw`(["'])(${SECRET_NAME})\1\s*:\s*(["'])[^"']*\3`, "giu"),
      (_match, quote: string, name: string) => `${quote}${name}${quote}:"[REDACTED]"`,
    )
    .replace(
      new RegExp(String.raw`\b(${SECRET_NAME})\s*[:=]\s*[^\s,;}"']+`, "giu"),
      (_match, name: string) => `${name}=[REDACTED]`,
    )
    .replace(
      /([?&](?:token|secret|key|api_key|password|auth)=)[^&\s]+/giu,
      (_match, prefix: string) => `${prefix}[REDACTED]`,
    )
    .replace(/\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/giu, "[REDACTED_AUTH]")
    .slice(0, 500);
}

function safeDetails(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (depth >= 4) return "[TRUNCATED]";
  if (typeof value === "string") return safeMessage(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 32).map((entry) => safeDetails(entry, "", depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 64)
        .map(([name, entry]) => [name, safeDetails(entry, name, depth + 1)]),
    );
  }
  return undefined;
}

export function diagnosticPhase(operation: string): NativeHarnessDiagnostic["phase"] {
  if (operation === "transport.discover") return "discovery";
  if (operation === "transport.connect" || operation === "sse.reconnect") return "readiness";
  if (operation === "server.start" || operation === "session.create") return "start";
  if (operation === "session.get") return "resume";
  if (operation === "session.abort") return "interrupt";
  if (
    operation === "session.delete" ||
    operation === "transport.dispose" ||
    operation === "server.child-exit"
  ) {
    return "dispose";
  }
  return "turn";
}

export function buildOpenCodeNativeDiagnostic(input: {
  readonly correlationId: string;
  readonly operation: string;
  readonly code: NativeHarnessDiagnostic["code"];
  readonly message: unknown;
  readonly details?: Record<string, unknown> | undefined;
  readonly providerCode?: string | undefined;
  readonly remediation?: string | undefined;
}): NativeHarnessDiagnostic {
  return {
    code: input.code,
    harnessKind: "opencode",
    phase: diagnosticPhase(input.operation),
    operation: input.operation,
    message: safeMessage(input.message),
    correlationId: input.correlationId,
    ...(input.providerCode ? { providerCode: safeMessage(input.providerCode) } : {}),
    ...(input.remediation ? { remediation: safeMessage(input.remediation) } : {}),
    ...(input.details ? { details: safeDetails(input.details) as Record<string, unknown> } : {}),
    occurredAt: new Date().toISOString(),
  };
}
