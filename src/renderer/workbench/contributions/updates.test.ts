import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@heroui/react";
import { useUpdateStore } from "@/renderer/state/updateStore";
import { handleUpdateStatus } from "./updates";

vi.mock("@heroui/react", () => ({
  toast: {
    danger: vi.fn<(message: string) => void>(),
    success: vi.fn<(message: string) => void>(),
    warning: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
  },
}));

describe("handleUpdateStatus", () => {
  beforeEach(() => {
    vi.mocked(toast.danger).mockClear();
    useUpdateStore.setState({
      phase: "idle",
      version: null,
      downloadPercent: 0,
      errorMessage: null,
      downloadTransferred: null,
      downloadTotal: null,
      downloadBytesPerSecond: null,
      agentUpdates: {},
    });
  });

  it("toasts user-initiated update failures", () => {
    handleUpdateStatus({ type: "error", messageKey: "update.operationFailed" });

    expect(useUpdateStore.getState().phase).toBe("error");
    expect(toast.danger).toHaveBeenCalledOnce();
    expect(String(vi.mocked(toast.danger).mock.calls[0]?.[0])).toContain("Update error");
  });

  it("does not toast background probe failures", () => {
    handleUpdateStatus({
      type: "error",
      messageKey: "update.operationFailed",
      notify: false,
    });

    expect(useUpdateStore.getState().phase).toBe("error");
    expect(toast.danger).not.toHaveBeenCalled();
  });
});
