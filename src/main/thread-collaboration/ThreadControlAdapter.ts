import type {
  InterruptThreadPayload,
  Project,
  StartThreadPayload,
  StartThreadResult,
  Thread,
  ThreadRuntimeSnapshot,
  ThreadStatus,
} from "@/shared/contracts";
import { DEFAULT_TERMINAL_SIZE, resolveMcpLaunchSnapshot } from "@/shared/contracts";
import { isUnknownThreadSessionError } from "@/shared/threadRelaunch";
import { buildWorktreeLocation } from "@/shared/worktree";
import type { SharedSettings } from "@/shared/settings";
import type { ThreadStateBroker } from "../threads/threadStateBroker";

export const THREAD_CONTROL_SETTLED_STATUSES: ReadonlySet<ThreadStatus> = new Set([
  "idle",
  "finished",
  "needs_approval",
  "needs_reply",
  "error",
  "inactive",
]);

/** States in which a new user message may be accepted without changing the
 * target's current turn. Attention and error states remain settled for the
 * generic wait primitive, but are deliberately not delivery-ready. */
export const THREAD_CONTROL_DELIVERY_STATUSES: ReadonlySet<ThreadStatus> = new Set([
  "idle",
  "finished",
  "inactive",
]);

export interface ThreadControlRuntime {
  getThreadSnapshots(): Promise<ThreadRuntimeSnapshot[]>;
  startThread(payload: StartThreadPayload): Promise<StartThreadResult>;
  sendThreadInput(payload: {
    threadId: string;
    prompt: string;
    config: Thread["config"];
    userMessageItemId?: string;
  }): Promise<void>;
  interruptThread(payload: InterruptThreadPayload): Promise<void>;
  closeThread(payload: { threadId: string }): Promise<void>;
}

export interface ThreadControlAdapterDeps {
  getThread(threadId: string): Thread | null;
  getThreads(): Thread[];
  getProject(projectId: string): Project | null;
  settings(): SharedSettings;
  runtime: ThreadControlRuntime;
  states: ThreadStateBroker;
}

export interface ThreadControlSnapshot {
  thread: Thread;
  status: ThreadStatus;
  attention: Thread["attention"];
  live: boolean;
}

export type ThreadDeliveryResult =
  | { kind: "delivered"; resumed: false }
  | { kind: "delivered"; resumed: true };

/**
 * CraftStation-owned façade over the existing long-lived thread controls.
 * It deliberately knows nothing about Crossagents: those remain ephemeral
 * subagents and never enter this adapter or the durable collaboration ledger.
 */
export class ThreadControlAdapter {
  constructor(private readonly deps: ThreadControlAdapterDeps) {}

  list(): Thread[] {
    return this.deps.getThreads();
  }

  require(threadId: string): Thread {
    const thread = this.deps.getThread(threadId);
    if (!thread) throw controlError("THREAD_NOT_FOUND", `Thread not found: ${threadId}.`);
    return thread;
  }

  snapshot(threadId: string): ThreadControlSnapshot {
    const thread = this.require(threadId);
    const live = this.deps.states.getLiveState(threadId);
    return {
      thread,
      status: live?.status ?? thread.status,
      attention: live?.attention ?? thread.attention,
      live: live !== undefined,
    };
  }

  isSettled(threadId: string): boolean {
    return THREAD_CONTROL_SETTLED_STATUSES.has(this.snapshot(threadId).status);
  }

  async refreshSnapshot(threadId: string): Promise<ThreadControlSnapshot> {
    const current = this.snapshot(threadId);
    try {
      const live = (await this.deps.runtime.getThreadSnapshots()).find(
        (entry) => entry.threadId === threadId,
      );
      return live
        ? {
            thread: current.thread,
            status: live.status,
            attention: live.attention,
            live: true,
          }
        : current;
    } catch {
      return current;
    }
  }

  /**
   * Deliver only when the target is settled. A busy target is a policy error,
   * never an implicit steer; callers must queue it in the collaboration ledger.
   */
  async deliverSettled(
    threadId: string,
    prompt: string,
    requestItemId?: string,
  ): Promise<ThreadDeliveryResult> {
    const thread = this.require(threadId);
    const snapshot = await this.refreshSnapshot(threadId);
    if (!THREAD_CONTROL_DELIVERY_STATUSES.has(snapshot.status)) {
      throw controlError(
        "THREAD_TARGET_BUSY",
        `Thread ${threadId} is ${snapshot.status}; queue the request until its current turn settles.`,
      );
    }

    try {
      await this.deps.runtime.sendThreadInput({
        threadId,
        prompt,
        config: thread.config,
        ...(requestItemId ? { userMessageItemId: requestItemId } : {}),
      });
      return { kind: "delivered", resumed: false };
    } catch (error) {
      if (!isUnknownThreadSessionError(error)) throw error;
    }

    if (!thread.sessionRef && !thread.canResumeWithConfig) {
      throw controlError(
        "THREAD_NOT_RESUMABLE",
        `Thread ${threadId} has no live or resumable session. Create a new thread instead.`,
      );
    }
    await this.deps.runtime.startThread(this.buildResumePayload(thread, prompt, requestItemId));
    return { kind: "delivered", resumed: true };
  }

  async interruptAndWait(threadId: string, timeoutMs = 30_000): Promise<ThreadControlSnapshot> {
    this.require(threadId);
    await this.deps.runtime.interruptThread({ threadId });
    const settled = await this.deps.states.waitUntil(
      [threadId],
      timeoutMs,
      () => {
        const snapshot = this.snapshot(threadId);
        return THREAD_CONTROL_SETTLED_STATUSES.has(snapshot.status) ? snapshot : undefined;
      },
      500,
    );
    if (!settled) {
      throw controlError(
        "THREAD_INTERRUPT_NOT_CONFIRMED",
        `Thread ${threadId} did not confirm a settled state after interrupt; no request was sent.`,
      );
    }
    return settled;
  }

  interrupt(threadId: string): Promise<void> {
    this.require(threadId);
    return this.deps.runtime.interruptThread({ threadId });
  }

  stop(threadId: string): Promise<void> {
    this.require(threadId);
    return this.deps.runtime.closeThread({ threadId });
  }

  async waitSettled(
    threadIds: string[],
    timeoutMs: number,
  ): Promise<ThreadControlSnapshot[] | null> {
    for (const threadId of threadIds) this.require(threadId);
    return (
      (await this.deps.states.waitUntil(
        threadIds,
        timeoutMs,
        () => {
          const snapshots = threadIds.map((threadId) => this.snapshot(threadId));
          return snapshots.some((snapshot) => THREAD_CONTROL_SETTLED_STATUSES.has(snapshot.status))
            ? snapshots
            : undefined;
        },
        1_000,
      )) ?? null
    );
  }

  private buildResumePayload(
    thread: Thread,
    prompt: string,
    requestItemId?: string,
  ): StartThreadPayload {
    const project = this.deps.getProject(thread.projectId);
    if (!project) {
      throw controlError(
        "THREAD_PROJECT_NOT_FOUND",
        `Cannot resume thread ${thread.id}: project ${thread.projectId} no longer exists.`,
      );
    }
    return {
      threadId: thread.id,
      projectLocation: thread.worktreePath
        ? buildWorktreeLocation(project.location, thread.worktreePath)
        : project.location,
      agentKind: thread.agentKind,
      ...(thread.agentInstanceId ? { agentInstanceId: thread.agentInstanceId } : {}),
      config: thread.config,
      prompt,
      initialSize: DEFAULT_TERMINAL_SIZE,
      ...(thread.sessionRef ? { sessionRef: thread.sessionRef } : {}),
      ...(thread.presentationMode ? { presentationMode: thread.presentationMode } : {}),
      ...(requestItemId ? { userMessageItemId: requestItemId } : {}),
      ...resolveMcpLaunchSnapshot(this.deps.settings(), project.mcpServers ?? []),
    };
  }
}

function controlError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
