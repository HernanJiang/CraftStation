type ThreadBindingUnavailableListener = (threadId: string) => void;

const listeners = new Set<ThreadBindingUnavailableListener>();

/** Fired when a thread is archived or deleted so bound schedules can go with it. */
export function onThreadBindingUnavailable(listener: ThreadBindingUnavailableListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyThreadBindingUnavailable(threadId: string): void {
  for (const listener of listeners) {
    try {
      listener(threadId);
    } catch {
      // Schedule cleanup must never break the thread write path.
    }
  }
}
