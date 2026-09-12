import type { AccountView } from "@/shared/contracts";
import { useTokenUsageStore } from "@/renderer/state/tokenUsageStore";
import { resolveAccountTokenAttribution } from "./quotaStatus";

export type AccountUsageQueryStatus = "idle" | "loading" | "success" | "error";

export interface AccountUsageQueryState {
  quota: AccountUsageQueryStatus;
  token: AccountUsageQueryStatus;
  quotaError?: string;
  tokenError?: string;
}

function formatCompactToken(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function displayError(error: string | undefined): string {
  if (!error) return "查询失败";
  return error.replace(/\s+/gu, " ").trim().slice(0, 160) || "查询失败";
}

export function hasAccountQuotaValue(account: AccountView): boolean {
  return (
    account.quotaWindows?.some(
      (window) => typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent),
    ) ?? false
  );
}

export function accountQuotaFailureMessage(account: AccountView): string {
  if (account.lastError?.trim()) return account.lastError;
  switch (account.status) {
    case "auth-expired":
      return "账号授权已过期，需要重新授权。";
    case "unavailable":
      return "额度暂不可用。";
    case "quota-exhausted":
      return "额度已耗尽。";
    case "error":
      return "额度查询失败。";
    case "disabled":
      return "账号已禁用。";
    default:
      return "暂无可用额度数据。";
  }
}

/**
 * v0.5 per-account 2x2 usage grid: Quota / Token / Cache / Status. Quota and
 * token cells carry their own provenance; cache shows "—" when there is no
 * reliable cache source so estimates are never dressed up as official numbers.
 */
export function AccountUsageGrid(props: {
  account: AccountView;
  queryState?: AccountUsageQueryState | undefined;
}) {
  const { account } = props;
  const { queryState } = props;
  const tokenResponse = useTokenUsageStore((state) => state.response);
  const tokenLoading = useTokenUsageStore((state) => state.loading);
  const tokenStoreError = useTokenUsageStore((state) => state.error);

  const fastWindow = account.quotaWindows?.find((window) => window.id === "session-5h");
  const longWindow = account.quotaWindows?.find(
    (window) => window.id === "weekly" || window.id === "monthly",
  );
  const quotaValue =
    fastWindow?.usedPercent != null ? fastWindow.usedPercent : (longWindow?.usedPercent ?? null);

  // A provider-wide summary is not an account summary. Only render a token
  // value when the response contains an exact accountId breakdown entry; when
  // token data exists but not for this account, say so honestly instead of the
  // blanket "no exact usage".
  const tokenAttribution = resolveAccountTokenAttribution(
    tokenResponse?.summaries,
    account.accountId,
  );
  const tokenEntry = tokenAttribution.kind === "exact" ? tokenAttribution : undefined;
  const tokenTotal = tokenEntry?.totalTokens;
  const cacheRead = tokenEntry?.cacheReadTokens ?? 0;
  const cacheWrite = tokenEntry?.cacheWriteTokens ?? 0;
  const hasReliableCache = tokenEntry !== undefined && cacheRead + cacheWrite > 0;
  const tokenUnavailableReason =
    tokenResponse?.sources.find((source) => !source.available && source.unavailableReason)
      ?.unavailableReason ??
    tokenResponse?.summaries.find((summary) => summary.unavailableReason)?.unavailableReason ??
    (tokenResponse?.sources.find((source) => !source.available) ? "精确用量暂不可用。" : undefined);
  const hasQuota = hasAccountQuotaValue(account);
  const quotaValueLabel =
    queryState?.quota === "loading"
      ? "加载中…"
      : hasQuota
        ? `${Math.round(quotaValue!)}%`
        : queryState?.quota === "error"
          ? displayError(queryState.quotaError ?? accountQuotaFailureMessage(account))
          : account.lastError
            ? displayError(account.lastError)
            : queryState?.quota === "success" || account.status !== "available"
              ? displayError(accountQuotaFailureMessage(account))
              : "—";
  const tokenValueLabel =
    queryState?.token === "loading" || (!queryState && tokenLoading)
      ? "加载中…"
      : queryState?.token === "error"
        ? displayError(queryState.tokenError ?? tokenStoreError ?? tokenUnavailableReason)
        : tokenUnavailableReason && tokenEntry === undefined
          ? displayError(tokenUnavailableReason)
          : tokenTotal == null
            ? queryState?.token === "success" || tokenResponse !== null
              ? tokenAttribution.kind === "unattributable"
                ? "无法精确归因"
                : "暂无精确用量"
              : "—"
            : formatCompactToken(tokenTotal);

  return (
    <div
      data-testid={`account-usage-grid-${account.accountId}`}
      className="mt-1.5 grid grid-cols-2 gap-1.5 text-[9px] text-neutral-400"
    >
      <div className="rounded-md bg-white/4 px-1.5 py-1" data-state={queryState?.quota ?? "idle"}>
        <span className="block text-neutral-500">额度</span>
        <span
          className="tabular-nums text-foreground"
          data-testid={`account-quota-value-${account.accountId}`}
        >
          {quotaValueLabel}
        </span>
      </div>
      <div className="rounded-md bg-white/4 px-1.5 py-1" data-state={queryState?.token ?? "idle"}>
        <span className="block text-neutral-500">Token</span>
        <span
          className="tabular-nums text-foreground"
          data-testid={`account-token-value-${account.accountId}`}
        >
          {tokenValueLabel}
        </span>
      </div>
      <div className="rounded-md bg-white/4 px-1.5 py-1">
        <span className="block text-neutral-500">缓存</span>
        <span className="tabular-nums text-foreground">
          {hasReliableCache ? formatCompactToken(cacheRead + cacheWrite) : "—"}
        </span>
      </div>
      <div className="rounded-md bg-white/4 px-1.5 py-1">
        <span className="block text-neutral-500">状态</span>
        <span className="text-foreground">{account.status}</span>
      </div>
    </div>
  );
}
