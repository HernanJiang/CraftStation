import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import type { SessionSwitchState } from "@/shared/sessionHandoff";
import { useAppStore } from "@/renderer/state/appStore";
import { useSessionHandoffStore } from "@/renderer/state/sessionHandoffStore";
import {
  clearThreadPendingSteer,
  resolveThreadServerRequest,
  setThreadPendingSteer,
  submitThreadInput,
} from "./threadRuntimeActions";

const bridge = vi.hoisted(() => ({
  sendThreadInput: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  resolveThreadServerRequest: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  clearPendingSteer: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  setPendingSteer: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridge }));

// Keep analytics (posthog/product telemetry) inert — the assertions target the
// supervisor-bound payloads, not telemetry side effects.
vi.mock("@/renderer/analytics/posthog", () => ({
  captureThreadPromptSubmitted: vi.fn<(...args: unknown[]) => void>(),
  threadProductProperties: vi.fn<(...args: unknown[]) => Record<string, unknown>>(() => ({})),
}));
vi.mock("@/renderer/analytics/productAnalytics", () => ({
  captureProductEvent: vi.fn<(...args: unknown[]) => void>(),
}));

const ENVELOPE = {
  segmentId: "segment:thread-1:1",
  runtimeSessionId: "runtime-codex",
  bindingEpoch: 1,
};

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Crafted",
    agentKind: "codex",
    config: { model: "gpt-5.3-codex" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    presentationMode: "terminal",
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

function project(): Project {
  return {
    id: "project-1",
    name: "Repo",
    location: { kind: "windows", path: "D:\\repo" },
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}

function seedActiveBinding(): void {
  const state: SessionSwitchState = {
    requestId: "segment:segment:thread-1:1",
    threadId: "thread-1",
    mode: "after-current-turn",
    phase: "active",
    sourceSegmentId: ENVELOPE.segmentId,
    targetBinding: {
      harnessKind: "codex",
      modelId: "gpt-5.3-codex",
      vendor: "openai",
      runtimeAdapterId: "codex-runtime",
    },
    activeSegment: {
      id: ENVELOPE.segmentId,
      threadId: "thread-1",
      ordinal: 0,
      bindingEpoch: ENVELOPE.bindingEpoch,
      status: "active",
      craftPlanId: "plan-1",
      recipeId: "recipe-1",
      resultItemId: "result-1",
      runtimeBinding: {
        harnessKind: "codex",
        modelId: "gpt-5.3-codex",
        vendor: "openai",
        runtimeAdapterId: "codex-runtime",
      },
      entityId: "entity-1",
      runtimeSessionId: ENVELOPE.runtimeSessionId,
      createdAt: "2026-08-31T00:00:01.000Z",
      activatedAt: "2026-08-31T00:00:02.000Z",
    },
    requestedAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
  useSessionHandoffStore.getState().setState("thread-1", state);
}

describe("crafted active commands carry the runtime execution envelope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.sendThreadInput.mockResolvedValue(undefined);
    bridge.resolveThreadServerRequest.mockResolvedValue(undefined);
    bridge.clearPendingSteer.mockResolvedValue(undefined);
    bridge.setPendingSteer.mockResolvedValue(undefined);
    useSessionHandoffStore.setState({ statesByThread: {} });
    useAppStore.setState({ threads: [thread()], projects: [project()] });
  });

  it("attaches the current envelope when submitting a prompt to a crafted thread", async () => {
    seedActiveBinding();
    await submitThreadInput("thread-1", "hello");
    expect(bridge.sendThreadInput).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", prompt: "hello", execution: ENVELOPE }),
    );
  });

  it("keeps legacy prompt submission envelope-free", async () => {
    await submitThreadInput("thread-1", "hello");
    const payload = bridge.sendThreadInput.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ threadId: "thread-1", prompt: "hello" });
    expect("execution" in payload && payload.execution !== undefined).toBe(false);
  });

  it("attaches the envelope when resolving a server request", async () => {
    seedActiveBinding();
    await resolveThreadServerRequest("thread-1", {
      requestId: "req-1",
      method: "requestPermission",
      response: { optionId: "allow" },
    });
    expect(bridge.resolveThreadServerRequest).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", requestId: "req-1", execution: ENVELOPE }),
    );
  });

  it("attaches the envelope when setting and clearing a pending steer", async () => {
    seedActiveBinding();
    await setThreadPendingSteer(thread(), "steer!", undefined);
    clearThreadPendingSteer("thread-1");
    await vi.waitFor(() => expect(bridge.clearPendingSteer).toHaveBeenCalledTimes(1));
    expect(bridge.setPendingSteer).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", prompt: "steer!", execution: ENVELOPE }),
    );
    expect(bridge.clearPendingSteer).toHaveBeenCalledWith({
      threadId: "thread-1",
      execution: ENVELOPE,
    });
  });

  it("never invents an envelope when the binding is missing or queued", () => {
    useSessionHandoffStore.getState().setState("thread-1", {
      requestId: "switch-1",
      threadId: "thread-1",
      mode: "after-current-turn",
      phase: "queued",
      sourceSegmentId: "segment-1",
      targetBinding: {
        harnessKind: "codex",
        modelId: "gpt-5.3-codex",
        vendor: "openai",
        runtimeAdapterId: "codex-runtime",
      },
      requestedAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    });
    clearThreadPendingSteer("thread-1");
    expect(bridge.clearPendingSteer).toHaveBeenCalledWith({ threadId: "thread-1" });
  });
});
