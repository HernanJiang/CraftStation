// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DisposableScope } from "@/shared/disposable";
import { createWorkbench, type WorkbenchContribution } from "./lifecycle";

describe("Workbench lifetime", () => {
  it("installs starting listeners synchronously and activates each phase once", () => {
    const events: string[] = [];
    const contribution = (id: "starting" | "ready" | "restored" | "eventually"):
      WorkbenchContribution<undefined> => ({ id, phase: id, activate: () => {
        events.push(id); return () => { events.push(`dispose:${id}`); };
      } });
    const workbench = createWorkbench({
      services: undefined, onError: (error: unknown) => { throw error instanceof Error ? error : new Error(String(error)); },
      contributions: [contribution("eventually"), contribution("restored"), contribution("starting"), contribution("ready")],
    });
    expect(events).toEqual(["starting"]);
    workbench.advanceTo("restored");
    workbench.advanceTo("ready");
    workbench.advanceTo("eventually");
    workbench.dispose();
    workbench.dispose();
    workbench.advanceTo("eventually");
    expect(events).toEqual(["starting", "ready", "restored", "eventually",
      "dispose:eventually", "dispose:restored", "dispose:ready", "dispose:starting"]);
  });

  it("cancels in-flight activation and immediately releases late resources", async () => {
    const cleanup = vi.fn<() => void>();
    const pending = Promise.withResolvers<() => void>();
    let signal: AbortSignal | undefined;
    const workbench = createWorkbench({ services: undefined, onError: vi.fn<() => void>(), contributions: [{
      id: "remote", phase: "starting", activate: ({ scope }) => {
        signal = scope.signal; return pending.promise;
      },
    }] });
    workbench.dispose();
    expect(signal?.aborted).toBe(true);
    pending.resolve(cleanup);
    await pending.promise;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("rolls back partial activation and continues independent contributions", () => {
    const cleanup = vi.fn<() => void>();
    const onError = vi.fn<(id: string, error: unknown) => void>();
    const next = vi.fn<() => void>();
    const error = new Error("listener failed");
    const workbench = createWorkbench({ services: undefined, onError, contributions: [
      { id: "failed", phase: "starting", activate: ({ scope }) => { scope.add(cleanup); throw error; } },
      { id: "next", phase: "starting", activate: next },
    ] });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("failed", error);
    expect(next).toHaveBeenCalledTimes(1);
    workbench.dispose();
  });

  it("refuses duplicate ids before installing any listener", () => {
    const activate = vi.fn<() => void>();
    const item = { id: "same", phase: "starting" as const, activate };
    expect(() => createWorkbench({ services: undefined, contributions: [item, item], onError: vi.fn<(id: string, error: unknown) => void>() })).toThrow("Duplicate contribution");
    expect(activate).not.toHaveBeenCalled();
  });

  it("releases session and project children independently and survives disposal failures", () => {
    const errors = vi.fn<(error: unknown) => void>();
    const window = new DisposableScope(errors);
    const project = window.child();
    const session = project.child();
    const dispose = vi.fn<() => void>();
    session.add(dispose);
    session.add(() => { throw new Error("cleanup failed"); });
    project.dispose();
    expect(session.signal.aborted).toBe(true);
    expect(window.signal.aborted).toBe(false);
    window.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
