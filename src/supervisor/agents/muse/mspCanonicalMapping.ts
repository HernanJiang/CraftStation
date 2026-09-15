import { randomUUID } from "node:crypto";
import type {
  CanonicalContentBlock,
  GoalStatus,
  PlanItemPayload,
  RuntimeEvent,
} from "@/shared/contracts";
import { createContextUsageEvent, usageFromTokenCounts } from "../contextUsage";

export interface MuseMappedItem {
  readonly itemId: string;
  readonly kind: string;
  readonly text?: string | undefined;
  readonly fallbackText?: string | undefined;
  readonly toolName?: string | undefined;
  readonly args?: unknown;
  readonly status?: string | undefined;
  readonly commandText?: string | undefined;
  readonly exitCode?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly visibleOutput?: string | undefined;
  readonly objective?: string | undefined;
  readonly role?: string | undefined;
  readonly subagentId?: string | undefined;
  readonly childSessionId?: string | undefined;
  readonly result?: unknown;
  readonly failureReason?: string | undefined;
  readonly outcome?: string | undefined;
  readonly reason?: string | undefined;
  readonly trigger?: string | undefined;
  readonly tokensBefore?: number | undefined;
  readonly tokensAfter?: number | undefined;
}

export interface MuseMappedDelta {
  readonly itemId: string;
  readonly field?: string | undefined;
  readonly delta: string;
}

export interface MuseTodoItem {
  readonly text: string;
  readonly status?: string | undefined;
}

export interface MuseGoalState {
  readonly objective?: string | undefined;
  readonly status?: string | undefined;
  readonly currentWork?: string | undefined;
  readonly percentComplete?: number | undefined;
}

const HIDDEN_MUSE_KINDS = new Set(["userMessage", "reminderChild"]);
const STARTED_MUSE_KINDS = new Set([
  "agentMessage",
  "reasoning",
  "thought",
  "thinking",
  "toolCall",
  "userShell",
  "subagent",
  "workflow",
]);
const REASONING_MUSE_KINDS = new Set(["reasoning", "thought", "thinking"]);

export function isMuseReasoningKind(kind: string | undefined): boolean {
  return kind !== undefined && REASONING_MUSE_KINDS.has(kind);
}

export function isMuseReasoningDeltaField(field: string | undefined): boolean {
  return (
    field === "reasoning" ||
    field === "thought" ||
    field === "thinking" ||
    (typeof field === "string" && field.startsWith("summary."))
  );
}

/** Muse reasoning streams `summary.n`; `text` is not streamed in MSP v1. */
export function museItemVisibleText(item: Record<string, unknown>, kind?: string): string | undefined {
  if (isMuseReasoningKind(kind) && Array.isArray(item.summary)) {
    const joined = item.summary.filter((part): part is string => typeof part === "string").join("");
    if (joined) return joined;
  }
  if (typeof item.text === "string" && item.text.length > 0) return item.text;
  if (Array.isArray(item.summary)) {
    const joined = item.summary.filter((part): part is string => typeof part === "string").join("");
    if (joined) return joined;
  }
  return undefined;
}

const MCP_TOOL_NAME = /^mcp__(.+?)__(.+)$/i;

export function museToolKind(name: string): "read" | "edit" | "search" | "execute" | "other" {
  if (/^mcp__/i.test(name)) return "other";
  if (/read|cat|ls|glob|grep/i.test(name)) return "read";
  if (/write|edit|patch|apply/i.test(name)) return "edit";
  if (/search|find/i.test(name)) return "search";
  if (/bash|shell|exec|command/i.test(name)) return "execute";
  return "other";
}

export function museMcpServerId(name: string): string | undefined {
  const match = MCP_TOOL_NAME.exec(name);
  return match?.[1];
}

/** Muse wire field is `tool`; keep `toolName`/`name` as defensive aliases. */
export function museToolNameFromItem(item: Record<string, unknown>): string | undefined {
  for (const key of ["tool", "toolName", "name"] as const) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function isHiddenMuseItemKind(kind: string | undefined): boolean {
  return kind !== undefined && HIDDEN_MUSE_KINDS.has(kind);
}

export function isMuseCompactPrompt(prompt: string): boolean {
  return /^\s*\/(?:compact|compaction)(?:\s|$)/i.test(prompt);
}

/**
 * Muse emits a `compaction` item even when nothing was summarized
 * (`outcome: "noop"`, reason `no_compactable_history`). Those must not become
 * a "Context compacted" chat row.
 */
export function shouldShowMuseCompaction(item: MuseMappedItem): boolean {
  if (item.kind !== "compaction") return false;
  const outcome = item.outcome?.trim().toLowerCase();
  if (outcome === "noop" || outcome === "cancelled" || outcome === "failed") return false;
  const reason = item.reason?.trim().toLowerCase();
  if (reason === "no_compactable_history") return false;
  if (outcome === "compacted") return true;
  const before = item.tokensBefore;
  const after = item.tokensAfter;
  return (
    typeof before === "number" &&
    typeof after === "number" &&
    Number.isFinite(before) &&
    Number.isFinite(after) &&
    after < before
  );
}

export function mapMuseItemStarted(threadId: string, item: MuseMappedItem): RuntimeEvent[] {
  if (isHiddenMuseItemKind(item.kind)) return [];
  if (item.kind === "compaction") return [];
  if (item.kind === "agentMessage") {
    return [
      {
        type: "item.started",
        threadId,
        itemId: item.itemId,
        itemType: "assistant_message",
        payload: { content: textBlocks(item.text) },
      },
    ];
  }
  if (isMuseReasoningKind(item.kind)) {
    const events: RuntimeEvent[] = [
      {
        type: "item.started",
        threadId,
        itemId: item.itemId,
        itemType: "reasoning",
        payload: { content: textBlocks(item.text) },
      },
    ];
    // Reasoning rows render `streams.reasoning_text`. A snapshot with no
    // following delta would complete empty and be dropped from the timeline.
    if (item.text) {
      events.push({
        type: "content.delta",
        threadId,
        itemId: item.itemId,
        stream: "reasoning_text",
        delta: item.text,
      });
    }
    return events;
  }
  if (item.kind === "toolCall") {
    return [
      {
        type: "item.started",
        threadId,
        itemId: item.itemId,
        itemType: "tool_call",
        payload: toolCallPayload(item, "running"),
      },
    ];
  }
  if (item.kind === "userShell") {
    return [
      {
        type: "item.started",
        threadId,
        itemId: item.itemId,
        itemType: "command_execution",
        payload: {
          command: item.commandText?.trim() || "",
          status: "running",
        },
      },
    ];
  }
  if (item.kind === "subagent") {
    return [
      {
        type: "item.started",
        threadId,
        itemId: item.itemId,
        itemType: "tool_call",
        payload: subagentPayload(item, "running"),
      },
    ];
  }
  if (item.kind === "workflow") {
    const title = item.text?.trim() || item.fallbackText?.trim() || "Workflow";
    return [
      {
        type: "item.started",
        threadId,
        itemId: item.itemId,
        itemType: "tool_call",
        payload: {
          name: "Workflow",
          title,
          kind: "other" as const,
          isSubAgent: true,
          status: "running",
        },
      },
    ];
  }
  const visible = item.fallbackText?.trim() || item.text?.trim();
  if (!visible) return [];
  return [
    {
      type: "item.started",
      threadId,
      itemId: item.itemId,
      itemType: "assistant_message",
      payload: { content: textBlocks(visible) },
    },
  ];
}

export function mapMuseItemDelta(
  threadId: string,
  delta: MuseMappedDelta,
  kind: string | undefined,
): RuntimeEvent | undefined {
  if (isHiddenMuseItemKind(kind) || kind === "compaction") return undefined;
  if (!delta.delta) return undefined;
  if (kind === "userShell") {
    return {
      type: "content.delta",
      threadId,
      itemId: delta.itemId,
      stream: "command_output",
      delta: delta.delta,
    };
  }
  if (kind === "toolCall") {
    return {
      type: "item.updated",
      threadId,
      itemId: delta.itemId,
      payload: { result: delta.delta, status: "running" },
    };
  }
  // Tool output must not paint as assistant text before the item kind is known.
  // Reasoning `summary.n` deltas often arrive before `item.started`; keep them.
  if (!kind && delta.field === "output") {
    return undefined;
  }
  const stream =
    isMuseReasoningKind(kind) || isMuseReasoningDeltaField(delta.field)
      ? "reasoning_text"
      : "assistant_text";
  return {
    type: "content.delta",
    threadId,
    itemId: delta.itemId,
    stream,
    delta: delta.delta,
  };
}

export function mapMuseItemCompleted(threadId: string, item: MuseMappedItem): RuntimeEvent[] {
  if (isHiddenMuseItemKind(item.kind)) return [];
  if (item.kind === "compaction") return mapMuseCompactionCompleted(threadId, item);
  if (!STARTED_MUSE_KINDS.has(item.kind) && !(item.fallbackText?.trim() || item.text?.trim())) {
    return [];
  }
  const events: RuntimeEvent[] = [];
  if (item.kind === "toolCall") {
    events.push({
      type: "item.updated",
      threadId,
      itemId: item.itemId,
      payload: toolCallPayload(item, toolStatus(item.status), item.visibleOutput ?? item.text),
    });
  } else if (item.kind === "userShell") {
    events.push({
      type: "item.updated",
      threadId,
      itemId: item.itemId,
      payload: {
        command: item.commandText?.trim() || "",
        result: item.visibleOutput ?? item.text,
        status: toolStatus(item.status),
        ...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
        ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
        ...(item.failureReason ? { errorMessage: item.failureReason } : {}),
      },
    });
  } else if (item.kind === "subagent" || item.kind === "workflow") {
    events.push({
      type: "item.updated",
      threadId,
      itemId: item.itemId,
      payload:
        item.kind === "workflow"
          ? {
              name: "Workflow",
              title: item.text?.trim() || item.fallbackText?.trim() || "Workflow",
              kind: "other",
              result: item.visibleOutput ?? item.text ?? item.fallbackText,
              isSubAgent: true,
              status: toolStatus(item.status),
            }
          : subagentPayload(item, toolStatus(item.status), subagentResultText(item)),
    });
  }
  events.push({ type: "item.completed", threadId, itemId: item.itemId });
  return events;
}

export function mapMuseContextUsage(
  threadId: string,
  usage: {
    usedTokens?: number;
    windowTokens?: number;
    promptTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    reasoningTokens?: number;
  },
): RuntimeEvent | undefined {
  const extra = [
    usage.promptTokens
      ? { id: "input", label: "Input", tokens: usage.promptTokens }
      : undefined,
    usage.outputTokens
      ? { id: "output", label: "Output", tokens: usage.outputTokens }
      : undefined,
    usage.cacheReadTokens
      ? { id: "cache-read", label: "Cache read", tokens: usage.cacheReadTokens }
      : undefined,
    usage.reasoningTokens
      ? { id: "reasoning", label: "Reasoning", tokens: usage.reasoningTokens }
      : undefined,
  ].filter((entry): entry is { id: string; label: string; tokens: number } => entry !== undefined);
  return createContextUsageEvent(
    threadId,
    usageFromTokenCounts({
      usedTokens: usage.usedTokens,
      maxTokens: usage.windowTokens,
      extra,
    }),
  );
}

export function mapMuseTodoList(
  threadId: string,
  items: readonly MuseTodoItem[],
  existingPlanItemId: string | undefined,
): { events: RuntimeEvent[]; planItemId: string | undefined } {
  const steps = items.map((item) => ({
    step: item.text,
    status: planStatus(item.status),
  }));
  // Unique id per plan instance: a closed plan item is never reopened under
  // the same id (the renderer ignores duplicate `item.started` ids), so the
  // next turn's todo list becomes a fresh plan item.
  const itemId = existingPlanItemId ?? `muse-plan-${threadId}-${randomUUID()}`;
  if (steps.length === 0) {
    if (!existingPlanItemId) return { events: [], planItemId: undefined };
    return {
      events: [
        { type: "item.updated", threadId, itemId, payload: { steps: [] } },
        { type: "item.completed", threadId, itemId, payload: { steps: [] } },
      ],
      planItemId: undefined,
    };
  }
  const payload: PlanItemPayload = { steps };
  if (!existingPlanItemId) {
    return {
      events: [{ type: "item.started", threadId, itemId, itemType: "plan", payload }],
      planItemId: itemId,
    };
  }
  const events: RuntimeEvent[] = [{ type: "item.updated", threadId, itemId, payload }];
  if (steps.every((step) => step.status === "completed")) {
    events.push({ type: "item.completed", threadId, itemId, payload });
    return { events, planItemId: undefined };
  }
  return { events, planItemId: itemId };
}

/**
 * Close the open plan item at a turn boundary. The Muse todo list frequently
 * outlives the turn without every step reaching `completed`; without this the
 * plan item (and the capsule Step counter) would stay "in progress" forever.
 * Steps keep the harness's last reported statuses — the renderer retires the
 * dock for completed plan items — and the next turn re-publishes the todo
 * list as a fresh plan item.
 */
export function closeMusePlanItem(
  threadId: string,
  planItemId: string,
  items: readonly MuseTodoItem[],
): RuntimeEvent[] {
  const steps = items
    .filter((item) => item.text.trim().length > 0)
    .map((item) => ({ step: item.text, status: planStatus(item.status) }));
  return [{ type: "item.completed", threadId, itemId: planItemId, payload: { steps } }];
}

export function mapMuseGoal(
  threadId: string,
  goal: MuseGoalState | null,
  existingGoalItemId: string | undefined,
): { events: RuntimeEvent[]; goalItemId: string | undefined } {
  const itemId = existingGoalItemId ?? `muse-goal-${threadId}`;
  if (!goal || !goal.objective?.trim()) {
    if (!existingGoalItemId) return { events: [], goalItemId: undefined };
    return {
      events: [
        {
          type: "item.updated",
          threadId,
          itemId,
          payload: { action: "cleared", availableActions: [] },
        },
      ],
      goalItemId: undefined,
    };
  }
  const payload = {
    action: existingGoalItemId ? ("updated" as const) : ("set" as const),
    objective: goal.objective,
    status: goalStatus(goal.status),
    availableActions: ["clear"] as const,
    ...(goal.currentWork ? { lastReason: goal.currentWork } : {}),
  };
  if (!existingGoalItemId) {
    return {
      events: [{ type: "item.started", threadId, itemId, itemType: "goal", payload }],
      goalItemId: itemId,
    };
  }
  return {
    events: [{ type: "item.updated", threadId, itemId, payload }],
    goalItemId: itemId,
  };
}

function mapMuseCompactionCompleted(threadId: string, item: MuseMappedItem): RuntimeEvent[] {
  if (!shouldShowMuseCompaction(item)) return [];
  const args = {
    ...(item.trigger ? { trigger: item.trigger } : {}),
    ...(item.tokensBefore !== undefined ? { pre_tokens: item.tokensBefore } : {}),
    ...(item.tokensAfter !== undefined ? { post_tokens: item.tokensAfter } : {}),
  };
  return [
    {
      type: "item.started",
      threadId,
      itemId: item.itemId,
      itemType: "tool_call",
      payload: { name: "ContextCompaction", status: "running", args },
    },
    {
      type: "item.completed",
      threadId,
      itemId: item.itemId,
      payload: { name: "ContextCompaction", status: "success", args },
    },
  ];
}

function toolCallPayload(item: MuseMappedItem, status: "running" | "completed" | "error", result?: string) {
  const name = item.toolName?.trim() || "tool";
  const args = parseArgs(item.args);
  const serverId = museMcpServerId(name);
  const locations = toolLocations(args);
  return {
    name,
    title: name,
    kind: museToolKind(name),
    args,
    status,
    ...(serverId ? { serverId } : {}),
    ...(locations ? { locations } : {}),
    ...(result !== undefined
      ? { result }
      : item.failureReason && status === "error"
        ? { result: item.failureReason }
        : {}),
  };
}

function subagentPayload(
  item: MuseMappedItem,
  status: "running" | "completed" | "error",
  result?: string,
) {
  const title = item.objective?.trim() || item.role?.trim() || "subagent";
  return {
    name: title,
    title,
    kind: "other" as const,
    args: {
      ...(item.role ? { subagent_type: item.role } : {}),
      ...(item.objective ? { description: item.objective } : {}),
      ...(item.subagentId ? { subagent_id: item.subagentId } : {}),
      ...(item.childSessionId ? { child_session_id: item.childSessionId } : {}),
    },
    isSubAgent: true,
    status,
    ...(result !== undefined ? { result } : {}),
  };
}

function subagentResultText(item: MuseMappedItem): string | undefined {
  const result = item.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const rec = result as Record<string, unknown>;
    if (typeof rec.summary === "string" && rec.summary.trim()) return rec.summary;
    if (typeof rec.text === "string" && rec.text.trim()) return rec.text;
  }
  return item.visibleOutput ?? item.text ?? item.fallbackText ?? item.failureReason;
}

function toolStatus(status: string | undefined): "completed" | "error" {
  return status === "failed" ||
    status === "rejected" ||
    status === "timedOut" ||
    status === "cancelled"
    ? "error"
    : "completed";
}

export function planStatus(status: string | undefined): "pending" | "in_progress" | "completed" {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "inprogress" || normalized === "in_progress" || normalized === "running") {
    return "in_progress";
  }
  if (normalized === "completed" || normalized === "cancelled") return "completed";
  return "pending";
}

function goalStatus(status: string | undefined): GoalStatus {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "paused") return "paused";
  if (normalized === "complete" || normalized === "completed") return "complete";
  if (normalized === "failed") return "failed";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  return "active";
}

function toolLocations(args: unknown): Array<{ path: string }> | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const rec = args as Record<string, unknown>;
  const path = [rec.path, rec.file, rec.file_path, rec.filePath, rec.target].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return path ? [{ path }] : undefined;
}

function textBlocks(text: string | undefined): CanonicalContentBlock[] {
  return text ? [{ kind: "text", text }] : [];
}

function parseArgs(raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return raw;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
