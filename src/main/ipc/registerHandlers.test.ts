import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipcProcedureMap } from "@/shared/ipc";
import type { AgentStatusesResponse } from "@/shared/contracts";

const ipcHandlers = vi.hoisted(
  () => new Map<string, (_event: unknown, ...args: unknown[]) => Promise<unknown>>(),
);

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
        ipcHandlers.set(channel, handler);
      },
    ),
  },
}));

import { registerIpcHandlers } from "./registerHandlers";

describe("registerIpcHandlers agent-status resilience", () => {
  beforeEach(() => {
    ipcHandlers.clear();
  });

  it("returns the last successful statuses when a refresh times out", async () => {
    const cached: AgentStatusesResponse = { windows: [], wsl: [], fromCache: false };
    const callSupervisor = vi
      .fn()
      .mockResolvedValueOnce(cached)
      .mockRejectedValueOnce(new Error('Supervisor request "refreshAgentStatuses" timed out.'));
    registerIpcHandlers({ localHandlers: {} as never, callSupervisor });

    const getStatuses = ipcHandlers.get(ipcProcedureMap.getAgentStatuses.channel);
    const refreshStatuses = ipcHandlers.get(ipcProcedureMap.refreshAgentStatuses.channel);
    if (!getStatuses || !refreshStatuses) throw new Error("missing agent-status IPC handlers");

    await expect(getStatuses(undefined, [])).resolves.toEqual(cached);
    await expect(refreshStatuses(undefined, [], { agentKinds: ["codex"] })).resolves.toEqual({
      ...cached,
      fromCache: true,
      degraded: {
        error: "TIMEOUT",
        operation: "refreshAgentStatuses",
        message: 'Supervisor request "refreshAgentStatuses" timed out.',
      },
    });
  });

  it("does not hide unrelated supervisor failures", async () => {
    const failure = new Error("Supervisor disconnected");
    registerIpcHandlers({
      localHandlers: {} as never,
      callSupervisor: vi.fn().mockRejectedValue(failure),
    });
    const refreshStatuses = ipcHandlers.get(ipcProcedureMap.refreshAgentStatuses.channel);
    if (!refreshStatuses) throw new Error("missing refresh IPC handler");

    await expect(refreshStatuses(undefined, [], { agentKinds: ["codex"] })).rejects.toBe(failure);
  });
});
