import type { SessionMetrics } from "@/shared/contracts";

const EMPTY_METRICS: SessionMetrics = {
  fiveHourQuotaPercent: null,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  cacheHitRatePercent: null,
};

function number(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function QuotaMeter(props: { label: string; value: number | null | undefined }) {
  const value = props.value == null ? null : Math.max(0, Math.min(100, Math.round(props.value)));
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{props.label}:</span>
      <span className="inline-flex h-[3.5px] w-9 items-center overflow-hidden rounded-full bg-white/10">
        {value == null ? null : (
          <span
            className="block h-full rounded-full bg-neutral-300"
            style={{ width: `${value}%` }}
          />
        )}
      </span>
      <span className="tabular-nums">{value == null ? "--%" : `${value}%`}</span>
    </span>
  );
}

export function SessionMetricsBar(props: { metrics?: SessionMetrics }) {
  const metrics = props.metrics ?? EMPTY_METRICS;
  return (
    <div
      data-session-metrics=""
      className="no-scrollbar order-2 flex min-h-5 items-center justify-center gap-1.5 overflow-x-auto whitespace-nowrap px-3 pt-1.5 text-[11px] text-neutral-400"
      aria-label="会话运行指标"
    >
      <QuotaMeter label="周额度" value={metrics.weeklyQuotaPercent} />
      <span aria-hidden="true">·</span>
      <QuotaMeter label="5h额度" value={metrics.fiveHourQuotaPercent} />
      <span aria-hidden="true">·</span>
      <span>输入: {number(metrics.inputTokens)} tok</span>
      <span aria-hidden="true">·</span>
      <span>输出: {number(metrics.outputTokens)} tok</span>
      <span aria-hidden="true">·</span>
      <span>缓存: {number(metrics.cachedTokens)} tok</span>
      <span aria-hidden="true">·</span>
      <span>命中率: {metrics.cacheHitRatePercent ?? "--"}%</span>
    </div>
  );
}
