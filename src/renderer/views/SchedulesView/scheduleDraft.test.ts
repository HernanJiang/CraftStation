import { describe, expect, it } from "vitest";
import type { ScheduledTask } from "@/shared/contracts";
import {
  newScheduleDraft,
  scheduleDraftInput,
  scheduleDraftIsValid,
  taskScheduleDraft,
} from "./scheduleDraft";

const baseTask: ScheduledTask = {
  id: "d2ac39e9-14ac-4776-9279-37a1e455a5db",
  name: "Daily brief",
  prompt: "Summarize my priorities.",
  agentKind: "claude:home",
  config: { model: "claude-fable-5", effort: "high" },
  recurrence: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" },
  enabled: true,
  nextRunAt: null,
  lastRunAt: null,
  lastCompletedAt: null,
  lastStatus: "never",
  lastResult: null,
  lastError: null,
  createdAt: "2026-07-10T12:00:00.000Z",
  updatedAt: "2026-07-10T12:00:00.000Z",
};

describe("scheduleDraft projectId", () => {
  it("defaults new drafts to the Home scope (null)", () => {
    expect(newScheduleDraft(undefined).projectId).toBeNull();
    expect(scheduleDraftInput(newScheduleDraft(undefined)).projectId).toBeNull();
  });

  it("round-trips a task's projectId through the draft", () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const draft = taskScheduleDraft({ ...baseTask, projectId });
    expect(draft.projectId).toBe(projectId);
    expect(scheduleDraftInput(draft).projectId).toBe(projectId);
  });

  it("treats a task without a projectId as Home", () => {
    const draft = taskScheduleDraft(baseTask);
    expect(draft.projectId).toBeNull();
    expect(scheduleDraftInput(draft).projectId).toBeNull();
  });

  it("round-trips timezone/recipe/target-thread through the draft", () => {
    const draft = taskScheduleDraft({
      ...baseTask,
      timezone: "Asia/Shanghai",
      recipeId: "recipe-morning",
      targetThreadId: "aa11bb22-cc33-4d44-9e55-6f77aa88bb99",
    });
    expect(draft.timezone).toBe("Asia/Shanghai");
    expect(draft.recipeId).toBe("recipe-morning");
    expect(draft.targetThreadId).toBe("aa11bb22-cc33-4d44-9e55-6f77aa88bb99");
    expect(scheduleDraftInput(draft)).toMatchObject({
      timezone: "Asia/Shanghai",
      recipeId: "recipe-morning",
      targetThreadId: "aa11bb22-cc33-4d44-9e55-6f77aa88bb99",
    });
  });

  it("rejects an invalid time zone", () => {
    const draft = { ...newScheduleDraft(undefined), timezone: "Not/AZone" };
    expect(scheduleDraftIsValid(draft)).toBe(false);
  });

  it("round-trips an every-N-minutes interval recurrence", () => {
    const draft = taskScheduleDraft({
      ...baseTask,
      recurrence: { kind: "interval", everyMinutes: 10 },
    });
    expect(draft.repeatMode).toBe("interval");
    expect(draft.everyMinutes).toBe(10);
    expect(scheduleDraftInput(draft).recurrence).toEqual({
      kind: "interval",
      everyMinutes: 10,
    });
    expect(scheduleDraftIsValid(draft)).toBe(true);
    expect(
      scheduleDraftIsValid({ ...draft, everyMinutes: 0 }),
    ).toBe(false);
  });
});
