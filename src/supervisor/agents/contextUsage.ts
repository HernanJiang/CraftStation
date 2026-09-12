import { randomUUID } from "node:crypto";
import type {
  ContextUsageBreakdownEntry,
  RuntimeEvent,
  ThreadContextUsage,
} from "@/shared/contracts";

interface TokenCounts {
  usedTokens?: number | undefined;
  maxTokens?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  thoughtTokens?: number | undefined;
  cachedReadTokens?: number | undefined;
  cachedWriteTokens?: number | undefined;
  extra?: ContextUsageBreakdownEntry[] | undefined;
}

export function readNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.trunc(value);
}

/** Mint a canonical runtime-event item id of the form `<prefix>-<uuid>`. */
export function newItemId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function createContextUsageEvent(
  threadId: string,
  usage: ThreadContextUsage | undefined,
): RuntimeEvent | undefined {
  if (!usage) return undefined;
  if (
    usage.usedTokens === undefined &&
    usage.maxTokens === undefined &&
    (usage.breakdown?.length ?? 0) === 0
  ) {
    return undefined;
  }
  return { type: "context.updated", threadId, usage };
}

export function usageFromTokenCounts(counts: TokenCounts): ThreadContextUsage | undefined {
  const seen = new Set<string>();
  const breakdown: ContextUsageBreakdownEntry[] = [];
  const push = (entry: ContextUsageBreakdownEntry | undefined) => {
    if (!entry || seen.has(entry.id)) return;
    seen.add(entry.id);
    breakdown.push(entry);
  };
  push(tokenEntry("input", "Input", counts.inputTokens));
  push(tokenEntry("output", "Output", counts.outputTokens));
  push(tokenEntry("reasoning", "Reasoning", counts.thoughtTokens));
  push(tokenEntry("cache-read", "Cache read", counts.cachedReadTokens));
  push(tokenEntry("cache-write", "Cache write", counts.cachedWriteTokens));
  for (const extra of counts.extra ?? []) push(tokenEntry(extra.id, extra.label, extra.tokens));

  const usedTokens = occupancyTokens(counts);

  if (usedTokens === undefined && counts.maxTokens === undefined && breakdown.length === 0) {
    return undefined;
  }

  return {
    ...(usedTokens !== undefined ? { usedTokens } : {}),
    ...(counts.maxTokens !== undefined ? { maxTokens: counts.maxTokens } : {}),
    ...(breakdown.length > 0 ? { breakdown } : {}),
  };
}

function occupancyTokens(counts: TokenCounts): number | undefined {
  const cacheRead = counts.cachedReadTokens ?? 0;
  const cacheWrite = counts.cachedWriteTokens ?? 0;
  if (counts.inputTokens !== undefined) {
    // DeepSeek/OpenAI-style: `input` is uncached when cache-read is exclusive.
    return counts.inputTokens > cacheRead
      ? counts.inputTokens
      : counts.inputTokens + cacheRead + cacheWrite;
  }
  if (counts.usedTokens !== undefined) return counts.usedTokens;
  const extras = (counts.extra ?? []).reduce((sum, entry) => sum + entry.tokens, 0);
  if (extras > 0) return extras;
  return undefined;
}

function tokenEntry(id: string, label: string, tokens: number | undefined) {
  if (tokens === undefined || tokens <= 0) return undefined;
  return { id, label, tokens };
}

const EXTRA_USAGE_FIELDS: ReadonlyArray<{
  id: string;
  label: string;
  keys: readonly string[];
}> = [
  {
    id: "messages",
    label: "Messages",
    keys: ["messageTokens", "messagesTokens", "conversationTokens", "conversation_tokens"],
  },
  {
    id: "tool-calls",
    label: "Tool calls",
    keys: ["toolCallTokens", "tool_call_tokens", "toolCallsTokens", "functionCallTokens"],
  },
  {
    id: "mcp-tools",
    label: "MCP tools",
    keys: ["mcpTokens", "mcp_tokens", "mcpToolTokens", "mcp_tool_tokens"],
  },
  {
    id: "system-tools",
    label: "System tools",
    keys: [
      "systemToolTokens",
      "system_tool_tokens",
      "toolsTokens",
      "toolTokens",
      "tool_tokens",
      "toolDefinitionsTokens",
      "tool_definitions_tokens",
    ],
  },
  {
    id: "skills",
    label: "Skills",
    keys: ["skillsTokens", "skillTokens", "skills_tokens", "skill_tokens"],
  },
  {
    id: "system-prompt",
    label: "System prompt",
    keys: ["systemPromptTokens", "system_prompt_tokens", "systemPrompt", "system_prompt"],
  },
];

function firstInteger(obj: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = readNonNegativeInteger(obj[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function extraEntriesFromCategories(value: unknown): ContextUsageBreakdownEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ContextUsageBreakdownEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const tokens = readNonNegativeInteger(row.tokens) ?? readNonNegativeInteger(row.tokenCount);
    if (tokens === undefined || tokens <= 0) continue;
    const id =
      (typeof row.id === "string" && row.id.trim()) ||
      (typeof row.name === "string" && row.name.trim()) ||
      (typeof row.label === "string" && row.label.trim());
    if (!id) continue;
    const label =
      (typeof row.label === "string" && row.label.trim()) ||
      (typeof row.name === "string" && row.name.trim()) ||
      id;
    entries.push({
      id: id
        .trim()
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-"),
      label,
      tokens,
    });
  }
  return entries;
}

/** Pull System Prompt / MCP / Skills / category arrays off a provider usage object. */
export function extraUsageEntries(obj: Record<string, unknown>): ContextUsageBreakdownEntry[] {
  const extras = extraEntriesFromCategories(obj.categories ?? obj.context);
  for (const field of EXTRA_USAGE_FIELDS) {
    const entry = tokenEntry(field.id, field.label, firstInteger(obj, field.keys));
    if (entry) extras.push(entry);
  }
  return extras;
}

export function usageFromProviderRecord(
  obj: Record<string, unknown>,
  options: { maxTokens?: number | undefined } = {},
): ThreadContextUsage | undefined {
  return usageFromTokenCounts({
    usedTokens: firstInteger(obj, ["totalTokens", "total_tokens", "used", "total"]),
    maxTokens:
      options.maxTokens ??
      firstInteger(obj, [
        "maxTokens",
        "max_tokens",
        "size",
        "modelContextWindow",
        "model_context_window",
      ]),
    inputTokens: firstInteger(obj, ["inputTokens", "input_tokens", "input"]),
    outputTokens: firstInteger(obj, ["outputTokens", "output_tokens", "output"]),
    thoughtTokens: firstInteger(obj, [
      "thoughtTokens",
      "reasoningTokens",
      "reasoningOutputTokens",
      "reasoning_output_tokens",
      "reasoning_tokens",
    ]),
    cachedReadTokens: firstInteger(obj, [
      "cachedInputTokens",
      "cachedReadTokens",
      "cacheReadTokens",
      "cached_input_tokens",
      "cache_read_tokens",
    ]),
    cachedWriteTokens: firstInteger(obj, [
      "cachedWriteTokens",
      "cacheWriteTokens",
      "cache_write_tokens",
    ]),
    extra: extraUsageEntries(obj),
  });
}
