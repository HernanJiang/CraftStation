import { describe, expect, it, vi } from "vitest";
import { notifyThreadBindingUnavailable, onThreadBindingUnavailable } from "./threadBindingChanges";

describe("threadBindingChanges", () => {
  it("notifies listeners and isolates listener failures", () => {
    const first = vi.fn<() => void>(() => {
      throw new Error("listener boom");
    });
    const second = vi.fn<(threadId: string) => void>();
    const stopFirst = onThreadBindingUnavailable(first);
    const stopSecond = onThreadBindingUnavailable(second);

    expect(() => notifyThreadBindingUnavailable("thread-1")).not.toThrow();
    expect(second).toHaveBeenCalledWith("thread-1");

    stopFirst();
    stopSecond();
    notifyThreadBindingUnavailable("thread-2");
    expect(second).toHaveBeenCalledTimes(1);
  });
});
