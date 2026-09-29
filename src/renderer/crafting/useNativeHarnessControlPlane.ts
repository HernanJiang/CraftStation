import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@heroui/react";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import { runNativeAgentInstall } from "@/renderer/actions/installNativeAgent";
import { currentWslDistros } from "@/renderer/utils/acpRegistryAuth";
import {
  isRetiredHarnessKind,
  NATIVE_HARNESS_AGENT_KINDS,
} from "@/renderer/crafting/harnessInventory";

// Inflight dedup across mounts: re-opening a page while a scoped probe is
// still running reuses that probe instead of stacking another full
// 8-harness × (native + WSL) detection sweep.
let refreshHarnessInflight: Promise<void> | undefined;

/**
 * Shared Native Harness control-plane projection: cached paint first, then a
 * real scoped detection revalidates, and supervisor detection events re-read
 * the projection without re-detecting. Used by both the Crafting Workbench
 * (inventory pickers) and the Harness map tab.
 */
export function useNativeHarnessControlPlane() {
  const [entries, setEntries] = useState<NativeHarnessControlPlaneEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightedKind, setHighlightedKind] = useState<string | undefined>(undefined);
  const [installingKinds, setInstallingKinds] = useState<ReadonlySet<string>>(() => new Set());

  // Projection read only. The control plane reshapes already-detected
  // AgentStatuses — it never probes the machine, so supervisor detection
  // events re-read this without re-triggering detection (no event loop).
  const readControlPlane = useCallback(async () => {
    try {
      const next = await readBridge().getNativeHarnessControlPlane({});
      setEntries(next);
    } catch {
      // Keep the previous projection; the next detection event retries.
    }
  }, []);

  // Open and manual refresh: run real scoped agent detection first (this
  // invalidates the executable-path cache and re-reads PATH supervisor-side,
  // so a CLI installed while CraftStation was running is found without a
  // restart), then project the fresh statuses into the control plane. The
  // projection is re-read on every outcome — success, degraded or failure —
  // so the panel always settles on the last cached result instead of going
  // blank.
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (!refreshHarnessInflight) {
        refreshHarnessInflight = (async () => {
          try {
            const response = await readBridge().refreshAgentStatuses(currentWslDistros(), {
              agentKinds: [...NATIVE_HARNESS_AGENT_KINDS],
            });
            if (response.degraded) {
              console.warn("[crafting] agent status refresh degraded", response.degraded);
              toast.warning("Agent 状态刷新超时，已保留上次结果。请稍后重试。");
            }
          } catch (error) {
            console.warn("[crafting] failed to refresh agent statuses", error);
            toast.warning(`Agent 状态刷新失败，已保留上次结果：${friendlyError(error)}`);
          } finally {
            refreshHarnessInflight = undefined;
          }
        })();
      }
      await refreshHarnessInflight;
      await readControlPlane();
    } finally {
      setLoading(false);
    }
  }, [readControlPlane]);

  useEffect(() => {
    // Stale-while-revalidate: paint the cached control-plane projection first
    // so the panel renders without waiting for live probes, then revalidate
    // with a real scoped detection in the background.
    void (async () => {
      await readControlPlane();
      void refresh();
    })();
    const unsubscribe = readBridge().onSupervisorEvent((event) => {
      if (
        event.type === "agent-detected" ||
        event.type === "agent-status-updated" ||
        event.type === "windows-agent-statuses" ||
        event.type === "wsl-agent-statuses"
      ) {
        void readControlPlane();
      }
    });
    return unsubscribe;
  }, [refresh, readControlPlane]);

  const install = useCallback(
    (entry: NativeHarnessControlPlaneEntry) => {
      const kind = entry.descriptor.harnessKind;
      setInstallingKinds((current) => new Set(current).add(kind));
      const finish = () =>
        setInstallingKinds((current) => {
          if (!current.has(kind)) return current;
          const next = new Set(current);
          next.delete(kind);
          return next;
        });
      const opened = runNativeAgentInstall({
        agentKind: kind,
        label: entry.descriptor.label,
        onComplete: (ok) => {
          if (!ok) {
            finish();
            return;
          }
          // The shared install action already refreshed agent statuses; the
          // fresh detection events re-read the control plane, but read it once
          // more here so the row settles even if an event was missed.
          void readControlPlane().finally(finish);
        },
        onRetry: () => install(entry),
      });
      if (!opened) finish();
    },
    [readControlPlane],
  );

  // Retired catalogue entries (e.g. DeepSeek API Runtime) stay out of the
  // lists; the runtime remains for saved recipes/threads.
  const visibleEntries = useMemo(
    () => entries.filter((entry) => !isRetiredHarnessKind(entry.descriptor.harnessKind)),
    [entries],
  );

  return {
    entries,
    visibleEntries,
    loading,
    highlightedKind,
    setHighlightedKind,
    installingKinds,
    refresh,
    install,
    readControlPlane,
  };
}
