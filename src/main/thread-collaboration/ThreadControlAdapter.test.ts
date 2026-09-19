import { describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { ThreadControlAdapter } from "./ThreadControlAdapter";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "target-thread",
    projectId: "project-1",
    title: "Target",
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    status: "working",
    attention: "working",
    canResumeWithConfig: true,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

function makeAdapter(status: Thread["status"]) {
  const target = makeThread({ status, attention: status === "working" ? "working" : "none" });
  const project = {
    id: "project-1",
    name: "Project",
    location: { kind: "windows", path: "C:\\repo" },
  } as Project;
  const runtime = {
    getThreadSnapshots: vi.fn<() => Promise<[]>>().mockResolvedValue([]),
    startThread: vi
      .fn<(payload: unknown) => Promise<{ threadId: string }>>()
      .mockResolvedValue({ threadId: target.id }),
    sendThreadInput: vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined),
    interruptThread: vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined),
    closeThread: vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined),
  };
  const states = {
    getLiveState: vi.fn<() => { status: Thread["status"]; attention: Thread["attention"] }>(() => ({
      status,
      attention: target.attention,
    })),
    waitUntil: vi.fn<(ids: string[], timeout: number, poll: () => unknown) => Promise<unknown>>(
      async (_ids, _timeout, poll) => poll(),
    ),
  };
  const adapter = new ThreadControlAdapter({
    getThread: (id) => (id === target.id ? target : null),
    getThreads: () => [target],
    getProject: (id) => (id === project.id ? project : null),
    settings: () =>
      ({
        mcpServers: [],
        disabledBuiltInMcpServers: {},
        disabledBuiltInMcpTools: {},
      }) as never,
    runtime,
    states: states as never,
  });
  return { adapter, runtime, states };
}

describe("ThreadControlAdapter", () => {
  it("does not turn an ambiguous send failure into an interrupt or duplicate send", async () => {
    const { adapter, runtime } = makeAdapter("working");
    const error = new Error("connection lost after acceptance");
    runtime.sendThreadInput.mockRejectedValueOnce(error);
    await expect(adapter.deliverSettled("target-thread", "request")).rejects.toBe(error);
    expect(runtime.sendThreadInput).toHaveBeenCalledTimes(1);
    expect(runtime.interruptThread).not.toHaveBeenCalled();
    expect(runtime.startThread).not.toHaveBeenCalled();
  });
  it("injects a prompt into a working target instead of waiting in a queue", async () => {
    const { adapter, runtime } = makeAdapter("working");

    await expect(adapter.deliverSettled("target-thread", "request")).resolves.toEqual({
      kind: "delivered",
      resumed: false,
    });
    expect(runtime.sendThreadInput).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "target-thread", prompt: "request" }),
    );
    expect(runtime.interruptThread).not.toHaveBeenCalled();
  });

  it("injects a prompt into an attention target instead of failing closed", async () => {
    const { adapter, runtime } = makeAdapter("needs_approval");

    await expect(adapter.deliverSettled("target-thread", "request")).resolves.toEqual({
      kind: "delivered",
      resumed: false,
    });
    expect(runtime.sendThreadInput).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "target-thread", prompt: "request" }),
    );
  });

  it("delivers to an idle target through the adapter seam", async () => {
    const { adapter, runtime } = makeAdapter("idle");

    await expect(
      adapter.deliverSettled("target-thread", "request", "request-item"),
    ).resolves.toEqual({ kind: "delivered", resumed: false });
    expect(runtime.sendThreadInput).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "target-thread",
        prompt: "request",
        userMessageItemId: "request-item",
      }),
    );
  });

  it("resumes an inactive thread and preserves the request item anchor", async () => {
    const { adapter, runtime } = makeAdapter("inactive");
    runtime.sendThreadInput.mockRejectedValueOnce(
      new Error("Unknown thread session: target-thread"),
    );

    await expect(
      adapter.deliverSettled("target-thread", "request", "request-item"),
    ).resolves.toEqual({ kind: "delivered", resumed: true });
    expect(runtime.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "target-thread",
        prompt: "request",
        userMessageItemId: "request-item",
      }),
    );
  });

  it("fails a dead non-resumable thread without starting a replacement", async () => {
    const { adapter, runtime } = makeAdapter("inactive");
    const target = adapter.require("target-thread");
    target.canResumeWithConfig = false;
    runtime.sendThreadInput.mockRejectedValueOnce(
      new Error("Unknown thread session: target-thread"),
    );

    await expect(adapter.deliverSettled("target-thread", "request")).rejects.toMatchObject({
      code: "THREAD_NOT_RESUMABLE",
    });
    expect(runtime.startThread).not.toHaveBeenCalled();
  });

  it("does not report interrupt success until a settled target is observed", async () => {
    const { adapter, runtime, states } = makeAdapter("working");
    states.waitUntil.mockResolvedValueOnce(undefined);

    await expect(adapter.interruptAndWait("target-thread", 10)).rejects.toMatchObject({
      code: "THREAD_INTERRUPT_NOT_CONFIRMED",
    });
    expect(runtime.interruptThread).toHaveBeenCalledWith({ threadId: "target-thread" });
    expect(runtime.sendThreadInput).not.toHaveBeenCalled();
  });
});
