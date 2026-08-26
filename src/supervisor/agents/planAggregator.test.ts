import { describe, expect, it } from "vitest";
import {
  closePlanAggregator,
  createPlanAggregator,
  planAggregatorPayload,
  registerPlanTaskId,
  removePlanTask,
  replaceAllPlanTasks,
  resolvePlanTaskKey,
  upsertPlanTask,
} from "./planAggregator";

describe("planAggregator", () => {
  it("emits item.started on the first upsert and item.updated on subsequent changes", () => {
    const state = createPlanAggregator("thread-1", "plan-1");

    const first = upsertPlanTask(state, "task-a", {
      description: "Investigate bug",
      status: "in_progress",
    });
    expect(first).toEqual([
      {
        type: "item.started",
        threadId: "thread-1",
        itemId: "plan-1",
        itemType: "plan",
        payload: { steps: [{ step: "Investigate bug", status: "in_progress" }] },
      },
    ]);

    const second = upsertPlanTask(state, "task-b", {
      description: "Write fix",
      status: "pending",
    });
    expect(second).toEqual([
      {
        type: "item.updated",
        threadId: "thread-1",
        itemId: "plan-1",
        payload: {
          steps: [
            { step: "Investigate bug", status: "in_progress" },
            { step: "Write fix", status: "pending" },
          ],
        },
      },
    ]);
  });

  it("merges fields when upserting an existing key and preserves order", () => {
    const state = createPlanAggregator("thread-1", "plan-1");
    upsertPlanTask(state, "task-a", { description: "Investigate", status: "in_progress" });
    upsertPlanTask(state, "task-b", { description: "Fix", status: "pending" });

    const update = upsertPlanTask(state, "task-a", { status: "completed" });
    expect(update).toEqual([
      {
        type: "item.updated",
        threadId: "thread-1",
        itemId: "plan-1",
        payload: {
          steps: [
            { step: "Investigate", status: "completed" },
            { step: "Fix", status: "pending" },
          ],
        },
      },
    ]);
  });

  it("returns no events when an upsert is a no-op", () => {
    const state = createPlanAggregator("thread-1", "plan-1");
    upsertPlanTask(state, "task-a", { description: "Investigate", status: "in_progress" });
    const noop = upsertPlanTask(state, "task-a", { status: "in_progress" });
    expect(noop).toEqual([]);
  });

  it("resolves task ids via registerPlanTaskId so updates land on the original key", () => {
    const state = createPlanAggregator("thread-1", "plan-1");
    upsertPlanTask(state, "create-1", { description: "Investigate", status: "pending" });
    registerPlanTaskId(state, "42", "create-1");

    const key = resolvePlanTaskKey(state, "42");
    expect(key).toBe("create-1");
    expect(upsertPlanTask(state, key!, { status: "completed" })).toEqual([
      {
        type: "item.updated",
        threadId: "thread-1",
        itemId: "plan-1",
        payload: { steps: [{ step: "Investigate", status: "completed" }] },
      },
    ]);
  });

  it("removes tasks and drops their task_id mappings", () => {
    const state = createPlanAggregator("thread-1", "plan-1");
    upsertPlanTask(state, "task-a", { description: "Investigate", status: "in_progress" });
    upsertPlanTask(state, "task-b", { description: "Fix", status: "pending" });
    registerPlanTaskId(state, "1", "task-a");

    const removed = removePlanTask(state, "task-a");
    expect(removed).toEqual([
      {
        type: "item.updated",
        threadId: "thread-1",
        itemId: "plan-1",
        payload: { steps: [{ step: "Fix", status: "pending" }] },
      },
    ]);
    expect(resolvePlanTaskKey(state, "1")).toBeUndefined();
  });

  it("replaces the full task list for bulk providers and resets order", () => {
    const state = createPlanAggregator("thread-1", "plan-1");
    upsertPlanTask(state, "task-a", { description: "Investigate", status: "in_progress" });

    const replaced = replaceAllPlanTasks(state, [
      { key: "todo:0", description: "Write tests", status: "completed" },
      { key: "todo:1", description: "Ship it", status: "pending" },
    ]);
    expect(replaced).toEqual([
      {
        type: "item.updated",
        threadId: "thread-1",
        itemId: "plan-1",
        payload: {
          steps: [
            { step: "Write tests", status: "completed" },
            { step: "Ship it", status: "pending" },
          ],
        },
      },
    ]);
  });

  it("closePlanAggregator emits item.completed once and is a no-op afterwards", () => {
    const state = createPlanAggregator("thread-1", "plan-1");
    upsertPlanTask(state, "task-a", { description: "Investigate" });

    const close = closePlanAggregator(state);
    expect(close).toEqual([{ type: "item.completed", threadId: "thread-1", itemId: "plan-1" }]);
    expect(closePlanAggregator(state)).toEqual([]);
  });

  it("reopens the plan item with item.started when a task arrives after close", () => {
    const state = createPlanAggregator("thread-1", "plan-1");
    upsertPlanTask(state, "task-a", { description: "First" });
    closePlanAggregator(state);

    const reopened = upsertPlanTask(state, "task-b", { description: "Second" });
    expect(reopened[0]).toMatchObject({
      type: "item.started",
      itemId: "plan-1",
      itemType: "plan",
    });
  });

  it("planAggregatorPayload returns the current ordered steps", () => {
    const state = createPlanAggregator("thread-1", "plan-1");
    upsertPlanTask(state, "task-a", { description: "A", status: "completed" });
    upsertPlanTask(state, "task-b", { description: "B", status: "in_progress" });
    expect(planAggregatorPayload(state)).toEqual({
      steps: [
        { step: "A", status: "completed" },
        { step: "B", status: "in_progress" },
      ],
    });
  });
});
