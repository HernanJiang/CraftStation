import { randomUUID } from "node:crypto";
import type { PromptSegment } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { buildPromptContentBlocks } from "@/shared/promptContent";
import type { QueuedStructuredTurn, SessionRuntime } from "../sessionTypes";

export interface StructuredTurnQueueContext {
  emit(event: SupervisorEvent): void;
  sessions: Map<string, SessionRuntime>;
  beginFailureEpisode(session: SessionRuntime): void;
  failStructuredSession(session: SessionRuntime, error: unknown): void;
  /**
   * Same-turn pool failover: when a turn dies on a pool-account quota error
   * while usable pool accounts remain, dispose the dead session, rebuild on
   * the next account and replay the turn. Returns true when it took over (the
   * caller must not also fail the session); false to fall through to the
   * normal failure path.
   */
  tryPoolFailover?(
    session: SessionRuntime,
    turn: QueuedStructuredTurn,
    error: unknown,
  ): Promise<boolean>;
  /**
   * Craft-Harness automatic retry: when a turn dies on a network/transport
   * interruption, wait the configured interval and replay it (with an
   * invisible continuation note). Runs after pool failover has declined;
   * returns true when it took over (the caller must not also fail the
   * session); false to fall through to the normal failure path.
   */
  tryTurnRetry?(
    session: SessionRuntime,
    turn: QueuedStructuredTurn,
    error: unknown,
  ): Promise<boolean>;
}

/**
 * Starts structured (GUI / server-controlled) turns and drains the
 * launch-queued initial prompt once the agent signals readiness. Owns the
 * optimistic user_message paint that keeps the chat pane responsive while the
 * structured session's `prompt()` round-trip is in flight. Extracted from
 * `ThreadSessionManager`.
 */
export class StructuredTurnQueue {
  constructor(private readonly ctx: StructuredTurnQueueContext) {}

  start(session: SessionRuntime, turn: QueuedStructuredTurn): void {
    if (!session.structuredSession?.startTurn) {
      return;
    }
    this.ctx.beginFailureEpisode(session);
    // Optimistic user_message: paint the user's prompt in the chat pane
    // before the structured session's `prompt()` round-trip resolves so the
    // chat doesn't visually stall waiting on the agent. Only meaningful for
    // GUI threads — terminal threads render user input via PTY echo.
    // Reuse the renderer-supplied id when present, but still emit the canonical
    // events. The originating renderer dedupes them by id, while other paired
    // renderers need this broadcast to see the submitted user message.
    const turnId = turn.turnId ?? `turn-${randomUUID()}`;
    const optimisticItemId =
      session.presentationMode === "gui" && turn.prompt.length > 0
        ? this.emitOptimisticUserMessage(
            session.threadId,
            turn.prompt,
            turn.segments,
            turn.userMessageItemId,
            turnId,
          )
        : undefined;
    // Failover/manual-switch context carry-over: prepend the stashed preface
    // to the SENT prompt only (the optimistic paint below stays the raw
    // prompt), then consume it so a later restart of this turn object cannot
    // prepend it twice (failover rebuilds re-derive it fresh).
    if (!turn.historyPreface && session.pendingHistoryPreface) {
      turn.historyPreface = session.pendingHistoryPreface;
      delete session.pendingHistoryPreface;
    }
    // Persistent fallback goal first (highest priority), then the failover
    // preface, then the raw prompt. Painted output always stays the raw
    // prompt (see the optimistic paint above).
    const sendPrompt = [turn.goalContext, turn.historyPreface, turn.prompt]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join("\n\n");
    delete turn.historyPreface;
    const startOptions = {
      ...(session.agentKind === "opencode" ? { turnId } : {}),
      ...(optimisticItemId ? { userMessageItemId: optimisticItemId } : {}),
      ...(turn.inlineInstructions ? { inlineInstructions: turn.inlineInstructions } : {}),
    };
    // Failover replay reuses the already-painted turn/user-message ids so the
    // rebuilt session cannot duplicate them (mirrors restartThread's contract).
    const replayTurn: QueuedStructuredTurn = { ...turn, turnId };
    if (optimisticItemId && !replayTurn.userMessageItemId) {
      replayTurn.userMessageItemId = optimisticItemId;
    }
    const startTurn = session.structuredSession.startTurn(
      sendPrompt,
      turn.config,
      turn.segments,
      Object.keys(startOptions).length > 0 ? startOptions : undefined,
    );
    void startTurn.catch(async (error) => {
      if (this.ctx.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
        return;
      }
      if (await this.ctx.tryPoolFailover?.(session, replayTurn, error)) return;
      if (await this.ctx.tryTurnRetry?.(session, replayTurn, error)) return;
      this.ctx.failStructuredSession(session, error);
    });
  }

  /** Drain the launch-queued initial prompt once the agent's TUI is ready. */
  startQueuedLaunchPrompt(session: SessionRuntime): void {
    if (!session.pendingLaunchPrompt || !session.structuredSession?.startTurn) {
      return;
    }
    this.ctx.beginFailureEpisode(session);
    const prompt = session.pendingLaunchPrompt;
    session.pendingLaunchPrompt = undefined;
    // One-shot fallback goal for the launch turn (same paint/send split as
    // regular turns; later turns re-assert via their own `goalContext`).
    const launchGoal = session.pendingLaunchGoalContext;
    session.pendingLaunchGoalContext = undefined;
    const sendPrompt = launchGoal ? `${launchGoal}\n\n${prompt}` : prompt;
    const options =
      session.agentKind === "opencode" ? { turnId: `turn-${randomUUID()}` } : undefined;
    const startTurn = options
      ? session.structuredSession.startTurn(sendPrompt, session.config, undefined, options)
      : session.structuredSession.startTurn(sendPrompt, session.config);
    void startTurn.catch(async (error) => {
      if (this.ctx.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
        return;
      }
      const replayTurn: QueuedStructuredTurn = {
        prompt,
        config: session.config,
        ...(options ? { turnId: options.turnId } : {}),
      };
      if (await this.ctx.tryPoolFailover?.(session, replayTurn, error)) return;
      if (await this.ctx.tryTurnRetry?.(session, replayTurn, error)) return;
      this.ctx.failStructuredSession(session, error);
    });
  }

  /**
   * Synchronously paint the user's typed prompt into the chat pane as a
   * canonical user_message item, ahead of the structured session's own
   * `prompt()` round-trip. The structured session reuses this item id
   * via `StartTurnOptions` so its eventual emit is no-op'd by the
   * renderer's per-id dedupe, and the supervisor still drives the rest of the
   * canonical event stream.
   */
  emitOptimisticUserMessage(
    threadId: string,
    prompt: string,
    segments?: PromptSegment[],
    requestedItemId?: string,
    requestedTurnId?: string,
  ): string {
    const turnId = requestedTurnId ?? `turn-${randomUUID()}`;
    const itemId = requestedItemId ?? `user-${randomUUID()}`;
    this.ctx.emit({
      type: "thread-runtime-event",
      threadId,
      event: { type: "turn.started", threadId, turnId },
    });
    this.ctx.emit({
      type: "thread-runtime-event",
      threadId,
      event: {
        type: "item.started",
        threadId,
        itemId,
        itemType: "user_message",
        payload: { content: buildPromptContentBlocks(prompt, segments) },
      },
    });
    this.ctx.emit({
      type: "thread-runtime-event",
      threadId,
      event: { type: "item.completed", threadId, itemId },
    });
    return itemId;
  }
}
