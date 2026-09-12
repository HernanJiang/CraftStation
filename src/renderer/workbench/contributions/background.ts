import { startDeferredFeaturePrewarm } from "@/renderer/deferredFeatures";
import { captureAppStarted, installProductAnalytics } from "@/renderer/analytics/posthog";
import type { WorkbenchContribution } from "../lifecycle";
import type { WorkbenchServices } from "../services";

export const analyticsContribution: WorkbenchContribution<WorkbenchServices> = {
  id: "analytics", phase: "restored",
  activate({ scope }) {
    scope.add(installProductAnalytics());
    captureAppStarted();
  },
};

export const quickComposerReadyContribution: WorkbenchContribution<WorkbenchServices> = {
  id: "quick-composer.ready", phase: "ready",
  activate: ({ services }) => services.bridge.notifyQuickComposerMainReady(),
};

export const prewarmContribution: WorkbenchContribution<WorkbenchServices> = {
  id: "features.prewarm", phase: "eventually",
  activate: startDeferredFeaturePrewarm,
};
