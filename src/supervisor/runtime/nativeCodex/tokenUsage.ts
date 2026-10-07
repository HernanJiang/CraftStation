/**
 * Codex `thread/tokenUsage/updated` params → canonical token-usage event.
 *
 * Lives with the native Codex runtime (not the legacy agents/codex adapter)
 * so the native event mapper stays inside its module boundary. The legacy
 * canonical mapper re-uses this implementation instead of keeping a copy.
 */

import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import type { ThreadTokenUsage } from "@craftstation/codex-protocol";
import {
  createContextUsageEvent,
  readNonNegativeInteger,
  usageFromProviderRecord,
} from "../../agents/contextUsage";

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function createCodexTokenUsageEvent(
  threadId: string,
  params: Record<string, unknown> | undefined,
): RuntimeEvent | undefined {
  const currentTokenUsageRecord = readRecord(params?.tokenUsage);
  const currentLastUsage = readRecord(currentTokenUsageRecord?.last);
  if (currentTokenUsageRecord && currentLastUsage) {
    const currentTokenUsage = currentTokenUsageRecord as ThreadTokenUsage;
    return createContextUsageEvent(
      threadId,
      usageFromProviderRecord(currentLastUsage, {
        maxTokens: readNonNegativeInteger(currentTokenUsage.modelContextWindow),
      }),
    );
  }

  const legacyTokenUsage = readRecord(params?.token_usage) ?? currentTokenUsageRecord;
  if (legacyTokenUsage) {
    const usage =
      readRecord(legacyTokenUsage.last) ??
      readRecord(legacyTokenUsage.lastTokenUsage) ??
      readRecord(legacyTokenUsage.last_token_usage) ??
      readRecord(legacyTokenUsage.total) ??
      readRecord(legacyTokenUsage.totalTokenUsage) ??
      readRecord(legacyTokenUsage.total_token_usage);
    if (!usage) return undefined;
    return createContextUsageEvent(
      threadId,
      usageFromProviderRecord(usage, {
        maxTokens:
          readNonNegativeInteger(legacyTokenUsage.modelContextWindow) ??
          readNonNegativeInteger(legacyTokenUsage.model_context_window),
      }),
    );
  }

  const info = params?.info;
  if (!info || typeof info !== "object") return undefined;
  const obj = info as Record<string, unknown>;
  const usage =
    readRecord(obj.last_token_usage) ??
    readRecord(obj.lastTokenUsage) ??
    readRecord(obj.total_token_usage) ??
    readRecord(obj.totalTokenUsage);
  if (!usage) return undefined;

  return createContextUsageEvent(
    threadId,
    usageFromProviderRecord(usage, {
      maxTokens:
        readNonNegativeInteger(obj.model_context_window) ??
        readNonNegativeInteger(obj.modelContextWindow),
    }),
  );
}
