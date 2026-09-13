import type { AccountView, UsageSnapshot } from "@/shared/contracts";
import { useTokenUsageStore } from "@/renderer/state/tokenUsageStore";
import type { AccountUsageQueryState } from "./AccountUsageGrid";
import { accountQuotaFailureMessage, hasAccountQuotaValue } from "./AccountUsageGrid";
import {
  formatUsedQuota,
  resolveAccountTokenAttribution,
  userFacingTokenMessage,
} from "./quotaStatus";

function formatResetsAt(value: number | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "恢复时间未知";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "恢复时间未知";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return month + "-" + day + " " + hour + ":" + minute;
  } catch {
    return "恢复时间未知";
  }
}

function formatCompactToken(value: number): string {
  if (value >= 1000000) return (value / 1000000).toFixed(1) + "M";
  if (value >= 1000) return (value / 1000).toFixed(1) + "k";
  return String(value);
}

type QuotaWindowLike = {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt?: number | undefined;
};

function resolveQuotaWindows<T extends QuotaWindowLike>(
  windows: readonly T[],
): {
  fast: T | undefined;
  long: T | undefined;
} {
  if (windows.length === 0) return { fast: undefined, long: undefined };
  const byId = (part: string) =>
    windows.find((w) => w.id.toLowerCase().includes(part) || w.label.toLowerCase().includes(part));
  let fast = byId("5h") ?? byId("session");
  let long = byId("weekly") ?? byId("week") ?? byId("monthly") ?? byId("month");
  if (!fast && !long) {
    fast = windows[0];
    long = windows[1];
  }
  if (fast && long && fast === long && windows.length > 1) {
    const idx = windows.indexOf(fast);
    const alt = windows[(idx + 1) % windows.length];
    if (alt !== fast) long = alt;
  }
  return { fast, long };
}

function deriveWindowLabel(window: QuotaWindowLike): string {
  const label = window.label?.trim();
  if (label) return label;
  const id = window.id.toLowerCase();
  if (id.includes("5h") || id.includes("session")) return "5h 限额";
  if (id.includes("week")) return "周/月限额";
  return window.id;
}

/**
 * Honest quota rows: render the windows the collector actually returned, with
 * their own labels (e.g. Grok "Monthly credits", Antigravity "Gemini · 5h").
 * The legacy forced "5h 限额 / 周/月限额" pair only applies when the windows
 * really are a 5h+weekly pair — otherwise a Grok credits window rendered as a
 * meaningless "5h -- / 周月 --" pair (user acceptance defect).
 */
function quotaRows(windows: readonly QuotaWindowLike[]): QuotaWindowLike[] {
  const fast = windows.find(
    (w) => w.id.toLowerCase().includes("5h") || w.id.toLowerCase().includes("session"),
  );
  const long = windows.find(
    (w) =>
      w.id.toLowerCase().includes("week") ||
      w.id.toLowerCase().includes("month") ||
      w.label.includes("周") ||
      w.label.includes("月"),
  );
  if (fast && long && windows.length <= 2) return [fast, long];
  return windows.slice(0, 4);
}

function formatQuotaResetParts(
  fast: QuotaWindowLike | undefined,
  long: QuotaWindowLike | undefined,
): string {
  const parts: string[] = [];
  parts.push("5h " + formatResetsAt(fast?.resetsAt));
  if (long) {
    const lowerId = long.id.toLowerCase();
    const label =
      lowerId.includes("week") || long.label.includes("周")
        ? "周"
        : lowerId.includes("month") || long.label.includes("月")
          ? "月"
          : "周/月";
    parts.push(label + " " + formatResetsAt(long.resetsAt));
  } else {
    parts.push("周/月 恢复时间未知");
  }
  return parts.join(" · ");
}

function formatWindowResetParts(windows: readonly QuotaWindowLike[]): string {
  if (windows.length === 0) return "恢复时间未知";
  return windows
    .map((window) => `${deriveWindowLabel(window)} ${formatResetsAt(window.resetsAt)}`)
    .join(" · ");
}

function resolveAccountQuotaWindows(account: AccountView) {
  return resolveQuotaWindows(account.quotaWindows ?? []);
}

function UsageBar(props: { label: string; value: number | null }) {
  const value = props.value == null ? null : Math.max(0, Math.min(100, Math.round(props.value)));
  const fillClass =
    value == null
      ? "bg-white/20"
      : value >= 100
        ? "bg-red-400"
        : value >= 90
          ? "bg-amber-400"
          : "bg-emerald-400";
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-[10px] text-neutral-400">
      <span>{props.label}</span>
      <span
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(value == null ? {} : { "aria-valuenow": value })}
        className="relative flex h-4 min-w-0 items-center justify-center overflow-hidden rounded-full bg-white/10"
      >
        <span
          aria-hidden="true"
          className={"absolute inset-y-0 left-0 rounded-full " + fillClass}
          style={{ width: (value ?? 0) + "%" }}
        />
        <span className="relative z-10 px-1 text-[9px] font-medium leading-none text-white/90 tabular-nums drop-shadow-sm">
          {formatUsedQuota(value)}
        </span>
      </span>
    </div>
  );
}

export function AccountQuotaCard(props: {
  account: AccountView;
  queryState?: AccountUsageQueryState | undefined;
}) {
  const { account, queryState } = props;
  const tokenResponse = useTokenUsageStore((state) => state.response);
  const tokenLoading = useTokenUsageStore((state) => state.loading);
  const { fast, long } = resolveAccountQuotaWindows(account);
  const hasQuota = hasAccountQuotaValue(account);
  const statusFailure =
    account.status === "error" ||
    account.status === "unavailable" ||
    account.status === "auth-expired";
  const quotaError =
    queryState?.quotaError ??
    (statusFailure || !hasQuota ? accountQuotaFailureMessage(account) : undefined);
  const showQuotaError = !hasQuota || statusFailure || queryState?.quota === "error";
  const tokenAttribution = resolveAccountTokenAttribution(
    tokenResponse?.summaries,
    account.accountId,
  );
  const isTokenLoading = queryState?.token === "loading" || (!queryState && tokenLoading);
  const tokenInput = tokenAttribution.kind === "exact" ? tokenAttribution.inputTokens : undefined;
  const tokenOutput = tokenAttribution.kind === "exact" ? tokenAttribution.outputTokens : undefined;
  const tokenInputLabel = isTokenLoading
    ? "加载中"
    : tokenInput != null
      ? formatCompactToken(tokenInput)
      : "—";
  const tokenOutputLabel = isTokenLoading
    ? "加载中"
    : tokenOutput != null
      ? formatCompactToken(tokenOutput)
      : "—";
  const tokenUnavailable =
    tokenAttribution.kind !== "exact" && !isTokenLoading && tokenResponse !== null;
  const tokenUnavailableReason =
    tokenResponse?.summaries.find((summary) => summary.unavailableReason)?.unavailableReason ??
    tokenResponse?.sources.find((source) => !source.available && source.unavailableReason)
      ?.unavailableReason;
  const windows = account.quotaWindows ?? [];
  const rows = hasQuota && !statusFailure ? quotaRows(windows) : [];
  const resetsText =
    rows.length > 0 ? formatWindowResetParts(rows) : formatQuotaResetParts(fast, long);
  // Attribution-first copy: real per-account numbers when pinned, an honest
  // "无法精确归因" when token data exists but not for this account, and the
  // legacy "暂无精确 Token 用量" only when there is no data at all.
  const tokenText =
    tokenAttribution.kind === "exact"
      ? "输入 " + tokenInputLabel + " · 输出 " + tokenOutputLabel
      : tokenAttribution.kind === "unattributable" && !isTokenLoading
        ? "无法精确归因"
        : !isTokenLoading && tokenResponse !== null
          ? "暂无精确 Token 用量"
          : "输入 " + tokenInputLabel + " · 输出 " + tokenOutputLabel;
  const tokenReasonText = userFacingTokenMessage(tokenUnavailableReason);
  const tokenErrorText = userFacingTokenMessage(queryState?.tokenError);
  const failureText = showQuotaError && quotaError ? quotaError : null;
  if (account.provider === "openai-compatible") {
    const totalLabel =
      tokenAttribution.kind === "exact"
        ? formatCompactToken(tokenAttribution.totalTokens)
        : isTokenLoading
          ? "加载中"
          : "—";
    return (
      <div data-testid={"account-quota-card-" + account.accountId} className="space-y-2">
        <p
          data-testid={"account-meta-" + account.accountId}
          className="text-[10px] leading-relaxed text-neutral-500"
        >
          {`总用量 ${totalLabel} · 输入 ${tokenInputLabel} · 输出 ${tokenOutputLabel}`}
        </p>
      </div>
    );
  }
  return (
    <div data-testid={"account-quota-card-" + account.accountId} className="space-y-2">
      {rows.length > 0 ? (
        rows.map((window) => (
          <UsageBar
            key={window.id}
            label={deriveWindowLabel(window)}
            value={Number.isFinite(window.usedPercent) ? window.usedPercent : null}
          />
        ))
      ) : (
        <p className="text-[10px] leading-4 text-neutral-500">
          {failureText ?? "暂无可用额度数据。"}
        </p>
      )}
      <p
        data-testid={"account-meta-" + account.accountId}
        className="text-[10px] leading-relaxed text-neutral-500"
      >
        {/* 恢复时间 is the actionable line — emphasize it. */}
        <span className="font-semibold text-neutral-300">{resetsText}</span>
        <span className="mx-1">·</span>
        <span>{tokenText}</span>
        {tokenUnavailable &&
        tokenAttribution.kind === "none" &&
        tokenReasonText &&
        tokenReasonText !== tokenText ? (
          <>
            <span className="mx-1">·</span>
            <span className="text-amber-300/80">{tokenReasonText}</span>
          </>
        ) : null}
        {failureText ? (
          <>
            <span className="mx-1">·</span>
            <span className="text-amber-300/80">{failureText}</span>
          </>
        ) : null}
        {queryState?.token === "error" && tokenErrorText && tokenErrorText !== tokenText ? (
          <>
            <span className="mx-1">·</span>
            <span className="text-amber-300/80">{tokenErrorText}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

export function ProviderQuotaCard(props: {
  providerId: string;
  snapshot: UsageSnapshot;
  /**
   * Offered only in the authorized-but-meterless state (e.g. OpenCode reports
   * a local Go plan before its opencode.ai browser session is captured, and
   * the meters exist only behind that session). When set, the empty-windows
   * block renders this action instead of leaving the user with no path to
   * real windows.
   */
  onConnectUsageSession?: () => void;
  connectLabel?: string;
  /**
   * Manual paste escape hatch shown next to the connect action, for when the
   * automatic capture cannot complete (e.g. the embedded view fails the OAuth
   * provider check).
   */
  onPasteCookie?: () => void;
}) {
  const { snapshot } = props;
  if (props.providerId === "volcengine" && snapshot.windows.length > 0) {
    return (
      <div data-testid="provider-quota-card-volcengine" className="mt-2 space-y-2">
        {snapshot.windows.map((window) => (
          <UsageBar key={window.id} label={window.label} value={window.usedPercent} />
        ))}
        <p
          data-testid="provider-meta-volcengine"
          className="text-[10px] leading-relaxed text-neutral-500"
        >
          {snapshot.windows
            .map((window) => `${window.label} ${formatResetsAt(window.resetsAt)}`)
            .join(" · ")}
        </p>
      </div>
    );
  }
  const { fast, long } = resolveQuotaWindows(snapshot.windows);
  const hasQuota = fast !== undefined || long !== undefined;
  const tokenInput = snapshot.tokens?.input;
  const tokenOutput = snapshot.tokens?.output;
  const tokenText =
    tokenInput == null && tokenOutput == null
      ? "暂无精确 Token 用量"
      : "输入 " +
        (tokenInput == null ? "—" : formatCompactToken(tokenInput)) +
        " · 输出 " +
        (tokenOutput == null ? "—" : formatCompactToken(tokenOutput));
  const failureText =
    snapshot.error ??
    (snapshot.status === "ok" && !hasQuota
      ? "暂无额度窗口"
      : props.providerId === "volcengine" && snapshot.status === "auth-missing"
        ? "凭证不可用或已失效，请重新填写 AK/SK 或 API Key。"
        : undefined);
  // Same honest-window contract as the account card: a Grok credits window is
  // "Monthly credits", not a fake "5h -- / 周月 --" pair.
  const rows = quotaRows(snapshot.windows);
  const showConnectAction =
    snapshot.status === "ok" && rows.length === 0 && props.onConnectUsageSession !== undefined;

  return (
    <div data-testid={"provider-quota-card-" + props.providerId} className="mt-2 space-y-2">
      {rows.length > 0 ? (
        rows.map((window) => (
          <UsageBar
            key={window.id}
            label={deriveWindowLabel(window)}
            value={Number.isFinite(window.usedPercent) ? window.usedPercent : null}
          />
        ))
      ) : (
        <p className="text-[10px] leading-4 text-neutral-500">
          {failureText ?? "暂无可用额度数据，请先登录/授权。"}
        </p>
      )}
      {showConnectAction ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={props.onConnectUsageSession}
            className="rounded-lg bg-white/5 px-2 py-1.5 text-[10px] font-medium text-foreground hover:bg-white/10"
          >
            {props.connectLabel ?? "连接会话显示额度"}
          </button>
          {props.onPasteCookie ? (
            <button
              type="button"
              onClick={props.onPasteCookie}
              className="rounded-lg px-2 py-1.5 text-[10px] text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
            >
              改用粘贴 Cookie
            </button>
          ) : null}
        </div>
      ) : null}
      <p
        data-testid={"provider-meta-" + props.providerId}
        className="text-[10px] leading-relaxed text-neutral-500"
      >
        {/* 恢复时间 is the actionable line — emphasize it. */}
        <span className="font-semibold text-neutral-300">
          {rows.length > 0 ? formatWindowResetParts(rows) : formatQuotaResetParts(fast, long)}
        </span>
        <span className="mx-1">·</span>
        <span>{tokenText}</span>
        {failureText ? (
          <>
            <span className="mx-1">·</span>
            <span className="text-amber-300/80">{failureText}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

export { formatResetsAt, resolveAccountQuotaWindows };
