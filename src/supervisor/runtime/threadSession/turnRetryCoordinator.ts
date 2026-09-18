import type { SupervisorEvent } from "@/shared/ipc";
import { isRetryableCapacityError } from "@/shared/retryableCapacityError";
import { isNativeNetworkErrorMessage } from "../../agents/nativeNetworkError";
import type { QueuedStructuredTurn, SessionRuntime } from "../sessionTypes";
import {
  classifyStructuredFailure,
  isExpectedStructuredFailure,
} from "./structuredFailureReporter";

/**
 * Invisible continuation note prepended to the SENT prompt of an automatically
 * retried turn (the painted user message stays the raw prompt, mirroring the
 * historyPreface contract). Covers both cases: the interrupted attempt may
 * have produced partial work (continue it) or never reached the agent at all
 * (just do the request).
 */
const RETRY_CONTINUATION_NOTE =
  "[CraftStation Craft-Harness auto-retry] The previous attempt of this turn was " +
  "interrupted by a network/transport failure before completing. Continue the task " +
  "from where it stopped; if the previous attempt never actually started, simply " +
  "carry out the original request normally.";

/** Craft-Harness turn retry policy, sourced from shared settings. */
export interface TurnRetryPolicy {
  /** Extra attempts after the first failure. 0 disables automatic retries. */
  maxAttempts: number;
  /** Fixed delay between attempts. */
  intervalMs: number;
}

export interface TurnRetryCoordinatorContext {
  isDisposed(): boolean;
  isCurrentSession(session: SessionRuntime): boolean;
  readPolicy(): TurnRetryPolicy;
  emit(event: SupervisorEvent): void;
  /** Stash the transcript preface for a turn about to rebuild its session. */
  attachHistoryPreface(session: SessionRuntime, turn: QueuedStructuredTurn): void;
  /** Re-send the turn on the same live structured session. */
  startTurn(session: SessionRuntime, turn: QueuedStructuredTurn): void;
  /** Rebuild the session (dead transport) and replay the turn there. */
  restartTurn(session: SessionRuntime, turn: QueuedStructuredTurn): Promise<void>;
  sleep(ms: number): Promise<void>;
}

/**
 * Craft-Harness: the cross-harness outer-runtime retry layer. When a
 * structured turn dies on a network error or an unexpected transport
 * interruption, CraftStation itself waits the configured interval and replays
 * the turn with an invisible continuation note — no per-agent adaptation.
 *
 * Deliberately NOT retried here (each already has an owner or is intentional):
 * - quota/billing/auth outcomes (`isExpectedStructuredFailure`; pool quota
 *   additionally has same-turn failover upstream of this coordinator),
 * - capacity-throttle noise (`isRetryableCapacityError` is provider-internal
 *   retry chatter, not a failure),
 * - user-requested interrupts (`structuredTurnInterruptRequested`).
 *
 * Terminal (PTY-only) threads are out of scope: they have no per-turn failure
 * signal, only process exit.
 */
export class TurnRetryCoordinator {
  constructor(private readonly ctx: TurnRetryCoordinatorContext) {}

  /**
   * Same-contract sibling of `tryPoolFailover`: returns true when it took over
   * the failed turn (the caller must not also fail the session); false to fall
   * through to the normal failure path. Never throws.
   */
  async tryTurnRetry(
    session: SessionRuntime,
    turn: QueuedStructuredTurn,
    error: unknown,
  ): Promise<boolean> {
    const policy = this.ctx.readPolicy();
    if (policy.maxAttempts <= 0) return false;
    if (session.structuredTurnInterruptRequested === true) return false;
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (isRetryableCapacityError(message)) return false;
    if (isExpectedStructuredFailure(error)) return false;
    const failureClass = classifyStructuredFailure(error);
    const retryable = failureClass === "transport" || isNativeNetworkErrorMessage(message);
    if (!retryable) return false;
    const attempt = (turn.turnRetryAttempt ?? 0) + 1;
    if (attempt > policy.maxAttempts) return false;
    turn.turnRetryAttempt = attempt;
    const reason = toSingleLineExcerpt(message);
    console.log(
      `[craft-harness] turn retry scheduled: thread=${session.threadId} attempt=${attempt}/${policy.maxAttempts} delayMs=${policy.intervalMs} class=${failureClass} reason=${reason}`,
    );
    this.ctx.emit({
      type: "thread-turn-retry",
      threadId: session.threadId,
      attempt,
      maxAttempts: policy.maxAttempts,
      delaySeconds: Math.round(policy.intervalMs / 1000),
      reason,
    });
    await this.ctx.sleep(policy.intervalMs);
    if (this.ctx.isDisposed() || !this.ctx.isCurrentSession(session)) return false;
    try {
      if (failureClass === "transport") {
        // Dead connection/process: re-sending on the same handle would fail
        // again — rebuild the session and replay, carrying the transcript
        // preface for the fresh-session case.
        this.ctx.attachHistoryPreface(session, turn);
      }
      // Continuation note rides the historyPreface channel: prepended to the
      // SENT prompt only, never painted. restartThread drops the preface when
      // the old session resumes natively, so it can never duplicate context.
      turn.historyPreface = turn.historyPreface
        ? `${RETRY_CONTINUATION_NOTE}\n\n${turn.historyPreface}`
        : RETRY_CONTINUATION_NOTE;
      if (failureClass === "transport") {
        await this.ctx.restartTurn(session, turn);
      } else {
        this.ctx.startTurn(session, turn);
      }
    } catch (retryError) {
      // Never silent, same contract as declined pool failover: the original
      // error must stay the banner, not bookkeeping noise.
      console.warn(
        `[craft-harness] turn retry declined: thread=${session.threadId} attempt=${attempt} reason=${retryError instanceof Error ? retryError.message : String(retryError)}`,
      );
      return false;
    }
    return true;
  }
}

function toSingleLineExcerpt(message: string, max = 120): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
