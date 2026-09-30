/**
 * 16 ms coalescing layer for PTY output. node-pty emits roughly one data
 * event per line, and every consumer of `thread-output` only appends or
 * accumulates the text, so joining a burst into one delivery preserves
 * semantics while collapsing thousands of IPC events into tens.
 *
 * Keys are the session OBJECTS (instance identity), so a replaced session
 * can never bleed output into its successor's stream.
 */
export const PTY_OUTPUT_BATCH_MS = 16;

export class PtyOutputBatcher<K extends object> {
  private readonly pending = new Map<K, string[]>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deliver: (key: K, data: string) => void) {}

  append(key: K, data: string): void {
    const chunks = this.pending.get(key);
    if (chunks) {
      chunks.push(data);
    } else {
      this.pending.set(key, [data]);
    }
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), PTY_OUTPUT_BATCH_MS);
  }

  /** Deliver one key's buffered chunks now; used so exit paths see final output. */
  flushKey(key: K): void {
    const chunks = this.pending.get(key);
    if (!chunks) return;
    this.pending.delete(key);
    if (this.pending.size === 0 && this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.deliverSafe(key, chunks.join(""));
  }

  /** Deliver everything buffered and disarm the shared timer. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const pending = [...this.pending];
    this.pending.clear();
    for (const [key, chunks] of pending) {
      this.deliverSafe(key, chunks.join(""));
    }
  }

  // One failing key must never swallow another session's output.
  private deliverSafe(key: K, data: string): void {
    try {
      this.deliver(key, data);
    } catch (error) {
      console.error(
        "[pty-output] phase=flush operation=deliver status=failed code=PTY_OUTPUT_DELIVER_FAILED",
        error,
      );
    }
  }
}
