import { GitBranch, GitCommitHorizontal, GitGraph } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import type { GitStatusResult } from "@/shared/contracts";

/**
 * Compact branch topology backed by the status API CraftStation already owns.
 * This intentionally does not invent commit history: until a paged git-log IPC
 * exists, the graph shows the truthful local HEAD/upstream relationship and
 * ahead/behind counts rather than fake commit rows.
 */
export function BranchSyncGraph(props: { gitStatus: GitStatusResult }) {
  const { gitStatus } = props;
  if (!gitStatus.isRepo || !gitStatus.branch) return null;

  const ahead = gitStatus.ahead ?? 0;
  const behind = gitStatus.behind ?? 0;
  const upstream = gitStatus.tracking || "No upstream";

  return (
    <section
      data-git-branch-graph=""
      className="border-t border-[color:var(--border)] px-2 py-2.5 text-xs"
    >
      <div className="mb-2 flex items-center gap-1.5 font-medium text-foreground/85">
        <GitGraph className="size-3.5 text-muted" />
        <Trans>Branch graph</Trans>
        <span className="ml-auto font-mono text-[10px] text-muted/60">
          ↓{behind} ↑{ahead}
        </span>
      </div>
      <div className="relative ml-1.5 grid grid-cols-[14px_minmax(0,1fr)] gap-x-2 gap-y-2">
        <span className="absolute bottom-2 left-[6px] top-2 w-px bg-white/10" aria-hidden="true" />
        <span className="relative z-[1] mt-1 size-3 rounded-full border-2 border-[#222329] bg-sky-400" />
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-foreground/90">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate font-mono">{gitStatus.branch}</span>
            <span className="rounded bg-white/5 px-1 text-[9px] uppercase text-muted">HEAD</span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted/60">
            <Trans>Local branch</Trans>
            {ahead > 0 ? <span className="ml-1 text-emerald-400">+{ahead}</span> : null}
          </div>
        </div>
        <span className="relative z-[1] mt-1 size-3 rounded-full border-2 border-[#222329] bg-violet-400" />
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-foreground/80">
            <GitCommitHorizontal className="size-3 shrink-0" />
            <span className="truncate font-mono">{upstream}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted/60">
            <Trans>Remote tracking branch</Trans>
            {behind > 0 ? <span className="ml-1 text-amber-400">+{behind}</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
