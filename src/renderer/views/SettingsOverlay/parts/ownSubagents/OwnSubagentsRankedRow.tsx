import { msg } from "@lingui/core/macro";
import { Plural, useLingui } from "@lingui/react/macro";
import type {
  CrossagentRankSource,
  CrossagentRoutingSnapshotEntry,
} from "@/shared/crossagentRanking";
import { formatReasoningLabel } from "@/shared/modelLabels";

const PREFERENCE_SOURCE_LABELS: Record<CrossagentRankSource, ReturnType<typeof msg>> = {
  "manual-override": msg`Manual override`,
  "tag-affinity": msg`Task match`,
  "crossagent-usage": msg`Own Subagents usage`,
  favorite: msg`Favorite`,
  "agent-usage": msg`Agent usage`,
  "built-in": msg`Built-in order`,
};

/** One ranked (provider, model) row: route position, selection detail,
 *  learned tags, and the ranking source. Filtering lives in the section-level
 *  provider/model checklist, not per row. */
export function OwnSubagentsRankedRow(props: {
  entry: CrossagentRoutingSnapshotEntry;
  /** Disambiguates same-label models from aggregator providers (OpenCode etc.). */
  subProviderLabel?: string;
  /** Route position shown as #N. Defaults to the snapshot rank. */
  rank?: number;
}) {
  const { t } = useLingui();
  const { entry, subProviderLabel, rank = entry.rank } = props;

  const detail = [
    ...(subProviderLabel ? [subProviderLabel] : []),
    ...(entry.reasoning ? [formatReasoningLabel(entry.reasoning)] : []),
    ...(entry.fast ? [t`Fast`] : []),
  ].join(" · ");

  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <span className="w-7 shrink-0 text-xs font-medium tabular-nums text-muted">
        #{rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">
          {entry.label} · {entry.model.label}
        </p>
        {detail ? <p className="truncate text-xs text-muted">{detail}</p> : null}
        {entry.learnedTags.length > 0 ? (
          <p className="truncate text-xs text-muted">
            {entry.learnedTags
              .slice(0, 5)
              .map(({ tag, count }) => `#${tag} (${count})`)
              .join(" · ")}
          </p>
        ) : null}
      </div>
      <div className="w-24 shrink-0 text-right text-xs text-muted">
        <p>{t(PREFERENCE_SOURCE_LABELS[entry.source])}</p>
        {entry.usageCount > 0 ? (
          <p>
            <Plural value={entry.usageCount} one="# use" other="# uses" />
          </p>
        ) : null}
      </div>
    </div>
  );
}
