import { DisposableScope, type Cleanup, type IDisposable } from "@/shared/disposable";

export const workbenchPhases = ["starting", "ready", "restored", "eventually"] as const;
export type WorkbenchPhase = (typeof workbenchPhases)[number];

export interface WorkbenchContext<Services> {
  readonly services: Services;
  readonly scope: DisposableScope;
  isReady(): boolean;
}

export interface WorkbenchContribution<Services> {
  readonly id: string;
  readonly phase: WorkbenchPhase;
  activate(context: WorkbenchContext<Services>): Cleanup | void | Promise<Cleanup | void>;
}

export interface Workbench extends IDisposable {
  advanceTo(phase: WorkbenchPhase): void;
}

/** Starting listeners install synchronously, before hydration or React mount. */
export function createWorkbench<Services>(options: {
  services: Services;
  contributions: readonly WorkbenchContribution<Services>[];
  onError(id: string, error: unknown): void;
  onPhase?(phase: WorkbenchPhase): void;
}): Workbench {
  const ids = new Set<string>();
  for (const contribution of options.contributions) {
    if (ids.has(contribution.id)) throw new Error(`Duplicate contribution: ${contribution.id}`);
    ids.add(contribution.id);
  }
  const windowScope = new DisposableScope((error) => options.onError("window.dispose", error));
  let phaseIndex = -1;

  const workbench: Workbench = {
    advanceTo(phase) {
      const target = workbenchPhases.indexOf(phase);
      while (!windowScope.signal.aborted && phaseIndex < target) {
        const current = workbenchPhases[++phaseIndex]!;
        options.onPhase?.(current);
        for (const contribution of options.contributions) {
          if (windowScope.signal.aborted) break;
          if (contribution.phase !== current) continue;
          const scope = windowScope.child();
          try {
            const result = contribution.activate({
              services: options.services,
              scope,
              isReady: () => !windowScope.signal.aborted && phaseIndex >= 1,
            });
            // Late async activation cannot resurrect an already closed window.
            if (result instanceof Promise) {
              void result.then((cleanup) => {
                if (cleanup) scope.add(cleanup);
              }).catch((error: unknown) => {
                scope.dispose();
                options.onError(contribution.id, error);
              });
            } else if (result) scope.add(result);
          } catch (error) {
            scope.dispose();
            options.onError(contribution.id, error);
          }
        }
      }
    },
    dispose: () => windowScope.dispose(),
  };
  workbench.advanceTo("starting");
  return workbench;
}
