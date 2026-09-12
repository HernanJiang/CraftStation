import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn<(message: unknown, options?: unknown) => string>());

vi.mock("@heroui/react", () => ({ toast }));

import { showTopStatusToast } from "./topStatusToast";

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
});
