// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupervisorEvent } from "@/shared/ipc";
import { isCraftRetryable, runWithCraftRetry } from "./turnRetry";
import { explainNativeNetworkError } from "../../agents/nativeNetworkError";

describe("Craft-Harness turn retry", () => {
  it("recognizes the actionable network error emitted by the real native runtime", () => {
    const message = explainNativeNetworkError(
      "Error running remote compact task: Connection failed: error sending request",
      "Codex",
    )!;
    expect(isCraftRetryable(new Error(message))).toBe(true);
  });
  it("retries the screenshot's remote-compaction failure with a bounded attempt count", async () => {
    const run = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(
        new Error("Error running remote compact task: Connection failed: error sending request"),
      )
      .mockResolvedValue("continued");
    const emit = vi.fn<(event: SupervisorEvent) => void>();
    const wait = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const result = await runWithCraftRetry({
      threadId: "t",
      policy: () => ({ maxAttempts: 2, intervalMs: 5000 }),
      isCurrent: () => true,
      emit,
      run,
      sleep: wait,
    });
    expect(result).toBe("continued");
    expect(run.mock.calls.map(([a]) => a)).toEqual([0, 1]);
    expect(wait).toHaveBeenCalledWith(5000);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "thread-turn-retry", attempt: 1 }),
    );
  });
  it("stops at the configured cap and preserves the original error", async () => {
    const error = new Error("Connection failed: error sending request");
    const run = vi.fn<() => Promise<void>>(async () => {
      throw error;
    });
    await expect(
      runWithCraftRetry({
        threadId: "t",
        policy: () => ({ maxAttempts: 2, intervalMs: 0 }),
        isCurrent: () => true,
        emit: () => {},
        run,
        sleep: async () => {},
      }),
    ).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it.each([
    "401 unauthorized",
    "402 Payment Required",
    "quota exhausted",
    "usage limit exceeded",
    "invalid API key",
    "HTTP 400 invalid model",
  ])("does not retry %s", (message) => {
    expect(isCraftRetryable(new Error(message))).toBe(false);
  });
  it("does not restart after Stop during the retry interval", async () => {
    let current = true;
    const run = vi.fn<() => Promise<void>>(async () => {
      throw new Error("Connection failed: error sending request");
    });
    const result = await runWithCraftRetry({
      threadId: "t",
      policy: () => ({ maxAttempts: 3, intervalMs: 5 }),
      isCurrent: () => current,
      emit: () => {},
      run,
      sleep: async () => {
        current = false;
      },
    });
    expect(result).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
