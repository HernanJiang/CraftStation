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

/** Show the composer dock when the model window is known, even before occupancy. */
export function shouldShowContextUsageDock(summary: ThreadContextUsageSummary): boolean {
  return summary.maxTokens !== undefined;
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
  const maxTokens = preferAdvertisedContextWindow(reportedUsage?.maxTokens, configuredMaxTokens);
  const percent =
    usedTokens !== undefined && maxTokens !== undefined && maxTokens > 0
      ? Math.max(0, Math.min(100, Math.round((usedTokens / maxTokens) * 100)))
      : undefined;
  const remainingTokens =
    usedTokens !== undefined && maxTokens !== undefined
      ? Math.max(0, maxTokens - usedTokens)
      : undefined;
  const breakdown =
    reportedUsage?.breakdown && reportedUsage.breakdown.length > 0 ? reportedUsage.breakdown : [];
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
  if (input <= 0) return undefined;
  if (cacheRead <= 0) return 0;
  const prompt = input > cacheRead ? input : input + cacheRead;
  return Math.round((cacheRead / prompt) * 100);
}

/** 256Ki/256K placeholders yield to a larger advertised model window (DeepSeek V4 = 1M). */
function preferAdvertisedContextWindow(
  reported: number | undefined,
  advertised: number | undefined,
): number | undefined {
  if (reported === undefined) return advertised;
  if (advertised === undefined) return reported;
  const stock = reported === 262_144 || reported === 256_000 || reported === 128_000;
  if (stock && advertised > reported) return advertised;
  return reported;
}

function inferConfiguredContextLimit(
  thread: Thread,
  capabilities: AgentCapability | undefined,
): number | undefined {
  const model = thread.config?.model;
  const configured = thread.config?.contextSize;
  const modelSize = lookupModelContextSize(model, capabilities);
  const contextId = modelAllowsContextSize(model, configured, capabilities)
    ? configured
    : (parseContextSizeParam(model) ??
      modelSize ??
      capabilities?.defaultContextSize ??
      (capabilities?.contextSizes?.length === 1 ? capabilities.contextSizes[0]?.id : undefined));
  const option = contextId
    ? capabilities?.contextSizes?.find(
        (candidate) => candidate.id === contextId || candidate.label === contextId,
      )
    : undefined;

  return (
    parseContextTokenLimit(option?.label) ??
    parseContextTokenLimit(contextId) ??
    parseContextTokenLimit(model)
  );
}

function modelAllowsContextSize(
  model: string | undefined,
  contextId: string | undefined,
  capabilities: AgentCapability | undefined,
): boolean {
  if (!contextId) return false;
  const allowed = modelContextSizeList(model, capabilities);
  if (allowed && allowed.length > 0) {
    return allowed.some((id) => id === contextId);
  }
  if (capabilities?.contextSizes && capabilities.contextSizes.length > 0) {
    return capabilities.contextSizes.some(
      (candidate) => candidate.id === contextId || candidate.label === contextId,
    );
  }
  return true;
}

function normalizeContextModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^[^/]+\/(?=.+)/, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-(?:low|medium|high|balanced|extra-high|thinking)$/i, "");
}

function contextModelIdsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.endsWith(`/${right}`) || right.endsWith(`/${left}`)) return true;
  const a = normalizeContextModelId(left);
  const b = normalizeContextModelId(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`) || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

function modelContextSizeList(
  model: string | undefined,
  capabilities: AgentCapability | undefined,
): string[] | undefined {
  const sizes = capabilities?.modelContextSizes;
  if (!model || !sizes) return undefined;
  const direct = sizes[model];
  if (direct && direct.length > 0) return direct;
  for (const [id, list] of Object.entries(sizes)) {
    if (list && list.length > 0 && contextModelIdsMatch(id, model)) return list;
  }
  return undefined;
}

function lookupModelContextSize(
  model: string | undefined,
  capabilities: AgentCapability | undefined,
): string | undefined {
  return modelContextSizeList(model, capabilities)?.[0];
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
  const trimmed = value.trim();
  const match = /(\d+(?:\.\d+)?)\s*([kKmM])\b/.exec(trimmed);
  if (match) {
    const amount = Number.parseFloat(match[1]!);
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    const multiplier = match[2]!.toLowerCase() === "m" ? 1_000_000 : 1_000;
    return Math.round(amount * multiplier);
  }
  if (/^\d+$/.test(trimmed)) {
    const tokens = Number.parseInt(trimmed, 10);
    if (tokens >= 1_000) return tokens;
  }
  return undefined;
}
