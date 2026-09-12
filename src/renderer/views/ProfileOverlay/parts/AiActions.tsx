import {
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Upload,
  Wrench,
} from "lucide-react";
import { Trans } from "@lingui/react/macro";
import type { AiActionType, ProfileAiAction } from "@/shared/contracts";

const ICONS: Record<AiActionType, typeof GitCommitHorizontal> = {
  commit: GitCommitHorizontal,
  push: Upload,
  pr: GitPullRequest,
  conflict: GitMerge,
  branch: GitBranch,
  other: Wrench,
};

/** Fixed display order: Commit / Push / PR / Merge-Conflict / Branch, then Other. */
const KNOWN_ORDER: ReadonlyArray<Exclude<AiActionType, "other">> = [
  "commit",
  "push",
  "pr",
  "conflict",
  "branch",
];

/** Zero-state labels mirror the backend aggregation labels for present rows. */
const ZERO_LABELS: Record<(typeof KNOWN_ORDER)[number], string> = {
  commit: "Commit",
  push: "Push",
  pr: "PR",
  conflict: "Merge / Conflict Resolve",
  branch: "Branch",
};

/**
 * AI-performed git actions. Rows come from real `ai_*` usage events only —
 * categories without data render as 0, and a fully empty log renders the
 * empty state instead of fabricated numbers.
 */
export function AiActions(props: {
  actions: ProfileAiAction[];
  /** Denser typography/spacing for the 3-column usage-stats layout. */
  compact?: boolean;
}) {
  const { actions, compact = false } = props;
  const byType = new Map(actions.map((action) => [action.type, action]));
  const other = byType.get("other");
  const headingClass = `mb-1 font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`;
  const rowClass = `flex items-center justify-between gap-4 ${compact ? "py-1 text-xs" : "py-2 text-sm"}`;

  if (actions.length === 0) {
    return (
      <section className="flex flex-col gap-1">
        <h2 className={headingClass}>
          <Trans>AI git actions</Trans>
        </h2>
        <p className={`py-2 text-muted ${compact ? "text-xs" : "text-sm"}`}>
          <Trans>No AI commits, pushes, PRs, merges, or branch operations tracked yet.</Trans>
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-1">
      <h2 className={headingClass}>
        <Trans>AI git actions</Trans>
      </h2>
      <div className="divide-y divide-separator">
        {KNOWN_ORDER.map((type) => {
          const action = byType.get(type);
          const Icon = ICONS[type];
          const via = action?.topProvider
            ? `${action.topProvider}${action.topModel ? ` - ${action.topModel}` : ""}`
            : null;
          return (
            <div key={type} className={rowClass}>
              <span className="flex min-w-0 items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-muted" />
                <span className="truncate font-medium text-foreground">
                  {action?.label ?? ZERO_LABELS[type]}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {via ? <span className="text-[11px] text-muted/70">{via}</span> : null}
                <span className="font-medium tabular-nums text-foreground">
                  {(action?.count ?? 0).toLocaleString()}
                </span>
              </span>
            </div>
          );
        })}
        {other ? (
          <div key="other" className={rowClass}>
            <span className="flex min-w-0 items-center gap-2">
              <Wrench className="size-3.5 shrink-0 text-muted" />
              <span className="truncate font-medium text-foreground">{other.label}</span>
            </span>
            <span className="font-medium tabular-nums text-foreground">
              {other.count.toLocaleString()}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
