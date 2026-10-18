import { randomUUID } from "node:crypto";
import type { SupervisorEvent } from "@/shared/ipc";

const PREFIX = "temporary-chat-";
export const isTemporaryChatThread = (id: string): boolean => id.startsWith(PREFIX);

/** Main owns the lifetime; closing during a slow launch must also close its late result. */
export class TemporaryChatSession {
  threadId: string | null = null;

  constructor(private readonly discard: (threadId: string) => Promise<void>) {}

  begin(): string {
    if (this.threadId) throw new Error("temporary-chat-already-open");
    this.threadId = `${PREFIX}${randomUUID()}`;
    return this.threadId;
  }

  async close(threadId: string): Promise<void> {
    if (this.threadId === threadId) this.threadId = null;
    await this.discard(threadId);
  }

  async start<T>(threadId: string, launch: () => Promise<T>): Promise<T> {
    if (this.threadId !== threadId) throw new Error("temporary-chat-closed");
    try {
      return await launch();
    } finally {
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
