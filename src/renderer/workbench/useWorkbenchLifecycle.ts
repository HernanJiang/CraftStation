import { useEffect } from "react";
import type { Workbench } from "./lifecycle";

/** Hydration owns readiness; the Workbench owns each activated feature's lifetime. */
export function useWorkbenchLifecycle(workbench: Workbench, ready: boolean, restored: boolean) {
  useEffect(() => {
    if (ready) workbench.advanceTo("ready");
    if (!ready || !restored) return;
    workbench.advanceTo("restored");
    let cancelIdle = () => {};
    const frame = requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === "function") {
        const idle = window.requestIdleCallback(() => workbench.advanceTo("eventually"), {
          timeout: 5_000,
        });
        cancelIdle = () => window.cancelIdleCallback(idle);
      } else {
        const timer = window.setTimeout(() => workbench.advanceTo("eventually"), 250);
        cancelIdle = () => window.clearTimeout(timer);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelIdle();
    };
  }, [workbench, ready, restored]);
}
