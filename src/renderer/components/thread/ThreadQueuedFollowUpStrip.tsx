import { ListTodo, Paperclip, Pencil, Send, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { PromptSegment } from "@/shared/contracts";
import { fileNameFromPath, isImagePath } from "@/shared/promptContent";
import type { QueuedFollowUp } from "@/renderer/state/slices/queuedFollowUpSlice";
import { attachmentImageUrl } from "../composer/useAttachments";
import { ThreadDockIconButton } from "./ThreadDockUI";

interface ThreadQueuedFollowUpStripProps {
  /** FIFO queue — every queued follow-up renders as its own stacked row. */
  items: QueuedFollowUp[];
  onSendNow: (itemId: string) => void;
  /** Move a queued message back into the composer for editing. */
  onEdit: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  imageUrlForPath?: ((path: string) => string) | undefined;
}

function queuedAttachments(queued: QueuedFollowUp) {
  return (queued.segments ?? []).filter(
    (segment): segment is Extract<PromptSegment, { kind: "attachment" }> =>
      segment.kind === "attachment",
  );
}

/**
 * One-line-per-message extension of the local context bar: queued follow-up
 * text plus its attachments (images stay visible while queued), with
 * Send / Edit / Delete per row. Edit hands the message back to the composer
 * instead of editing inline so attachments survive the round trip.
 */
export function ThreadQueuedFollowUpStrip(props: ThreadQueuedFollowUpStripProps) {
  const { items, onSendNow, onEdit, onDelete, imageUrlForPath } = props;
  const { t } = useLingui();

  return (
    <>
      {items.map((queued, index) => {
        const attachments = queuedAttachments(queued);
        return (
          <div
            key={queued.id}
            data-thread-queued-follow-up=""
            className="relative z-[1] -mb-px mx-auto flex h-7 w-[calc(100%-32px)] items-center gap-2 border border-b-0 border-[var(--hairline)] px-3 text-xs text-muted"
          >
            {index === 0 ? (
              <ListTodo className="size-3.5 shrink-0 text-foreground-muted" />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            <span
              data-testid="thread-queued-follow-up"
              className="min-w-0 flex-1 truncate text-foreground"
              title={queued.prompt}
            >
              {queued.prompt}
            </span>
            {attachments.length > 0 ? (
              <span
                data-testid="thread-queued-follow-up-attachments"
                className="flex shrink-0 items-center gap-1"
              >
                {attachments.map((segment, segmentIndex) => {
                  const name = fileNameFromPath(segment.path);
                  if (isImagePath(name, segment.mimeType)) {
                    return (
                      <img
                        key={`${segment.path}-${segmentIndex}`}
                        src={attachmentImageUrl({ path: segment.path }, imageUrlForPath)}
                        alt={name}
                        title={name}
                        className="size-4 rounded-sm object-cover"
                      />
                    );
                  }
                  return (
                    <span
                      key={`${segment.path}-${segmentIndex}`}
                      title={name}
                      className="flex max-w-24 items-center gap-0.5 truncate text-foreground-muted"
                    >
                      <Paperclip className="size-3 shrink-0" />
                      <span className="truncate">{name}</span>
                    </span>
                  );
                })}
              </span>
            ) : null}
            <div className="flex shrink-0 items-center gap-0.5">
              <ThreadDockIconButton label={t`Send now`} onPress={() => onSendNow(queued.id)}>
                <Send className="size-3.5" />
              </ThreadDockIconButton>
              <ThreadDockIconButton label={t`Edit`} onPress={() => onEdit(queued.id)}>
                <Pencil className="size-3.5" />
              </ThreadDockIconButton>
              <ThreadDockIconButton
                label={t`Delete queued message`}
                danger
                onPress={() => onDelete(queued.id)}
              >
                <X className="size-3.5" />
              </ThreadDockIconButton>
            </div>
          </div>
        );
      })}
    </>
  );
}
