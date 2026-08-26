import { Suspense } from "react";
import { usePanelStore } from "@/renderer/state/panelStore";
import { DeferredProjectAuxiliaryPanel } from "@/renderer/deferredFeatures";

export function MainRightPanel() {
  const visible = usePanelStore((state) => state.auxiliaryPanelPlacement !== "hidden");
  const selectedTab = usePanelStore((state) => state.auxiliaryPanelTab);
  if (!visible) return null;

  return (
    <Suspense>
      <DeferredProjectAuxiliaryPanel includeTerminal visible showLauncher={selectedTab === null} />
    </Suspense>
  );
}
