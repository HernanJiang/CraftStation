import { readBridge } from "@/renderer/bridge";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { currentWslDistros } from "@/renderer/utils/acpRegistryAuth";
import type { AgentStatusesResponse } from "@/shared/contracts";

export const MODEL_CATALOG_REFRESH_MS = 15 * 60_000;
const attempts = new Map<string, number>();
const pending = new Map<string, Promise<AgentStatusesResponse | undefined>>();

/** Shared by automatic and manual refreshes; never change the user's selections. */
export function refreshModelCatalog(
  kind: string,
  force = false,
): Promise<AgentStatusesResponse | undefined> {
  const inFlight = pending.get(kind);
  if (inFlight) return inFlight;
  if (!force && Date.now() - (attempts.get(kind) ?? -Infinity) < MODEL_CATALOG_REFRESH_MS)
    return Promise.resolve(undefined);
  const bridge = readBridge();
  if (!bridge?.refreshAgentStatuses) return Promise.resolve(undefined);
  attempts.set(kind, Date.now());
  let timer: ReturnType<typeof setTimeout>;
  const task = Promise.race([
    bridge.refreshAgentStatuses(currentWslDistros(), { agentKinds: [kind] }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("MODEL_CATALOG_REFRESH_TIMEOUT")), 75_000);
    }),
  ])
    .then((response) => {
      if (response) {
        for (const status of [...response.windows, ...response.wsl]) {
          if (status.kind === kind) useAgentStatusesStore.getState().mergeAgentStatus(status);
        }
      }
      return response;
    })
    .finally(() => {
      clearTimeout(timer);
      pending.delete(kind);
    });
  pending.set(kind, task);
  return task;
}
