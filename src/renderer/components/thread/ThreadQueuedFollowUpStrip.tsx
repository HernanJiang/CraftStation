import { useEffect, useState } from "react";
import { ListTodo, Send, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common";
import type { QueuedFollowUp } from "@/renderer/state/slices/queuedFollowUpSlice";
import { ThreadDockHeader, ThreadDockIconButton, ThreadDockSection } from "./ThreadDockUI";

interface ThreadQueuedFollowUpStripProps {
  queued: QueuedFollowUp;
  onSendNow: () => void;
  onDelete: () => void;
  onPromptChange: (prompt: string) => void;
}

/**
 * Queue card above the composer: a follow-up waiting for the current turn to
 * finish, with Send now / edit / delete. Mirrors the pending-steer dock chrome.
 */
export function ThreadQueuedFollowUpStrip(props: ThreadQueuedFollowUpStripProps) {
  const { queued, onSendNow, onDelete, onPromptChange } = props;
  const { t } = useLingui();
  const [draft, setDraft] = useState(queued.prompt);

  useEffect(() => {
    setDraft(queued.prompt);
  }, [queued.prompt, queued.queuedAt]);

  return (
    <div data-thread-queued-follow-up="" className="mx-auto w-[calc(100%-32px)]">
      <ThreadDockSection placement="composer" collapsed={false} ariaLabel={t`Queued`}>
        <ThreadDockHeader
          icon={ListTodo}
          title={t`Queued`}
          countLabel={
            queued.paused ? (
              <Trans>paused until you send</Trans>
            ) : (
              <Trans>sends when this turn finishes</Trans>
            )
          }
          actions={
            <div className="flex items-center gap-0.5">
              <Button
                size="sm"
                variant="ghost"
                aria-label={t`Send now`}
                className="h-6 min-w-0 shrink-0 gap-1 px-1.5 text-[11px] text-muted/80 hover:bg-foreground/5 hover:text-foreground"
                onPress={onSendNow}
              >
                <Send className="size-3" />
                <Trans>Send now</Trans>
              </Button>
              <ThreadDockIconButton label={t`Delete queue`} danger onPress={onDelete}>
                <X className="size-3.5" />
              </ThreadDockIconButton>
            </div>
          }
        />
        <div className="px-2 pb-1.5">
          <textarea
            data-testid="thread-queued-follow-up"
            aria-label={t`Queued prompt`}
            value={draft}
            rows={2}
            className="w-full resize-none rounded-md border border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1 text-xs leading-5 text-foreground outline-none focus:border-accent"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              const next = draft.trim();
              if (next.length === 0) {
                setDraft(queued.prompt);
                return;
              }
              if (next !== queued.prompt) onPromptChange(next);
            }}
          />
        </div>
      </ThreadDockSection>
    </div>
  );
}
