import { switcherDisplayWindow } from "@craftstation/agents-usage/switcherQuota";
import type { AccountView, UsageSnapshot } from "@/shared/contracts";
import { formatMoney } from "@/renderer/components/providers/usageFormat";
import type { AccountUsageQueryState } from "./AccountUsageGrid";
import { accountQuotaFailureMessage, hasAccountQuotaValue } from "./AccountUsageGrid";
import { formatUsedQuota } from "./quotaStatus";

/** Reset time is only written when the collector actually reported one —
 * unknown values render nothing instead of a "恢复时间未知" placeholder. */
function formatResetsAt(value: number | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return month + "-" + day + " " + hour + ":" + minute;
  } catch {
    return null;
  }
}

type QuotaWindowLike = {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt?: number | undefined;
  /** Absolute balance amounts for currency-reporting providers (e.g. StepFun). */
  remaining?: number | undefined;
  limit?: number | undefined;
  currency?: string | undefined;
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
function quotaRows(windows: readonly QuotaWindowLike[], providerId: string): QuotaWindowLike[] {
  const headline = switcherDisplayWindow(providerId, windows);
  const rest = headline ? windows.filter((window) => window.id !== headline.id) : windows;
  const ordered = headline
    ? [windows.find((window) => window.id === headline.id), ...rest]
    : [...windows];
  const present = ordered.filter((window): window is QuotaWindowLike => window !== undefined);
  // The 5h/session window is the one that blocks first — keep it on top even
  // when the headline lane is the fullest weekly (multi-window codex cards
  // used to bury Session under Weekly + per-model reserves).
  const fastIndex = present.findIndex(
    (w) => w.id.toLowerCase().includes("5h") || w.id.toLowerCase().includes("session"),
  );
  if (fastIndex > 0) {
    const fast = present.splice(fastIndex, 1)[0]!;
    present.unshift(fast);
  }
  return present.slice(0, 4);
}

function formatQuotaResetParts(
  fast: QuotaWindowLike | undefined,
  long: QuotaWindowLike | undefined,
): string {
  const parts: string[] = [];
  const fastText = fast ? formatResetsAt(fast.resetsAt) : null;
  if (fastText) parts.push("5h " + fastText);
  if (long) {
    const longText = formatResetsAt(long.resetsAt);
    if (longText) {
      const lowerId = long.id.toLowerCase();
      const label =
        lowerId.includes("week") || long.label.includes("周")
          ? "周"
          : lowerId.includes("month") || long.label.includes("月")
            ? "月"
            : "周/月";
      parts.push(label + " " + longText);
    }
  }
  return parts.join(" · ");
}

function formatWindowResetParts(windows: readonly QuotaWindowLike[]): string {
  return windows
    .map((window) => {
      const resetsAt = formatResetsAt(window.resetsAt);
      return resetsAt ? `${deriveWindowLabel(window)} ${resetsAt}` : null;
    })
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function resolveAccountQuotaWindows(account: AccountView) {
  return resolveQuotaWindows(account.quotaWindows ?? []);
}

function UsageBar(props: { label: string; value: number | null }) {
  const value = props.value == null ? null : Math.max(0, Math.min(100, Math.round(props.value)));
  const fillClass =
    value == null
      ? "bg-black/20 dark:bg-white/20"
      : value >= 100
        ? "bg-red-400"
        : value >= 90
          ? "bg-amber-400"
          : "bg-emerald-400";
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-[10px] text-muted">
      <span>{props.label}</span>
      <span
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(value == null ? {} : { "aria-valuenow": value })}
        className="relative flex h-4 min-w-0 items-center justify-center overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
      >
        <span
          aria-hidden="true"
          className={"absolute inset-y-0 left-0 rounded-full " + fillClass}
          style={{ width: (value ?? 0) + "%" }}
        />
        <span className="relative z-10 px-1 text-[9px] font-medium leading-none text-foreground dark:text-white/90 tabular-nums drop-shadow-sm">
          {formatUsedQuota(value)}
        </span>
      </span>
    </div>
  );
}

const RESET_CREDIT_WINDOW_ID = "codex:reset-credits";

export function AccountQuotaCard(props: {
  account: AccountView;
  queryState?: AccountUsageQueryState | undefined;
  onRedeemResetCredit?: ((account: AccountView) => void) | undefined;
}) {
  const { account, queryState } = props;
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
  const windows = account.quotaWindows ?? [];
  const resetCreditWindow = windows.find((window) => window.id === RESET_CREDIT_WINDOW_ID);
  const resetCreditCount =
    resetCreditWindow?.limit !== undefined && resetCreditWindow.limit > 0
      ? resetCreditWindow.limit
      : 0;
  const meterWindows = windows.filter((window) => window.id !== RESET_CREDIT_WINDOW_ID);
  const rows = hasQuota && !statusFailure ? quotaRows(meterWindows, account.provider) : [];
  const resetsText =
    rows.length > 0 ? formatWindowResetParts(rows) : formatQuotaResetParts(fast, long);
  const failureText = showQuotaError && quotaError ? quotaError : null;
  if (account.provider === "openai-compatible") {
    // 渠道能拿到真实额度（如阶跃 /v1/accounts 余额、one-api 中转 billing）就
    // 渲染额度条；拿不到时不造假装满的窗口。Token 用量不在这页展示。
    const compatRows = hasQuota && !statusFailure ? quotaRows(windows, account.provider) : [];
    const balanceWindow = compatRows.find(
      (window) => window.remaining !== undefined && window.currency,
    );
    const metaBits: string[] = [];
    if (balanceWindow?.remaining !== undefined && balanceWindow.currency) {
      const remaining = formatMoney(balanceWindow.remaining, balanceWindow.currency);
      const limit =
        balanceWindow.limit !== undefined
          ? ` / 共 ${formatMoney(balanceWindow.limit, balanceWindow.currency)}`
          : "";
      metaBits.push(`余额 ${remaining}${limit}`);
    } else if (compatRows.length > 0) {
      const resetParts = formatWindowResetParts(compatRows);
      if (resetParts) metaBits.push(resetParts);
    }
    // Only surface real failures (auth/connectivity/exhaustion) — a channel
    // that simply has no quota endpoint must not spam "暂无可用额度数据".
    // quota-exhausted is excluded from `statusFailure`
    // above so its bar still renders at 100%; pull its message directly.
    const compatFailure =
      statusFailure || queryState?.quota === "error"
        ? failureText
        : account.status === "quota-exhausted"
          ? accountQuotaFailureMessage(account)
          : null;
    return (
      <div data-testid={"account-quota-card-" + account.accountId} className="space-y-2">
        {compatRows.map((window) => (
          <UsageBar
            key={window.id}
            label={deriveWindowLabel(window)}
            value={Number.isFinite(window.usedPercent) ? window.usedPercent : null}
          />
        ))}
        <p
          data-testid={"account-meta-" + account.accountId}
          className="text-[10px] leading-relaxed text-neutral-500"
        >
          {metaBits.join(" · ")}
          {compatFailure ? (
            <>
              {metaBits.length > 0 ? <span className="mx-1">·</span> : null}
              <span className="text-amber-300/80">{compatFailure}</span>
            </>
          ) : null}
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
      {resetCreditCount > 0 ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] leading-4 text-neutral-500">
            重置卡 {resetCreditCount} 张未使用。额度要等核销后才会下降。
          </p>
          {props.onRedeemResetCredit ? (
            <button
              type="button"
              className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] text-foreground hover:bg-[var(--row-hover)] disabled:opacity-50 dark:bg-white/5"
              onClick={(event) => {
                event.stopPropagation();
                props.onRedeemResetCredit?.(account);
              }}
            >
              使用重置卡
            </button>
          ) : null}
        </div>
      ) : null}
      <p
        data-testid={"account-meta-" + account.accountId}
        className="text-[10px] leading-relaxed text-neutral-500"
      >
        {/* 恢复时间 is the actionable line — emphasize it. */}
        {resetsText ? <span className="font-semibold text-neutral-300">{resetsText}</span> : null}
        {/* When no bars rendered, the standalone line above already carries
         * the failure — meta only repeats it when bars exist alongside. */}
        {failureText && rows.length > 0 ? (
          <>
            {resetsText ? <span className="mx-1">·</span> : null}
            <span className="text-amber-300/80">{failureText}</span>
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
            .map((window) => {
              const resetsAt = formatResetsAt(window.resetsAt);
              return resetsAt ? `${window.label} ${resetsAt}` : null;
            })
            .filter((part): part is string => part !== null)
            .join(" · ")}
        </p>
      </div>
    );
  }
  const { fast, long } = resolveQuotaWindows(snapshot.windows);
  const hasQuota = fast !== undefined || long !== undefined;
  const failureText =
    snapshot.error ??
    (snapshot.status === "ok" && !hasQuota
      ? "暂无额度窗口"
      : props.providerId === "volcengine" && snapshot.status === "auth-missing"
        ? "凭证不可用或已失效，请重新填写 AK/SK 或 API Key。"
        : undefined);
  // Same honest-window contract as the account card: a Grok credits window is
  // "Monthly credits", not a fake "5h -- / 周月 --" pair.
  const rows = quotaRows(snapshot.windows, props.providerId);
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
        {(() => {
          const resetsText =
            rows.length > 0 ? formatWindowResetParts(rows) : formatQuotaResetParts(fast, long);
          return (
            <>
              {resetsText ? (
                <span className="font-semibold text-neutral-300">{resetsText}</span>
              ) : null}
              {failureText ? (
                <>
                  {resetsText ? <span className="mx-1">·</span> : null}
                  <span className="text-amber-300/80">{failureText}</span>
                </>
              ) : null}
            </>
          );
        })()}
      </p>
    </div>
  );
}

export { formatResetsAt, resolveAccountQuotaWindows };
