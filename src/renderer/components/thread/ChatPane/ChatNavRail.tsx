import { useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { getRuntimeItemPayload } from "@/renderer/state/slices/runtimeEventSlice";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { useAppStore } from "@/renderer/state/appStore";
import type { MessageItemPayload } from "@/shared/contracts";
import type { ChatTimelineEntry } from "./chatPaneSelectors";

interface NavNode {
  /** Index into the visible timeline entries — the scroll target. */
  entryIndex: number;
  itemId: string;
  /** Trimmed prompt text for the tick tooltip and detail card. */
  summary: string;
  /** Trimmed assistant reply preview for the detail card ("" when none yet). */
  assistantPreview: string;
  /** True while this turn's assistant reply is still streaming. */
  isWorking: boolean;
}

const MAX_SUMMARY_CHARS = 90;
const MAX_CARD_PROMPT_CHARS = 140;
const MAX_CARD_ASSISTANT_CHARS = 200;

function textFromContentBlocks(payload: unknown): string {
  const content = (payload as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const typed = part as { kind?: string; text?: string; type?: string } | null;
      if (!typed || typeof typed.text !== "string") return "";
      return typed.text;
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

function promptSummaryFromItem(item: RuntimeChatItem | undefined): string {
  if (!item) return "";
  return truncate(
    textFromContentBlocks(getRuntimeItemPayload(item, "user_message")).slice(0, MAX_SUMMARY_CHARS),
    MAX_SUMMARY_CHARS,
  );
}

function assistantPreviewFromItem(item: RuntimeChatItem | undefined): string {
  if (!item || item.type !== "assistant_message") return "";
  const streamed = (item.streams.assistant_text ?? "").replace(/\s+/gu, " ").trim();
  const payloadText = textFromContentBlocks(
    getRuntimeItemPayload<MessageItemPayload>(item, "assistant_message"),
  );
  const combined = streamed.length > 0 ? `${streamed} ${payloadText}`.trim() : payloadText;
  return truncate(combined, MAX_CARD_ASSISTANT_CHARS);
}

/**
 * Tick width by distance from the hovered/clicked node: only the focused dash
 * elongates, neighbours fall off in steps, distant ticks stay short. Pure
 * helper so the stair pattern is unit-testable.
 */
export function tickWidthClassByDistance(distance: number): string {
  if (distance <= 0) return "w-8";
  if (distance === 1) return "w-5";
  if (distance === 2) return "w-3";
  return "w-1.5";
}

export function tickToneClassByDistance(distance: number, isScrollCurrent: boolean): string {
  if (distance === 0) return "bg-neutral-100";
  if (distance === 1) return "bg-neutral-400";
  if (distance === 2) return "bg-neutral-500";
  return isScrollCurrent ? "bg-neutral-300" : "bg-neutral-600/70";
}

/**
 * Slim vertical quick-navigation rail hugging the left edge of the chat
 * content. At rest it is a faint column of short grey ticks (the scroll
 * position node is a touch brighter). Hovering or clicking a tick elongates
 * only that dash, with neighbours stepping down by distance, and pops an
 * independent preview card (prompt + reply摘要) to the tick's right.
 * Clicking a tick scrolls the conversation to that turn.
 */
export function ChatNavRail(props: {
  threadId: string;
  entries: readonly ChatTimelineEntry[];
  scrollToIndex: (index: number, options?: { align?: "start" | "center" | "end" }) => void;
  /** 0..1 scroll progress of the chat scroll container, for current-node tracking. */
  scrollProgress?: number | undefined;
  className?: string | undefined;
}) {
  const { threadId, entries, scrollToIndex, scrollProgress, className } = props;
  const { t } = useLingui();
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [cardAnchorTop, setCardAnchorTop] = useState<number | null>(null);
  // Select only the stable primitive slice references and derive nodes with
  // useMemo: an inline computing selector would return a fresh array on every
  // store notification and can loop `useSyncExternalStore` without a cache.
  const itemsById = useAppStore((state) => state.runtimeItemsByIdByThread[threadId]);
  const itemIds = useAppStore((state) => state.runtimeItemIdsByThread[threadId]);
  const nodes = useMemo<readonly NavNode[]>(() => {
    if (!itemsById) return [];
    const collected: NavNode[] = [];
    const order = itemIds ?? [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry || entry.kind !== "item") continue;
      const item = itemsById[entry.id];
      if (!item || item.type !== "user_message") continue;
      // The reply is the first assistant message after this prompt in store
      // order (before the next user prompt).
      let assistant: RuntimeChatItem | undefined;
      const startAt = order.indexOf(entry.id);
      if (startAt >= 0) {
        for (let k = startAt + 1; k < order.length; k += 1) {
          const next = itemsById[order[k]!];
          if (!next) continue;
          if (next.type === "user_message") break;
          if (next.type === "assistant_message") {
            assistant = next;
            break;
          }
        }
      }
      collected.push({
        entryIndex: index,
        itemId: entry.id,
        summary: promptSummaryFromItem(item),
        assistantPreview: assistantPreviewFromItem(assistant),
        isWorking: assistant ? assistant.state !== "completed" : true,
      });
    }
    return collected;
  }, [itemsById, itemIds, entries]);

  // The current node is derived from scroll progress across the prompt nodes:
  // the last prompt whose normalized position is at/above the viewport top.
  const currentIndex = useMemo(() => {
    if (nodes.length <= 1) return nodes.length - 1;
    const progress = scrollProgress ?? 0;
    // Map scroll progress onto node positions; without per-item offsets this is
    // an approximation uniform across the conversation, which is enough to
    // keep a stable "current" highlight between clicks.
    const approx = Math.round((nodes.length - 1) * Math.min(Math.max(progress, 0), 1));
    return Math.min(Math.max(approx, 0), nodes.length - 1);
  }, [nodes, scrollProgress]);

  if (nodes.length === 0) return null;

  const nodeCount = nodes.length;
  const focusedNode = focusIndex !== null ? nodes[focusIndex] : undefined;

  const focusNode = (index: number, anchor: HTMLElement | null) => {
    setFocusIndex(index);
    if (anchor) setCardAnchorTop(anchor.offsetTop + anchor.offsetHeight / 2);
  };
  const clearFocus = () => {
    setFocusIndex(null);
    setCardAnchorTop(null);
  };

  return (
    <div
      data-testid="chat-nav-rail"
      data-focused-index={focusIndex ?? -1}
      className={`group pointer-events-none absolute inset-y-0 left-0 z-20 w-10 ${className ?? ""}`}
      onMouseLeave={clearFocus}
      aria-label={t`Conversation quick navigation`}
    >
      <div className="relative flex h-full w-full flex-col justify-center gap-1 py-2 pl-1.5">
        {nodes.map((node, index) => {
          const isCurrent = index === currentIndex;
          const distance =
            focusIndex === null ? Number.POSITIVE_INFINITY : Math.abs(index - focusIndex);
          const isFocused = focusIndex !== null && distance === 0;
          return (
            <button
              key={node.itemId}
              type="button"
              data-testid={`chat-nav-node-${index}`}
              data-focused={isFocused ? "true" : "false"}
              aria-current={isCurrent ? "true" : undefined}
              aria-label={node.summary || t`Prompt #${index + 1}`}
              title={node.summary || t`Prompt #${index + 1}`}
              onMouseEnter={(event) => focusNode(index, event.currentTarget)}
              onFocus={(event) => focusNode(index, event.currentTarget)}
              onClick={(event) => {
                event.stopPropagation();
                focusNode(index, event.currentTarget);
                scrollToIndex(node.entryIndex, { align: "start" });
              }}
              className="pointer-events-auto flex min-h-4 items-center rounded-sm px-0.5 text-left outline-none focus-visible:bg-white/5"
            >
              <span
                className={`h-[3px] shrink-0 rounded-full transition-all duration-150 ${focusIndex === null ? "w-1.5" : tickWidthClassByDistance(distance)} ${
                  focusIndex === null
                    ? isCurrent
                      ? "bg-neutral-200"
                      : "bg-neutral-600/70"
                    : tickToneClassByDistance(distance, isCurrent)
                }`}
                aria-hidden="true"
              />
            </button>
          );
        })}
        <span className="sr-only" aria-hidden="false">
          {currentIndex + 1}/{nodeCount}
        </span>
      </div>

      {focusedNode && focusIndex !== null ? (
        <div
          data-testid="chat-nav-card"
          role="status"
          style={cardAnchorTop !== null ? { top: cardAnchorTop } : undefined}
          className="pointer-events-none absolute left-10 z-30 w-64 max-w-[16rem] -translate-y-1/2 rounded-lg border border-border/60 bg-[#1c1c1f]/95 p-2.5 text-left shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px]">
            <span className="font-semibold text-muted">
              {focusIndex + 1}/{nodeCount}
            </span>
            <span
              className={`inline-flex items-center gap-1 font-medium ${
                focusedNode.isWorking ? "text-sky-300" : "text-neutral-400"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  focusedNode.isWorking ? "animate-pulse bg-sky-300" : "bg-neutral-500"
                }`}
                aria-hidden="true"
              />
              {focusedNode.isWorking ? t`Working` : t`Done`}
            </span>
          </div>
          <p className="line-clamp-3 text-[11px] leading-snug text-foreground">
            {truncate(focusedNode.summary, MAX_CARD_PROMPT_CHARS) || t`Prompt #${focusIndex + 1}`}
          </p>
          {focusedNode.assistantPreview ? (
            <p className="mt-1.5 line-clamp-4 border-t border-border/50 pt-1.5 text-[11px] leading-snug text-muted">
              {focusedNode.assistantPreview}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
