import type { CraftStationChannel } from "@/shared/channel";
import type { CraftStationDiagnosticTags } from "@/shared/diagnostics/sentryPrivacy";

export type UpdateOperation = "check" | "download";

export type UpdateFailureKind =
  | "transient-network"
  | "optional-manifest-missing"
  | "required-manifest-missing"
  | "artifact-integrity"
  | "disk"
  | "unexpected";

export interface ClassifiedUpdateFailure {
  readonly kind: UpdateFailureKind;
  readonly retryable: boolean;
}

const TRANSIENT_NETWORK_CODES = new Set([
  "EPIPE",
  "ECONNRESET",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);
const TRANSIENT_HTTP_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const DISK_ERROR_CODES = new Set(["ENOSPC", "EACCES", "EPERM", "EROFS"]);
const UPDATE_MANIFEST_PATTERN = /(?:latest|nightly)(?:-[a-z0-9]+)?\.ya?ml/i;
const MISSING_RELEASE_PATTERN =
  /unable to find latest version|no published versions|releases\/latest/i;
const INTEGRITY_PATTERN =
  /(?:artifact[^.]*\b(?:corrupt|invalid|missing)|checksum|code signature|hash mismatch|integrity|sha512|signature)/i;

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth += 1) {
    chain.push(current);
    if (typeof current !== "object" || !("cause" in current)) break;
    current = current.cause;
  }
  return chain;
}

function errorCode(error: unknown): string | null {
  for (const item of errorChain(error)) {
    if (typeof item !== "object" || item === null || !("code" in item)) continue;
    if (typeof item.code === "string") return item.code.toUpperCase();
  }
  return null;
}

function hasTimeoutName(error: unknown): boolean {
  for (const item of errorChain(error)) {
    if (item instanceof Error && (item.name === "AbortError" || item.name === "TimeoutError")) {
      return true;
    }
  }
  return false;
}

function errorMessage(error: unknown): string {
  return errorChain(error)
    .map((item) => (item instanceof Error ? item.message : ""))
    .filter(Boolean)
    .join(" ");
}

function errorStatus(error: unknown): number | null {
  for (const item of errorChain(error)) {
    if (typeof item !== "object" || item === null || !("statusCode" in item)) continue;
    if (typeof item.statusCode === "number") return item.statusCode;
  }
  return null;
}

function isTransientHttp(error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== null && TRANSIENT_HTTP_STATUSES.has(status)) return true;
  return /net::ERR_/i.test(errorMessage(error));
}

function isMissingUpdateFeed(error: unknown, operation: UpdateOperation): boolean {
  if (operation !== "check") return false;
  const message = errorMessage(error);
  const is404 = errorStatus(error) === 404 || /\b404\b/.test(message);
  if (is404 && UPDATE_MANIFEST_PATTERN.test(message)) return true;
  if (MISSING_RELEASE_PATTERN.test(message)) return true;
  return is404 && /github/i.test(message);
}

export function classifyUpdateFailure(
  error: unknown,
  operation: UpdateOperation,
  channel: CraftStationChannel,
): ClassifiedUpdateFailure {
  const code = errorCode(error);
  const message = errorMessage(error);

  if (code && TRANSIENT_NETWORK_CODES.has(code)) {
    return { kind: "transient-network", retryable: true };
  }
  if (hasTimeoutName(error) || isTransientHttp(error)) {
    return { kind: "transient-network", retryable: true };
  }
  if (isMissingUpdateFeed(error, operation)) {
    return {
      kind: channel === "nightly" ? "optional-manifest-missing" : "required-manifest-missing",
      retryable: false,
    };
  }
  if (code && DISK_ERROR_CODES.has(code)) {
    return { kind: "disk", retryable: false };
  }
  if (INTEGRITY_PATTERN.test(message)) {
    return { kind: "artifact-integrity", retryable: false };
  }
  return { kind: "unexpected", retryable: false };
}

export class UpdateDiagnosticError extends Error {
  constructor(
    readonly operation: UpdateOperation,
    readonly outcome: UpdateFailureKind,
  ) {
    super(`Updater ${operation} failed: ${outcome}.`);
    this.name = "UpdateDiagnosticError";
  }
}

function normalizePlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
    case "linux":
    case "win32":
      return platform;
    default:
      return "other";
  }
}

export function buildUpdateDiagnosticTags(
  channel: CraftStationChannel,
  operation: UpdateOperation,
  outcome: UpdateFailureKind,
  platform: NodeJS.Platform = process.platform,
): CraftStationDiagnosticTags {
  return {
    "craftstation.feature_area": "updates",
    "craftstation.channel": channel,
    "craftstation.platform": normalizePlatform(platform),
    "event.origin": `updater.${operation}.${outcome}`,
  };
}
