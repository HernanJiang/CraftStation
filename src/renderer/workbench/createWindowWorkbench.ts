import { createWorkbenchServices } from "./services";
import { createWorkbench, type WorkbenchContribution } from "./lifecycle";
import type { WorkbenchServices } from "./services";
import { runtimeEventsContribution } from "./contributions/runtimeEvents";
import { remoteCommandsContribution } from "./contributions/remoteCommands";
import { synchronizationContribution } from "./contributions/synchronization";
import { updatesContribution } from "./contributions/updates";
import { threadRequestsContribution } from "./contributions/threadRequests";
import { outputPruningContribution } from "./contributions/outputPruning";
import {
  analyticsContribution,
  prewarmContribution,
  quickComposerReadyContribution,
} from "./contributions/background";

/** Main owns global synchronization; temporary chat only receives its private runtime events. */
export function createWindowWorkbench(services = createWorkbenchServices()) {
  const contributions: WorkbenchContribution<WorkbenchServices>[] =
    services.bridge.windowKind === "main"
      ? [
          runtimeEventsContribution,
          updatesContribution,
          remoteCommandsContribution,
          synchronizationContribution,
          threadRequestsContribution,
          outputPruningContribution,
          quickComposerReadyContribution,
          analyticsContribution,
          prewarmContribution,
        ]
      : services.bridge.windowKind === "temporaryChat"
        ? [runtimeEventsContribution, prewarmContribution]
        : services.bridge.windowKind === "quickComposer"
          ? [prewarmContribution]
          : [];
  return createWorkbench({
    services,
    contributions,
    onError: services.reportError,
    onPhase: (phase) => {
      performance.mark(`craftstation:workbench.${phase}`);
    },
  });
}
