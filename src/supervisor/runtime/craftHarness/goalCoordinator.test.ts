// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent, UsageSpent } from "@/shared/contracts";
import { GoalCoordinator, type GoalRuntimeSnapshot } from "./goalCoordinator";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "craft-goal-"));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const runtime: GoalRuntimeSnapshot = {
    identity: "runtime-1",
    idle: true,
    planMode: false,
    pendingInput: false,
    supportsContinuation: true,
  };
  const proceed = vi.fn<() => Promise<void>>(async () => undefined);
  const emit = vi.fn<(event: import("@/shared/ipc").SupervisorEvent) => void>();
  const options = {
    path: join(dir, "goals.json"),
    emit,
    snapshot: () => runtime,
    continueGoal: proceed,
  };
  const goals = new GoalCoordinator(options);
  const event = (e: RuntimeEvent) =>
    goals.observe({ type: "thread-runtime-event", threadId: "thread", event: e });
  const start = (turnId = "turn-1") => {
    runtime.idle = false;
    event({ type: "turn.started", threadId: "thread", turnId });
  };
  const finish = (
    turnId = "turn-1",
    state: "completed" | "failed" | "interrupted" = "completed",
  ) => {
    runtime.idle = true;
    event({ type: "turn.completed", threadId: "thread", turnId, state });
    goals.observe({
      type: "thread-state",
      threadId: "thread",
      status: "idle",
      attention: "none",
      canResumeWithConfig: true,
    });
  };
  return { goals, options, proceed, emit, runtime, event, start, finish };
}
function usage(counter: number, patch: Partial<UsageSpent> = {}): RuntimeEvent {
  return {
    type: "usage.spent",
    threadId: "thread",
    usage: {
      counterKind: "cumulative",
      counter,
      scopeId: "native-1",
      epoch: 0,
      sampleId: `${counter}`,
      ...patch,
    },
  };
}
describe("Craft-Harness goal", () => {
  it.each(["complete", "paused", "budget_limited", "failed"] as const)(
    "imports a pre-upgrade %s goal without resetting its usage or continuing",
    async (status) => {
      const f = fixture();
      f.goals.control("thread", {
        action: "edit",
        objective: "old goal",
        reassert: true,
        checkpoint: {
          objective: "old goal",
          status,
          tokenBudget: 100,
          tokensUsed: 100,
          timeUsedSeconds: 30,
          iterations: 3,
        },
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(f.proceed).not.toHaveBeenCalled();
      expect(f.goals.get("thread")).toMatchObject({
        status: status === "failed" ? "blocked" : status,
        tokenBudget: 100,
        tokensUsed: 100,
        timeUsedSeconds: 30,
        iterations: 3,
      });
      expect(new GoalCoordinator(f.options).get("thread")?.status).toBe(
        status === "failed" ? "blocked" : status,
      );
      f.goals.dispose();
    },
  );
  it("ignores checkpoints for different objectives and when durable state already exists", () => {
    const f = fixture();
    const checkpoint = { objective: "another goal", status: "complete" as const, tokensUsed: 100 };
    f.goals.control("thread", {
      action: "edit",
      objective: "new goal",
      reassert: true,
      checkpoint,
    });
    expect(f.goals.get("thread")).toMatchObject({ status: "active", tokensUsed: 0 });
    f.goals.control("thread", {
      action: "edit",
      objective: "new goal",
      reassert: true,
      checkpoint: { ...checkpoint, objective: "new goal" },
    });
    expect(f.goals.get("thread")).toMatchObject({ status: "active", tokensUsed: 0 });
    f.goals.dispose();
  });
  it("preserves resume for a legacy quota stop that still has token budget remaining", async () => {
    const f = fixture();
    f.goals.control("thread", {
      action: "edit",
      objective: "goal",
      reassert: true,
      checkpoint: {
        objective: "goal",
        status: "budget_limited",
        tokenBudget: 200,
        tokensUsed: 100,
      },
    });
    expect(f.goals.get("thread")?.status).toBe("usage_limited");
    f.goals.control("thread", { action: "resume" });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.proceed).toHaveBeenCalledTimes(1);
    f.goals.dispose();
  });
  it("persists and automatically continues after an ordinary turn without declaring completion", async () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "修复并验证完整目标" });
    f.start();
    f.finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.proceed).toHaveBeenCalledTimes(1);
    expect(f.goals.get("thread")?.status).toBe("active");
    const restored = new GoalCoordinator(f.options);
    expect(restored.get("thread")?.objective).toBe("修复并验证完整目标");
    f.goals.dispose();
    restored.dispose();
  });
  it.each(["planMode", "pendingInput"] as const)(
    "does not continue when %s is present",
    async (key) => {
      const f = fixture();
      f.goals.control("thread", { action: "edit", objective: "goal" });
      f.runtime[key] = true;
      f.start();
      f.finish();
      await vi.advanceTimersByTimeAsync(100);
      expect(f.proceed).not.toHaveBeenCalled();
      f.goals.dispose();
    },
  );
  it("checks queued input and pending approvals again at dispatch", async () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "goal" });
    f.start();
    f.event({
      type: "request.opened",
      threadId: "thread",
      requestId: "permission",
      requestType: "tool_user_input",
      payload: { summary: "确认输入" },
    });
    f.finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.proceed).not.toHaveBeenCalled();
    f.goals.dispose();
  });
  it("keeps paused goals stopped across re-registration and reload", async () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "goal" });
    f.goals.control("thread", { action: "pause" });
    f.goals.control("thread", { action: "edit", objective: "goal", reassert: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.proceed).not.toHaveBeenCalled();
    expect(new GoalCoordinator(f.options).get("thread")?.status).toBe("paused");
    f.goals.control("thread", { action: "resume" });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.proceed).toHaveBeenCalledTimes(1);
    f.goals.dispose();
  });
  it("requires an explicit evidence report and never revives a completed goal on reassert", async () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "goal" });
    f.start();
    expect(() => f.goals.update("thread", "complete", " ")).toThrow("GOAL_EVIDENCE_REQUIRED");
    f.goals.update("thread", "complete", "产物已生成，完整验收测试通过");
    f.goals.control("thread", { action: "edit", objective: "goal", reassert: true });
    f.finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.proceed).not.toHaveBeenCalled();
    expect(f.goals.get("thread")?.status).toBe("complete");
    f.goals.dispose();
  });
  it("suppresses another continuation when an automatic turn made no tool call", async () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "goal" });
    await vi.advanceTimersByTimeAsync(100);
    f.start();
    f.finish();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.proceed).toHaveBeenCalledTimes(1);
    expect(f.goals.get("thread")?.deferred).toBe(true);
    expect(f.goals.get("thread")?.status).toBe("active");
    f.goals.dispose();
  });
  it("continues an automatic turn that did real work", async () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "goal" });
    await vi.advanceTimersByTimeAsync(100);
    f.start();
    f.event({
      type: "item.started",
      threadId: "thread",
      itemId: "tool",
      itemType: "command_execution",
    });
    f.finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.proceed).toHaveBeenCalledTimes(2);
    f.goals.dispose();
  });
  it("stops interruptions and does not automatically retry a failed goal", async () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "goal" });
    f.start();
    f.finish("turn-1", "interrupted");
    await vi.advanceTimersByTimeAsync(100);
    expect(f.goals.get("thread")?.status).toBe("paused");
    expect(f.proceed).not.toHaveBeenCalled();
    f.goals.control("thread", { action: "resume" });
    f.start("turn-2");
    f.finish("turn-2", "failed");
    f.goals.onFailure("thread");
    await vi.advanceTimersByTimeAsync(100);
    expect(f.goals.get("thread")?.status).toBe("blocked");
    f.goals.dispose();
  });
  it("requires three distinct turns for the same blocker and resets the audit on user resume", () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "goal" });
    for (const turnId of ["a", "b"]) {
      f.start(turnId);
      expect(() => f.goals.update("thread", "blocked", "需要同一份输入数据")).toThrow(
        "GOAL_BLOCKED_AUDIT_PENDING",
      );
      expect(() => f.goals.update("thread", "blocked", "需要同一份输入数据")).toThrow(
        "GOAL_BLOCKED_AUDIT_PENDING",
      );
      f.finish(turnId);
    }
    f.start("c");
    expect(f.goals.update("thread", "blocked", "需要同一份输入数据").status).toBe("blocked");
    f.finish("c");
    f.goals.control("thread", { action: "resume" });
    f.start("d");
    expect(() => f.goals.update("thread", "blocked", "需要同一份输入数据")).toThrow("1/3");
    f.goals.dispose();
  });
  it("treats terminal tool hooks as progress in the same turn, keeping the blocked audit honest", () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "goal" });
    f.goals.observeHook("thread", "session.turn_started");
    expect(() => f.goals.update("thread", "blocked", "missing input")).toThrow("1/3");
    f.goals.observeHook("thread", "session.turn_started", { tool: "read_file" });
    expect(() => f.goals.update("thread", "blocked", "missing input")).toThrow("1/3");
    f.goals.dispose();
  });
  it("counts cumulative consumption once, excludes pre-goal spend, and handles new sessions", () => {
    const f = fixture();
    f.event(usage(1000));
    f.goals.control("thread", { action: "edit", objective: "goal" });
    f.event(usage(1200));
    f.event(usage(1200));
    f.event(usage(1100));
    f.event(usage(50, { scopeId: "native-2", fresh: true }));
    expect(f.goals.get("thread")?.tokensUsed).toBe(250);
    f.goals.dispose();
  });
  it("deduplicates per-call samples and stops at a user-specified budget", async () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "goal", tokenBudget: 100 });
    const sample = usage(100, { counterKind: "per-call", sampleId: "call-1" });
    f.event(sample);
    f.event(sample);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.goals.get("thread")).toMatchObject({ tokensUsed: 100, status: "budget_limited" });
    expect(f.proceed).not.toHaveBeenCalled();
    expect(() => f.goals.control("thread", { action: "resume" })).toThrow("GOAL_BUDGET_EXHAUSTED");
    f.goals.dispose();
  });
  it("rechecks user hold and clear at the queued continuation boundary", async () => {
    const f = fixture();
    f.goals.control("thread", { action: "edit", objective: "goal" });
    f.goals.control("thread", { action: "hold", pending: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.proceed).not.toHaveBeenCalled();
    f.goals.control("thread", { action: "hold", pending: false });
    f.goals.control("thread", { action: "clear" });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.proceed).not.toHaveBeenCalled();
    expect(f.goals.get("thread")).toBeNull();
    f.goals.dispose();
  });
});
