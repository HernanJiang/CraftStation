import { GitBranch, Hammer, Monitor } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { Project } from "@/shared/contracts";
import { isHomeProjectId } from "@/shared/homeScope";
import { useGitStore } from "@/renderer/state/gitStore";
import type { ReactNode } from "react";
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
  onProjectChange?: (projectId: string) => void;
  craftMode: CraftMode;
  onCraftModeChange: (mode: CraftMode) => void;
  rightActions?: ReactNode;
}) {
  const { t } = useLingui();
  const branch = useGitStore((s) => s.branches[props.project.id]?.current);
  const runtimeLabel = props.project.location.kind === "wsl" ? "WSL" : t`Local`;
  const showProject = !isHomeProjectId(props.project.id);

  const itemClass = "flex items-center gap-1.5 font-medium";
  return (
    <div
      data-draft-context-bar=""
      className="relative z-[1] -mb-px mx-auto flex w-[calc(100%-32px)] items-center justify-between rounded-t-lg border border-b-0 border-[rgba(255,255,255,0.07)] bg-[#1c1d22] px-3 py-1.5 text-xs text-muted"
    >
      <div className="flex min-w-0 items-center gap-3">
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
        {branch ? (
          <span className={itemClass}>
            <GitBranch className="size-3.5 shrink-0 text-muted" />
            <span className="max-w-[160px] truncate font-mono text-[11px] text-foreground/80">{branch}</span>
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {props.rightActions}
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
