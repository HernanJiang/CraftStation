import type { AgentStatus } from "@/shared/contracts";
import { WINDOWS_WSL_LAUNCH_FALLBACK_KINDS } from "@/shared/agentStatus";
import type {
  NativeHarnessControlPlaneEntry,
  NativeHarnessDiagnostic,
  NativeHarnessDescriptor,
  NativeHarnessPublicDiagnostic,
  NativeHarnessPublicDescriptor,
} from "@/shared/crafting";
import { THIRD_PARTY_ACCOUNT_PROVIDER } from "@/shared/thirdPartyRouting";

export interface NativeHarnessControlPlaneProjectionInput {
  descriptors: readonly NativeHarnessDescriptor[];
  statuses: readonly AgentStatus[];
  profileConfigured: ReadonlySet<string>;
  environmentKind: "windows" | "posix" | "wsl";
  diagnostics?: ReadonlyMap<string, readonly NativeHarnessDiagnostic[]>;
}

function safeBoundaryLabel(boundary: string): string {
  // A machine-facing boundary is useful to explain the adapter, but a public
  // projection must never echo a physical executable/profile path.
  if (/[A-Za-z]:[\\/]|(?:^|\s)\\\\|(?:^|\s)\/(?:[^/\s]+\/)+/u.test(boundary)) {
    return "native runtime boundary";
  }
  return boundary;
}

function publicDescriptor(descriptor: NativeHarnessDescriptor): NativeHarnessPublicDescriptor {
  return {
    id: descriptor.id,
    harnessKind: descriptor.harnessKind,
    label: descriptor.label,
    vendor: descriptor.vendor,
    official: descriptor.official,
    transport: descriptor.transport,
    machineFacingBoundary: safeBoundaryLabel(descriptor.machineFacingBoundary),
    capabilities: { ...descriptor.capabilities },
  };
}

function pickAgentStatus(
  descriptor: NativeHarnessDescriptor,
  statuses: readonly AgentStatus[],
): AgentStatus | undefined {
  const native = statuses.find(
    (candidate) => candidate.kind === descriptor.harnessKind && candidate.envKind !== "wsl",
  );
  if (native?.installed) return native;
  const allowWsl = (WINDOWS_WSL_LAUNCH_FALLBACK_KINDS as readonly string[]).includes(
    descriptor.harnessKind,
  );
  if (!allowWsl) return native;
  const wsl = statuses.find(
    (candidate) =>
      candidate.kind === descriptor.harnessKind &&
      candidate.envKind === "wsl" &&
      candidate.installed,
  );
  return wsl ?? native;
}

function statusFor(
  descriptor: NativeHarnessDescriptor,
  status: AgentStatus | undefined,
  diagnostics: readonly NativeHarnessDiagnostic[],
  profileConfigured: ReadonlySet<string>,
): NativeHarnessControlPlaneEntry["status"] {
  if (
    descriptor.transport === "unavailable" ||
    diagnostics.some((diagnostic) => diagnostic.code === "RUNTIME_UNAVAILABLE") ||
    (descriptor.harnessKind === "deepseek" && !status)
  )
    return "unavailable";
  if (
    diagnostics.some((diagnostic) =>
      [
        "PROTOCOL_MISMATCH",
        "NATIVE_PROCESS_CRASHED",
        "NATIVE_SESSION_NOT_FOUND",
        "NATIVE_EXECUTION_FAILED",
        "CLEANUP_FAILED",
      ].includes(diagnostic.code),
    )
  ) {
    return "error";
  }
  if (!status) return "not-configured";
  if (!status.installed) return "unavailable";
  if (status.authState === "authenticated") return "ready";
  // Muse Code consumes a third-party OpenAI-compatible key as META_API_KEY at
  // spawn. Official `muse login` is only for Meta's own account.
  if (
    descriptor.harnessKind === "muse" &&
    profileConfigured.has(THIRD_PARTY_ACCOUNT_PROVIDER)
  ) {
    return "ready";
  }
  if (status.authState === "missing") return "not-configured";
  return "not-configured";
}

function stableDiagnosticMessage(
  code: NativeHarnessPublicDiagnostic["code"],
  harnessKind: string,
): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return `${harnessKind} requires authentication.`;
    case "RUNTIME_NOT_CONFIGURED":
      return `${harnessKind} native runtime is not configured.`;
    case "RUNTIME_UNAVAILABLE":
      return `${harnessKind} native runtime is unavailable.`;
    case "PROTOCOL_MISMATCH":
      return `${harnessKind} native protocol is incompatible.`;
    case "NATIVE_PROCESS_CRASHED":
      return `${harnessKind} native process exited unexpectedly.`;
    case "NATIVE_SESSION_NOT_FOUND":
      return `${harnessKind} native session was not found.`;
    case "NATIVE_EXECUTION_FAILED":
      return `${harnessKind} native execution failed.`;
    case "NATIVE_STDERR":
      return `${harnessKind} native runtime emitted diagnostic output.`;
    case "CLEANUP_FAILED":
      return `${harnessKind} native cleanup failed.`;
  }
}

function stableRemediation(code: NativeHarnessPublicDiagnostic["code"]): string | undefined {
  switch (code) {
    case "AUTH_REQUIRED":
      return "Authenticate through the provider's official runtime entry point.";
    case "RUNTIME_NOT_CONFIGURED":
    case "RUNTIME_UNAVAILABLE":
      return "Install and configure the official native runtime, then refresh status.";
    case "PROTOCOL_MISMATCH":
      return "Update the official runtime and retry discovery.";
    case "NATIVE_SESSION_NOT_FOUND":
      return "Start a new native session or select a persisted session that still exists.";
    default:
      return undefined;
  }
}

function publicDiagnostic(diagnostic: NativeHarnessDiagnostic): NativeHarnessPublicDiagnostic {
  const code = diagnostic.code;
  return {
    code,
    harnessKind: diagnostic.harnessKind,
    phase: diagnostic.phase,
    operation: diagnostic.operation,
    message: stableDiagnosticMessage(code, diagnostic.harnessKind),
    ...(stableRemediation(code) ? { remediation: stableRemediation(code) } : {}),
  };
}

function dedupeDiagnostics(
  diagnostics: readonly NativeHarnessDiagnostic[],
): NativeHarnessPublicDiagnostic[] {
  const seen = new Set<string>();
  const result: NativeHarnessPublicDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const publicRecord = publicDiagnostic(diagnostic);
    const key = `${publicRecord.code}|${publicRecord.phase}|${publicRecord.operation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(publicRecord);
  }
  return result;
}

function fallbackDiagnostic(
  descriptor: NativeHarnessDescriptor,
  status: NativeHarnessControlPlaneEntry["status"],
  agentStatus: AgentStatus | undefined,
): NativeHarnessPublicDiagnostic | undefined {
  // An error status is always caused by a supplied native diagnostic. Do not
  // append the generic readiness fallback, otherwise a protocol/process
  // failure is misleadingly reported as an additional configuration issue.
  if (status === "ready" || status === "error") return undefined;
  const code: NativeHarnessPublicDiagnostic["code"] =
    status === "unavailable"
      ? "RUNTIME_UNAVAILABLE"
      : agentStatus?.authState === "missing"
        ? "AUTH_REQUIRED"
        : "RUNTIME_NOT_CONFIGURED";
  return publicDiagnostic({
    code,
    harnessKind: descriptor.harnessKind,
    phase: "readiness",
    operation: "control-plane-status",
    message: stableDiagnosticMessage(code, descriptor.harnessKind),
    occurredAt: new Date(0).toISOString(),
  });
}

/**
 * Project supervisor-owned native runtime state into a renderer-safe snapshot.
 * The projection deliberately drops profile refs, environment values,
 * executable paths, provider codes, timestamps, and diagnostic details.
 */
export function projectNativeHarnessControlPlane(
  input: NativeHarnessControlPlaneProjectionInput,
): NativeHarnessControlPlaneEntry[] {
  return input.descriptors.map((descriptor) => {
    const agentStatus = pickAgentStatus(descriptor, input.statuses);
    const supplied = input.diagnostics?.get(descriptor.harnessKind) ?? [];
    const diagnostics = dedupeDiagnostics(supplied);
    const status = statusFor(descriptor, agentStatus, supplied, input.profileConfigured);
    const fallback = fallbackDiagnostic(descriptor, status, agentStatus);
    if (fallback && !diagnostics.some((entry) => entry.code === fallback.code)) {
      diagnostics.push(fallback);
    }
    return {
      descriptor: publicDescriptor(descriptor),
      status,
      profileConfigured: input.profileConfigured.has(descriptor.harnessKind),
      environmentKind: agentStatus?.envKind ?? input.environmentKind,
      diagnostics,
    };
  });
}
