import { useEffect } from "react";
import {
  MODEL_CATALOG_REFRESH_MS,
  refreshModelCatalog,
} from "@/renderer/actions/modelCatalogRefresh";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

export function useModelCatalogRefresh(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      const { agentStatuses, wslAgentStatuses } = useAgentStatusesStore.getState();
      const disabled = new Set(useSharedSettings.getState().disabledAgents);
      const kinds = new Set(
        [...agentStatuses, ...wslAgentStatuses]
          .filter((status) => status.installed && !disabled.has(status.kind))
          .map((status) => status.kind),
      );
      void Promise.allSettled([...kinds].map((kind) => refreshModelCatalog(kind)));
    };
    // Startup already runs a full discovery; subsequent refreshes are bounded
    // and also catch a laptop resuming after a long sleep.
    const timer = setInterval(refresh, MODEL_CATALOG_REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled]);
}
