import { describe, expect, it } from "vitest";
import type { ScheduledTask } from "@/shared/contracts";
import { resolveScheduleExecution, type ThreadContextSnapshot } from "./ScheduleExecutionResolver";

const task: ScheduledTask = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Brief",
  prompt: "Do the work.",
  agentKind: "claude:home",
  config: { model: "claude-fable-5" },
  recurrence: { kind: "hourly", minute: 0 },
  enabled: true,
  nextRunAt: null,
  lastRunAt: null,
  lastCompletedAt: null,
  lastStatus: "never",
  lastResult: null,
  lastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("resolveScheduleExecution", () => {
  it("uses the legacy path when no native recipe matches", () => {
    const mode = resolveScheduleExecution({
      task,
      runThreadId: "thread-new",
      contextSnapshot: null,
    });
    expect(mode.kind).toBe("legacy");
    expect(mode.prompt).toContain("Do the work.");
    expect(mode.prompt).toContain("CRAFTSTATION_SCHEDULE: pause");
    expect(mode.snapshot.threadTarget).toEqual({ kind: "new" });
  });

  it("injects inherited context text without a native session", () => {
    const contextSnapshot: ThreadContextSnapshot = {
      threadId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      title: "Old",
      projectId: "p",
      sourceAgentKind: "codex",
      conversationText: "User: BANANA42",
    };
    const mode = resolveScheduleExecution({
      task: { ...task, targetThreadId: contextSnapshot.threadId },
      runThreadId: "thread-new",
      contextSnapshot,
    });
    expect(mode.kind).toBe("legacy");
    expect(mode.prompt).toContain("BANANA42");
    expect(mode.prompt).toContain("Do the work.");
    expect(mode.snapshot.threadTarget).toEqual({
      kind: "existing",
      threadId: contextSnapshot.threadId,
    });
  });
});
