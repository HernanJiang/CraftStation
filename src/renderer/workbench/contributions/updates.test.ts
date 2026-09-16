import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@heroui/react";
import { useUpdateStore } from "@/renderer/state/updateStore";
import { handleUpdateStatus } from "./updates";

const openExternal = vi.fn<(url: string) => Promise<void>>();

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({ openExternal }),
}));

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
    vi.mocked(toast.info).mockClear();
    openExternal.mockReset();
    useUpdateStore.setState({
      phase: "idle",
      version: null,
      downloadPercent: 0,
      errorMessage: null,
      downloadTransferred: null,
      downloadTotal: null,
      downloadBytesPerSecond: null,
      manualDownloadUrl: null,
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

  it("surfaces a portable update as a GitHub download instead of auto-installing", () => {
    handleUpdateStatus({
      type: "update-available",
      version: "1.2.6",
      manualDownloadUrl: "https://github.com/HernanJiang/CraftStation/releases",
      openDownload: true,
    });

    expect(useUpdateStore.getState().phase).toBe("available-manual");
    expect(useUpdateStore.getState().version).toBe("1.2.6");
    expect(useUpdateStore.getState().manualDownloadUrl).toBe(
      "https://github.com/HernanJiang/CraftStation/releases",
    );
    expect(toast.info).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/HernanJiang/CraftStation/releases",
    );
  });
});
