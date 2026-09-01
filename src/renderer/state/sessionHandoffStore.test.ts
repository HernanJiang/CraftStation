import { beforeEach, describe, expect, it } from "vitest";
import type { SessionSwitchState } from "@/shared/sessionHandoff";
import { getRuntimeExecutionEnvelope, useSessionHandoffStore } from "./sessionHandoffStore";

function switchState(overrides: Partial<SessionSwitchState> = {}): SessionSwitchState {
  return {
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
    ...overrides,
  };
}

function activeSegment(overrides: Record<string, unknown> = {}) {
  return {
    id: "segment-2",
    threadId: "thread-1",
    ordinal: 1,
    bindingEpoch: 2,
    status: "active" as const,
    craftPlanId: "plan-1",
    recipeId: "recipe-1",
    resultItemId: "result-1",
    runtimeBinding: {
      harnessKind: "grok",
      modelId: "grok-4.6",
      vendor: "xai",
      runtimeAdapterId: "native-harness:grok",
    },
    entityId: "entity-1",
    runtimeSessionId: "runtime-grok",
    createdAt: "2026-08-31T00:00:01.000Z",
    activatedAt: "2026-08-31T00:00:02.000Z",
    ...overrides,
  };
}

describe("getRuntimeExecutionEnvelope", () => {
  beforeEach(() => {
    useSessionHandoffStore.setState({ statesByThread: {} });
  });

  it("returns the supervisor-published envelope for an active crafted segment", () => {
    useSessionHandoffStore
      .getState()
      .setState("thread-1", switchState({ phase: "active", activeSegment: activeSegment() }));

    expect(getRuntimeExecutionEnvelope("thread-1")).toEqual({
      segmentId: "segment-2",
      runtimeSessionId: "runtime-grok",
      bindingEpoch: 2,
    });
  });

  it("returns undefined while a switch is only queued", () => {
    useSessionHandoffStore.getState().setState("thread-1", switchState());
    expect(getRuntimeExecutionEnvelope("thread-1")).toBeUndefined();
  });

  it("returns undefined when the active segment is missing or not runtime-bound", () => {
    useSessionHandoffStore
      .getState()
      .setState("thread-1", switchState({ phase: "active", activeSegment: undefined }));
    useSessionHandoffStore.getState().setState(
      "thread-2",
      switchState({
        phase: "active",
        activeSegment: activeSegment({ runtimeSessionId: undefined }),
      }),
    );

    expect(getRuntimeExecutionEnvelope("thread-1")).toBeUndefined();
    expect(getRuntimeExecutionEnvelope("thread-2")).toBeUndefined();
  });

  it("returns undefined for unknown (legacy) threads instead of a derived guess", () => {
    expect(getRuntimeExecutionEnvelope("legacy-thread")).toBeUndefined();
  });
});
