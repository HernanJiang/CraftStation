import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";

vi.mock("@/renderer/actions/threadRuntimeActions", () => ({
  setThreadPendingSteer: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  submitThreadInput: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@/renderer/actions/threadActions", () => ({
  registerNativeGoal: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
}));

vi.mock("@/renderer/analytics/posthog", () => ({
  captureThreadPromptSubmitted: vi.fn<() => void>(),
}));

import {
  clearQueuedFollowUp,
  enqueueThreadFollowUp,
  flushQueuedFollowUp,
  sendQueuedFollowUpNow,
  startQueuedFollowUpFlush,
} from "./queuedFollowUpActions";
import { setThreadPendingSteer, submitThreadInput } from "./threadRuntimeActions";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-q",
    projectId: "project-1",
    agentKind: "codex",
    title: "Thread",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    status: "working",
    config: { model: "gpt-5.3-codex" },
    presentationMode: "gui",
    ...overrides,
  } as Thread;
}

describe("queued follow-up actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      threads: [thread()],
      queuedFollowUpByThreadId: {},
    });
  });

  afterEach(() => {
    useAppStore.setState({ queuedFollowUpByThreadId: {} });
  });

  it("enqueues a follow-up without submitting", () => {
    enqueueThreadFollowUp("thread-q", "check later", [{ kind: "text", content: "check later" }]);
    expect(useAppStore.getState().queuedFollowUpByThreadId["thread-q"]).toMatchObject({
      prompt: "check later",
      paused: false,
    });
    expect(submitThreadInput).not.toHaveBeenCalled();
    expect(setThreadPendingSteer).not.toHaveBeenCalled();
  });

  it("Send now on a working thread steers immediately and clears the queue", async () => {
    enqueueThreadFollowUp("thread-q", "go now", [{ kind: "text", content: "go now" }]);
    await sendQueuedFollowUpNow(thread());
    expect(setThreadPendingSteer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "thread-q" }),
      "go now",
      [{ kind: "text", content: "go now" }],
    );
    expect(useAppStore.getState().queuedFollowUpByThreadId["thread-q"]).toBeUndefined();
  });

  it("restores the queued follow-up when the steer send fails", async () => {
    enqueueThreadFollowUp("thread-q", "go now", [{ kind: "text", content: "go now" }]);
    vi.mocked(setThreadPendingSteer).mockRejectedValueOnce(
      new Error('Supervisor request "setPendingSteer" timed out'),
    );
    await expect(sendQueuedFollowUpNow(thread())).rejects.toThrow("timed out");
    expect(useAppStore.getState().queuedFollowUpByThreadId["thread-q"]).toMatchObject({
      prompt: "go now",
    });
  });

  it("Send now on an idle thread submits as a normal follow-up", async () => {
    enqueueThreadFollowUp("thread-q", "after stop", undefined);
    await sendQueuedFollowUpNow(thread({ status: "idle" }));
    expect(submitThreadInput).toHaveBeenCalledWith("thread-q", "after stop", undefined, undefined);
    expect(setThreadPendingSteer).not.toHaveBeenCalled();
  });

  it("flushes when the in-flight turn settles unless the queue is paused", async () => {
    enqueueThreadFollowUp("thread-q", "after turn", [{ kind: "text", content: "after turn" }]);
    useAppStore.setState({ threads: [thread({ status: "idle" })] });
    await flushQueuedFollowUp("thread-q");
    expect(submitThreadInput).toHaveBeenCalledWith(
      "thread-q",
      "after turn",
      [{ kind: "text", content: "after turn" }],
      undefined,
    );
    expect(useAppStore.getState().queuedFollowUpByThreadId["thread-q"]).toBeUndefined();
  });

  it("does not auto-flush a paused queue", async () => {
    enqueueThreadFollowUp("thread-q", "held", undefined);
    useAppStore.getState().pauseQueuedFollowUp("thread-q");
    useAppStore.setState({ threads: [thread({ status: "idle" })] });
    await flushQueuedFollowUp("thread-q");
    expect(submitThreadInput).not.toHaveBeenCalled();
    expect(useAppStore.getState().queuedFollowUpByThreadId["thread-q"]?.paused).toBe(true);
  });

  it("auto-sends when a working thread becomes idle", async () => {
    const stop = startQueuedFollowUpFlush();
    enqueueThreadFollowUp("thread-q", "auto", [{ kind: "text", content: "auto" }]);
    useAppStore.setState({ threads: [thread({ status: "working" })] });
    useAppStore.setState({ threads: [thread({ status: "idle" })] });
    await vi.waitFor(() => {
      expect(submitThreadInput).toHaveBeenCalledWith(
        "thread-q",
        "auto",
        [{ kind: "text", content: "auto" }],
        undefined,
      );
    });
    stop();
  });

  it("leaves a paused queue in place when the turn is interrupted", async () => {
    const stop = startQueuedFollowUpFlush();
    enqueueThreadFollowUp("thread-q", "held", undefined);
    useAppStore.getState().pauseQueuedFollowUp("thread-q");
    useAppStore.setState({ threads: [thread({ status: "working" })] });
    useAppStore.setState({ threads: [thread({ status: "idle" })] });
    await Promise.resolve();
    expect(submitThreadInput).not.toHaveBeenCalled();
    expect(useAppStore.getState().queuedFollowUpByThreadId["thread-q"]?.prompt).toBe("held");
    stop();
  });

  it("clearQueuedFollowUp drops the slot", () => {
    enqueueThreadFollowUp("thread-q", "later", undefined);
    clearQueuedFollowUp("thread-q");
    expect(useAppStore.getState().queuedFollowUpByThreadId["thread-q"]).toBeUndefined();
  });
});
