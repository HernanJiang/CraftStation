import { switcherDisplayWindow } from "@craftstation/agents-usage/switcherQuota";
import type { AccountStatus } from "@/shared/contracts/accounts";
import type { TokenUsageSummary } from "@/shared/contracts";
import type { UsageStatus } from "@/shared/contracts/usage";

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
  windows: readonly { id?: string; usedPercent: number; unit?: string | undefined }[],
  providerId = "",
): number | null {
  if (windows.length === 0) return null;
  const headline = switcherDisplayWindow(
    providerId,
    windows.map((window) => ({
      id: window.id ?? "",
      usedPercent: window.usedPercent,
      ...(window.unit ? { unit: window.unit } : {}),
    })),
  );
  if (headline && Number.isFinite(headline.usedPercent)) return headline.usedPercent;
  const values = windows
    .map((window) => window.usedPercent)
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

export function resolveAccountQuotaDisplayState(
  status: AccountStatus,
  windows: readonly { id?: string; usedPercent: number; unit?: string | undefined }[],
  providerId = "",
): QuotaDisplayState {
  if (UNAVAILABLE_ACCOUNT_STATUSES.has(status)) return "unavailable";
  const measuredState = resolveMeasuredQuotaState(maxUsedPercent(windows, providerId));
  // A full window is exhausted even if the persisted account status still
  // says quota-low while the asynchronous refresh is catching up.
  if (measuredState === "unavailable") return "unavailable";
  if (status === "quota-low") return "low";
  return measuredState;
}

export function resolveProviderQuotaDisplayState(
  status: UsageStatus,
  windows: readonly { id?: string; usedPercent: number; unit?: string | undefined }[],
  providerId = "",
): QuotaDisplayState {
  if (UNAVAILABLE_USAGE_STATUSES.has(status)) return "unavailable";
  return resolveMeasuredQuotaState(maxUsedPercent(windows, providerId));
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

export type AccountTokenAttribution =
  /** A non-estimated per-account breakdown entry pins usage to this account. */
  | {
      kind: "exact";
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    }
  /** Token data exists, but no breakdown entry pins it to this account. */
  | { kind: "unattributable" }
  /** No token data at all. */
  | { kind: "none" };

/**
 * Attribute ledger token usage to one account (Provider → Account). An exact
 * (or derived) `byAccount` entry keyed by this account id is real per-account
 * usage. When the response carries token totals but nothing for this account,
 * the usage genuinely cannot be attributed — report that instead of the
 * blanket "暂无精确 Token 用量", which is reserved for having no data at all.
 */
export function resolveAccountTokenAttribution(
  summaries: readonly TokenUsageSummary[] | undefined,
  accountId: string,
): AccountTokenAttribution {
  const exact = summaries
    ?.flatMap((summary) =>
      summary.byAccount
        .filter((entry) => entry.key === accountId)
        .map((entry) => ({ summary, entry })),
    )
    .find(({ summary }) => summary.quality !== "estimated");
  if (exact) {
    return {
      kind: "exact",
      inputTokens: exact.entry.inputTokens,
      outputTokens: exact.entry.outputTokens,
      totalTokens: exact.entry.totalTokens,
      cacheReadTokens: exact.entry.cacheReadTokens,
      cacheWriteTokens: exact.entry.cacheWriteTokens,
    };
  }
  const hasData = summaries?.some((summary) => summary.totalTokens > 0) ?? false;
  return hasData ? { kind: "unattributable" } : { kind: "none" };
}
