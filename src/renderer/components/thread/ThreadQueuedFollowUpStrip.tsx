import { useEffect, useRef, useState } from "react";
import { ListTodo, Pencil, Send, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { QueuedFollowUp } from "@/renderer/state/slices/queuedFollowUpSlice";
import { ThreadDockIconButton } from "./ThreadDockUI";

interface ThreadQueuedFollowUpStripProps {
  queued: QueuedFollowUp;
  onSendNow: () => void;
  onDelete: () => void;
  onPromptChange: (prompt: string) => void;
}

/**
 * One-line extension of the local context bar: queued follow-up text plus
 * Send / Edit / Delete. The prompt is read-only until Edit is pressed.
 */
export function ThreadQueuedFollowUpStrip(props: ThreadQueuedFollowUpStripProps) {
  const { queued, onSendNow, onDelete, onPromptChange } = props;
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(queued.prompt);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(queued.prompt);
    setEditing(false);
  }, [queued.prompt, queued.queuedAt]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const next = draft.trim();
    if (next.length === 0) {
      setDraft(queued.prompt);
      setEditing(false);
      return;
    }
    if (next !== queued.prompt) onPromptChange(next);
    setEditing(false);
  }

  function cancel() {
    setDraft(queued.prompt);
    setEditing(false);
  }

  return (
    <div
      data-thread-queued-follow-up=""
      className="relative z-[1] -mb-px mx-auto flex h-7 w-[calc(100%-32px)] items-center gap-2 border border-b-0 border-[var(--hairline)] px-3 text-xs text-muted"
    >
      <ListTodo className="size-3.5 shrink-0 text-foreground-muted" />
      {editing ? (
        <input
          ref={inputRef}
          data-testid="thread-queued-follow-up"
          aria-label={t`Queued prompt`}
          value={draft}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        />
      ) : (
        <span
          data-testid="thread-queued-follow-up"
          className="min-w-0 flex-1 truncate text-foreground"
          title={queued.prompt}
        >
          {queued.prompt}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <ThreadDockIconButton label={t`Send now`} onPress={onSendNow}>
          <Send className="size-3.5" />
        </ThreadDockIconButton>
        <ThreadDockIconButton
          label={editing ? t`Done` : t`Edit queue`}
          onMouseDown={(event) => {
            if (editing) event.preventDefault();
          }}
          onPress={() => {
            if (editing) commit();
            else setEditing(true);
          }}
        >
          <Pencil className="size-3.5" />
        </ThreadDockIconButton>
        <ThreadDockIconButton label={t`Delete queue`} danger onPress={onDelete}>
          <X className="size-3.5" />
        </ThreadDockIconButton>
      </div>
    </div>
  );
}
