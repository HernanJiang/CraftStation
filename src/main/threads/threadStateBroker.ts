import type { PendingSteerState, ThreadAttention, ThreadStatus } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";

/** Latest live runtime bits observed for a thread from `thread-state` events. */
export interface LiveThreadState {
  status: ThreadStatus;
  attention: ThreadAttention;
  errorMessage?: string;
}

interface Waiter {
  keys: ReadonlySet<string>;
  wake(): void;
}

/**
 * Persistent, main-side tap on the supervisor event stream that the always-on
 * app-controls MCP server reads from. It caches the latest live status and the
 * staged pending-steer slot per thread (neither is exposed by a request/reply
 * RPC), and drives event-driven `wait_for_thread` waits without polling the
 * supervisor. Fed by {@link observe} from the same `onEvent` tap that persists
 * events, so the DB row is already updated by the time a wake fires.
 */
export class ThreadStateBroker {
  private readonly liveStates = new Map<string, LiveThreadState>();
  private readonly pendingSteer = new Map<string, PendingSteerState>();
  private readonly waiters = new Set<Waiter>();

  /** Wire into the supervisor event tap (main.ts / headless host `onEvent`). */
  observe(event: SupervisorEvent): void {
    switch (event.type) {
      case "thread-state":
        this.liveStates.set(event.threadId, {
          status: event.status,
          attention: event.attention,
          ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
        });
        this.wake(event.threadId);
        return;
      case "thread-pending-steer":
        if (event.pending) this.pendingSteer.set(event.threadId, event.pending);
        else this.pendingSteer.delete(event.threadId);
        this.wake(event.threadId);
        return;
      case "thread-exited":
        this.liveStates.delete(event.threadId);
        this.pendingSteer.delete(event.threadId);
        this.wake(event.threadId);
        return;
      case "thread-output":
        this.wake(event.threadId);
        return;
      case "project-tree-changed":
      case "git-changed":
        this.wake(event.projectId);
        return;
      default:
        return;
    }
  }

  /** Latest live status/attention seen for a thread, or `undefined` if none yet. */
  getLiveState(threadId: string): LiveThreadState | undefined {
    return this.liveStates.get(threadId);
  }

  /** Currently staged steer message for a thread, or `null` when the slot is empty. */
  getPendingSteer(threadId: string): PendingSteerState | null {
    return this.pendingSteer.get(threadId) ?? null;
  }

  /**
   * Event-driven wait: re-evaluate `poll` on each `thread-state` /
   * `thread-pending-steer` / `thread-exited` / `thread-output` /
   * `project-tree-changed` / `git-changed` wake for `keys` (thread ids,
   * `shell:` terminal ids, or project ids — the observed event spaces never
   * collide), plus a coarse re-check cap, until it returns a value or the
   * deadline elapses. Returns the polled value, or `undefined` on timeout.
   * The waiter stays registered across the whole loop so a wake landing
   * mid-poll is never lost — it just shortens the next sleep. No tight
   * polling.
   */
  async waitUntil<T>(
    keys: string[],
    timeoutMs: number,
    poll: () => T | undefined | Promise<T | undefined>,
    maxChunkMs = 1_000,
  ): Promise<T | undefined> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let pendingWake = false;
    let wakeResolve: (() => void) | undefined;
    const waiter: Waiter = {
      keys: new Set(keys),
      wake: () => {
        pendingWake = true;
        wakeResolve?.();
      },
    };
    this.waiters.add(waiter);
    try {
      for (;;) {
        pendingWake = false;
        const value = await poll();
        if (value !== undefined) return value;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return undefined;
        if (!pendingWake) {
          await new Promise<void>((resolve) => {
            wakeResolve = resolve;
            setTimeout(resolve, Math.min(maxChunkMs, remaining));
          });
          wakeResolve = undefined;
        }
      }
    } finally {
      this.waiters.delete(waiter);
      wakeResolve?.();
    }
  }

  private wake(key: string): void {
    if (this.waiters.size === 0) return;
    for (const waiter of this.waiters) {
      if (waiter.keys.has(key)) waiter.wake();
    }
  }
}
