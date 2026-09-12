import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAdapter } from "@/supervisor/agents/base";
import type { ResolvedSpawnAttempt } from "./spawnPlan";
import {
  STRUCTURED_ATTEMPT_MAX_LIFETIME_MS,
  SubagentAttemptRunner,
  type AttemptExecutionState,
} from "./SubagentAttemptRunner";
import type { SubagentRunHost, SubagentRunStatus } from "./types";

function makeHost(): SubagentRunHost {
  return {
    appendRuntimeEvent: () => {},
  } as unknown as SubagentRunHost;
}

function makeState(): AttemptExecutionState {
  return {
    parentThreadId: "parent-1",
    childThreadId: "child-1",
    label: "probe-agent",
    plan: {
      prompt: "do it",
      projectLocation: { kind: "windows", path: "C:\\repo" },
      background: false,
      retryMode: "startup",
      attempts: [],
    },
    handle: undefined,
    oneShot: undefined,
    cancelRequested: false,
    turnStarted: false,
    turnDispatched: false,
  };
}

function makeStructuredAdapter(handle: {
  dispose: () => Promise<void>;
  startTurn: () => Promise<void>;
}): AgentAdapter {
  return {
    kind: "codex",
    label: "Codex",
    createStructuredSession: vi.fn<() => Promise<unknown>>(async () => ({
      setListener: () => {},
      openThread: async () => undefined,
      startTurn: handle.startTurn,
      interruptTurn: async () => undefined,
      dispose: handle.dispose,
    })),
  } as unknown as AgentAdapter;
}

function makeAttempt(adapter: AgentAdapter): ResolvedSpawnAttempt {
  return {
    adapter,
    config: { model: "m" },
    provider: "codex",
    model: "m",
    label: "probe-agent",
  } as unknown as ResolvedSpawnAttempt;
}

describe("SubagentAttemptRunner lifetime ceiling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails a never-settling structured attempt closed after the ceiling", async () => {
    const dispose = vi.fn<() => Promise<void>>(async () => undefined);
    const adapter = makeStructuredAdapter({
      dispose,
      startTurn: () => new Promise<void>(() => {}),
    });
    const runner = new SubagentAttemptRunner(makeHost());
    const state = makeState();
    const settled: Array<{ status: string; message?: string }> = [];

    runner.run(
      state,
      0,
      makeAttempt(adapter),
      {
        isActive: () => true,
        onRuntimeEvent: () => {},
        onSettle: (status: Exclude<SubagentRunStatus, "running">, message?: string) => {
          settled.push({ status, ...(message ? { message } : {}) });
        },
      },
      { maxLifetimeMs: 60_000 },
    );

    await vi.advanceTimersByTimeAsync(59_999);
    expect(settled).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveLength(1);
    expect(settled[0]!.status).toBe("failed");
    expect(settled[0]!.message).toMatch(/timed out/);
    expect(settled[0]!.message).toMatch(/probe-agent/);
    expect(dispose).toHaveBeenCalled();
    expect(state.attemptTimeout).toBeUndefined();
  });

  it("does not fire when the attempt settles first", async () => {
    let resolveTurn!: () => void;
    const turn = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });
    const adapter = makeStructuredAdapter({
      dispose: vi.fn<() => Promise<void>>(async () => undefined),
      startTurn: () => turn,
    });
    const runner = new SubagentAttemptRunner(makeHost());
    const state = makeState();
    const settled: string[] = [];

    runner.run(
      state,
      0,
      makeAttempt(adapter),
      {
        isActive: () => true,
        onRuntimeEvent: () => {},
        onSettle: (status) => {
          settled.push(status);
        },
      },
      { maxLifetimeMs: 60_000 },
    );
    // Run the async startTurn to completion is impossible here (it hangs by
    // design); settle is driven by the attempt itself in production. Simulate
    // an early settle by tearing down (which clears the timer) — then verify
    // the ceiling never fires afterwards.
    resolveTurn();
    await runner.teardown(state);
    await vi.advanceTimersByTimeAsync(360_000);
    expect(settled).toEqual([]);
    expect(state.attemptTimeout).toBeUndefined();
  });

  it("exposes the documented 20-minute default ceiling", () => {
    expect(STRUCTURED_ATTEMPT_MAX_LIFETIME_MS).toBe(20 * 60 * 1000);
  });
});
