import { useLingui } from "@lingui/react/macro";
import { AlertCircle, CheckCircle2, Clipboard, LoaderCircle, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Thread } from "@/shared/contracts";
import { isRetryableCapacityError } from "@/shared/retryableCapacityError";
import { useAppStore } from "@/renderer/state/appStore";
import { formatTokenCount } from "./formatTokenCount";
import { estimateStreamedTokens, formatTokenRate } from "@/shared/tokenSpeed";
import { resolveThreadContextUsageSummary } from "./threadContextUsage";
import { msg as linguiMsg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";

type RuntimeState = "working" | "completed" | "error" | "idle";
const EMPTY_COMPLETED_TURNS: readonly {
  startedAt: number;
  endedAt: number;
  anchorItemId: string | null;
}[] = [];

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  if (minutes <= 0) return i18n._(linguiMsg`${remainder}秒`);
  return i18n._(linguiMsg`${minutes}分${remainder}秒`);
}

function formatClock(value: string | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : "--";
}

function resolveRuntimeState(thread: Thread): RuntimeState {
  if (thread.status === "error") return "error";
  if (
    thread.status === "working" ||
    thread.status === "launching" ||
    thread.status === "needs_approval" ||
    thread.status === "needs_reply"
  ) {
    return "working";
  }
  if (thread.done || thread.status === "finished" || thread.lastTurnEndedAt) return "completed";
  return "idle";
}

export function ThreadRuntimeStatusBar({ threadId }: { threadId: string }) {
  const { t } = useLingui();
  const thread = useAppStore((state) =>
    state.threads.find((candidate) => candidate.id === threadId),
  );
  const contextUsage = useAppStore((state) => state.runtimeContextByThread[threadId]);
  const completedTurns = useAppStore(
    (state) => state.runtimeCompletedTurnsByThread[threadId] ?? EMPTY_COMPLETED_TURNS,
  );
  const turnOutput = useAppStore((state) => state.runtimeTurnOutputByThread[threadId]);
  const itemIds = useAppStore((state) => state.runtimeItemIdsByThread[threadId]);
  const itemsById = useAppStore((state) => state.runtimeItemsByIdByThread[threadId]);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!thread || resolveRuntimeState(thread) !== "working") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [thread]);

  const state = thread ? resolveRuntimeState(thread) : "idle";
  const summary = useMemo(
    () =>
      thread
        ? resolveThreadContextUsageSummary({
            thread,
            agentStatus: undefined,
            reportedUsage: contextUsage,
          })
        : undefined,
    [contextUsage, thread],
  );
  // Estimated output for reopened threads (no live turn-output accumulator):
  // sum persisted model-output text since the last user message.
  const replayedOutputTokens = useMemo(() => {
    if (turnOutput !== undefined || !itemIds || !itemsById) return 0;
    let total = 0;
    for (let i = itemIds.length - 1; i >= 0; i--) {
      const item = itemsById[itemIds[i]!];
      if (!item) continue;
      if (item.type === "user_message") break;
      if (item.type === "assistant_message" || item.type === "reasoning") {
        total += estimateStreamedTokens(
          (item.streams.assistant_text ?? "") + (item.streams.reasoning_text ?? ""),
        );
      }
    }
    return total;
  }, [turnOutput, itemIds, itemsById]);
  if (!thread) return null;

  const startedAt = thread.activeTurnStartedAt ?? thread.lastTurnStartedAt;
  const endedAt = thread.lastTurnEndedAt;
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  const endedMs = endedAt ? Date.parse(endedAt) : NaN;
  const elapsed = Number.isFinite(startedMs)
    ? formatDuration(
        ((state === "working" ? now : Number.isFinite(endedMs) ? endedMs : now) - startedMs) / 1000,
      )
    : undefined;
  const currentTokens = summary?.usedTokens;
  const previousTurn = completedTurns.at(-1);
  // Decode throughput per the deepseek-harness fold: summed per-segment
  // first→last-delta windows (tool gaps never enter the denominator), with
  // each segment's provider-reported output tokens preferred over its char
  // estimate. Deltas carry a supervisor-side emission stamp so IPC batching
  // can't compress the window.
  const segment = turnOutput?.segment ?? null;
  const openMs = segment ? Math.max(0, segment.lastDeltaAt - segment.firstDeltaAt) : 0;
  const decodeMs = (turnOutput?.decodeMs ?? 0) + openMs;
  const openTokens = segment
    ? segment.reportedTokens > 0
      ? segment.reportedTokens + Math.max(0, segment.estimatedTokens - segment.reportedBaseline)
      : segment.estimatedTokens
    : 0;
  const liveOutputTokens =
    (turnOutput?.finalizedTokens ?? 0) + (turnOutput?.floatingReported ?? 0) + openTokens;
  // Providers that deliver output in one/few chunks — or produce none of the
  // live delta events at all — leave a zero-width (or absent) decode window,
  // which hides the rate entirely. Fall back to whole-turn elapsed for the
  // denominator, and to persisted stream text for the numerator on reopened
  // threads, so every CLI shows a readable throughput (marked 估算).
  const outputTokens = turnOutput !== undefined ? liveOutputTokens : replayedOutputTokens;
  const turnElapsedMs = Number.isFinite(startedMs)
    ? Math.max(0, (state === "working" || !Number.isFinite(endedMs) ? now : endedMs) - startedMs)
    : 0;
  const wholeTurnFallback = decodeMs <= 0 && outputTokens > 0;
  const effectiveDecodeMs = decodeMs > 0 ? decodeMs : turnElapsedMs;
  const tokensPerSecond =
    outputTokens > 0 && effectiveDecodeMs > 0
      ? outputTokens / (effectiveDecodeMs / 1000)
      : undefined;
  const rateIsEstimated =
    wholeTurnFallback ||
    turnOutput === undefined ||
    (turnOutput.finalizedTokens === 0 &&
      turnOutput.floatingReported === 0 &&
      (segment?.reportedTokens ?? 0) === 0);
  const icon =
    state === "working" ? (
      <LoaderCircle className="size-3.5 animate-spin" />
    ) : state === "error" ? (
      <AlertCircle className="size-3.5" />
    ) : state === "completed" ? (
      <CheckCircle2 className="size-3.5" />
    ) : (
      <Wrench className="size-3.5" />
    );
  const label =
    state === "working"
      ? t`Working`
      : state === "error"
        ? t`Error`
        : state === "completed"
          ? t`Completed`
          : t`Idle`;
  const tone =
    state === "working"
      ? "text-sky-300"
      : state === "error"
        ? "text-red-300"
        : state === "completed"
          ? "text-emerald-300"
          : "text-muted";

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      right: Math.max(8, window.innerWidth - rect.right),
      bottom: window.innerHeight - rect.top + 6,
    });
  };
  const hide = () => setPos(null);

  const visibleErrorMessage =
    thread.errorMessage && !isRetryableCapacityError(thread.errorMessage)
      ? thread.errorMessage
      : undefined;

  const copyError = async () => {
    if (state !== "error" || !visibleErrorMessage) return;
    try {
      await navigator.clipboard.writeText(visibleErrorMessage);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard permissions are unavailable in some remote surfaces.
    }
  };

  return (
    <div
      ref={triggerRef}
      className="relative flex shrink-0 items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
      data-testid="thread-runtime-status"
    >
      <button
        type="button"
        aria-label={state === "error" ? t`${label}，点击复制错误详情` : label}
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium ${tone} hover:bg-[var(--row-hover)]`}
        onClick={() => void copyError()}
      >
        {icon}
        <span>{label}</span>
        {elapsed ? <span className="tabular-nums opacity-75">{elapsed}</span> : null}
        {state === "error" ? <Clipboard className="size-3 opacity-60" /> : null}
      </button>
      {pos
        ? createPortal(
            <div
              style={{ position: "fixed", right: pos.right, bottom: pos.bottom, zIndex: 80 }}
              className="w-64 rounded-lg border border-[var(--hairline)] bg-[var(--composer-surface)] p-3 text-[11px] text-muted shadow-xl"
              data-testid="thread-runtime-status-popover"
            >
              <div className="mb-2 font-semibold text-foreground">{label}</div>
              <Detail label={t`开始时间`} value={formatClock(startedAt)} />
              <Detail
                label={state === "working" ? t`已工作` : t`本轮耗时`}
                value={elapsed ?? "--"}
              />
              <Detail
                label={t`本轮 Token`}
                value={currentTokens === undefined ? t`未提供` : formatTokenCount(currentTokens)}
              />
              {tokensPerSecond !== undefined ? (
                <Detail
                  label={t`输出速度`}
                  value={t`${formatTokenRate(tokensPerSecond)}${rateIsEstimated ? t`（估算）` : ""}`}
                />
              ) : null}
              {state === "completed" ? (
                <Detail label={t`完成时间`} value={formatClock(endedAt)} />
              ) : null}
              {previousTurn ? (
                <Detail
                  label={t`上一轮耗时`}
                  value={formatDuration((previousTurn.endedAt - previousTurn.startedAt) / 1000)}
                />
              ) : null}
              {state === "error" && visibleErrorMessage ? (
                <div className="mt-2 border-t border-white/10 pt-2">
                  <div className="mb-1 font-semibold text-red-300">{t`错误原因`}</div>
                  <button
                    type="button"
                    className="w-full break-words text-left text-red-200 hover:text-red-100"
                    onClick={() => void copyError()}
                  >
                    {copied ? t`已复制` : visibleErrorMessage}
                  </button>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span>{label}</span>
      <span className="max-w-44 truncate text-right tabular-nums text-foreground-muted">
        {value}
      </span>
    </div>
  );
}
