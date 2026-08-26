import type { PlanItemPayload, RuntimeEvent } from "@/shared/contracts";

export type PlanStepStatus = PlanItemPayload["steps"][number]["status"];

interface AggregatedTask {
  description: string;
  status: PlanStepStatus;
  order: number;
}

/**
 * Per-thread accumulator for provider plan/todo events.
 *
 * Bulk providers (legacy Claude TodoWrite, OpenCode todowrite, ACP plan
 * updates) emit a full step list per call. Newer providers (Claude SDK Task*)
 * emit per-task events. The aggregator hides that distinction from the rest of
 * the runtime by maintaining one stable plan item per session whose
 * `PlanItemPayload.steps` array is rebuilt from accumulated state on every
 * change. Adapters call `upsertPlanTask` / `removePlanTask` / `replaceAllTasks`
 * and forward the returned events; the renderer's plan dock derivation
 * (`threadTodoState`) continues to work unchanged.
 */
export interface PlanAggregatorState {
  threadId: string;
  itemId: string;
  started: boolean;
  completed: boolean;
  tasksByKey: Map<string, AggregatedTask>;
  keyByTaskId: Map<string, string>;
  nextOrder: number;
}

export function createPlanAggregator(threadId: string, itemId: string): PlanAggregatorState {
  return {
    threadId,
    itemId,
    started: false,
    completed: false,
    tasksByKey: new Map(),
    keyByTaskId: new Map(),
    nextOrder: 0,
  };
}

export function planAggregatorPayload(state: PlanAggregatorState): PlanItemPayload {
  const ordered = [...state.tasksByKey.values()].sort((a, b) => a.order - b.order);
  return {
    steps: ordered.map((task) => ({
      step: task.description,
      status: task.status,
    })),
  };
}

/**
 * Insert a new task or merge into an existing one (by `key`). When the
 * resulting state differs from the prior snapshot, emit `item.started` for the
 * first task ever, or `item.updated` for subsequent changes. Returns `[]` when
 * the call is a no-op (same key + same fields).
 */
export function upsertPlanTask(
  state: PlanAggregatorState,
  key: string,
  fields: { description?: string; status?: PlanStepStatus },
): RuntimeEvent[] {
  const previous = state.tasksByKey.get(key);
  const description = fields.description ?? previous?.description ?? defaultDescription(key);
  const status = fields.status ?? previous?.status ?? "pending";
  if (previous && previous.description === description && previous.status === status) {
    return [];
  }
  const order = previous ? previous.order : state.nextOrder++;
  state.tasksByKey.set(key, { description, status, order });
  return emitForCurrentState(state);
}

/**
 * Look up the aggregator key for a provider-issued task identifier (e.g.
 * Claude's runtime-assigned task_id). Returns `undefined` if the identifier
 * was never recorded — callers should treat unknown ids as new tasks rather
 * than silently dropping the update.
 */
export function resolvePlanTaskKey(
  state: PlanAggregatorState,
  identifier: string,
): string | undefined {
  if (state.tasksByKey.has(identifier)) return identifier;
  return state.keyByTaskId.get(identifier);
}

/**
 * Record a `task_id -> aggregator-key` mapping so subsequent updates that
 * reference only the runtime-assigned id can find the existing entry.
 */
export function registerPlanTaskId(state: PlanAggregatorState, taskId: string, key: string): void {
  state.keyByTaskId.set(taskId, key);
}

export function removePlanTask(state: PlanAggregatorState, key: string): RuntimeEvent[] {
  if (!state.tasksByKey.delete(key)) return [];
  for (const [taskId, k] of state.keyByTaskId) {
    if (k === key) state.keyByTaskId.delete(taskId);
  }
  return emitForCurrentState(state);
}

/**
 * Drop every accumulated task and replace with `tasks` in the given order.
 * Used for bulk-replace providers (TodoWrite, OpenCode todowrite, ACP plan
 * updates) so they can map directly without faking per-item operations.
 */
export function replaceAllPlanTasks(
  state: PlanAggregatorState,
  tasks: ReadonlyArray<{ key: string; description: string; status: PlanStepStatus }>,
): RuntimeEvent[] {
  state.tasksByKey.clear();
  state.keyByTaskId.clear();
  state.nextOrder = 0;
  for (const task of tasks) {
    state.tasksByKey.set(task.key, {
      description: task.description,
      status: task.status,
      order: state.nextOrder++,
    });
  }
  return emitForCurrentState(state);
}

export function closePlanAggregator(state: PlanAggregatorState): RuntimeEvent[] {
  if (!state.started || state.completed) return [];
  state.completed = true;
  return [{ type: "item.completed", threadId: state.threadId, itemId: state.itemId }];
}

function emitForCurrentState(state: PlanAggregatorState): RuntimeEvent[] {
  const payload = planAggregatorPayload(state);
  if (state.completed) {
    // A new task arrived after the previous plan item was closed. Reopen
    // semantics aren't supported by the canonical contract — emit a fresh
    // `item.started` so the renderer treats this as the active plan again.
    state.completed = false;
    state.started = true;
    return [
      {
        type: "item.started",
        threadId: state.threadId,
        itemId: state.itemId,
        itemType: "plan",
        payload,
      },
    ];
  }
  if (!state.started) {
    state.started = true;
    return [
      {
        type: "item.started",
        threadId: state.threadId,
        itemId: state.itemId,
        itemType: "plan",
        payload,
      },
    ];
  }
  return [
    {
      type: "item.updated",
      threadId: state.threadId,
      itemId: state.itemId,
      payload,
    },
  ];
}

function defaultDescription(key: string): string {
  return key.startsWith("task:") ? `Task ${key.slice("task:".length)}` : "Task";
}
