import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn<(message: unknown, options?: unknown) => string>());

vi.mock("@heroui/react", () => ({ toast }));

import { poolFailoverToastCopy, showTopStatusToast, turnRetryToastCopy } from "./topStatusToast";

describe("showTopStatusToast", () => {
  beforeEach(() => {
    toast.mockClear();
    toast.mockReturnValue("toast-1");
  });

  it("posts status notices to the shared top-start queue with the task-toast style", () => {
    const key = showTopStatusToast("已切换至 gemini-3.8-flash");

    expect(key).toBe("toast-1");
    expect(toast).toHaveBeenCalledWith("已切换至 gemini-3.8-flash", {
      variant: "default",
      timeout: 3000,
    });
  });

  it("forwards descriptions and custom timeouts", () => {
    showTopStatusToast("配额已耗尽", { description: "detail", timeout: 8000 });

    expect(toast).toHaveBeenCalledWith("配额已耗尽", {
      description: "detail",
      variant: "default",
      timeout: 8000,
    });
  });

  it("formats pool-failover notices in readable Chinese", () => {
    expect(poolFailoverToastCopy("Grok", "a@x.com", "b@y.com")).toEqual({
      title: "Grok账号a@x.com额度已耗尽",
      description: "已切换到b@y.com继续作答",
    });
  });

  it("formats Craft-Harness retry notices with attempt, interval and reason", () => {
    expect(turnRetryToastCopy(1, 2, 5, "ECONNRESET")).toEqual({
      title: "网络/连接中断，5 秒后自动重试（第 1/2 次）",
      description: "ECONNRESET",
    });
  });
});
