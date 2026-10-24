import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentStatus, AgentStatusesResponse } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useModelCatalogRefresh } from "@/renderer/hooks/useModelCatalogRefresh";
import { MODEL_CATALOG_REFRESH_MS, refreshModelCatalog } from "./modelCatalogRefresh";

const bridge = vi.hoisted(() => ({
  refreshAgentStatuses:
    vi.fn<(distros: string[], scope: { agentKinds: string[] }) => Promise<AgentStatusesResponse>>(),
}));
vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridge }));
vi.mock("@/renderer/utils/acpRegistryAuth", () => ({ currentWslDistros: () => [] }));
let count = 0;
let kind: string;
function status(id: string, label = id): AgentStatus {
  return {
    kind,
    label: kind,
    installed: true,
    authState: "authenticated",
    envKind: "windows",
    capabilities: {
      models: [{ id, label }],
      efforts: [],
      modelEfforts: {},
      modes: [],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "server",
      presentationMode: "gui",
      settingDefs: [],
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  kind = `catalog-test-${++count}`;
  bridge.refreshAgentStatuses.mockReset();
  useAgentStatusesStore.setState({
    agentStatuses: [status("stable", "Old name")],
    wslAgentStatuses: [],
  });
  useSharedSettings.setState({ disabledAgents: [], hiddenModels: { [kind]: ["stable"] } });
});
afterEach(() => vi.useRealTimers());

it("updates renamed and new models automatically without changing visibility choices", async () => {
  const fresh = status("stable", "Updated upstream name");
  fresh.capabilities.models.push({ id: "future", label: "Future model" });
  bridge.refreshAgentStatuses.mockResolvedValue({ windows: [fresh], wsl: [], fromCache: false });
  const { unmount } = renderHook(() => useModelCatalogRefresh(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MODEL_CATALOG_REFRESH_MS);
  });
  expect(useAgentStatusesStore.getState().agentStatuses[0]?.capabilities.models).toEqual(
    fresh.capabilities.models,
  );
  expect(useSharedSettings.getState().hiddenModels[kind]).toEqual(["stable"]);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(bridge.refreshAgentStatuses).toHaveBeenCalledTimes(1);
  unmount();
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_REFRESH_MS);
  expect(bridge.refreshAgentStatuses).toHaveBeenCalledTimes(1);
});

it("coalesces simultaneous refreshes and retains the last catalog after failure", async () => {
  let reject!: (error: Error) => void;
  bridge.refreshAgentStatuses.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const first = refreshModelCatalog(kind, true);
  const second = refreshModelCatalog(kind, true);
  expect(second).toBe(first);
  reject(new Error("offline"));
  await expect(first).rejects.toThrow("offline");
  expect(useAgentStatusesStore.getState().agentStatuses[0]?.capabilities.models[0]?.label).toBe(
    "Old name",
  );
  bridge.refreshAgentStatuses.mockResolvedValue({
    windows: [status("new")],
    wsl: [],
    fromCache: false,
  });
  await refreshModelCatalog(kind, true);
  expect(bridge.refreshAgentStatuses).toHaveBeenCalledTimes(2);
});
