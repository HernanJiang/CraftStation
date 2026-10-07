/**
 * Codex token/context usage → canonical usage-event builders.
 */

import type { RuntimeEvent } from "@/shared/contracts";
import {
  createContextUsageEvent,
  readNonNegativeInteger,
  usageFromProviderRecord,
} from "../../contextUsage";
import { readRecord } from "./readers";

// Canonical implementation lives with the native Codex runtime so the new
// path stays inside its module boundary; legacy callers keep importing it
// through this module.
export { createCodexTokenUsageEvent } from "@/supervisor/runtime/nativeCodex/tokenUsage";

export function createCodexContextUsageEvent(
  threadId: string,
  params: Record<string, unknown> | undefined,
): RuntimeEvent | undefined {
  const turn = params?.turn;
  const fromTurn =
    turn && typeof turn === "object" ? (turn as Record<string, unknown>).usage : undefined;
  const usage = params?.usage ?? fromTurn;
  if (!usage || typeof usage !== "object") return undefined;
  return createCodexUsageEvent(threadId, usage as Record<string, unknown>);
}

/**
 * Session-cumulative spend sample from `thread/tokenUsage/updated`: the
 * absolute `total.totalTokens` counter (NEVER `last` — that is per-call and
 * gets rewritten by upstream compaction). The session layer supplies the
 * scope meta (scopeId/epoch/fresh) via `CodexUsageScopeTracker.sample`.
 */
export function createCodexUsageSpentEvent(
  threadId: string,
  params: Record<string, unknown> | undefined,
  meta: { scopeId: string; epoch: number; fresh?: boolean },
): RuntimeEvent | undefined {
  const counter = readCodexCumulativeTotalTokens(params);
  if (counter === undefined) return undefined;
  return {
    type: "usage.spent",
    threadId,
    usage: {
      counterKind: "cumulative",
      counter,
      scopeId: meta.scopeId,
      epoch: meta.epoch,
      ...(meta.fresh ? { fresh: true } : {}),
      // Idempotent replays of the same counter value dedup naturally.
      sampleId: `${meta.scopeId}:${meta.epoch}:${counter}`,
      occurredAt: Date.now(),
    },
  };
}

/** Read the session-cumulative total across the current and legacy payload shapes. */
export function readCodexCumulativeTotalTokens(
  params: Record<string, unknown> | undefined,
): number | undefined {
  const currentTokenUsage = readRecord(params?.tokenUsage);
  const fromCurrent = readTotalTokens(readRecord(currentTokenUsage?.total));
  if (fromCurrent !== undefined) return fromCurrent;

  const legacy = readRecord(params?.token_usage) ?? currentTokenUsage;
  const fromLegacy = readTotalTokens(
    readRecord(legacy?.total) ??
      readRecord(legacy?.totalTokenUsage) ??
      readRecord(legacy?.total_token_usage),
  );
  if (fromLegacy !== undefined) return fromLegacy;

  const info = readRecord(params?.info);
  return readTotalTokens(readRecord(info?.total_token_usage) ?? readRecord(info?.totalTokenUsage));
}

function readTotalTokens(total: Record<string, unknown> | undefined): number | undefined {
  const explicitTotal =
    readNonNegativeInteger(total?.totalTokens) ?? readNonNegativeInteger(total?.total_tokens);
  if (explicitTotal !== undefined) return explicitTotal;

  // A few older app-server builds exposed the cumulative object with only
  // component counters. Keep this compatibility path scoped to `total` (the
  // cumulative object); never use `last`, whose value is per-turn and would
  // double-count after the next notification.
  const components = [
    total?.inputTokens,
    total?.input_tokens,
    total?.outputTokens,
    total?.output_tokens,
    total?.reasoningTokens,
    total?.reasoning_tokens,
    total?.cachedInputTokens,
    total?.cached_input_tokens,
    total?.cacheReadTokens,
    total?.cache_read_tokens,
    total?.cachedWriteTokens,
    total?.cacheWriteTokens,
    total?.cache_write_tokens,
  ].map(readNonNegativeInteger);
  if (!components.some((value) => value !== undefined)) return undefined;
  return components.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function createCodexUsageEvent(
  threadId: string,
  obj: Record<string, unknown>,
  options: { maxTokens?: number | undefined } = {},
): RuntimeEvent | undefined {
  return createContextUsageEvent(threadId, usageFromProviderRecord(obj, options));
}
