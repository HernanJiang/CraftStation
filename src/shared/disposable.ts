export interface IDisposable {
  dispose(): void;
}

export type Cleanup = IDisposable | (() => void);

/** Owns resources and cancellation. A completed child detaches from its parent. */
export class DisposableScope implements IDisposable {
  private readonly controller = new AbortController();
  private readonly cleanups = new Set<() => void>();

  constructor(private readonly onError: (error: unknown) => void) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  add(cleanup: Cleanup): IDisposable {
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      this.cleanups.delete(dispose);
      try {
        if (typeof cleanup === "function") cleanup();
        else cleanup.dispose();
      } catch (error) {
        this.onError(error);
      }
    };
    if (this.signal.aborted) dispose();
    else this.cleanups.add(dispose);
    return { dispose };
  }

  child(): DisposableScope {
    const child = new DisposableScope(this.onError);
    const registration = this.add(child);
    child.add(() => registration.dispose());
    return child;
  }

  dispose(): void {
    if (this.signal.aborted) return;
    this.controller.abort();
    for (const cleanup of [...this.cleanups].reverse()) cleanup();
  }
}
