import { useLingui } from "@lingui/react/macro";
import type { ProfileHeatmap } from "@/shared/contracts";
import { LightballTabs, type LightballTab } from "@/renderer/components/common";
import { ActivityHeatmap } from "./ActivityHeatmap";

export type ActivityMetric = "prompts" | "tokens";

export function ActivitySection(props: {
  promptHeatmap: ProfileHeatmap;
  tokenHeatmap: ProfileHeatmap | null;
  tokensAvailable: boolean;
  metric: ActivityMetric;
  onMetricChange: (metric: ActivityMetric) => void;
  /** Denser heading for the 3-column usage-stats layout. */
  compact?: boolean;
}) {
  const { t } = useLingui();
  const { promptHeatmap, tokenHeatmap, tokensAvailable, metric, onMetricChange, compact = false } =
    props;
  const showTokens = metric === "tokens" && tokensAvailable && tokenHeatmap;
  const heatmap = showTokens ? tokenHeatmap : promptHeatmap;

  const tabs: ReadonlyArray<LightballTab<ActivityMetric>> = [
    { id: "prompts", label: t`Prompts` },
    { id: "tokens", label: t`Tokens`, disabled: !tokensAvailable },
  ];

  return (
    <section className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
      <div className="flex items-center justify-between">
        <h2
          className={`font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`}
        >
          {t`Activity`}
        </h2>
        <LightballTabs
          tabs={tabs}
          active={metric}
          onChange={onMetricChange}
          ariaLabel={t`Activity metric`}
          className="w-[150px]"
          equalWidth
          shape="rounded"
        />
      </div>
      <ActivityHeatmap heatmap={heatmap} />
    </section>
  );
}
