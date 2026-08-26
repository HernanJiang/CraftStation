import { Ellipsis, Loader2, Pin } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { Thread } from "@/shared/contracts";
import type { StatusTone } from "@/renderer/components/providers/statusTone";
import { toggleStarThread } from "@/renderer/actions/threadActions";

interface ThreadItemSuffixProps {
  thread: Thread;
  statusTone: StatusTone;
  isExperimentCandidate: boolean;
  onMore?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

const iconButtonClass =
  "flex size-[18px] shrink-0 items-center justify-center rounded-md text-muted/70 opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--row-hover)] hover:text-foreground";

function ThreadStatus(props: { thread: Thread; statusTone: StatusTone }) {
  const { t } = useLingui();
  if (props.statusTone === "working") {
    return <Loader2 className="size-3 animate-spin text-accent" aria-label={t`Working`} />;
  }
  if (props.thread.done || props.statusTone === "done" || props.statusTone === "finished") {
    return (
      <span
        aria-label={t`Completed`}
        className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
      />
    );
  }
  return null;
}

/** Keep the row quiet: status is the only persistent suffix; actions appear on hover. */
export function ThreadItemSuffix(props: ThreadItemSuffixProps) {
  const { t } = useLingui();

  return (
    <span className="relative flex w-[38px] shrink-0 items-center justify-end">
      <span className="flex size-[18px] items-center justify-center transition-opacity group-hover:opacity-0">
        <ThreadStatus thread={props.thread} statusTone={props.statusTone} />
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
        </span>
      ) : null}
    </span>
  );
}
