import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useTokenUsageStore } from "@/renderer/state/tokenUsageStore";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import type {
  ContextUsageBreakdownEntry,
  ToolCallPayload,
  UsageSnapshot,
} from "@/shared/contracts";
import { isDelegatedAgentTool } from "@/shared/toolCallClassification";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { deriveToolDisplay, isCrossagentTool } from "./ChatPane/parts/items/toolDisplay";
import { formatTokenCount } from "./formatTokenCount";
import type { ThreadContextUsageSummary } from "./threadContextUsage";

const SEGMENT_COLORS = [
  "bg-slate-400",
  "bg-sky-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-violet-400",
  "bg-rose-400",
  "bg-neutral-400",
] as const;

const POPOVER_CLASS = "craftstation-context-quota-popover w-80 rounded-xl border p-3 shadow-xl";

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

type AgentCapsuleStatus = "running" | "completed" | "failed" | "cancelled";

export interface AgentCapsuleEntry {
  itemId: string;
  task: string;
  modelLine: string | undefined;
  status: AgentCapsuleStatus;
  isCrossagent: boolean;
}

export interface AgentCapsuleCounts {
  total: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export function countAgentCapsuleEntries(
  entries: readonly AgentCapsuleEntry[],
): AgentCapsuleCounts {
  const counts: AgentCapsuleCounts = {
    total: entries.length,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const entry of entries) {
    if (entry.status === "running") counts.running += 1;
    else if (entry.status === "failed") counts.failed += 1;
    else if (entry.status === "cancelled") counts.cancelled += 1;
    else counts.completed += 1;
  }
  return counts;
}

function resolveAgentCapsuleStatus(
  state: string | undefined,
  payload: ToolCallPayload | undefined,
): AgentCapsuleStatus {
  if (state !== "completed" || payload?.status === "running") return "running";
  if (payload?.subAgentStatus === "cancelled" || payload?.crossagentStatus === "cancelled")
    return "cancelled";
  if (payload?.status === "error") return "failed";
  return "completed";
}

function splitAgentLabel(name: string): { task: string; modelLine?: string } {
  const separator = " — ";
  const index = name.indexOf(separator);
  if (index > 0) {
    const task = name.slice(0, index).trim();
    const modelLine = name.slice(index + separator.length).trim();
    if (task && modelLine) return { task, modelLine };
  }
  return { task: name.trim() };
}

const EMPTY_AGENT_ENTRIES: readonly AgentCapsuleEntry[] = Object.freeze([]);

interface AgentCapsuleCacheEntry {
  sourceIds: readonly string[] | undefined;
  structuralVersion: number;
  entries: readonly AgentCapsuleEntry[];
}

const agentCapsuleCache = new Map<string, AgentCapsuleCacheEntry>();

const EMPTY_AGENT_COUNTS: AgentCapsuleCounts = Object.freeze({
  total: 0,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
});

interface AgentCapsuleCountsCacheEntry {
  sourceIds: readonly string[] | undefined;
  structuralVersion: number;
  counts: AgentCapsuleCounts;
}

const agentCapsuleCountsCache = new Map<string, AgentCapsuleCountsCacheEntry>();

/**
 * 全量 Agent 计数（不截断，供右上角状态胶囊的 `N Agents …` 文案使用）。
 * 列表展示仍用截断的 {@link selectAgentCapsuleEntries}。
 */
export function selectAgentCapsuleCounts(
  state: {
    runtimeItemIdsByThread: Record<string, readonly string[] | undefined>;
    runtimeItemsByIdByThread: Record<
      string,
      Record<string, RuntimeChatItem | undefined> | undefined
    >;
    runtimeStructuralVersionByThread?: Record<string, number>;
  },
  threadId: string,
): AgentCapsuleCounts {
  const sourceIds = state.runtimeItemIdsByThread[threadId];
  if (!sourceIds || sourceIds.length === 0) return EMPTY_AGENT_COUNTS;
  const structuralVersion = state.runtimeStructuralVersionByThread?.[threadId] ?? 0;
  const cached = agentCapsuleCountsCache.get(threadId);
  if (cached && cached.sourceIds === sourceIds && cached.structuralVersion === structuralVersion) {
    return cached.counts;
  }
  const counts = countAgentCapsuleEntries(collectAllAgentCapsuleEntries(state, threadId));
  if (agentCapsuleCountsCache.size > 200) agentCapsuleCountsCache.clear();
  agentCapsuleCountsCache.set(threadId, { sourceIds, structuralVersion, counts });
  return counts;
}

function collectAllAgentCapsuleEntries(
  state: {
    runtimeItemIdsByThread: Record<string, readonly string[] | undefined>;
    runtimeItemsByIdByThread: Record<
      string,
      Record<string, RuntimeChatItem | undefined> | undefined
    >;
  },
  threadId: string,
): AgentCapsuleEntry[] {
  const ids = state.runtimeItemIdsByThread[threadId];
  if (!ids || ids.length === 0) return [];
  const items = state.runtimeItemsByIdByThread[threadId];
  if (!items) return [];
  const collected: AgentCapsuleEntry[] = [];
  for (const id of ids) {
    const item = items[id];
    if (!item || item.type !== "tool_call" || item.parentItemId) continue;
    const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
    if (!payload || !isDelegatedAgentTool(payload)) continue;
    const display = deriveToolDisplay(payload);
    const { task, modelLine } = splitAgentLabel(display.title);
    collected.push({
      itemId: id,
      task,
      modelLine,
      status: resolveAgentCapsuleStatus(item.state, payload),
      isCrossagent: isCrossagentTool(payload),
    });
  }
  return collected;
}

/**
 * 根级委托 Agent 行（running 优先、其余最近在前，最多 8 条）。按结构版本缓存，
 * 避免流式 delta 期间每次 store 更新都重新分配数组导致胶囊反复重渲染。
 * 无 Agent 时返回空数组 —— 调用方据此隐藏入口，绝不凭空显示。
 */
export function selectAgentCapsuleEntries(
  state: {
    runtimeItemIdsByThread: Record<string, readonly string[] | undefined>;
    runtimeItemsByIdByThread: Record<
      string,
      Record<string, RuntimeChatItem | undefined> | undefined
    >;
    runtimeStructuralVersionByThread?: Record<string, number>;
  },
  threadId: string,
): readonly AgentCapsuleEntry[] {
  const sourceIds = state.runtimeItemIdsByThread[threadId];
  const structuralVersion = state.runtimeStructuralVersionByThread?.[threadId] ?? 0;
  const cached = agentCapsuleCache.get(threadId);
  if (cached && cached.sourceIds === sourceIds && cached.structuralVersion === structuralVersion) {
    return cached.entries;
  }
  const entries = collectAgentCapsuleEntries(state, threadId);
  if (agentCapsuleCache.size > 200) agentCapsuleCache.clear();
  agentCapsuleCache.set(threadId, { sourceIds, structuralVersion, entries });
  return entries;
}

function collectAgentCapsuleEntries(
  state: {
    runtimeItemIdsByThread: Record<string, readonly string[] | undefined>;
    runtimeItemsByIdByThread: Record<
      string,
      Record<string, RuntimeChatItem | undefined> | undefined
    >;
  },
  threadId: string,
): readonly AgentCapsuleEntry[] {
  const all = collectAllAgentCapsuleEntries(state, threadId);
  if (all.length === 0) return EMPTY_AGENT_ENTRIES;
  // Newest 8, newest-first — same window the old reverse scan produced.
  const collected = all.slice(-8).reverse();
  // running 优先，其余保持最近在前。
  collected.sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (a.status !== "running" && b.status === "running") return 1;
    return 0;
  });
  return collected.length === 0 ? EMPTY_AGENT_ENTRIES : collected;
}

function isAuthorized(status: string | undefined): boolean {
  return status === "ok" || status === "quota-hit" || status === "rate-limited";
}

function quotaWindowPercent(snapshot: UsageSnapshot | undefined, matcher: RegExp): number | null {
  if (!snapshot || !isAuthorized(snapshot.status)) return null;
  const window = snapshot.windows.find(
    (candidate) => matcher.test(candidate.id) || matcher.test(candidate.label),
  );
  if (!window) return null;
  const hasCounts = window.used !== undefined || window.limit !== undefined;
  // A bare 0% or 100% with no used/limit is a placeholder, not a measurement.
  if (!hasCounts && (window.usedPercent === 0 || window.usedPercent === 100)) return null;
  return Math.round(window.usedPercent);
}

function formatOccupancyShare(tokens: number, total: number): string {
  if (total <= 0) return formatTokenCount(tokens);
  const percent = (tokens / total) * 100;
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}

function formatRemainingQuota(usedPercent: number): string {
  return `${Math.max(0, Math.min(100, Math.round(100 - usedPercent)))}% 剩余`;
}

function resolveBreakdownTokens(
  breakdown: readonly ContextUsageBreakdownEntry[],
  matcher: RegExp,
): number | undefined {
  const total = breakdown
    .filter((entry) => matcher.test(`${entry.id} ${entry.label}`.toLowerCase()))
    .reduce((sum, entry) => sum + entry.tokens, 0);
  return total > 0 ? total : undefined;
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
  quotaAccountId?: string;
}) {
  const { contextSummary, quotaProviderId, quotaAccountId } = props;
  const { triggerRef, pos, show, hide } = useHoverPopover();
  const todaySummary = useTokenUsageStore((state) =>
    state.response?.summaries.find((summary) => summary.period === "today"),
  );
  const providerSnapshot = useProviderUsageStore((state) =>
    quotaProviderId ? state.snapshots[quotaProviderId] : undefined,
  );
  const account = useUsageAccountsStore((state) =>
    quotaAccountId
      ? state.accounts.find((candidate) => candidate.accountId === quotaAccountId)
      : undefined,
  );
  const fiveHour = quotaWindowPercent(providerSnapshot, /5h|session/i);
  const weekly = quotaWindowPercent(providerSnapshot, /week|7d/i);

  const used = contextSummary?.usedTokens;
  const max = contextSummary?.maxTokens;
  const percent = contextSummary?.percent;
  const occupancy = (contextSummary?.occupancy ?? []).filter((entry) => entry.tokens > 0);
  const occupancyTotal = occupancy.reduce((sum, entry) => sum + entry.tokens, 0);
  const contextTotal = used ?? occupancyTotal;
  const contextPercent =
    percent ??
    (max !== undefined && contextTotal > 0
      ? Math.min(100, Math.round((contextTotal / max) * 100))
      : contextTotal > 0
        ? 100
        : 0);
  const hitRate = contextSummary?.cacheHitRate;

  const breakdown = contextSummary?.breakdown ?? [];
  const inputContextTokens = resolveBreakdownTokens(breakdown, /^(input|prompt)|输入/);
  const outputContextTokens = resolveBreakdownTokens(breakdown, /^(output|completion)|输出/);
  const cacheReadContextTokens = resolveBreakdownTokens(
    breakdown,
    /cache[-_ ]?read|cached(?:[-_ ]?input)?|缓存读取|缓存命中/,
  );
  const reasoningContextTokens = resolveBreakdownTokens(breakdown, /reason|thinking|推理/);
  const hasSessionTokenData =
    inputContextTokens !== undefined ||
    outputContextTokens !== undefined ||
    cacheReadContextTokens !== undefined ||
    reasoningContextTokens !== undefined;

  const inputTokens = todaySummary?.inputTokens ?? 0;
  const outputTokens = todaySummary?.outputTokens ?? 0;
  const cacheRead = todaySummary?.cacheReadTokens ?? 0;
  const hasTokenData = todaySummary !== undefined && inputTokens + outputTokens + cacheRead > 0;
  const accountQuotaWindows = (account?.quotaWindows ?? []).filter((window) =>
    Number.isFinite(window.usedPercent),
  );
  const accountQuota = accountQuotaWindows.length > 0 ? accountQuotaWindows : [];

  const RING_RADIUS = 9;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const ringFraction = percent !== undefined ? percent / 100 : 0;
  const ringClass = percent !== undefined ? "stroke-neutral-400" : "";

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
                    : max !== undefined
                      ? `-- / ${formatTokenCount(max)}`
                      : used !== undefined
                        ? formatTokenCount(used)
                        : "--"}
                  {percent !== undefined ? ` (${percent}%)` : ""}
                </span>
              </div>
              <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="flex h-full min-w-0 overflow-hidden rounded-full transition-[width]"
                  style={{ width: `${contextPercent}%` }}
                >
                  {occupancy.length > 0 && occupancyTotal > 0
                    ? occupancy.map((entry, index) => (
                        <div
                          key={entry.id}
                          className={`h-full ${SEGMENT_COLORS[index % SEGMENT_COLORS.length]}`}
                          style={{ width: `${(entry.tokens / occupancyTotal) * 100}%` }}
                        />
                      ))
                    : null}
                </div>
              </div>
              {occupancy.length > 0 && occupancyTotal > 0 ? (
                <div className="mt-2 border-t border-white/5 pt-1.5">
                  {occupancy.map((entry, index) => (
                    <DetailRow
                      key={entry.id}
                      label={entry.label}
                      dot={SEGMENT_COLORS[index % SEGMENT_COLORS.length]}
                    >
                      {formatOccupancyShare(entry.tokens, contextTotal)}
                    </DetailRow>
                  ))}
                </div>
              ) : null}
              {hasSessionTokenData ? (
                <div className="mt-1.5 border-t border-white/5 pt-1.5">
                  <div className="pb-0.5 text-[10px] font-semibold text-foreground-muted">
                    当前会话 Token
                  </div>
                  {inputContextTokens !== undefined ? (
                    <DetailRow label="输入">
                      {`${formatTokenCount(inputContextTokens)} · ${formatOccupancyShare(inputContextTokens, contextTotal)}`}
                    </DetailRow>
                  ) : null}
                  {outputContextTokens !== undefined ? (
                    <DetailRow label="输出">
                      {`${formatTokenCount(outputContextTokens)} · ${formatOccupancyShare(outputContextTokens, contextTotal)}`}
                    </DetailRow>
                  ) : null}
                  {cacheReadContextTokens !== undefined ? (
                    <DetailRow label="缓存读取">
                      {`${formatTokenCount(cacheReadContextTokens)} · ${formatOccupancyShare(cacheReadContextTokens, contextTotal)}`}
                    </DetailRow>
                  ) : null}
                  {reasoningContextTokens !== undefined ? (
                    <DetailRow label="推理">
                      {`${formatTokenCount(reasoningContextTokens)} · ${formatOccupancyShare(reasoningContextTokens, contextTotal)}`}
                    </DetailRow>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-1.5 border-t border-white/5 pt-1.5">
                <DetailRow label="平均缓存命中率">
                  {hitRate === undefined ? "未提供" : `${hitRate}%`}
                </DetailRow>
                {account ? (
                  <DetailRow label="当前账号">{account.maskedIdentity ?? account.label}</DetailRow>
                ) : null}
                {accountQuota.map((window) => (
                  <DetailRow key={window.id} label={`${window.label || window.id} 额度`}>
                    {formatRemainingQuota(window.usedPercent)}
                  </DetailRow>
                ))}
                {account && accountQuota.length === 0 ? (
                  <DetailRow label="当前账号额度">未提供</DetailRow>
                ) : null}
                {providerSnapshot?.credits?.balance !== undefined ? (
                  <DetailRow label={account ? "账号余额" : "渠道余额"}>
                    {`${providerSnapshot.credits.balance}${providerSnapshot.credits.currency ? ` ${providerSnapshot.credits.currency}` : ""}`}
                  </DetailRow>
                ) : null}
                {fiveHour !== null ? <DetailRow label="5h 已用">{fiveHour}%</DetailRow> : null}
                {weekly !== null ? <DetailRow label="周已用">{weekly}%</DetailRow> : null}
                {used !== undefined ? (
                  <DetailRow label="当前会话占用">{formatTokenCount(used)}</DetailRow>
                ) : null}
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
