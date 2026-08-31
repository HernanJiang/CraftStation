import type { AccountStatus } from "@/shared/contracts/accounts";
import type { UsageStatus, UsageWindow } from "@/shared/contracts/usage";

export type QuotaDisplayState = "sufficient" | "low" | "unavailable";

const UNAVAILABLE_ACCOUNT_STATUSES = new Set<AccountStatus>([
  "quota-exhausted",
  "auth-expired",
  "unavailable",
  "disabled",
  "error",
]);

const UNAVAILABLE_USAGE_STATUSES = new Set<UsageStatus>([
  "auth-missing",
  "app-not-running",
  "rate-limited",
  "quota-hit",
  "unsupported",
  "error",
]);

export function maxUsedPercent(
  windows: readonly Pick<UsageWindow, "usedPercent">[],
): number | null {
  if (windows.length === 0) return null;
  const values = windows
    .map((window) => window.usedPercent)
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

export function resolveAccountQuotaDisplayState(
  status: AccountStatus,
  windows: readonly Pick<UsageWindow, "usedPercent">[],
): QuotaDisplayState {
  if (UNAVAILABLE_ACCOUNT_STATUSES.has(status)) return "unavailable";
  const measuredState = resolveMeasuredQuotaState(maxUsedPercent(windows));
  // A full window is exhausted even if the persisted account status still
  // says quota-low while the asynchronous refresh is catching up.
  if (measuredState === "unavailable") return "unavailable";
  if (status === "quota-low") return "low";
  return measuredState;
}

export function resolveProviderQuotaDisplayState(
  status: UsageStatus,
  windows: readonly Pick<UsageWindow, "usedPercent">[],
): QuotaDisplayState {
  if (UNAVAILABLE_USAGE_STATUSES.has(status)) return "unavailable";
  return resolveMeasuredQuotaState(maxUsedPercent(windows));
}

function resolveMeasuredQuotaState(usedPercent: number | null): QuotaDisplayState {
  if (usedPercent === null || usedPercent >= 100) return "unavailable";
  // Keep the renderer in lock-step with the supervisor's quota-low rule.
  // A value at 90% is a warning; 100% is no longer usable.
  return usedPercent >= 90 ? "low" : "sufficient";
}

export function quotaDisplayStateLabel(state: QuotaDisplayState): string {
  switch (state) {
    case "sufficient":
      return "额度充足";
    case "low":
      return "额度低";
    case "unavailable":
      return "不可用";
  }
}

export function quotaDisplayStateClass(state: QuotaDisplayState): string {
  switch (state) {
    case "sufficient":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
    case "low":
      return "border-amber-400/20 bg-amber-400/10 text-amber-300";
    case "unavailable":
      return "border-red-400/20 bg-red-400/10 text-red-300";
  }
}

export function formatUsedQuota(usedPercent: number | null): string {
  return usedPercent === null ? "已用额度 --" : `已用额度 ${Math.round(usedPercent)}%`;
}

/** Convert implementation/provenance text into a stable user-facing message. */
export function userFacingTokenMessage(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  if (/runtime ledger|\bledger\b|exact (account )?usage|精确.*用量/iu.test(reason)) {
    return "暂无精确 Token 用量";
  }
  return reason;
}
