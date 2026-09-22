import { Crafter, getDefaultRegistry, type CraftPlan, type Item } from "@/shared/crafting";
import type {
  ScheduleExecutionSnapshot,
  ScheduledTask,
  ScheduleThreadTarget,
} from "@/shared/contracts";
import { scheduleThreadTarget } from "@/shared/schedules";
import { scheduleSelfStopInstructions } from "./scheduleSelfStop";

/** Persisted conversation/context inherited by an existing-thread run. Text only. */
export interface ThreadContextSnapshot {
  threadId: string;
  title: string;
  projectId: string;
  /** Original thread's agentKind, recorded for provenance — never used to resume. */
  sourceAgentKind: string;
  conversationText: string | null;
}

export type ScheduleLaunchMode =
  | {
      kind: "native";
      prompt: string;
      craftPlan: CraftPlan;
      snapshot: ScheduleExecutionSnapshot;
      contextSnapshot: ThreadContextSnapshot | null;
    }
  | {
      kind: "legacy";
      prompt: string;
      snapshot: ScheduleExecutionSnapshot;
      contextSnapshot: ThreadContextSnapshot | null;
    };

const MAX_INHERITED_CONTEXT_CHARS = 4_000;

export function buildScheduleExecutionSnapshot(
  task: ScheduledTask,
  threadTarget: ScheduleThreadTarget,
): ScheduleExecutionSnapshot {
  return {
    recipeId: task.recipeId ?? null,
    model: task.config.model,
    harnessItemId: task.config.harnessItemId ?? null,
    agentKind: task.agentKind,
    threadTarget,
    sourceThreadId: task.sourceThreadId ?? null,
  };
}

/**
 * Resolve how this occurrence should run.
 *
 * Native: compile a fresh CraftPlan (no sessionRef) and spawn via harness runtime.
 * Legacy: isolated startThread compatibility path for harnesses not yet on the
 * native CraftPlan seam. Provider-specific branches stay here, not in
 * ScheduleService.
 */
export function resolveScheduleExecution(input: {
  task: ScheduledTask;
  runThreadId: string;
  workspace?: string;
  contextSnapshot: ThreadContextSnapshot | null;
  crafter?: Crafter;
}): ScheduleLaunchMode {
  const threadTarget = scheduleThreadTarget(input.task);
  const snapshot = buildScheduleExecutionSnapshot(input.task, threadTarget);
  const prompt = buildSchedulePrompt(input.task, input.contextSnapshot);
  const native = tryCompileNativeCraftPlan({
    task: input.task,
    runThreadId: input.runThreadId,
    ...(input.workspace ? { workspace: input.workspace } : {}),
    ...(input.crafter ? { crafter: input.crafter } : {}),
  });
  if (native) {
    return {
      kind: "native",
      prompt,
      craftPlan: native,
      snapshot,
      contextSnapshot: input.contextSnapshot,
    };
  }
  return {
    kind: "legacy",
    prompt,
    snapshot,
    contextSnapshot: input.contextSnapshot,
  };
}

export function buildSchedulePrompt(
  task: ScheduledTask,
  contextSnapshot: ThreadContextSnapshot | null,
): string {
  const control = scheduleSelfStopInstructions(task.id);
  if (!contextSnapshot) return `${task.prompt}\n\n${control}`;
  const raw = contextSnapshot.conversationText;
  const context =
    raw != null && raw.length > MAX_INHERITED_CONTEXT_CHARS
      ? `${raw.slice(0, MAX_INHERITED_CONTEXT_CHARS)}…`
      : raw;
  if (context == null || context.trim() === "") {
    return `${task.prompt}\n\n[Schedule context: continuing conversation "${contextSnapshot.title}" — no prior transcript was available. Execute the scheduled instructions above in a fresh session.]\n\n${control}`;
  }
  return `${task.prompt}\n\n[Schedule context: continuing conversation "${contextSnapshot.title}". Inherited context (text only — the harness session is fresh):\n${context}\n---\nExecute the scheduled instructions above.]\n\n${control}`;
}

function tryCompileNativeCraftPlan(input: {
  task: ScheduledTask;
  runThreadId: string;
  workspace?: string;
  crafter?: Crafter;
}): CraftPlan | null {
  const crafter = input.crafter ?? new Crafter(getDefaultRegistry());
  const registry = getDefaultRegistry();
  const modelItem = findModelItem(registry.listItems("model"), input.task.config.model);
  const harnessItem = findHarnessItem(
    registry.listItems("harness"),
    input.task.agentKind,
    input.task.config.harnessItemId ?? null,
  );
  if (!modelItem || !harnessItem) return null;
  try {
    const result = crafter.compile(
      { slots: { model: modelItem, harness: harnessItem } },
      {
        threadId: input.runThreadId,
        ...(input.workspace ? { workspace: input.workspace } : {}),
      },
    );
    if (!result.success || !result.resultItem?.craftPlan) return null;
    const plan = result.resultItem.craftPlan;
    // Fresh native session every run: drop any session continuation the recipe
    // might have copied. Existing-thread continuation is context text only.
    const { sessionRef: _ignored, ...fresh } = plan;
    return { ...fresh, threadId: input.runThreadId };
  } catch {
    return null;
  }
}

function findModelItem(items: Item[], modelId: string): Item | undefined {
  const exact = items.find((item) => item.id === modelId);
  if (exact) return exact;
  return items.find((item) =>
    item.components.some(
      (component) =>
        component.kind === "model_capability" &&
        "modelId" in component &&
        component.modelId === modelId,
    ),
  );
}

function findHarnessItem(
  items: Item[],
  agentKind: string,
  harnessItemId: string | null,
): Item | undefined {
  if (harnessItemId) {
    const named = items.find((item) => item.id === harnessItemId);
    if (named) return named;
  }
  const kind = agentKind.split(":")[0] ?? "";
  if (!kind) return undefined;
  return items.find((item) => item.id === `harness:${kind}`);
}
