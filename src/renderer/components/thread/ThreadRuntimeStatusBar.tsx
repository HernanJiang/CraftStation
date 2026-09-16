import { useLingui } from "@lingui/react/macro";
import { AlertCircle, CheckCircle2, Clipboard, LoaderCircle, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Thread } from "@/shared/contracts";
import { isRetryableCapacityError } from "@/shared/retryableCapacityError";
import { useAppStore } from "@/renderer/state/appStore";
import { formatTokenCount } from "./formatTokenCount";
import { resolveThreadContextUsageSummary } from "./threadContextUsage";

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
  if (minutes <= 0) return `${remainder}秒`;
  return `${minutes}分${remainder}秒`;
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
        aria-label={state === "error" ? `${label}，点击复制错误详情` : label}
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
              <Detail label="开始时间" value={formatClock(startedAt)} />
              <Detail label={state === "working" ? "已工作" : "本轮耗时"} value={elapsed ?? "--"} />
              <Detail
                label="本轮 Token"
                value={currentTokens === undefined ? "未提供" : formatTokenCount(currentTokens)}
              />
              {state === "completed" ? (
                <Detail label="完成时间" value={formatClock(endedAt)} />
              ) : null}
              {previousTurn ? (
                <Detail
                  label="上一轮耗时"
                  value={formatDuration((previousTurn.endedAt - previousTurn.startedAt) / 1000)}
                />
              ) : null}
              {state === "error" && visibleErrorMessage ? (
                <div className="mt-2 border-t border-white/10 pt-2">
                  <div className="mb-1 font-semibold text-red-300">错误原因</div>
                  <button
                    type="button"
                    className="w-full break-words text-left text-red-200 hover:text-red-100"
                    onClick={() => void copyError()}
                  >
                    {copied ? "已复制" : visibleErrorMessage}
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
