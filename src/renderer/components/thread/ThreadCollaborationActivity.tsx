import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUpRight } from "lucide-react";
import type { ThreadExchangeView } from "@/shared/threadCollaboration";
import { readBridge } from "@/renderer/bridge";
import { openThread } from "@/renderer/actions/threadActions";
import {
  CollaborationStatusIcon,
  collaborationCounterpart,
  collaborationStatusLabel,
  displayDialogueTitle,
} from "./threadCollaborationUi";

export const MAX_VISIBLE_COLLABORATION_EXCHANGES = 3;

export function useThreadCollaborationExchanges(
  threadId: string,
  refreshKey?: number,
): ThreadExchangeView[] {
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
          actorThreadId: threadId,
          threadId,
          limit: MAX_VISIBLE_COLLABORATION_EXCHANGES,
        });
        if (!active) return;
        setExchanges((previous) =>
          previous.length === next.length &&
          previous.every(
            (entry, index) =>
              entry.id === next[index]?.id &&
              entry.status === next[index]?.status &&
              entry.updatedAt === next[index]?.updatedAt,
          )
            ? previous
            : next,
        );
      } catch {
        // The full dialog owns actionable diagnostics. The compact projection
        // stays quiet when the host is temporarily unavailable.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [threadId, refreshKey]);

  return exchanges;
}

export function CollaborationExchangeList(props: {
  threadId: string;
  exchanges: ThreadExchangeView[];
  onOpen?: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-0.5">
      {props.exchanges.map((exchange) => {
        const counterpart = collaborationCounterpart(exchange, props.threadId);
        const displayTitle = displayDialogueTitle(counterpart.provenance);
        return (
          <div
            key={exchange.id}
            className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-xs"
          >
            <CollaborationStatusIcon status={exchange.status} className="size-3 shrink-0" />
            <span className="shrink-0 text-muted">
              {counterpart.direction === "outbound" ? <Trans>To</Trans> : <Trans>From</Trans>}
            </span>
            <span
              className="min-w-0 flex-1 truncate font-medium text-foreground"
              title={counterpart.provenance.title}
            >
              {displayTitle}
            </span>
            <span className="shrink-0 text-[11px] text-muted">
              {collaborationStatusLabel(exchange.status)}
            </span>
            <button
              type="button"
              aria-label={t`Open ${displayTitle}`}
              title={counterpart.provenance.title}
              onClick={() =>
                openThread(counterpart.provenance.threadId, {
                  focusComposer: false,
                  switchWorkspace: true,
                })
              }
              className="shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
            >
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {props.onOpen ? (
        <button
          type="button"
          onClick={props.onOpen}
          className="rounded-md px-1.5 py-1 text-left text-xs font-medium text-foreground transition-colors hover:bg-[var(--row-hover)]"
        >
          <Trans>View cross-thread dialogue</Trans>
        </button>
      ) : null}
    </div>
  );
}
