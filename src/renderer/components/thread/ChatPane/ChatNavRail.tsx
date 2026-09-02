import { useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { getRuntimeItemPayload } from "@/renderer/state/slices/runtimeEventSlice";
import { useAppStore } from "@/renderer/state/appStore";
import type { ChatTimelineEntry } from "./chatPaneSelectors";

interface NavNode {
  /** Index into the visible timeline entries — the scroll target. */
  entryIndex: number;
  itemId: string;
  /** Trimmed prompt text for the expanded tooltip. */
  summary: string;
}

const MAX_SUMMARY_CHARS = 90;

function promptSummaryFromPayload(payload: unknown): string {
  const content = (payload as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  const text = content
    .map((part) => {
      const typed = part as { kind?: string; text?: string; type?: string } | null;
      if (!typed) return "";
      if (typeof typed.text === "string") return typed.text;
      if (typed.kind === "text" && typeof typed.text === "string") return typed.text;
      return "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.slice(0, MAX_SUMMARY_CHARS);
}

/**
 * Zcode-style vertical quick-navigation rail on the left edge of the chat
 * content. Collapsed it shows only a slim column of tick nodes; on hover (or
 * focus) it expands and shows each user prompt's summary. Clicking a node
 * scrolls the conversation to that message. The node closest to the viewport
 * top is highlighted as the current position.
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
  const [expanded, setExpanded] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);
  // Select only the stable primitive slice references and derive nodes with
  // useMemo: an inline computing selector would return a fresh array on every
  // store notification and can loop `useSyncExternalStore` without a cache.
  const itemsById = useAppStore((state) => state.runtimeItemsByIdByThread[threadId]);
  const nodes = useMemo<readonly NavNode[]>(() => {
    if (!itemsById) return [];
    const collected: NavNode[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry || entry.kind !== "item") continue;
      const item = itemsById[entry.id];
      if (!item || item.type !== "user_message") continue;
      const summary = promptSummaryFromPayload(getRuntimeItemPayload(item, "user_message"));
      collected.push({ entryIndex: index, itemId: entry.id, summary });
    }
    return collected;
  }, [itemsById, entries]);

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
  // Overlay on the far left of the chat content (flush to the main sidebar).
  // Collapsed it is a 12px tick gutter; expanded it paints over the messages
  // instead of pushing the conversation sideways.
  const widthClass = expanded ? "w-52" : "w-3";

  return (
    <div
      ref={railRef}
      data-testid="chat-nav-rail"
      data-expanded={expanded ? "true" : "false"}
      className={`group pointer-events-auto absolute inset-y-0 left-0 z-20 ${widthClass} overflow-hidden transition-[width] duration-150 ${
        expanded
          ? "bg-[color:var(--content-background)]/92 shadow-[4px_0_16px_rgba(0,0,0,0.28)] backdrop-blur-sm"
          : ""
      } ${className ?? ""}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      aria-label={t`Conversation quick navigation`}
    >
      <div className="flex h-full w-full flex-col gap-0.5 py-2 pl-0.5 pr-1">
        {nodes.map((node, index) => {
          const isCurrent = index === currentIndex;
          return (
            <button
              key={node.itemId}
              type="button"
              data-testid={`chat-nav-node-${index}`}
              aria-current={isCurrent ? "true" : undefined}
              title={node.summary || t`Prompt #${index + 1}`}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded(true);
                scrollToIndex(node.entryIndex, { align: "start" });
              }}
              className="flex min-h-3 flex-1 items-center gap-1.5 rounded-md px-0.5 text-left transition-colors hover:bg-white/5"
            >
              <span
                className={`h-1 shrink-0 rounded-full transition-all ${
                  isCurrent ? "w-2.5 bg-accent" : "w-1.5 bg-neutral-600 group-hover:bg-neutral-400"
                }`}
                aria-hidden="true"
              />
              {expanded ? (
                <span
                  className={`min-w-0 flex-1 truncate text-[10px] leading-tight ${
                    isCurrent ? "text-accent" : "text-neutral-500"
                  }`}
                >
                  {node.summary || t`Prompt #${index + 1}`}
                </span>
              ) : null}
            </button>
          );
        })}
        {nodeCount > 0 ? (
          <span
            className={`shrink-0 pl-3 text-[9px] text-neutral-600 ${expanded ? "" : "hidden"}`}
            aria-hidden="true"
          >
            {currentIndex + 1}/{nodeCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}
