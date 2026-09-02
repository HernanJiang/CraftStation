import { ChevronDown, FileDiff, GitBranch, Hammer, Monitor } from "lucide-react";
import { toast } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import type { Project } from "@/shared/contracts";
import { isHomeProjectId } from "@/shared/homeScope";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import { showGitReviewPanel } from "@/renderer/actions/panelActions";
import { BranchSelector } from "@/renderer/components/common";
import { useGitStore } from "@/renderer/state/gitStore";
import type { ReactNode } from "react";
import { PlanProgressSlot } from "./ComposerStatusRow";
import { ProjectSwitchMenu } from "./ProjectSwitchMenu";
import { CraftModeSwitch, type CraftMode } from "./CraftModeSwitch";
import { usePanelStore } from "@/renderer/state/panelStore";

/**
 * v0.2.8 — Codex-style context strip above the draft composer (1:1 with Codex).
 *
 * Displays current project, runtime location, and git branch, with optional
 * right-aligned action buttons (CraftStation mode and presentation mode).
 */
export function DraftContextBar(props: {
  project: Project;
  paneId?: string;
  /** 会话 id：有计划时在标签栏左侧显示计划进度胶囊。 */
  threadId?: string;
  worktreePath?: string;
  onProjectChange?: (projectId: string) => void;
  craftMode: CraftMode;
  onCraftModeChange: (mode: CraftMode) => void;
  rightActions?: ReactNode;
}) {
  const { t } = useLingui();
  const gitStatus = useGitStore((state) =>
    props.worktreePath
      ? state.worktreeStatuses[props.worktreePath]
      : state.statuses[props.project.id],
  );
  const discoveredBranch = useGitStore((state) => state.branches[props.project.id]?.current);
  const branch = gitStatus?.branch || discoveredBranch;
  const runtimeLabel = props.project.location.kind === "wsl" ? "WSL" : t`Local`;
  const showProject = !isHomeProjectId(props.project.id);

  const itemClass = "flex items-center gap-1.5 font-medium";

  function openGitReview() {
    showGitReviewPanel(props.project.id, props.worktreePath);
  }

  function handleSwitchBranch(nextBranch: string, createNew: boolean) {
    readBridge()
      .gitSwitchBranch({
        projectLocation: props.project.location,
        branch: nextBranch,
        createNew,
      })
      .then((result) => {
        const store = useGitStore.getState();
        const current = store.statuses[props.project.id];
        if (!current) return;
        store.setStatus(props.project.id, {
          ...current,
          branch: result.branch,
          tracking: result.tracking,
          ahead: result.ahead,
          behind: result.behind,
        });
      })
      .catch((error: unknown) => toast.danger(friendlyError(error)));
  }

  return (
    <div
      data-draft-context-bar=""
      className="relative z-[1] -mb-px mx-auto flex w-[calc(100%-32px)] items-center justify-between rounded-t-lg border border-b-0 border-[rgba(255,255,255,0.07)] bg-[#1c1d22] px-3 py-1.5 text-xs text-muted"
    >
      <div className="flex min-w-0 items-center gap-3">
        {props.threadId ? <PlanProgressSlot threadId={props.threadId} /> : null}
        <ProjectSwitchMenu
          currentProjectId={props.project.id}
          variant="compact"
          homeAsNoProject
          {...(props.paneId ? { paneId: props.paneId } : {})}
          {...(props.onProjectChange ? { onSelectProject: props.onProjectChange } : {})}
        />
        {!showProject ? <span className="sr-only">{t`No project`}</span> : null}
        <span className={itemClass}>
          <Monitor className="size-3.5 shrink-0 text-muted" />
          <span>{runtimeLabel}</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {props.rightActions}
        {showProject ? (
          <div
            data-composer-git-controls=""
            className="flex h-7 min-w-0 items-center overflow-hidden rounded-lg bg-white/5 text-[11px] text-neutral-300"
          >
            {branch && !props.worktreePath ? (
              <BranchSelector
                projectId={props.project.id}
                currentBranch={branch}
                value={branch}
                onSwitchBranch={handleSwitchBranch}
                hideWorktreeToggle
                showMoveBranchAction={false}
                popoverPlacement="top"
                compact
                trigger={
                  <button
                    type="button"
                    aria-label={t`Switch branch`}
                    className="flex h-7 min-w-0 items-center gap-1 px-2 transition-colors hover:bg-white/10"
                  >
                    <GitBranch className="size-3.5 shrink-0" />
                    <span className="max-w-28 truncate font-mono">{branch}</span>
                    <ChevronDown className="size-3 shrink-0 text-muted" />
                  </button>
                }
              />
            ) : (
              <button
                type="button"
                aria-label={t`Open Git review`}
                className="flex h-7 min-w-0 items-center gap-1 px-2 transition-colors hover:bg-white/10"
                onClick={openGitReview}
              >
                <GitBranch className="size-3.5 shrink-0" />
                <span className="max-w-28 truncate font-mono">{branch ?? t`Git`}</span>
              </button>
            )}
            <span className="h-4 w-px bg-white/10" aria-hidden="true" />
            <button
              type="button"
              aria-label={t`Open Git review`}
              title={t`Review changes, commit, and sync`}
              className="flex h-7 items-center gap-1 px-2 transition-colors hover:bg-white/10"
              onClick={openGitReview}
            >
              <FileDiff className="size-3.5 shrink-0" />
              <span>{t`Review`}</span>
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-white/5 px-2 text-[11px] font-medium text-neutral-300 transition-colors hover:bg-white/10"
          onClick={() => {
            const panel = usePanelStore.getState();
            panel.setAuxiliaryPanelPlacement("right");
            panel.setAuxiliaryPanelTab("harness");
            panel.setRightPanelTab("harness");
          }}
        >
          <Hammer className="size-3.5 text-neutral-300" />
          <span>{t`Crafting Table`}</span>
        </button>
        <CraftModeSwitch value={props.craftMode} onChange={props.onCraftModeChange} />
      </div>
    </div>
  );
}
