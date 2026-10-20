import { randomUUID } from "node:crypto";
import type { SupervisorEvent } from "@/shared/ipc";

const PREFIX = "temporary-chat-";
export const isTemporaryChatThread = (id: string): boolean => id.startsWith(PREFIX);

/** Main owns the lifetime; closing during a slow launch must also close its late result. */
export class TemporaryChatSession {
  threadId: string | null = null;
  private busy = 0;
  private releasing = false;

  constructor(private readonly discard: (threadId: string) => Promise<void>) {}

  begin(): string {
    if (this.threadId) throw new Error("temporary-chat-already-open");
    this.threadId = `${PREFIX}${randomUUID()}`;
    return this.threadId;
  }

  /**
   * Drop the current conversation and mint the next identity. `close` clears
   * the id before its first await, so `begin` is safe in the same turn. A
   * launch still in flight for the old id discards only that id.
   */
  rearm(): string {
    const previous = this.threadId;
    if (previous) void this.close(previous);
    return this.begin();
  }

  async close(threadId: string): Promise<void> {
    if (this.threadId === threadId) this.threadId = null;
    await this.discard(threadId);
  }

  /**
   * Stop the prepared CLI without ending this window. The thread id stays so
   * the next open starts the same slot. A launch already in flight is left
   * alone; the caller retries after it finishes.
   */
  async releaseProcess(): Promise<boolean> {
    const threadId = this.threadId;
    if (!threadId || this.busy > 0 || this.releasing) return false;
    this.releasing = true;
    try {
      await this.discard(threadId);
      return this.threadId === threadId;
    } finally {
      this.releasing = false;
    }
  }

  async start<T>(threadId: string, launch: () => Promise<T>): Promise<T> {
    if (this.threadId !== threadId) throw new Error("temporary-chat-id-mismatch");
    if (this.releasing) throw new Error("temporary-chat-busy");
    this.busy += 1;
    try {
      return await launch();
    } finally {
      this.busy -= 1;
      if (this.threadId !== threadId) await this.discard(threadId);
    }
  }
}

/** Split mixed supervisor batches before persistence, main history and remote broadcasts. */
export function routeTemporaryChatEvent(
  event: SupervisorEvent,
  deliver: (event: SupervisorEvent) => void,
): SupervisorEvent | null {
  if (event.type === "thread-runtime-events-multi") {
    const privateBatches = event.batches.filter((batch) => isTemporaryChatThread(batch.threadId));
    if (privateBatches.length === 0) return event;
    deliver({ ...event, batches: privateBatches });
    const batches = event.batches.filter((batch) => !isTemporaryChatThread(batch.threadId));
    return batches.length ? { ...event, batches } : null;
  }
  if ("threadId" in event && isTemporaryChatThread(event.threadId)) {
    deliver(event);
    return null;
  }
  return event;
}
