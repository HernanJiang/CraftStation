import { useLingui } from "@lingui/react/macro";
import type { ProfileCoreStats } from "@/shared/contracts";

function Row(props: { label: string; value: string; compact?: boolean | undefined }) {
  return (
    <div
      className={`flex items-center justify-between gap-4 ${props.compact ? "py-1 text-xs" : "py-2 text-sm"}`}
    >
      <span className="text-muted">{props.label}</span>
      <span className="font-medium tabular-nums text-foreground">{props.value}</span>
    </div>
  );
}

export interface InsightRow {
  label: string;
  value: string;
}

function InsightGroup(props: { rows: InsightRow[]; compact?: boolean }) {
  return (
    <div className="divide-y divide-separator">
      {props.rows.map((row) => (
        <Row key={row.label} label={row.label} value={row.value} compact={props.compact} />
      ))}
    </div>
  );
}

export function ActivityInsights(props: {
  core: ProfileCoreStats;
  className?: string;
  /** Denser typography/spacing for the 3-column usage-stats layout. */
  compact?: boolean;
  /**
   * Render the two halves as standalone cards (for the compact 3-column row:
   * [insights A] [insights B] [model usage]) instead of one 2-column section.
   */
  split?: boolean;
}) {
  // NOTE: rows must be built inline with this scope's `t`: the Lingui macro
  // only transforms `t` tagged templates bound to useLingui(). Passing `t`
  // into a helper shadows the binding, the macro skips it, and every label
  // renders empty at runtime.
  const { t } = useLingui();
  const { insights, totals } = props.core;

  const reasoning = insights.topReasoning
    ? `${insights.topReasoning.label} - ${insights.topReasoning.percent}%`
    : "-";
  const provider = insights.topProvider
    ? `${insights.topProvider.label} - ${insights.topProvider.percent}%`
    : "-";
  const activeHour = insights.mostActiveHour ? insights.mostActiveHour.label : "-";
  const rows: InsightRow[] = [
    { label: t`Most used provider`, value: provider },
    { label: t`Most used reasoning`, value: reasoning },
    { label: t`Fast mode`, value: `${insights.fastModePercent}%` },
    { label: t`Most active hour`, value: activeHour },
    { label: t`Messages sent`, value: totals.messagesSent.toLocaleString() },
    { label: t`Goals set`, value: totals.goalsSet.toLocaleString() },
    { label: t`Skills explored`, value: String(insights.skillsExplored) },
    { label: t`Skill runs`, value: insights.totalSkillsUsed.toLocaleString() },
    { label: t`Workflow runs`, value: insights.workflowRuns.toLocaleString() },
    { label: t`Subagent runs`, value: insights.subagentRuns.toLocaleString() },
    { label: t`MCP tool calls`, value: insights.mcpToolCalls.toLocaleString() },
    { label: t`Total threads`, value: totals.totalThreads.toLocaleString() },
    { label: t`Total prompts`, value: totals.totalPrompts.toLocaleString() },
  ];
  const midpoint = Math.ceil(rows.length / 2);
  const primary = rows.slice(0, midpoint);
  const secondary = rows.slice(midpoint);
  const compact = props.compact ?? false;
  const headingClass = `mb-1 font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`;

  if (props.split) {
    return (
      <>
        <section className={`flex flex-col gap-1 ${props.className ?? ""}`}>
          <h2 className={headingClass}>{t`Activity insights`}</h2>
          <InsightGroup rows={primary} compact={compact} />
        </section>
        <section className="flex flex-col gap-1">
          {/* Layout spacer: keeps card B aligned with card A in the grid row. */}
          <h2 className={`${headingClass} invisible`} aria-hidden>
            {t`Activity insights`}
          </h2>
          <InsightGroup rows={secondary} compact={compact} />
        </section>
      </>
    );
  }

  return (
    <section className={`flex flex-col gap-1 ${props.className ?? ""}`}>
      <h2 className={headingClass}>{t`Activity insights`}</h2>
      <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        <InsightGroup rows={primary} compact={compact} />
        <InsightGroup rows={secondary} compact={compact} />
      </div>
    </section>
  );
}
