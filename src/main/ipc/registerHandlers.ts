import { ipcMain } from "electron";
import type { AgentStatusesResponse } from "@/shared/contracts";
import {
  ipcProcedureMap,
  parseIpcProcedureArgs,
  type IpcProcedureName,
  type IpcProcedurePayload,
  type IpcProcedureResult,
  type MainLocalIpcHandlerMap,
  type SupervisorProcedureName,
} from "@/shared/ipc";

interface RegisterIpcHandlersOptions {
  localHandlers: MainLocalIpcHandlerMap;
  callSupervisor<Name extends SupervisorProcedureName>(
    name: Name,
    payload: IpcProcedurePayload<Name>,
  ): Promise<IpcProcedureResult<Name>>;
}

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): void {
  let lastAgentStatuses: AgentStatusesResponse | undefined;
  const procedureNames = Object.keys(ipcProcedureMap) as IpcProcedureName[];
  for (const name of procedureNames) {
    const procedure = ipcProcedureMap[name];
    ipcMain.handle(procedure.channel, async (_event, ...args: unknown[]) => {
      const payload = parseIpcProcedureArgs(name, args);
      if (procedure.transport === "main-local") {
        const handler = options.localHandlers[name as keyof MainLocalIpcHandlerMap] as (
          payload: unknown,
        ) => unknown;
        return handler(payload);
      }
      try {
        const result = await options.callSupervisor(
          name as SupervisorProcedureName,
          payload as never,
        );
        if (name === "getAgentStatuses" || name === "refreshAgentStatuses") {
          lastAgentStatuses = result as AgentStatusesResponse;
        }
        return result;
      } catch (error) {
        if (name !== "refreshAgentStatuses" || !isRefreshAgentStatusesTimeout(error)) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[ipc] refreshAgentStatuses timed out; returning last known statuses", error);
        return {
          ...(lastAgentStatuses ?? { windows: [], wsl: [] }),
          fromCache: true,
          degraded: {
            error: "TIMEOUT",
            operation: "refreshAgentStatuses",
            message,
          },
        } satisfies AgentStatusesResponse;
      }
    });
  }
}

function isRefreshAgentStatusesTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Supervisor request ["']refreshAgentStatuses["'] timed out\.?/i.test(message);
}
