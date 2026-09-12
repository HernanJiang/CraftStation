import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  Goal as GoalIcon,
  ListChecks,
  MessagesSquare,
} from "lucide-react";
import { toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectLocation } from "@/shared/contracts";
import { friendlyError } from "@/shared/messages";
import { isCodexNativeGoalAgent } from "@/shared/threadGoal";
import { buildWorktreeLocation } from "@/shared/worktree";
import { showGitReviewPanel } from "@/renderer/actions/panelActions";
import { readBridge } from "@/renderer/bridge";
import { MAIN_THREAD_HEADER_PORTAL_ID } from "@/renderer/components/layout/layoutHeaderPortals";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { refreshGitProject } from "@/renderer/state/gitRefresh";
import { useThreadHasBackgroundActivity } from "@/renderer/hooks/uiSelectors";
import { CapsuleBranchView } from "./CapsuleBranchView";
import { CapsuleCommitView } from "./CapsuleCommitView";
import {
  CollaborationExchangeList,
  useThreadCollaborationExchanges,
} from "./ThreadCollaborationActivity";
import {
  collaborationCounterpart,
  collaborationStatusLabel,
  collaborationStatusTone,
  displayDialogueTitle,
} from "./threadCollaborationUi";
import { selectThreadTodoDockState, type ThreadTodoDockState } from "./threadTodoState";
import {
  selectAgentCapsuleCounts,
  selectAgentCapsuleEntries,
  type AgentCapsuleEntry,
} from "./ComposerStatusRow";

/** Minimal git facts the capsule renders. All values come from `useGitStore`. */
export interface CapsuleGitSummary {
  isRepo: boolean;
  branch: string;
  changedFiles: number;
  insertions: number;
  deletions: number;
  ahead: number;
  behind: number;
  hasRemote: boolean;
}

/** Collapsed capsule text, e.g. `+326 -27 · main`.
 * Order is fixed: Changes → Branch.
 * Pure helper so tests can assert the format without mounting stores.
 * Callers prepend the Agents segment (`2 Agents working`) and the Step
 * segment themselves; absent segments are simply omitted, never placeholders.
 */
export function buildCapsuleLabel(
  git: CapsuleGitSummary | undefined,
  stepLabel: string | undefined,
): string {
  if (!git || !git.isRepo) {
    if (stepLabel) return stepLabel;
    if (git && !git.isRepo) return "not a repo";
    return "…";
  }
  const parts: string[] = [];
  if (git.changedFiles > 0) {
    parts.push(`+${git.insertions} -${git.deletions}`);
  } else {
    parts.push("clean");
  }
  parts.push(git.branch || "—");
  if (stepLabel) parts.push(stepLabel);
  return parts.join(" · ");
}

function agentStatusDotClass(status: AgentCapsuleEntry["status"]): string {
  switch (status) {
    case "running":
      return "bg-sky-400";
    case "completed":
      return "bg-emerald-400";
    case "failed":
      return "bg-rose-400";
    default:
      return "bg-neutral-500";
  }
}

/** Completed-step count from the same todo dock state that feeds the Step segment. */
function stepCompletedCount(todo: ThreadTodoDockState): number {
  return todo.steps.reduce((count, step) => (step.status === "completed" ? count + 1 : count), 0);
}

export function capsuleStatusDotClass(
  git: CapsuleGitSummary | undefined,
  opts: { hasConflict?: boolean; isWorking?: boolean },
): string {
  if (opts.hasConflict) return "bg-danger";
  if (!git || !git.isRepo) return "bg-muted/60";
  if (git.changedFiles > 0 || git.ahead > 0 || git.behind > 0) return "bg-amber-400";
  if (opts.isWorking) return "bg-sky-400";
  return "bg-emerald-400";
}

export interface ThreadStatusCapsuleProps {
  threadId: string;
  projectId: string;
  worktreePath?: string | undefined;
  projectLocation: ProjectLocation;
  collaborationRefreshKey?: number;
  onOpenCollaboration?: () => void;
}

function resolveEffectiveLocation(
  projectLocation: ProjectLocation,
  worktreePath: string | undefined,
): ProjectLocation {
  return worktreePath ? buildWorktreeLocation(projectLocation, worktreePath) : projectLocation;
}

export function ThreadStatusCapsule(props: ThreadStatusCapsuleProps) {
  const {
    threadId,
    projectId,
    worktreePath,
    projectLocation,
    collaborationRefreshKey,
    onOpenCollaboration,
  } = props;
  const exchanges = useThreadCollaborationExchanges(threadId, collaborationRefreshKey);
  const latestExchange = exchanges[0];
  const latestCounterpart = latestExchange
    ? collaborationCounterpart(latestExchange, threadId)
    : undefined;
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<
    null | "branch" | "commit" | "agents" | "dialogue"
  >(null);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [initializingRepo, setInitializingRepo] = useState(false);
  const [panelAnchor, setPanelAnchor] = useState<{ top: number; right: number }>({
    top: 48,
    right: 16,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const leftCardRef = useRef<HTMLDivElement>(null);

  const projectStatus = useGitStore((s) => s.statuses[projectId]);
  const worktreeStatus = useGitStore((s) =>
    worktreePath ? s.worktreeStatuses[worktreePath] : undefined,
  );
  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
  const thread = useAppStore((s) => s.threads.find((item) => item.id === threadId));
  const hasBackgroundActivity = useThreadHasBackgroundActivity(threadId);
  const todoState = useAppStore((s) => selectThreadTodoDockState(s, threadId));
  // Sub-agent state is owned by the composer capsule's selector; the top-right
  // capsule only reads it (never recomputes) so both surfaces stay in lockstep.
  const agentCounts = useAppStore((s) => selectAgentCapsuleCounts(s, threadId));
  const agentEntries = useAppStore((s) => selectAgentCapsuleEntries(s, threadId));
  const openSubAgent = useAppStore((s) => s.openSubAgent);

  const effectiveStatus = worktreeStatus ?? projectStatus;
  const gitSummary: CapsuleGitSummary | undefined = useMemo(() => {
    if (!effectiveStatus) return undefined;
    return {
      isRepo: effectiveStatus.isRepo,
      branch: effectiveStatus.branch,
      changedFiles:
        effectiveStatus.staged.length +
        effectiveStatus.unstaged.length +
        (effectiveStatus.conflictFiles?.length ?? 0),
      insertions: effectiveStatus.totalInsertions,
      deletions: effectiveStatus.totalDeletions,
      ahead: effectiveStatus.ahead,
      behind: effectiveStatus.behind,
      hasRemote: effectiveStatus.hasRemote,
    };
  }, [effectiveStatus]);

  const taskFraction = useMemo(() => {
    if (!todoState || todoState.steps.length === 0) return undefined;
    return `Step ${stepCompletedCount(todoState)}/${todoState.steps.length}`;
  }, [todoState]);

  const dialogueTitle = latestCounterpart
    ? displayDialogueTitle(latestCounterpart.provenance)
    : undefined;
  const dialogueRawTitle = latestCounterpart?.provenance.title;
  const dialogueTone = latestExchange ? collaborationStatusTone(latestExchange.status) : undefined;
  const dialogueTextClass =
    dialogueTone === "danger"
      ? "text-red-400"
      : dialogueTone === "accent"
        ? "text-sky-400"
        : dialogueTone === "warning"
          ? "text-amber-400"
          : "text-foreground";

  // Collapsed order is fixed: Agents → Step → Dialogue → Changes → Branch.
  // Absent segments are omitted, never placeholders.
  const agentsSummary =
    agentCounts.total > 0
      ? agentCounts.running > 0
        ? t`${agentCounts.running} Agents working`
        : agentCounts.failed > 0
          ? t`${agentCounts.completed + agentCounts.cancelled} Agents ended · ${agentCounts.failed} error`
          : t`${agentCounts.total} Agents ended`
      : undefined;
  const gitLabel =
    gitSummary?.isRepo === true ? buildCapsuleLabel(gitSummary, undefined) : undefined;
  const collapsedAriaLabel = useMemo(() => {
    const parts = [agentsSummary, taskFraction, dialogueTitle, gitLabel].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return t`Project status: ${parts.join(" · ") || "…"}. ${open ? "Hide" : "Show"} details.`;
  }, [agentsSummary, taskFraction, dialogueTitle, gitLabel, open, t]);

  // Every segment is its own button: clicking it opens the small panel, and
  // the branch/agents segments additionally expand their card to the left.
  // Clicks must not bubble to the container toggle.
  const collapsedSegments = useMemo(() => {
    const segments: ReactNode[] = [];
    if (agentsSummary) {
      segments.push(
        <button
          key="agents"
          type="button"
          aria-label={t`${agentsSummary}. Show agents.`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(null);
            setOpen(true);
          }}
          className="shrink-0 font-semibold text-foreground transition-colors hover:text-foreground"
        >
          {agentCounts.running > 0 ? (
            <Trans>{agentCounts.running} Agents working</Trans>
          ) : agentCounts.failed > 0 ? (
            <Trans>
              {agentCounts.completed + agentCounts.cancelled} Agents ended · {agentCounts.failed}{" "}
              error
            </Trans>
          ) : (
            <Trans>{agentCounts.total} Agents ended</Trans>
          )}
        </button>,
      );
    }
    if (taskFraction) {
      segments.push(
        <button
          key="step"
          type="button"
          aria-label={t`${taskFraction}. Show task.`}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            // Steps live inline in the Git panel. The segment only toggles
            // that panel — it never opens a second floating card.
            setOpen((current) => !current);
          }}
          className="shrink-0 font-medium text-foreground"
        >
          {taskFraction}
        </button>,
      );
    }
    if (latestExchange && latestCounterpart) {
      segments.push(
        <button
          key="dialogue"
          type="button"
          aria-label={t`Cross-thread dialogue with ${dialogueTitle}. Show details.`}
          title={dialogueRawTitle}
          aria-expanded={open && expanded === "dialogue"}
          onClick={(e) => {
            e.stopPropagation();
            if (open && expanded === "dialogue") {
              setOpen(false);
            } else {
              setExpanded("dialogue");
              setOpen(true);
            }
          }}
          className="flex max-w-[18ch] shrink-0 items-center gap-1 font-medium"
        >
          <MessagesSquare className={`size-3 shrink-0 ${dialogueTextClass}`} aria-hidden="true" />
          <span className={`truncate ${dialogueTextClass}`} title={String(latestExchange.status)}>
            {collaborationStatusLabel(latestExchange.status)}
          </span>
          <span className="truncate text-foreground" title={dialogueRawTitle}>
            {dialogueTitle}
          </span>
        </button>,
      );
    }
    if (gitSummary?.isRepo === true) {
      const lineChanges = gitSummary.insertions + gitSummary.deletions;
      segments.push(
        <button
          key="changes"
          type="button"
          aria-label={
            gitSummary.changedFiles > 0
              ? t`${gitSummary.changedFiles} changed files. Show git status.`
              : t`Clean. Show git status.`
          }
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="shrink-0 [font-variant-numeric:tabular-nums]"
        >
          {gitSummary.changedFiles > 0 ? (
            lineChanges > 0 ? (
              <>
                <span className="font-semibold text-emerald-400">+{gitSummary.insertions}</span>{" "}
                <span className="font-semibold text-red-400">-{gitSummary.deletions}</span>
              </>
            ) : (
              <span className="font-medium text-foreground">
                <Trans>{gitSummary.changedFiles} changes</Trans>
              </span>
            )
          ) : (
            <span className="text-muted">clean</span>
          )}
        </button>,
      );
      segments.push(
        <button
          key="branch"
          type="button"
          aria-label={t`Branch ${gitSummary.branch || "—"}. Show branches.`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(null);
            setOpen(true);
          }}
          className="flex max-w-[20ch] shrink-0 items-center gap-1 font-medium text-foreground"
        >
          <GitBranch className="size-3 shrink-0 text-muted" aria-hidden="true" />
          <span className="truncate">{gitSummary.branch || "—"}</span>
        </button>,
      );
    }
    if (segments.length === 0) {
      segments.push(
        <span key="empty" className="shrink-0 text-muted">
          {!gitSummary ? "…" : <Trans>not a repo</Trans>}
        </span>,
      );
    }
    return segments.flatMap((segment, index) =>
      index === 0
        ? [segment]
        : [
            <span key={`sep-${index}`} aria-hidden="true" className="shrink-0 text-muted/50">
              {" "}
              ·{" "}
            </span>,
            segment,
          ],
    );
  }, [
    agentsSummary,
    agentCounts,
    taskFraction,
    latestExchange,
    latestCounterpart,
    dialogueTitle,
    dialogueRawTitle,
    dialogueTextClass,
    gitSummary,
    open,
    expanded,
    t,
  ]);

  const isWorking = thread?.status === "working" || hasBackgroundActivity;
  const hasConflict = Boolean(
    effectiveStatus?.mergeInProgress || (effectiveStatus?.conflictFiles?.length ?? 0) > 0,
  );
  const dotClass = capsuleStatusDotClass(gitSummary, { hasConflict, isWorking });

  // Close the floating panel when the user switches project/thread.
  useEffect(() => {
    setOpen(false);
    setExpanded(null);
  }, [projectId, threadId, worktreePath]);

  useEffect(() => {
    if (!open) {
      setMenuOpen(false);
      setExpanded(null);
    }
  }, [open]);

  // Auto-open the full card the moment an agent decomposes work into
  // multiple steps (0 → N transition only — never on plain mount/switch).
  const mountedRef = useRef(false);
  const prevStepCountRef = useRef(0);
  const stepCount = todoState?.steps.length ?? 0;
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevStepCountRef.current = stepCount;
      return;
    }
    if (stepCount > 0 && prevStepCountRef.current === 0) {
      setOpen(true);
    }
    prevStepCountRef.current = stepCount;
  }, [stepCount]);

  // Anchor the body-portaled panel under the capsule so the header's
  // `overflow-hidden` portal target never clips it. Horizontally it hugs the
  // RIGHT edge of the main content header row — the same vertical line as the
  // sidebar toggle at the corner (the row's last item). NOT the capsule
  // button: the capsule itself is portaled into that header, so `closest()`
  // from the button can never reach a layout ancestor, and the button is
  // narrower than the row. The anchor is re-measured on a short loop while
  // open: sidebar open/close never fires window resize, so one-shot measuring
  // would leave the panel stranded.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const buttonRect = buttonRef.current?.getBoundingClientRect();
      if (!buttonRect) return;
      const headerRight =
        document.querySelector("[data-main-content-header]")?.getBoundingClientRect().right ??
        document.getElementById(MAIN_THREAD_HEADER_PORTAL_ID)?.getBoundingClientRect().right;
      const rightEdge = headerRight ?? buttonRect.right;
      const next = {
        top: Math.round(Math.min(window.innerHeight - 16, buttonRect.bottom + 8)),
        right: Math.round(Math.max(8, window.innerWidth - rightEdge)),
      };
      setPanelAnchor((prev) => (prev.top === next.top && prev.right === next.right ? prev : next));
    };
    measure();
    const timer = window.setInterval(measure, 200);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      if (leftCardRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const hasChanges = (gitSummary?.changedFiles ?? 0) > 0;

  const handleViewChanges = () => {
    showGitReviewPanel(projectId, worktreePath);
    setOpen(false);
  };

  const handleRefresh = () => {
    const location = project?.location ?? projectLocation;
    void refreshGitProject({ id: projectId, location }, "manual", "full").catch(() => undefined);
  };

  const handleSwitchBranch = (branch: string, createNew: boolean) => {
    const location = project?.location ?? projectLocation;
    readBridge()
      .gitSwitchBranch({ projectLocation: location, branch, createNew })
      .then((result) => {
        // Immediately patch the store so the UI updates without waiting
        // for the file-watcher → refreshProject cascade. Worktree threads
        // patch their own status slot.
        const store = useGitStore.getState();
        if (worktreePath) {
          const current = store.worktreeStatuses[worktreePath];
          if (current) {
            store.setWorktreeStatus(worktreePath, {
              ...current,
              branch: result.branch,
              tracking: result.tracking,
              ahead: result.ahead,
              behind: result.behind,
            });
          }
          return;
        }
        const status = store.statuses[projectId];
        if (status) {
          store.setStatus(projectId, {
            ...status,
            branch: result.branch,
            tracking: result.tracking,
            ahead: result.ahead,
            behind: result.behind,
          });
        }
        void refreshGitProject({ id: projectId, location }, "manual", "full").catch(
          () => undefined,
        );
      })
      .catch((error: unknown) => {
        toast.danger(friendlyError(error));
      });
  };

  const handleInitRepo = () => {
    const location = project?.location ?? projectLocation;
    setInitializingRepo(true);
    readBridge()
      .gitInit({ projectLocation: resolveEffectiveLocation(location, worktreePath) })
      .then(() => {
        const loc = project?.location ?? projectLocation;
        return refreshGitProject({ id: projectId, location: loc }, "manual", "full");
      })
      .catch((error: unknown) => {
        toast.danger(friendlyError(error));
      })
      .finally(() => {
        setInitializingRepo(false);
      });
  };

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center">
      <div
        ref={buttonRef}
        role="toolbar"
        data-testid="project-status-capsule"
        aria-label={collapsedAriaLabel}
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          if (!open) {
            setOpen(true);
          } else {
            setOpen(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
            } else {
              setOpen(false);
            }
          }
        }}
        className="craftstation-overlay-header__controls flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--composer-surface)] px-3 text-[13px] font-medium text-muted shadow-sm transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
      >
        <span className={`size-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
        <span className="flex items-center gap-1.5 whitespace-nowrap [font-variant-numeric:tabular-nums]">
          {collapsedSegments}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </div>

      {open
        ? createPortal(
            <div
              style={{ position: "fixed", top: panelAnchor.top, right: panelAnchor.right }}
              className="z-[100] flex items-start gap-2 craftstation-overlay-zoom-root"
            >
              {expanded &&
              (expanded === "agents" ||
                expanded === "dialogue" ||
                effectiveStatus?.isRepo) ? (
                <div
                  ref={leftCardRef}
                  className="max-h-[min(60vh,480px)] w-[300px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-[var(--hairline)] bg-[var(--composer-surface)] p-1.5 shadow-2xl craftstation-overlay-zoom-content"
                >
                  {expanded === "agents" ? (
                    <ul className="space-y-0.5">
                      {agentEntries.map((entry) => (
                        <li key={`${threadId}:agent:${entry.itemId}`}>
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              openSubAgent(threadId, entry.itemId);
                            }}
                            title={t`Open agent conversation`}
                            className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--row-hover)]"
                          >
                            <span
                              className={`size-1.5 shrink-0 rounded-full ${agentStatusDotClass(entry.status)}`}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-foreground">
                                {entry.task}
                              </span>
                              {entry.modelLine ? (
                                <span className="block truncate text-[11px] text-muted">
                                  {entry.modelLine}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted">
                              {entry.status === "running" ? (
                                <Trans>Running</Trans>
                              ) : entry.status === "completed" ? (
                                <Trans>Completed</Trans>
                              ) : entry.status === "failed" ? (
                                <Trans>Failed</Trans>
                              ) : (
                                <Trans>Cancelled</Trans>
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : effectiveStatus?.isRepo && expanded === "branch" ? (
                    <CapsuleBranchView
                      projectId={projectId}
                      branch={effectiveStatus.branch}
                      changedFiles={gitSummary?.changedFiles ?? 0}
                      stagedCount={effectiveStatus.staged.length}
                      unstagedCount={effectiveStatus.unstaged.length}
                      gitStatus={effectiveStatus}
                      isWorktree={Boolean(worktreePath)}
                      onSwitchBranch={handleSwitchBranch}
                    />
                  ) : expanded === "dialogue" ? (
                    <div>
                      <p className="px-1.5 py-1 text-xs font-medium text-muted">
                        <Trans>Cross-thread dialogue</Trans>
                      </p>
                      <CollaborationExchangeList
                        threadId={threadId}
                        exchanges={exchanges}
                        {...(onOpenCollaboration
                          ? {
                              onOpen: () => {
                                setOpen(false);
                                onOpenCollaboration();
                              },
                            }
                          : {})}
                      />
                    </div>
                  ) : effectiveStatus?.isRepo && expanded === "commit" ? (
                    <CapsuleCommitView
                      projectId={projectId}
                      projectLocation={project?.location ?? projectLocation}
                      worktreePath={worktreePath}
                      branch={effectiveStatus.branch}
                      insertions={gitSummary?.insertions ?? 0}
                      deletions={gitSummary?.deletions ?? 0}
                      stagedCount={effectiveStatus.staged.length}
                      unstagedCount={effectiveStatus.unstaged.length}
                      hasRemote={effectiveStatus.hasRemote}
                      ahead={effectiveStatus.ahead}
                    />
                  ) : null}
                </div>
              ) : null}
              <div
                ref={panelRef}
                role="dialog"
                aria-label={t`Project and task status`}
                data-testid="project-status-panel"
                className="w-[240px] max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--hairline)] bg-[var(--composer-surface)] shadow-2xl craftstation-overlay-zoom-content"
              >
                <div className="flex items-center justify-between gap-1 px-2 pt-1.5">
                  <p className="truncate text-xs font-semibold text-foreground">
                    <Trans>Git 工具</Trans>
                  </p>
                  <div className="flex items-center">
                    <div className="relative">
                      <button
                        type="button"
                        aria-label={t`更多操作`}
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen((v) => !v)}
                        className="rounded p-1 text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
                      >
                        <Ellipsis className="size-3.5" aria-hidden="true" />
                      </button>
                      {menuOpen ? (
                        <div
                          role="menu"
                          className="absolute top-full right-0 z-10 mt-1 w-40 rounded-lg border border-[var(--hairline)] bg-[var(--composer-surface)] p-1 shadow-xl"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuOpen(false);
                              handleViewChanges();
                            }}
                            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-[var(--row-hover)]"
                          >
                            <Trans>在 Git 面板中打开</Trans>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuOpen(false);
                              handleRefresh();
                            }}
                            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-[var(--row-hover)]"
                          >
                            <Trans>刷新状态</Trans>
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label={collapsed ? t`展开 Git 面板` : t`收起 Git 面板`}
                      aria-expanded={!collapsed}
                      onClick={() => setCollapsed((v) => !v)}
                      className="rounded p-1 text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
                    >
                      <ChevronDown
                        className={`size-3.5 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
                {!collapsed ? (
                  <div className="max-h-[min(60vh,480px)] space-y-0.5 overflow-y-auto px-1.5 py-1">
                    {thread?.goal ? (
                      <div className="w-full rounded-md px-1.5 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted">
                            <GoalIcon className="size-3.5 shrink-0" aria-hidden="true" />
                            <Trans>目标</Trans>
                          </p>
                          <span className="shrink-0 text-[11px] text-muted [font-variant-numeric:tabular-nums]">
                            {thread?.agentKind && isCodexNativeGoalAgent(thread.agentKind) ? (
                              <Trans>原生</Trans>
                            ) : (
                              <Trans>兼容模式</Trans>
                            )}
                          </span>
                        </div>
                        <p className="truncate text-xs text-foreground">{thread.goal.prompt}</p>
                      </div>
                    ) : null}
                    {exchanges.length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((current) => (current === "dialogue" ? null : "dialogue"))
                        }
                        aria-label={t`Cross-thread dialogue. Show details.`}
                        aria-expanded={expanded === "dialogue"}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors hover:bg-[var(--row-hover)]"
                      >
                        <MessagesSquare className="size-4 shrink-0 text-muted" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                          <Trans>Cross-thread dialogue</Trans>
                        </span>
                        <span className={`shrink-0 text-[11px] ${dialogueTextClass}`}>
                          {latestExchange
                            ? collaborationStatusLabel(latestExchange.status)
                            : null}
                        </span>
                        <ChevronLeft className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                      </button>
                    ) : null}
                    {agentCounts.total > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((current) => (current === "agents" ? null : "agents"))
                        }
                        aria-label={t`Agents. Show agents.`}
                        aria-expanded={expanded === "agents"}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors hover:bg-[var(--row-hover)]"
                      >
                        <Bot className="size-4 shrink-0 text-muted" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                          <Trans>Agents</Trans>
                        </span>
                        <span className="shrink-0 text-[11px] text-muted [font-variant-numeric:tabular-nums]">
                          {agentCounts.running > 0 ? (
                            <Trans>{agentCounts.running} running</Trans>
                          ) : agentCounts.failed > 0 ? (
                            <Trans>
                              {agentCounts.completed + agentCounts.cancelled} ended ·{" "}
                              {agentCounts.failed} error
                            </Trans>
                          ) : (
                            <Trans>{agentCounts.total} ended</Trans>
                          )}
                        </span>
                        <ChevronLeft className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                      </button>
                    ) : null}
                    {effectiveStatus?.isRepo ? (
                      <>
                        <button
                          type="button"
                          onClick={handleViewChanges}
                          aria-label={t`Show changes in the Git panel`}
                          title={t`Show changes in the Git panel`}
                          className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors hover:bg-[var(--row-hover)]"
                        >
                          <FileDiff className="size-4 shrink-0 text-muted" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                            <Trans>更改</Trans>
                          </span>
                          {hasChanges ? (
                            <span className="shrink-0 text-[11px] font-semibold [font-variant-numeric:tabular-nums]">
                              <span className="text-emerald-400">
                                +{gitSummary?.insertions ?? 0}
                              </span>{" "}
                              <span className="text-red-400">-{gitSummary?.deletions ?? 0}</span>
                            </span>
                          ) : (
                            <span className="shrink-0 text-[11px] text-muted">{t`clean`}</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((current) => (current === "branch" ? null : "branch"))
                          }
                          aria-label={t`Branch ${effectiveStatus.branch || "—"}. Show branches.`}
                          aria-expanded={expanded === "branch"}
                          className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors hover:bg-[var(--row-hover)]"
                        >
                          <GitBranch className="size-4 shrink-0 text-muted" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                            {effectiveStatus.branch || "—"}
                          </span>
                          <ChevronLeft
                            className="size-3.5 shrink-0 text-muted"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((current) => (current === "commit" ? null : "commit"))
                          }
                          aria-label={t`提交或推送`}
                          aria-expanded={expanded === "commit"}
                          className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors hover:bg-[var(--row-hover)]"
                        >
                          <GitCommitHorizontal
                            className="size-4 shrink-0 text-muted"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                            <Trans>提交或推送</Trans>
                          </span>
                          <ChevronLeft
                            className="size-3.5 shrink-0 text-muted"
                            aria-hidden="true"
                          />
                        </button>
                      </>
                    ) : (
                      <div className="space-y-1.5 px-1 py-1">
                        <p className="text-xs text-muted">
                          {effectiveStatus ? (
                            <Trans>不是 Git 仓库</Trans>
                          ) : (
                            <Trans>正在加载 Git 状态…</Trans>
                          )}
                        </p>
                        {effectiveStatus ? (
                          <button
                            type="button"
                            disabled={initializingRepo}
                            onClick={handleInitRepo}
                            className="h-7 rounded-md border border-[var(--hairline)] px-2 text-xs font-medium text-foreground transition-colors hover:bg-[var(--row-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {initializingRepo ? (
                              <Trans>正在初始化…</Trans>
                            ) : (
                              <Trans>初始化 Git 仓库</Trans>
                            )}
                          </button>
                        ) : null}
                      </div>
                    )}
                    {todoState && todoState.steps.length > 0 ? (
                      <div className="mt-1 border-t border-[var(--hairline)] pt-1">
                        <p className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-muted">
                          <ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
                          <Trans>进程</Trans>
                          <span className="ml-auto shrink-0 [font-variant-numeric:tabular-nums]">
                            {stepCompletedCount(todoState)}/{todoState.steps.length}
                          </span>
                        </p>
                        <ul className="space-y-0.5">
                          {todoState.steps.map((step, index) => (
                            <li
                              key={`${todoState.sourceItemId}:${index}`}
                              className="flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-xs"
                            >
                              {step.status === "completed" ? (
                                <span
                                  className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center"
                                  aria-label="done"
                                >
                                  <Check className="size-3 text-emerald-400" aria-hidden="true" />
                                </span>
                              ) : step.status === "in_progress" ? (
                                <ChevronRight
                                  className={`mt-0.5 size-3.5 shrink-0 text-sky-400 ${isWorking ? "animate-pulse" : ""}`}
                                  aria-label={isWorking ? "in progress" : "paused"}
                                />
                              ) : (
                                <span
                                  className="mt-0.5 size-3.5 shrink-0 rounded-full border border-muted/50"
                                  aria-hidden="true"
                                />
                              )}
                              <span
                                className={`min-w-0 flex-1 whitespace-normal break-words ${step.status === "completed" ? "text-muted" : "text-foreground"}`}
                              >
                                {step.text}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
