import type { RuntimeEvent } from "@/shared/contracts";
import type { StructuredSessionHandle } from "@/supervisor/agents/base";
import { runOneShotChild, type OneShotChildHandle } from "./oneShotChild";
import type { PreparedSubagentRun, ResolvedSpawnAttempt } from "./spawnPlan";
import { resolveSubagentExecution } from "./types";
import type { SubagentRunHost, SubagentRunStatus } from "./types";

export interface AttemptExecutionState {
  parentThreadId: string;
  childThreadId: string;
  label: string;
  plan: PreparedSubagentRun;
  handle: StructuredSessionHandle | undefined;
  oneShot: OneShotChildHandle | undefined;
  cancelRequested: boolean;
  turnStarted: boolean;
  turnDispatched: boolean;
  /** Armed per-attempt lifetime timer; cleared on settle/teardown. */
  attemptTimeout?: ReturnType<typeof setTimeout> | undefined;
}

interface AttemptCallbacks {
  isActive(): boolean;
  onRuntimeEvent(event: RuntimeEvent): void;
  onSettle(status: Exclude<SubagentRunStatus, "running">, errorMessage?: string): void;
}

export interface AttemptRunOptions {
  /** Wall-clock ceiling for one attempt; defaults to {@link STRUCTURED_ATTEMPT_MAX_LIFETIME_MS}. */
  maxLifetimeMs?: number;
}

/**
 * Hard ceiling on one structured attempt's wall-clock lifetime. Unlike the
 * `wait_for_agent` timeout (which only bounds the wait and intentionally
 * leaves the run alive), an attempt that never settles — stalled session
 * creation, a turn with no terminal event, a hung provider — must fail
 * closed, or the run spins forever with no UI recourse. Mirrors
 * `ONE_SHOT_CHILD_MAX_LIFETIME_MS` for the one-shot lane.
 */
export const STRUCTURED_ATTEMPT_MAX_LIFETIME_MS = 20 * 60 * 1000;

function timeoutMessage(state: AttemptExecutionState, ceilingMs: number): string {
  const minutes = Math.round(ceilingMs / 60000);
  return (
    `Subagent "${state.label}" timed out after ~${minutes} min without settling; ` +
    `its child session was torn down. Retry it, or narrow the task.`
  );
}

/** Executes one resolved structured or one-shot attempt for a logical run. */
export class SubagentAttemptRunner {
  constructor(private readonly host: SubagentRunHost) {}

  run(
    state: AttemptExecutionState,
    attemptIndex: number,
    attempt: ResolvedSpawnAttempt,
    callbacks: AttemptCallbacks,
    opts?: AttemptRunOptions,
  ): void {
    // Lifetime ceiling for the whole attempt (session creation, turn dispatch,
    // provider stall): without it an attempt that never settles leaves the run
    // spinning forever. Cleared on settle/teardown; per-attempt so retries get
    // a fresh budget.
    if (state.attemptTimeout) clearTimeout(state.attemptTimeout);
    const ceiling = opts?.maxLifetimeMs ?? STRUCTURED_ATTEMPT_MAX_LIFETIME_MS;
    let timedOut = false;
    state.attemptTimeout = setTimeout(() => {
      timedOut = true;
      state.attemptTimeout = undefined;
      // Bypass the guarded settle below: this IS the timeout speaking.
      void this.teardown(state).finally(() => {
        callbacks.onSettle("failed", timeoutMessage(state, ceiling));
      });
    }, Math.max(0, ceiling));
    if (typeof state.attemptTimeout.unref === "function") state.attemptTimeout.unref();
    const settledOnSettle: AttemptCallbacks["onSettle"] = (status, errorMessage) => {
      if (state.attemptTimeout) {
        clearTimeout(state.attemptTimeout);
        state.attemptTimeout = undefined;
      }
      // The lane settling after the ceiling fired is stale output; drop it.
      if (!timedOut) callbacks.onSettle(status, errorMessage);
    };
    const guarded: AttemptCallbacks = {
      isActive: () => !timedOut && callbacks.isActive(),
      onRuntimeEvent: callbacks.onRuntimeEvent,
      onSettle: settledOnSettle,
    };
    if (resolveSubagentExecution(attempt.adapter) === "one-shot") {
      this.runOneShot(state, attemptIndex, attempt, guarded);
      return;
    }
    void this.runStructured(state, attempt, guarded);
  }

  async teardown(state: AttemptExecutionState): Promise<void> {
    if (state.attemptTimeout) {
      clearTimeout(state.attemptTimeout);
      state.attemptTimeout = undefined;
    }
    if (state.oneShot) {
      state.oneShot.cancel();
      state.oneShot = undefined;
    }
    const handle = state.handle;
    if (!handle) return;
    state.handle = undefined;
    await this.disposeHandle(handle);
  }

  private async runStructured(
    state: AttemptExecutionState,
    attempt: ResolvedSpawnAttempt,
    callbacks: AttemptCallbacks,
  ): Promise<void> {
    const { adapter, config } = attempt;
    try {
      const mcpAccess = await this.host.resolveParentMcpAccess?.(
        state.parentThreadId,
        { threadId: state.childThreadId, title: state.label },
        adapter.kind,
      );
      if (!callbacks.isActive()) return;

      const handle = await adapter.createStructuredSession?.({
        threadId: state.childThreadId,
        projectLocation: state.plan.projectLocation,
        config,
        presentationMode: "gui",
        // Same contract as SpawnPipeline.createStructuredSession: the shared
        // runtime — not the provider — supplies `baseSpawnEnv`, so a structured
        // subagent child spawns with the provider's updater/telemetry opt-outs.
        ...(adapter.baseSpawnEnv ? { baseSpawnEnv: adapter.baseSpawnEnv } : {}),
        ...(mcpAccess ?? {}),
      });
      if (!handle) {
        callbacks.onSettle("failed", "Failed to create subagent session");
        return;
      }
      if (!callbacks.isActive() || state.cancelRequested) {
        await this.disposeHandle(handle);
        return;
      }

      state.handle = handle;
      handle.setListener({
        onClose: () =>
          callbacks.onSettle("failed", "Subagent session closed before the turn completed"),
        onError: (message) => callbacks.onSettle("failed", message),
        onUpdate: (update) => {
          if (callbacks.isActive() && state.turnStarted && update.status === "idle") {
            callbacks.onSettle("completed");
          }
        },
        onRuntimeEvent: callbacks.onRuntimeEvent,
      });

      if (handle.activate) await handle.activate();
      if (!callbacks.isActive() || state.cancelRequested) return;
      if (handle.openThread) await handle.openThread(config);
      if (!callbacks.isActive() || state.cancelRequested) return;
      if (!handle.startTurn) {
        callbacks.onSettle("failed", "Subagent session cannot start a turn");
        return;
      }
      state.turnStarted = true;
      state.turnDispatched = true;
      await handle.startTurn(state.plan.prompt, config);
    } catch (error) {
      callbacks.onSettle(
        state.cancelRequested ? "cancelled" : "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private runOneShot(
    state: AttemptExecutionState,
    attemptIndex: number,
    attempt: ResolvedSpawnAttempt,
    callbacks: AttemptCallbacks,
  ): void {
    const { adapter, config } = attempt;
    const itemId = `attempt-${attemptIndex + 1}-oneshot-out`;
    let opened = false;
    const ensureOpen = () => {
      if (opened) return;
      opened = true;
      callbacks.onRuntimeEvent({
        type: "item.started",
        threadId: state.childThreadId,
        itemId,
        itemType: "assistant_message",
      });
    };

    const handle = runOneShotChild({
      adapter,
      projectLocation: state.plan.projectLocation,
      model: config.model,
      effort: config.effort,
      prompt: state.plan.prompt,
      onTextDelta: (delta) => {
        ensureOpen();
        callbacks.onRuntimeEvent({
          type: "content.delta",
          threadId: state.childThreadId,
          itemId,
          stream: "assistant_text",
          delta,
        });
      },
      onSettle: ({ status, errorMessage }) => {
        if (opened) {
          callbacks.onRuntimeEvent({
            type: "item.completed",
            threadId: state.childThreadId,
            itemId,
          });
        }
        callbacks.onSettle(status, errorMessage);
      },
    });

    state.turnDispatched = true;
    state.oneShot = handle;
    if (state.cancelRequested) handle.cancel();
  }

  private async disposeHandle(handle: StructuredSessionHandle): Promise<void> {
    try {
      if (handle.interruptTurn) await handle.interruptTurn();
    } catch {}
    try {
      await handle.dispose();
    } catch {}
  }
}
