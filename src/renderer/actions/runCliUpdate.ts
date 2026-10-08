import { toast } from "@heroui/react";
import { readBridge } from "@/renderer/bridge";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useUpdateStore } from "@/renderer/state/updateStore";
import { currentWslDistros } from "@/renderer/utils/acpRegistryAuth";
import { msg as linguiMsg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";

/**
 * Run one CLI binary update end to end. Shared by the titlebar "Check all
 * CLIs" menu and the synthesis-bench Harness rows/cards so both surfaces
 * update through the same path (same toasts, same in-flight state, same
 * post-update refresh). The titlebar menu additionally re-runs its version
 * check afterwards; callers that own such a check should do it themselves.
 *
 * The update key is `${agentKind}:${envKind}:${distro}` (see CliUpdateMenu);
 * scope is re-derived from it so callers only pass the flattened entry.
 */
export async function runCliUpdateBinary(input: {
  key: string;
  agentKind: string;
  label: string;
  latest?: string | undefined;
}): Promise<boolean> {
  const [, envKindRaw, distro] = input.key.split(":");
  const envKind = envKindRaw === "wsl" ? "wsl" : envKindRaw === "windows" ? "windows" : "posix";
  const store = useUpdateStore.getState();
  if (store.agentUpdates[input.key]) return false;
  store.beginAgentUpdate(input.key, input.label);
  try {
    const result = await readBridge().updateAgentBinary({
      agentKind: input.agentKind,
      envKind,
      ...(envKind === "wsl" && distro ? { wslDistro: distro } : {}),
    });
    if (!result.ok) {
      toast.danger(result.output?.trim() || i18n._(linguiMsg`无法更新 ${input.label}。`));
      return false;
    }
    toast.success(
      input.latest
        ? i18n._(linguiMsg`${input.label} 已更新到 v${input.latest}。`)
        : i18n._(linguiMsg`${input.label} 已更新。`),
    );
    const refreshed = await readBridge().refreshAgentStatuses(currentWslDistros(), {
      agentKinds: [input.agentKind],
      envs: [envKind === "wsl" && distro ? { kind: "wsl", distro } : { kind: "native" }],
    });
    // Apply the merged full lists directly instead of waiting for the
    // agent-status-updated events — a version check that runs right after
    // this await (titlebar post-update re-check) must already see the new
    // installed version, or it re-lists the just-updated CLI and its badge
    // stays until the next check.
    if (refreshed && !refreshed.degraded) {
      const statusesStore = useAgentStatusesStore.getState();
      if (refreshed.windows) statusesStore.setAgentStatuses(refreshed.windows);
      if (refreshed.wsl) statusesStore.setWslAgentStatuses(refreshed.wsl);
    }
    // Drop the entry: a fresh check (titlebar auto/manual) re-adds it if the
    // update did not actually land.
    store.setAvailableCliUpdates(
      store.availableCliUpdates.filter((entry) => entry.key !== input.key),
    );
    return true;
  } catch (error) {
    toast.danger(
      error instanceof Error ? error.message : i18n._(linguiMsg`无法更新 ${input.label}。`),
    );
    return false;
  } finally {
    store.finishAgentUpdate(input.key);
  }
}
