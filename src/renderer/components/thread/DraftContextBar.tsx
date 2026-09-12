import { Monitor, PackageOpen, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { Project, ThreadGoal } from "@/shared/contracts";
import { isHomeProjectId } from "@/shared/homeScope";
import { moveThreadToProject, stopThreadGoal } from "@/renderer/actions/threadActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useState, type ReactNode } from "react";
import { ProjectSwitchMenu } from "./ProjectSwitchMenu";
import type { CraftMode } from "./CraftModeSwitch";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { ComposerPlanChip } from "./ComposerPlanChip";
import { ThreadGoalDock } from "./ThreadGoalDock";
import { selectThreadGoalDockState, type ThreadGoalDockState } from "./threadGoalState";
import { ThreadRuntimeStatusBar } from "./ThreadRuntimeStatusBar";

/**
 * v0.2.8 — Codex-style context strip above the draft composer (1:1 with Codex).
 *
 * Displays current project, runtime location, and git branch, with optional
 * right-aligned action buttons (CraftStation mode and presentation mode).
 */
export function DraftContextBar(props: {
  project: Project;
  paneId?: string;
  /** 会话 id：用于绑定 live thread 的 Goal chip、计划进度芯片与项目切换。右上角状态胶囊仍保留自己的计划入口。 */
  threadId?: string;
  worktreePath?: string;
  onProjectChange?: (projectId: string) => void;
  craftMode: CraftMode;
  onCraftModeChange: (mode: CraftMode) => void;
  rightActions?: ReactNode;
  /** When false, the context bar does not host the goal strip (mobile chips / terminal dock). */
  showGoalStrip?: boolean;
}) {
  const { t } = useLingui();
  const runtimeLabel = props.project.location.kind === "wsl" ? "WSL" : t`Local`;
  const showProject = !isHomeProjectId(props.project.id);
  // A live thread rebinds itself to the picked project ("+ Add to project");
  // draft panes keep their local draft-switching behavior.
  const liveThreadId = useAppStore((state) =>
    props.threadId && state.threads.some((thread) => thread.id === props.threadId)
      ? props.threadId
      : undefined,
  );
  // A staged "use in chat" recipe from My Recipes. The chip is a visual cue;
  // the chat submit still resolves the StoredRecipe fresh before crafting.
  const pendingRecipeIntent = useCraftingWorkbenchStore((state) => state.pendingRecipeIntent);
  const recipes = useCraftingWorkbenchStore((state) => state.recipes);
  const pendingRecipe = pendingRecipeIntent
    ? recipes.find((recipe) => recipe.id === pendingRecipeIntent.recipeId)
    : undefined;

  const itemClass = "flex items-center gap-1.5 font-medium";

  // Durable `/goal` bound to the live thread (if any). Shown only while a
  // goal is active — never a placeholder.
  const goalThreadId = liveThreadId ?? props.threadId;
  const threadGoal = useAppStore((state) =>
    goalThreadId ? state.threads.find((thread) => thread.id === goalThreadId)?.goal : undefined,
  );
  const runtimeGoal = useAppStore((state) =>
    goalThreadId ? selectThreadGoalDockState(state, goalThreadId) : null,
  );
  const [dismissedGoalItemId, setDismissedGoalItemId] = useState<string | null>(null);
  const visibleRuntimeGoal =
    runtimeGoal && runtimeGoal.sourceItemId !== dismissedGoalItemId ? runtimeGoal : null;
  const contextUsage = useAppStore((state) =>
    goalThreadId ? state.runtimeContextByThread[goalThreadId] : undefined,
  );
  const durableGoalState =
    !visibleRuntimeGoal && goalThreadId && threadGoal
      ? durableGoalToDockState(goalThreadId, threadGoal, contextUsage?.usedTokens)
      : null;
  const visibleGoalState = visibleRuntimeGoal ?? durableGoalState;

  return (
    <div
      data-draft-context-bar=""
      className="relative z-[1] -mb-px mx-auto flex w-[calc(100%-32px)] items-center justify-between rounded-t-lg border border-b-0 border-[var(--hairline)] px-3 py-1.5 text-xs text-muted"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProjectSwitchMenu
          currentProjectId={props.project.id}
          variant="compact"
          homeAsNoProject
          strong
          {...(props.paneId ? { paneId: props.paneId } : {})}
          {...(liveThreadId
            ? {
                onSelectProject: (projectId: string) =>
                  moveThreadToProject(liveThreadId, projectId),
              }
            : props.onProjectChange
              ? { onSelectProject: props.onProjectChange }
              : {})}
        />
        {!showProject ? <span className="sr-only">{t`No project`}</span> : null}
        <span className={itemClass}>
          <Monitor className="size-3.5 shrink-0 text-muted" />
          <span>{runtimeLabel}</span>
        </span>
        {goalThreadId ? <ComposerPlanChip threadId={goalThreadId} /> : null}
        {props.showGoalStrip !== false && goalThreadId && visibleGoalState ? (
          <ThreadGoalDock
            threadId={goalThreadId}
            state={visibleGoalState}
            placement="context-bar"
            onDismiss={() => {
              if (visibleRuntimeGoal) {
                setDismissedGoalItemId(visibleRuntimeGoal.sourceItemId);
                return;
              }
              if (goalThreadId) void stopThreadGoal(goalThreadId);
            }}
          />
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {props.rightActions}
        {goalThreadId ? <ThreadRuntimeStatusBar threadId={goalThreadId} /> : null}
        {pendingRecipe ? (
          <span
            data-testid="pending-recipe-chip"
            title={pendingRecipe.systemName}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-amber-400/10 px-2 text-[11px] font-medium text-amber-700 dark:text-amber-300"
          >
            <PackageOpen className="size-3.5" />
            <span className="max-w-40 truncate">{pendingRecipe.systemName}</span>
            <button
              type="button"
              aria-label={t`取消配方`}
              onClick={() => useCraftingWorkbenchStore.getState().clearPendingRecipeIntent()}
              className="rounded p-0.5 hover:bg-amber-400/20"
            >
              <X className="size-3" />
            </button>
          </span>
        ) : null}
        {/* 模式选择已移出聊天框：高效/创造模式改为在模型选择栏直接选对应配方。
            合成台按钮顺延为最右侧。craftMode 状态保留给合成台入口的 entryMode。 */}
      </div>
    </div>
  );
}

function durableGoalToDockState(
  threadId: string,
  goal: ThreadGoal,
  tokensUsed: number | undefined,
): ThreadGoalDockState {
  const createdAtSeconds = Date.parse(goal.createdAt) / 1000;
  const paused = goal.paused === true;
  return {
    sourceItemId: `durable-goal:${threadId}`,
    itemState: "completed",
    objective: goal.prompt,
    status: paused ? "paused" : "active",
    action: "set",
    availableActions: paused ? ["edit", "resume", "clear"] : ["edit", "pause", "clear"],
    ...(tokensUsed !== undefined ? { tokensUsed } : {}),
    ...(paused
      ? { timeUsedSeconds: Math.max(0, Math.round(Date.now() / 1000 - createdAtSeconds)) }
      : { timeUsedSeconds: 0, updatedAt: createdAtSeconds }),
  };
}
