import type { AccountView } from "@/shared/contracts";
import { useTokenUsageStore } from "@/renderer/state/tokenUsageStore";

function formatCompactToken(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

/**
 * v0.5 per-account 2x2 usage grid: Quota / Token / Cache / Status. Quota and
 * token cells carry their own provenance; cache shows "—" when there is no
 * reliable cache source so estimates are never dressed up as official numbers.
 */
export function AccountUsageGrid(props: { account: AccountView }) {
  const { account } = props;
  const tokenResponse = useTokenUsageStore((state) => state.response);

  const fastWindow = account.quotaWindows?.find((window) => window.id === "session-5h");
  const longWindow = account.quotaWindows?.find(
    (window) => window.id === "weekly" || window.id === "monthly",
  );
  const quotaValue =
    fastWindow?.usedPercent != null ? fastWindow.usedPercent : (longWindow?.usedPercent ?? null);

  // A provider-wide summary is not an account summary. Only render a token
  // value when the response contains an exact accountId breakdown entry.
  const tokenEntry = tokenResponse?.summaries
    ?.flatMap((summary) =>
      summary.byAccount
        .filter((entry) => entry.key === account.accountId)
        .map((entry) => ({ summary, entry })),
    )
    .find(({ summary }) => summary.quality !== "estimated");
  const tokenTotal = tokenEntry?.entry.totalTokens;
  const cacheRead = tokenEntry?.entry.cacheReadTokens ?? 0;
  const cacheWrite = tokenEntry?.entry.cacheWriteTokens ?? 0;
  const hasReliableCache = tokenEntry !== undefined && cacheRead + cacheWrite > 0;

  return (
    <div
      data-testid={`account-usage-grid-${account.accountId}`}
      className="mt-1.5 grid grid-cols-2 gap-1.5 text-[9px] text-neutral-400"
    >
      <div className="rounded-md bg-white/4 px-1.5 py-1">
        <span className="block text-neutral-500">额度</span>
        <span className="tabular-nums text-foreground">
          {quotaValue == null ? "—" : `${Math.round(quotaValue)}%`}
        </span>
      </div>
      <div className="rounded-md bg-white/4 px-1.5 py-1">
        <span className="block text-neutral-500">Token</span>
        <span className="tabular-nums text-foreground">
          {tokenTotal == null ? "—" : formatCompactToken(tokenTotal)}
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
