import type { SupervisorEvent } from "@/shared/ipc";
import { isRetryableCapacityError } from "@/shared/retryableCapacityError";
import { isNativeNetworkErrorMessage } from "../../agents/nativeNetworkError";
import {
  classifyStructuredFailure,
  isExpectedStructuredFailure,
} from "../threadSession/structuredFailureReporter";

export const CRAFT_RETRY_CONTEXT =
  "[CraftStation Craft-Harness auto-retry] The previous attempt of this turn was " +
  "interrupted by a network/transport failure before completing. Continue the task " +
  "from where it stopped; if the previous attempt never actually started, simply " +
  "carry out the original request normally.";

export function isCraftRetryable(error: unknown): boolean {
  if (isExpectedStructuredFailure(error)) return false;
  const projected = error instanceof Error ? error.message : String(error ?? "");
  const marker = projected.indexOf("原始错误：");
  const message = marker >= 0 ? projected.slice(marker + "原始错误：".length) : projected;
  if (isRetryableCapacityError(message)) return false;
  if (
    /\b(?:401|402|403|429)\b|quota|billing|usage.limit|insufficient|unauthori|forbidden|auth_required|invalid.*(?:key|token)/i.test(
      message,
    )
  )
    return false;
  return classifyStructuredFailure(error) === "transport" || isNativeNetworkErrorMessage(message);
}

export async function runWithCraftRetry<T>(ctx: {
  threadId: string;
  policy(): { maxAttempts: number; intervalMs: number };
  isCurrent(): boolean;
  emit(event: SupervisorEvent): void;
  run(attempt: number): Promise<T>;
  sleep(ms: number): Promise<void>;
}): Promise<T | undefined> {
  for (let attempt = 0; ; attempt++) {
    if (!ctx.isCurrent()) return undefined;
    try {
      return await ctx.run(attempt);
    } catch (error) {
      const policy = ctx.policy();
      if (!isCraftRetryable(error)) throw error;
      if (!ctx.isCurrent()) return undefined;
      if (attempt >= policy.maxAttempts) throw error;
      ctx.emit({
        type: "thread-turn-retry",
        threadId: ctx.threadId,
        attempt: attempt + 1,
        maxAttempts: policy.maxAttempts,
        delaySeconds: Math.round(policy.intervalMs / 1000),
        reason: "网络或传输中断",
      });
      console.info("[craft-harness]", {
        phase: "turn",
        operation: "retry",
        status: "scheduled",
        code: "TURN_NETWORK_RETRY",
        threadId: ctx.threadId,
        attempt: attempt + 1,
      });
      await ctx.sleep(policy.intervalMs);
    }
  }
}
