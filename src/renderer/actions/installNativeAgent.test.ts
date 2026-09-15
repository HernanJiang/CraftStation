import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({
  refreshAgentStatuses: vi.fn<() => Promise<unknown>>(),
}));

const installRunner = vi.hoisted(() => ({
  runAgentInstallCommand:
    vi.fn<(input: { onCommandComplete?: (exitCode: number) => void }) => boolean>(),
}));

vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@heroui/react")>();
  return {
    ...actual,
    toast: {
      ...actual.toast,
      danger: vi.fn<(...args: unknown[]) => void>(),
      success: vi.fn<(...args: unknown[]) => void>(),
      warning: vi.fn<(...args: unknown[]) => void>(),
      info: vi.fn<(...args: unknown[]) => void>(),
    },
  };
});

vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridgeMock }));

vi.mock("@/renderer/actions/agentLoginActions", () => ({
  runAgentInstallCommand: installRunner.runAgentInstallCommand,
}));

import { toast } from "@heroui/react";
import { runNativeAgentInstall } from "./installNativeAgent";

describe("runNativeAgentInstall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMock.refreshAgentStatuses.mockResolvedValue({});
  });

  it("refuses kinds outside the Native Agent Registry instead of guessing an installer", () => {
    const onComplete = vi.fn<(ok: boolean) => void>();
    const opened = runNativeAgentInstall({
      agentKind: "not-a-real-cli",
      label: "Not Real",
      onComplete,
    });

    expect(opened).toBe(false);
    expect(installRunner.runAgentInstallCommand).not.toHaveBeenCalled();
    expect(toast.danger).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it("runs the registry install command for Antigravity (agy) and refreshes detection on success", async () => {
    const onComplete = vi.fn<(ok: boolean) => void>();
    installRunner.runAgentInstallCommand.mockImplementation(
      (input: { onCommandComplete?: (exitCode: number) => void }) => {
        input.onCommandComplete?.(0);
        return true;
      },
    );

    const opened = runNativeAgentInstall({
      agentKind: "antigravity",
      label: "Antigravity",
      onComplete,
    });

    expect(opened).toBe(true);
    expect(installRunner.runAgentInstallCommand).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Antigravity", purpose: "install" }),
    );
    await vi.waitFor(() => {
      expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalledWith(expect.anything(), {
        agentKinds: ["antigravity"],
      });
      expect(onComplete).toHaveBeenCalledWith(true);
    });
  });

  it("surfaces a real error and skips the refresh when the installer exits non-zero", () => {
    const onComplete = vi.fn<(ok: boolean) => void>();
    installRunner.runAgentInstallCommand.mockImplementation(
      (input: { onCommandComplete?: (exitCode: number) => void }) => {
        input.onCommandComplete?.(3);
        return true;
      },
    );

    runNativeAgentInstall({ agentKind: "antigravity", label: "Antigravity", onComplete });

    expect(toast.danger).toHaveBeenCalledWith(expect.stringContaining("3"));
    expect(bridgeMock.refreshAgentStatuses).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it("reports a failed post-install detection refresh instead of faking success", async () => {
    const onComplete = vi.fn<(ok: boolean) => void>();
    installRunner.runAgentInstallCommand.mockImplementation(
      (input: { onCommandComplete?: (exitCode: number) => void }) => {
        input.onCommandComplete?.(0);
        return true;
      },
    );
    bridgeMock.refreshAgentStatuses.mockRejectedValue(new Error("supervisor gone"));

    runNativeAgentInstall({ agentKind: "antigravity", label: "Antigravity", onComplete });

    await vi.waitFor(() => {
      expect(toast.danger).toHaveBeenCalledWith("supervisor gone");
      expect(onComplete).toHaveBeenCalledWith(false);
    });
  });
});
