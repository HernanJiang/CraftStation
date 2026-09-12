import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import type { ProfileBreakdownEntry } from "@/shared/contracts";

function SkeletonRow() {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4">
        <div className="h-3.5 w-28 animate-pulse rounded bg-foreground/10" />
        <div className="h-3.5 w-8 animate-pulse rounded bg-foreground/10" />
      </div>
      <div className="h-1.5 w-full rounded-full bg-foreground/10" />
    </div>
  );
}

/** A titled list of percent-weighted bars (providers, models, ...). */
export function BreakdownBars(props: {
  title: string;
  caption?: string;
  entries: ProfileBreakdownEntry[];
  limit?: number;
  loading?: boolean;
  loadingRows?: number;
  emptyText?: string;
  footer?: ReactNode;
  /** Formats the raw count shown next to the percent (default `toLocaleString`). */
  formatValue?: (count: number) => string;
  /** Denser typography/spacing for the 3-column usage-stats layout. */
  compact?: boolean;
}) {
  const { t } = useLingui();
  const {
    title,
    caption,
    entries,
    limit = 6,
    loading = false,
    loadingRows = 4,
    emptyText,
    footer,
    formatValue = (n) => n.toLocaleString(),
    compact = false,
  } = props;
  const rows = entries.slice(0, limit);

  return (
    <section className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
      <div className="flex items-baseline justify-between">
        <h2
          className={`font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`}
        >
          {title}
        </h2>
        {caption ? <span className="text-[11px] text-muted/70">{caption}</span> : null}
      </div>
      {loading ? (
        <div className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
          {Array.from({ length: loadingRows }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className={`py-1 text-muted ${compact ? "text-xs" : "text-sm"}`}>
          {emptyText ?? t`No data yet.`}
        </p>
      ) : (
        <div className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
          {rows.map((entry) => (
            <div key={entry.key} className={`flex flex-col ${compact ? "gap-1" : "gap-1.5"}`}>
              <div
                className={`flex items-center justify-between gap-4 ${compact ? "text-xs" : "text-sm"}`}
              >
                <span className="truncate font-medium text-foreground">{entry.label}</span>
                <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                  <span className="text-muted">{formatValue(entry.count)}</span>
                  <span className="text-muted/50">{entry.percent}%</span>
                </span>
              </div>
              <div
                className={`w-full overflow-hidden rounded-full bg-foreground/10 ${compact ? "h-1" : "h-1.5"}`}
              >
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${Math.min(100, Math.max(2, entry.percent))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {footer}
    </section>
  );
}
