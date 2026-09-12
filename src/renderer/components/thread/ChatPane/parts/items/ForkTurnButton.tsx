import { Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { GitFork } from "lucide-react";
import { forkThreadFromTurn } from "@/renderer/actions/forkThreadActions";

interface ForkTurnButtonProps {
  threadId: string;
  /** Anchor item id of the completed turn to fork from. */
  itemId: string;
}

/**
 * Message-strip action that branches the conversation at this turn: the new
 * thread carries this turn's transcript prefix, is grouped with the source,
 * and opens side-by-side without launching.
 */
export function ForkTurnButton({ threadId, itemId }: ForkTurnButtonProps) {
  const { t } = useLingui();
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger>
        <button
          type="button"
          aria-label={t`Fork from this turn`}
          className="flex size-5 items-center justify-center rounded text-muted/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            void forkThreadFromTurn(threadId, itemId).catch(() => undefined);
          }}
        >
          <GitFork className="size-3" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="top">{t`Fork from this turn`}</Tooltip.Content>
    </Tooltip>
  );
}
