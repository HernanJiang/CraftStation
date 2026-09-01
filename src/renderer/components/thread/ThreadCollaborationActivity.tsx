import { useEffect, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUpRight } from "lucide-react";
import type { ThreadExchangeView } from "@/shared/threadCollaboration";
import { readBridge } from "@/renderer/bridge";
import { openThread } from "@/renderer/actions/threadActions";
import {
  CollaborationStatusIcon,
  collaborationCounterpart,
  collaborationStatusLabel,
  collaborationStatusTone,
  compositionLabel,
} from "./threadCollaborationUi";

const MAX_VISIBLE_EXCHANGES = 3;

export function ThreadCollaborationActivity(props: {
  threadId: string;
  refreshKey?: number;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const [exchanges, setExchanges] = useState<ThreadExchangeView[]>([]);

  useEffect(() => {
    let active = true;
    const bridge = readBridge();
    const listThreadExchanges = bridge?.listThreadExchanges;
    if (typeof listThreadExchanges !== "function") {
      return () => {
        active = false;
      };
    }
    const load = async () => {
      try {
        const next = await listThreadExchanges({
          actorThreadId: props.threadId,
          threadId: props.threadId,
          limit: MAX_VISIBLE_EXCHANGES,
        });
        if (active) setExchanges(next);
      } catch {
        // The full dialog owns actionable diagnostics. The compact timeline
        // projection stays quiet when the host is temporarily unavailable.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [props.threadId, props.refreshKey]);

  if (exchanges.length === 0) return null;

  return (
    <section
      aria-label={t`Cross-thread dialogue activity`}
      className="mx-auto flex w-full max-w-[920px] shrink-0 flex-col gap-1 border-b border-border/60 px-3 py-2"
    >
      {exchanges.map((exchange) => {
        const counterpart = collaborationCounterpart(exchange, props.threadId);
        return (
          <div
            key={exchange.id}
            className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-secondary/60 px-2.5 py-1.5 text-xs"
          >
            <Chip
              color={collaborationStatusTone(exchange.status)}
              size="sm"
              variant="soft"
              className="shrink-0"
            >
              <CollaborationStatusIcon status={exchange.status} className="size-3" />
              <Chip.Label>{collaborationStatusLabel(exchange.status)}</Chip.Label>
            </Chip>
            <span className="shrink-0 text-muted">
              {counterpart.direction === "outbound" ? <Trans>To</Trans> : <Trans>From</Trans>}
            </span>
            <span className="min-w-0 truncate font-medium text-foreground">
              {counterpart.provenance.title}
            </span>
            <span className="hidden min-w-0 truncate text-muted @min-[620px]:inline">
              {compositionLabel(counterpart.provenance)}
            </span>
            {exchange.replyExcerpt ? (
              <span className="hidden min-w-0 flex-1 truncate text-muted @min-[760px]:inline">
                {exchange.replyExcerpt}
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <Button
              isIconOnly
              aria-label={t`Open ${counterpart.provenance.title}`}
              size="sm"
              variant="ghost"
              onPress={() =>
                openThread(counterpart.provenance.threadId, {
                  focusComposer: false,
                  switchWorkspace: true,
                })
              }
            >
              <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
        );
      })}
      <Button className="self-start px-2 text-xs" size="sm" variant="ghost" onPress={props.onOpen}>
        <Trans>View cross-thread dialogue</Trans>
      </Button>
    </section>
  );
}
