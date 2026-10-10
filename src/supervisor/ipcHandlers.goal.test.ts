// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createSupervisorIpcHandlers } from "./ipcHandlers";
import type { SupervisorRuntime } from "./supervisorRuntime";

it("routes goal controls through Craft-Harness for both crafted and CLI sessions", async () => {
  const control = vi.fn<() => Promise<void>>(async () => undefined);
  const legacyControl = vi.fn<() => Promise<void>>(async () => {
    throw new Error("Unknown thread session: native-goal");
  });
  const handlers = createSupervisorIpcHandlers({
    controlThreadGoal: control,
    threadSessionManager: { controlThreadGoal: legacyControl },
  } as unknown as SupervisorRuntime);
  const payload = { threadId: "native-goal", action: "resume" as const };
  await handlers.controlThreadGoal(payload);
  expect(control).toHaveBeenCalledWith(payload);
  expect(legacyControl).not.toHaveBeenCalled();
});
