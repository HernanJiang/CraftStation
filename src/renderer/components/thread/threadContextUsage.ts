import { msg } from "@lingui/core/macro";
import type {
  AgentCapability,
  AgentStatus,
  ContextUsageBreakdownEntry,
  Thread,
  ThreadContextUsage,
} from "@/shared/contracts";
import { i18n } from "@/renderer/i18n/i18n";
import { agentStatusForPresentation } from "@/shared/agentSelection";
import { formatTokenCount } from "./formatTokenCount";

export const CONTEXT_OCCUPANCY_ORDER = [
  "messages",
  "tool-calls",
  "mcp-tools",
  "system-tools",
  "skills",
  "system-prompt",
  "other",
] as const;

export type ContextOccupancyId = (typeof CONTEXT_OCCUPANCY_ORDER)[number];

export const CONTEXT_OCCUPANCY_LABELS: Record<ContextOccupancyId, string> = {
  messages: "消息",
  "tool-calls": "工具调用",
  "mcp-tools": "MCP 工具",
  "system-tools": "系统工具",
  skills: "技能",
  "system-prompt": "系统提示词",
  other: "其他",
};

export interface ContextOccupancyRow {
  id: ContextOccupancyId;
  label: string;
  tokens: number;
}

export interface ThreadContextUsageSummary {
  usedTokens?: number;
  maxTokens?: number;
  remainingTokens?: number;
  percent?: number;
  breakdown: ContextUsageBreakdownEntry[];
  occupancy: ContextOccupancyRow[];
  cacheHitRate?: number;
  usedLabel: string;
  maxLabel: string;
  remainingLabel: string;
  percentLabel: string;
  headline: string;
  detail: string;
}

export function hasReportedContextUsage(usage: ThreadContextUsage | undefined): boolean {
  if (!usage) return false;
  return usage.usedTokens !== undefined || (usage.breakdown?.length ?? 0) > 0;
}

export function resolveThreadContextUsageSummary(input: {
  thread: Thread;
  agentStatus: AgentStatus | undefined;
  reportedUsage: ThreadContextUsage | undefined;
}): ThreadContextUsageSummary {
  const { thread, agentStatus, reportedUsage } = input;
  const presentationMode =
    thread.presentationMode ?? agentStatus?.capabilities.presentationMode ?? "terminal";
  const capabilities = agentStatus
    ? agentStatusForPresentation(agentStatus, presentationMode, thread.sessionRef).capabilities
    : undefined;
  const configuredMaxTokens = inferConfiguredContextLimit(thread, capabilities);
  const usedTokens = reportedUsage?.usedTokens;
  const maxTokens = reportedUsage?.maxTokens ?? configuredMaxTokens;
  const percent =
    usedTokens !== undefined && maxTokens !== undefined && maxTokens > 0
      ? Math.max(0, Math.min(100, Math.round((usedTokens / maxTokens) * 100)))
      : undefined;
  const remainingTokens =
    usedTokens !== undefined && maxTokens !== undefined
      ? Math.max(0, maxTokens - usedTokens)
      : undefined;
  const breakdown =
    reportedUsage?.breakdown && reportedUsage.breakdown.length > 0
      ? reportedUsage.breakdown
      : [];
  const occupancy = resolveContextOccupancy(breakdown, usedTokens);
  const cacheHitRate = resolveSessionCacheHitRate(breakdown);
  const usedLabel = usedTokens === undefined ? i18n._(msg`Unknown`) : formatTokenCount(usedTokens);
  const maxLabel = maxTokens === undefined ? i18n._(msg`Unknown`) : formatTokenCount(maxTokens);
  const remainingLabel =
    remainingTokens === undefined ? i18n._(msg`Unknown`) : formatTokenCount(remainingTokens);
  const percentLabel = percent === undefined ? i18n._(msg`Context`) : `${percent}%`;
  const headline =
    percent === undefined
      ? maxTokens === undefined
        ? i18n._(msg`Context usage`)
        : i18n._(msg`${maxLabel} context`)
      : i18n._(msg`${percent}% full`);
  const detail =
    usedTokens === undefined && maxTokens === undefined
      ? i18n._(msg`Provider has not reported token usage.`)
      : maxTokens === undefined
        ? i18n._(msg`${usedLabel} tokens`)
        : i18n._(msg`${usedLabel} / ${maxLabel} tokens`);

  return {
    ...(usedTokens !== undefined ? { usedTokens } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(remainingTokens !== undefined ? { remainingTokens } : {}),
    ...(percent !== undefined ? { percent } : {}),
    breakdown,
    occupancy,
    ...(cacheHitRate !== undefined ? { cacheHitRate } : {}),
    usedLabel,
    maxLabel,
    remainingLabel,
    percentLabel,
    headline,
    detail,
  };
}

export function classifyContextOccupancy(
  entry: Pick<ContextUsageBreakdownEntry, "id" | "label">,
): ContextOccupancyId | undefined {
  const key = `${entry.id} ${entry.label}`.toLowerCase().replaceAll("_", "-");
  if (/(?:cache-?read|cache-?write|cached)/.test(key)) return undefined;
  if (/mcp/.test(key)) return "mcp-tools";
  if (/skill|技能/.test(key)) return "skills";
  if (/system[- ]prompt|系统提示/.test(key)) return "system-prompt";
  if (/tool[- ]call|function[- ]call|工具调用/.test(key)) return "tool-calls";
  if (/system[- ]tool|deferred tool|tool definition|built-?in tool|系统工具/.test(key)) {
    return "system-tools";
  }
  if (/(?:^|[\s-])tools?(?:[\s-]|\d|$)/.test(key)) return "system-tools";
  if (/message|conversation|input|消息/.test(key)) return "messages";
  if (/output|reason/.test(key)) return undefined;
  return "other";
}

export function resolveContextOccupancy(
  breakdown: readonly ContextUsageBreakdownEntry[],
  usedTokens?: number,
): ContextOccupancyRow[] {
  const totals: Record<ContextOccupancyId, number> = {
    messages: 0,
    "tool-calls": 0,
    "mcp-tools": 0,
    "system-tools": 0,
    skills: 0,
    "system-prompt": 0,
    other: 0,
  };
  let skipped = 0;
  for (const entry of breakdown) {
    const id = classifyContextOccupancy(entry);
    if (!id) {
      skipped += entry.tokens;
      continue;
    }
    totals[id] += entry.tokens;
  }
  const classified = CONTEXT_OCCUPANCY_ORDER.reduce((sum, id) => sum + totals[id], 0);
  if (classified <= 0) return [];
  const target = usedTokens ?? classified;
  if (target > classified) {
    const remainder = target - classified;
    // Cache/output/reasoning are excluded from occupancy. Do not dump that
    // remainder into "其他" — that fabricates a split the provider never sent.
    if (remainder > skipped) totals.other += remainder - skipped;
  }
  return CONTEXT_OCCUPANCY_ORDER.map((id) => ({
    id,
    label: CONTEXT_OCCUPANCY_LABELS[id],
    tokens: totals[id],
  }));
}

export function resolveSessionCacheHitRate(
  breakdown: readonly ContextUsageBreakdownEntry[],
): number | undefined {
  const cacheRead = breakdown
    .filter((entry) => /cache-?read|cached/.test(`${entry.id} ${entry.label}`.toLowerCase()))
    .reduce((sum, entry) => sum + entry.tokens, 0);
  const input = breakdown
    .filter((entry) => {
      const key = `${entry.id} ${entry.label}`.toLowerCase();
      if (/(?:cache-?read|cache-?write|cached)/.test(key)) return false;
      return entry.id === "input" || /input/.test(entry.label.toLowerCase());
    })
    .reduce((sum, entry) => sum + entry.tokens, 0);
  if (cacheRead <= 0 || input <= 0) return undefined;
  const prompt = input > cacheRead ? input : input + cacheRead;
  return Math.round((cacheRead / prompt) * 100);
}

function inferConfiguredContextLimit(
  thread: Thread,
  capabilities: AgentCapability | undefined,
): number | undefined {
  const model = thread.config?.model;
  const contextId =
    thread.config?.contextSize ??
    parseContextSizeParam(model) ??
    (model ? capabilities?.modelContextSizes?.[model]?.[0] : undefined) ??
    capabilities?.defaultContextSize;
  const option = contextId
    ? capabilities?.contextSizes?.find((candidate) => candidate.id === contextId)
    : undefined;

  return (
    parseContextTokenLimit(option?.label) ??
    parseContextTokenLimit(contextId) ??
    parseContextTokenLimit(model)
  );
}

function parseContextSizeParam(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  const bracket = /\[([^\]]+)\]/.exec(modelId)?.[1];
  if (!bracket) return undefined;
  const contextParam = /(?:^|,)\s*context\s*=\s*([^,\]]+)/i.exec(bracket)?.[1]?.trim();
  if (contextParam) return contextParam;
  const plainSize = bracket.trim();
  return parseContextTokenLimit(plainSize) ? plainSize : undefined;
}

function parseContextTokenLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /(\d+(?:\.\d+)?)\s*([kKmM])\b/.exec(value);
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1]!);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const multiplier = match[2]!.toLowerCase() === "m" ? 1_000_000 : 1_000;
  return Math.round(amount * multiplier);
}
