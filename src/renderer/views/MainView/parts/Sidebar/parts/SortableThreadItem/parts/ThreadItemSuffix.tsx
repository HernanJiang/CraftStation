import { Archive, Clock, Ellipsis, Loader2, Pin } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { Thread } from "@/shared/contracts";
import type { StatusTone } from "@/renderer/components/providers/statusTone";
import { archiveThread, toggleStarThread } from "@/renderer/actions/threadActions";
import { scheduleRelatesToThread } from "@/shared/schedules";
import { useScheduleStore } from "@/renderer/state/scheduleStore";
import { DraftIndicator } from "../../DraftIndicator";

interface ThreadItemSuffixProps {
  thread: Thread;
  statusTone: StatusTone;
  isExperimentCandidate: boolean;
  hasUnreadNotification?: boolean;
  hasDraft?: boolean;
  onMore?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

const iconButtonClass =
  "flex size-[18px] shrink-0 items-center justify-center rounded-md text-muted/70 opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--row-hover)] hover:text-foreground";

function ThreadStatus(props: { thread: Thread; statusTone: StatusTone }) {
  const { t } = useLingui();
  const hasSchedule = useScheduleStore((state) =>
    state.tasks.some((task) => scheduleRelatesToThread(task, props.thread.id)),
  );
  if (props.statusTone === "working") {
    return <Loader2 className="size-3 animate-spin text-accent" aria-label={t`Working`} />;
  }
  // A terminal parser can briefly report `finished` while the final turn
  // record has not landed yet. Do not paint the tiny completed dot for that
  // transient state; it falsely tells the user an unfinished task is done.
  const hasSettledTurn =
    props.thread.lastTurnEndedAt !== undefined && props.thread.activeTurnStartedAt === undefined;
  const isComplete =
    props.thread.done ||
    props.statusTone === "done" ||
    (props.statusTone === "finished" && hasSettledTurn);
  // Clock only for a settled thread that still has a bound schedule. Never
  // replace the working spinner, and never compete with error/attention.
  if (
    hasSchedule &&
    props.statusTone !== "error" &&
    props.statusTone !== "attention" &&
    (isComplete || props.statusTone === "active" || props.statusTone === "inactive")
  ) {
    return (
      <Clock
        className="size-3 text-muted"
        aria-label={t`Scheduled`}
        data-testid="thread-schedule-clock"
      />
    );
  }
  if (isComplete) {
    return (
      <span
        aria-label={t`Completed`}
        className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
      />
    );
  }
  return null;
}

/** Keep the row quiet: status/unread sit on the far right; actions appear on hover. */
export function ThreadItemSuffix(props: ThreadItemSuffixProps) {
  const { t } = useLingui();
  const marker = props.hasUnreadNotification ? (
    <span
      aria-label={t`Unread notification`}
      data-testid="thread-unread-notification-dot"
      className="size-1.5 shrink-0 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.55)]"
    />
  ) : props.hasDraft ? (
    <DraftIndicator />
  ) : (
    <ThreadStatus thread={props.thread} statusTone={props.statusTone} />
  );

  return (
    <span className="relative ml-auto flex w-[58px] shrink-0 items-center justify-end">
      <span className="flex size-[18px] items-center justify-end transition-opacity group-hover:opacity-0">
        {marker}
      </span>
      {!props.isExperimentCandidate ? (
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 group-hover:pointer-events-auto">
          <button
            type="button"
            aria-label={
              props.thread.starred ? t`Unpin ${props.thread.title}` : t`Pin ${props.thread.title}`
            }
            className={`${iconButtonClass} ${props.thread.starred ? "text-foreground" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleStarThread(props.thread.id);
            }}
          >
            <Pin className={`size-3 ${props.thread.starred ? "fill-current" : ""}`} />
          </button>
          <button
            type="button"
            aria-label={t`More actions for ${props.thread.title}`}
            className={iconButtonClass}
            onClick={(event) => {
              event.stopPropagation();
              props.onMore?.(event);
            }}
          >
            <Ellipsis className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t`Archive ${props.thread.title}`}
            className={iconButtonClass}
            onClick={(event) => {
              event.stopPropagation();
              archiveThread(props.thread.id);
            }}
          >
            <Archive className="size-3" />
          </button>
        </span>
      ) : null}
    </span>
  );
}
