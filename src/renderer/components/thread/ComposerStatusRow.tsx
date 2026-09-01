import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLingui } from "@lingui/react/macro";
import { Check, Hourglass, ListChecks } from "lucide-react";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import { useAppStore } from "@/renderer/state/appStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useTokenUsageStore } from "@/renderer/state/tokenUsageStore";
import type { UsageSnapshot } from "@/shared/contracts";
import { formatTokenCount } from "./formatTokenCount";
import type { ThreadContextUsageSummary } from "./threadContextUsage";
import type { ThreadTodoDockState, ThreadTodoStepStatus } from "./threadTodoState";
import { selectThreadTodoDockState } from "./threadTodoState";

/** Breakdown 段落配色（与 ZCode 上下文详情一致的小圆点风格）。 */
const SEGMENT_COLORS = [
  "bg-sky-400",
  "bg-violet-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-cyan-400",
  "bg-lime-400",
];

const POPOVER_CLASS = "w-72 rounded-xl border border-white/10 bg-[#141417] p-3 shadow-xl";

/** 合成台工具栏在自身 stacking context 之下会盖住普通浮层，详情面板统一 portal 到 body。 */
function useHoverPopover() {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null);
  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      right: Math.max(8, window.innerWidth - rect.right),
      bottom: window.innerHeight - rect.top + 6,
    });
  };
  const hide = () => setPos(null);
  return { triggerRef, pos, show, hide };
}

function StepStatusIcon({ status }: { status: ThreadTodoStepStatus }) {
  switch (status) {
    case "completed":
      return <Check className="size-3 shrink-0 text-emerald-400" aria-hidden="true" />;
    case "in_progress":
      return (
        <span className="inline-flex size-3 shrink-0 items-center justify-center">
          <PixelLoader size="xxs" className="text-foreground" />
        </span>
      );
    default:
      return <Hourglass className="size-3 shrink-0 text-neutral-500" aria-hidden="true" />;
  }
}

/**
 * 计划进度胶囊（输入框上方标签栏左侧，ZCode「进程 N/M」同款）：
 * 默认缩成小胶囊；点击在原地向上展开大卡片，列出每一步的详细状态。
 */
export function PlanProgressCapsule(props: { threadId: string; todo: ThreadTodoDockState }) {
  const { t } = useLingui();
  const { threadId, todo } = props;
  const triggerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const toggle = () => {
    if (pos) {
      setPos(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 6 });
  };
  const completed = todo.steps.reduce(
    (count, step) => (step.status === "completed" ? count + 1 : count),
    0,
  );
  const total = todo.steps.length;
  const activeIndex = todo.activeIndex;
  const activeStep = todo.steps[activeIndex];

  return (
    <div
      ref={triggerRef}
      className="relative flex min-w-0 items-center"
      data-testid="plan-progress-badge"
    >
      <button
        type="button"
        aria-label={t`Plan progress ${completed}/${total}`}
        aria-expanded={pos !== null}
        onClick={toggle}
        className={`flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors ${
          pos ? "bg-white/10 text-foreground" : "bg-white/5 text-neutral-300 hover:bg-white/10"
        }`}
      >
        <ListChecks className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span>{t`Progress`}</span>
        <span className="tabular-nums">
          {completed}/{total}
        </span>
      </button>
      {pos
        ? createPortal(
            <div
              style={{ position: "fixed", left: pos.left, bottom: pos.bottom }}
              className={POPOVER_CLASS}
              data-testid="plan-progress-popover"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-foreground">{t`Plan progress`}</span>
                <span className="tabular-nums text-neutral-400">
                  {completed}/{total}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-emerald-400/80 transition-[width]"
                  style={{ width: `${total > 0 ? Math.round((completed / total) * 100) : 0}%` }}
                />
              </div>
              <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
                {todo.steps.map((step, index) => (
                  <li
                    key={`${threadId}:detail:${index}`}
                    className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] ${
                      index === activeIndex ? "bg-white/[0.06] text-foreground" : "text-neutral-400"
                    }`}
                  >
                    <StepStatusIcon status={step.status} />
                    <span className="min-w-0 flex-1 truncate">{step.text}</span>
                  </li>
                ))}
              </ul>
              {activeStep && todo.steps[activeIndex]?.status !== "completed" ? (
                <p className="mt-1.5 truncate text-[10px] text-neutral-500">
                  {t`Current: ${activeStep.text}`}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** 从会话状态解析计划；无计划时不渲染。 */
export function PlanProgressSlot(props: { threadId: string }) {
  const todo = useAppStore((state) => selectThreadTodoDockState(state, props.threadId));
  if (!todo || todo.steps.length === 0) return null;
  return <PlanProgressCapsule threadId={props.threadId} todo={todo} />;
}

function isAuthorized(status: string | undefined): boolean {
  return status === "ok" || status === "quota-hit" || status === "rate-limited";
}

function quotaWindowPercent(snapshot: UsageSnapshot | undefined, matcher: RegExp): number | null {
  if (!snapshot || !isAuthorized(snapshot.status)) return null;
  const window = snapshot.windows.find(
    (candidate) => matcher.test(candidate.id) || matcher.test(candidate.label),
  );
  return window ? Math.round(window.usedPercent) : null;
}

function DetailRow(props: { label: string; children: ReactNode; dot?: string | undefined }) {
  return (
    <div className="flex items-center justify-between gap-2 py-[3px] text-[11px]">
      <span className="flex min-w-0 items-center gap-1.5 text-neutral-400">
        {props.dot ? (
          <span className={`size-1.5 rounded-full ${props.dot}`} aria-hidden="true" />
        ) : null}
        <span className="truncate">{props.label}</span>
      </span>
      <span className="shrink-0 tabular-nums text-neutral-200">{props.children}</span>
    </div>
  );
}

/**
 * 上下文/额度圆环（合成台工具栏、模型选择器左侧）：ZCode 同款圆形指示环，
 * 悬浮 portal 面板显示全部详情——上下文容量与各部分占比、平均缓存命中率、
 * 渠道 5h/周额度与今日 token 用量。
 */
export function ContextQuotaRing(props: {
  threadId?: string;
  contextSummary?: ThreadContextUsageSummary;
  quotaProviderId?: string;
}) {
  const { contextSummary, quotaProviderId } = props;
  const { triggerRef, pos, show, hide } = useHoverPopover();
  const todaySummary = useTokenUsageStore((state) =>
    state.response?.summaries.find((summary) => summary.period === "today"),
  );
  const providerSnapshot = useProviderUsageStore((state) =>
    quotaProviderId ? state.snapshots[quotaProviderId] : undefined,
  );
  const fiveHour = quotaWindowPercent(providerSnapshot, /5h|session/i);
  const weekly = quotaWindowPercent(providerSnapshot, /week|7d/i);

  const used = contextSummary?.usedTokens;
  const max = contextSummary?.maxTokens;
  const percent = contextSummary?.percent;
  const breakdown = contextSummary?.breakdown ?? [];
  const breakdownTotal = breakdown.reduce((sum, entry) => sum + entry.tokens, 0);

  const inputTokens = todaySummary?.inputTokens ?? 0;
  const outputTokens = todaySummary?.outputTokens ?? 0;
  const cacheRead = todaySummary?.cacheReadTokens ?? 0;
  const hitRate =
    inputTokens + cacheRead > 0 ? Math.round((cacheRead / (inputTokens + cacheRead)) * 100) : null;
  const hasTokenData = todaySummary !== undefined && inputTokens + outputTokens + cacheRead > 0;

  // 圆环进度：优先上下文占用；没有会话用量时用缓存命中率示意，再没有就空环。
  const RING_RADIUS = 9;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const ringFraction =
    percent !== undefined
      ? percent / 100
      : hasTokenData && hitRate !== null
        ? Math.max(0.02, Math.min(1, hitRate / 100))
        : 0;
  const ringClass =
    percent !== undefined && percent > 80
      ? "stroke-amber-400"
      : percent !== undefined
        ? "stroke-neutral-300"
        : hasTokenData
          ? "stroke-sky-400/70"
          : "";

  return (
    <div
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      className="relative flex self-center items-center"
      data-testid="context-quota-ring"
    >
      <button
        type="button"
        aria-label="上下文与额度详情"
        className="flex size-6 items-center justify-center rounded-md hover:bg-white/5"
      >
        <svg viewBox="0 0 24 24" className="size-[18px] -rotate-90" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="3"
            className="stroke-white/10"
          />
          {ringClass ? (
            <circle
              cx="12"
              cy="12"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              className={ringClass}
              strokeDasharray={`${Math.max(0.04, ringFraction) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
            />
          ) : null}
        </svg>
      </button>
      {pos
        ? createPortal(
            <div
              style={{ position: "fixed", right: pos.right, bottom: pos.bottom }}
              className={POPOVER_CLASS}
              data-testid="context-quota-popover"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-foreground">上下文容量</span>
                <span className="tabular-nums text-neutral-400">
                  {used !== undefined && max !== undefined
                    ? `${formatTokenCount(used)} / ${formatTokenCount(max)}`
                    : used !== undefined
                      ? formatTokenCount(used)
                      : "--"}
                  {percent !== undefined ? ` (${percent}%)` : ""}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-[width] ${
                    percent !== undefined && percent > 80 ? "bg-amber-400" : "bg-sky-400"
                  }`}
                  style={{ width: `${percent ?? 0}%` }}
                />
              </div>
              {breakdown.length > 0 && breakdownTotal > 0 ? (
                <div className="mt-2 border-t border-white/5 pt-1.5">
                  {breakdown.map((entry, index) => (
                    <DetailRow
                      key={entry.id}
                      label={entry.label}
                      dot={SEGMENT_COLORS[index % SEGMENT_COLORS.length]}
                    >
                      {breakdownTotal > 0
                        ? `${Math.round((entry.tokens / breakdownTotal) * 100)}%`
                        : formatTokenCount(entry.tokens)}
                    </DetailRow>
                  ))}
                </div>
              ) : null}
              <div className="mt-1.5 border-t border-white/5 pt-1.5">
                <DetailRow label="平均缓存命中率">
                  {hitRate === null ? "--%" : `${hitRate}%`}
                </DetailRow>
                {fiveHour !== null ? <DetailRow label="5h 额度">{fiveHour}%</DetailRow> : null}
                {weekly !== null ? <DetailRow label="周额度">{weekly}%</DetailRow> : null}
                {hasTokenData ? (
                  <DetailRow label="今日 输入 / 输出 / 缓存">
                    {`${formatTokenCount(inputTokens)} / ${formatTokenCount(outputTokens)} / ${formatTokenCount(cacheRead)}`}
                  </DetailRow>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
