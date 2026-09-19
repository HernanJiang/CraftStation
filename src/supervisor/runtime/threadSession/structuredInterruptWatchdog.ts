import type { SessionRuntime } from "../sessionTypes";
import { STRUCTURED_INTERRUPT_FORCE_STOP_MS } from "./userInterrupt";

const NO_ACTIVE_TURN_TO_INTERRUPT = "no active turn to interrupt";

function isNoActiveTurnToInterrupt(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.trim().toLowerCase() === NO_ACTIVE_TURN_TO_INTERRUPT;
}

export interface StructuredInterruptWatchdogContext {
  sessions: Map<string, SessionRuntime>;
  isDisposed(): boolean;
  completeForcedInterrupt(session: SessionRuntime): void;
}

/**
 * Force-stop watchdog for structured (GUI) turns. Owns the interrupt request
 * and its absolute deadline: if the provider has not acknowledged cancellation
 * before the grace period expires, dispose it and close the turn locally.
 */
export class StructuredInterruptWatchdog {
  constructor(private readonly ctx: StructuredInterruptWatchdogContext) {}

  async interruptStructuredTurn(session: SessionRuntime): Promise<void> {
    if (session.presentationMode !== "gui") {
      return;
    }
    // 即使 provider 已结束失败回合、没有可中断的 handle，Stop 也取消等待中的重试。
    session.structuredTurnGeneration = (session.structuredTurnGeneration ?? 0) + 1;
    if (session.ignoreExit) {
      // 重建已接管旧 handle 的关闭；Stop 应立即结束逻辑回合，不能等待已失效的
      // provider 再确认中断。重建链会根据 generation 丢弃它随后拿到的新资源。
      this.clearStructuredInterruptWatchdog(session);
      session.structuredTurnInterruptRequested = false;
      session.structuredSession = undefined;
      this.ctx.completeForcedInterrupt(session);
      return;
    }
    const handle = session.structuredSession;
    const interruptTurn = handle?.interruptTurn;
    if (!interruptTurn) {
      return;
    }
    // A previous request may have left the flag set (the acked-cancel path
    // never clears it); a new explicit Stop always deserves a fresh
    // deadline — a stale flag must never neuter it into a silent no-op that
    // bricks the thread in "working" with a dead stop button.
    session.structuredTurnInterruptRequested = true;
    this.armStructuredInterruptWatchdog(session);
    const generation = session.structuredTurnGeneration;
    try {
      await interruptTurn.call(handle);
    } catch (error) {
      // 旧 Stop 的迟到回执不能清理新回合、替换后的实例或它的 watchdog。
      if (
        this.ctx.sessions.get(session.threadId)?.instanceId !== session.instanceId ||
        session.structuredTurnGeneration !== generation ||
        session.structuredSession !== handle
      )
        return;
      if (isNoActiveTurnToInterrupt(error)) {
        this.clearStructuredInterruptWatchdog(session);
        session.structuredTurnInterruptRequested = false;
        this.ctx.completeForcedInterrupt(session);
        return;
      }
      session.structuredTurnInterruptRequested = false;
      this.clearStructuredInterruptWatchdog(session);
      throw error;
    }
  }

  clearStructuredInterruptWatchdog(session: SessionRuntime): void {
    if (session.structuredInterruptWatchdog) {
      clearTimeout(session.structuredInterruptWatchdog);
      session.structuredInterruptWatchdog = undefined;
    }
  }

  /**
   * Arm the absolute force-stop deadline. Provider output does not extend it:
   * continuing to stream is not an acknowledgement of the user's Stop request.
   */
  armStructuredInterruptWatchdog(session: SessionRuntime): void {
    this.clearStructuredInterruptWatchdog(session);
    const instanceId = session.instanceId;
    session.structuredInterruptWatchdog = setTimeout(() => {
      session.structuredInterruptWatchdog = undefined;
      this.forceStopUnacknowledgedTurn(session.threadId, instanceId);
    }, STRUCTURED_INTERRUPT_FORCE_STOP_MS);
  }

  /**
   * The agent did not acknowledge Stop before the fixed deadline. Dispose the
   * structured session best-effort and close the turn locally; the manager will
   * recreate the provider process when the user sends the next message.
   */
  private forceStopUnacknowledgedTurn(threadId: string, instanceId: string): void {
    const session = this.ctx.sessions.get(threadId);
    if (!session || session.instanceId !== instanceId) {
      return;
    }
    if (this.ctx.isDisposed() || session.ignoreExit) {
      return;
    }
    if (session.status !== "working" || !session.structuredTurnInterruptRequested) {
      return;
    }
    this.clearStructuredInterruptWatchdog(session);
    session.structuredTurnInterruptRequested = false;
    const interruptedSession = session.structuredSession;
    interruptedSession?.forceCompleteTurn?.();
    session.ignoreExit = true;
    session.structuredSession = undefined;
    void Promise.resolve(interruptedSession?.dispose()).catch((error) => {
      console.error("[supervisor] failed to dispose force-stopped structured session:", error);
    });
    this.ctx.completeForcedInterrupt(session);
  }
}
