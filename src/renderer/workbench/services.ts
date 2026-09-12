import { readBridge } from "@/renderer/bridge";
import { captureRendererException } from "@/renderer/diagnostics/sentry";

/** Window-owned composition. Main and Supervisor remain behind the typed bridge. */
export function createWorkbenchServices(bridge = readBridge()) {
  return {
    bridge,
    reportError(operation: string, error: unknown) {
      console.error("[workbench]", {
        phase: "lifecycle", operation, status: "failed",
        code: "WORKBENCH_CONTRIBUTION_FAILED", windowKind: bridge.windowKind,
      }, error);
      captureRendererException(error, { featureArea: "workbench" });
    },
  };
}

export type WorkbenchServices = ReturnType<typeof createWorkbenchServices>;
