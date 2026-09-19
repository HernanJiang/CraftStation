import type { CraftSession, Entity, HarnessRuntimeAdapter } from "@/shared/crafting";

/** Own transports by adapter instance, not harness name: concurrent sessions
 * of the same harness and handoff source/target release independently. */
export class OwnedHarnessRuntimes {
  private readonly live = new Set<HarnessRuntimeAdapter>();
  private readonly pending = new Set<Promise<void>>();
  private readonly wrappers = new WeakMap<HarnessRuntimeAdapter, HarnessRuntimeAdapter>();

  own(adapter: HarnessRuntimeAdapter): HarnessRuntimeAdapter {
    const existing = this.wrappers.get(adapter);
    if (existing) return existing;
    const sessions = new Map<CraftSession, () => void>();
    const spawning = new Set<Promise<Entity>>();
    let disposed: Promise<void> | undefined;
    const dispose = (): Promise<void> => {
      if (disposed) return disposed;
      for (const unsubscribe of sessions.values()) unsubscribe();
      sessions.clear();
      this.live.delete(wrapper);
      // CPA spawn may still be starting a sidecar or building its target.
      // Release the adapter after those bounded operations have registered
      // their resources; callers are fenced immediately by disposed.
      disposed = Promise.allSettled([...spawning]).then(() => adapter.dispose?.());
      this.pending.add(disposed);
      void disposed.then(
        () => this.pending.delete(disposed!),
        () => this.pending.delete(disposed!),
      );
      return disposed;
    };
    const open = async (operation: () => Promise<CraftSession>): Promise<CraftSession> => {
      if (disposed) throw new Error("Runtime was disposed before opening a session.");
      try {
        const session = await operation();
        // Closing cannot cancel every provider's pending handshake. A late
        // session still belongs to this owner and must never escape alive.
        if (disposed) {
          await session.terminate();
          throw new Error("Runtime was disposed while opening a session.");
        }
        if (!sessions.has(session)) {
          const unsubscribe = session.subscribe((event) => {
            if (event.type !== "session.exited") return;
            sessions.get(session)?.();
            sessions.delete(session);
            if (sessions.size === 0)
              void dispose().catch(() => {
                console.warn(
                  `[runtime] phase=cleanup operation=dispose status=failed harness=${adapter.harnessKind} code=RUNTIME_DISPOSE_FAILED`,
                );
              });
          });
          sessions.set(session, unsubscribe);
        }
        return session;
      } catch (error) {
        if (sessions.size === 0) await dispose().catch(() => undefined);
        throw error;
      }
    };
    const wrapper: HarnessRuntimeAdapter = {
      id: adapter.id,
      harnessKind: adapter.harnessKind,
      ...(adapter.descriptor ? { descriptor: adapter.descriptor } : {}),
      supports: (plan) => adapter.supports(plan),
      spawnEntity: async (plan) => {
        if (disposed) throw new Error("Runtime was disposed before spawning an entity.");
        const operation = adapter.spawnEntity(plan);
        spawning.add(operation);
        try {
          const entity = await operation;
          if (disposed) throw new Error("Runtime was disposed while spawning an entity.");
          return entity;
        } catch (error) {
          if (sessions.size === 0) await dispose().catch(() => undefined);
          throw error;
        } finally {
          spawning.delete(operation);
        }
      },
      createSession: (entity) => open(() => adapter.createSession(entity)),
      resumeSession: (entity, ref) => open(() => adapter.resumeSession(entity, ref)),
      getDiagnostics: () => adapter.getDiagnostics?.() ?? [],
      dispose,
    };
    this.live.add(wrapper);
    this.wrappers.set(adapter, wrapper);
    return wrapper;
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.live].map((adapter) => Promise.resolve(adapter.dispose?.())));
    await this.flush();
  }
}
