import { randomUUID } from "node:crypto";

import type { CraftPlan } from "@/shared/crafting";
import type { ConversationCheckpoint, RuntimeSegment } from "@/shared/sessionHandoff";
import { conversationCheckpointSchema } from "@/shared/sessionHandoff";
import { redactPortableText } from "./redaction";

export interface PortableLedgerItem {
  id: string;
  type: string;
  state: "started" | "updated" | "completed";
  payload?: unknown;
  streams: Record<string, string>;
}

export interface CheckpointProjectionInput {
  threadId: string;
  sourceSegment: RuntimeSegment;
  sourcePlan: CraftPlan;
  items: readonly PortableLedgerItem[];
  lastCompletedTurnAnchorItemId?: string;
  maxCharacters?: number;
  maxRecentMessages?: number;
  now?: string;
  id?: string;
}

const DEFAULT_MAX_CHARACTERS = 24_000;
const DEFAULT_RECENT_MESSAGES = 8;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function contentText(payload: unknown): string {
  const content = record(payload)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      const value = record(block);
      if (value?.kind === "text" && typeof value.text === "string") return [value.text];
      if (value?.kind === "file" && typeof value.path === "string") return [`@${value.path}`];
      return [];
    })
    .join("\n");
}

function itemText(item: PortableLedgerItem): string {
  if (item.type === "user_message" || item.type === "assistant_message") {
    return contentText(item.payload) || item.streams.assistant_text || "";
  }
  return "";
}

function bulletTexts(items: readonly PortableLedgerItem[], type: string): string[] {
  return items.flatMap((item) => {
    if (item.state !== "completed" || item.type !== type) return [];
    const payload = record(item.payload);
    if (type === "file_change" && typeof payload?.path === "string") {
      return [`${String(payload.changeKind ?? "change")}: ${payload.path}`];
    }
    if (type === "command_execution") {
      const command = typeof payload?.command === "string" ? payload.command : "command";
      const exitCode = typeof payload?.exitCode === "number" ? ` (exit ${payload.exitCode})` : "";
      return [`${command}${exitCode}`];
    }
    if (type === "plan" && Array.isArray(payload?.steps)) {
      return payload.steps.flatMap((step) => {
        const row = record(step);
        return typeof row?.step === "string" ? [`${row.status ?? "pending"}: ${row.step}`] : [];
      });
    }
    return [];
  });
}

export function projectConversationCheckpoint(
  input: CheckpointProjectionInput,
): ConversationCheckpoint {
  const completed = input.items.filter(
    (item) => item.state === "completed" && item.type !== "reasoning",
  );
  const messages = completed
    .filter((item) => item.type === "user_message" || item.type === "assistant_message")
    .flatMap((item) => {
      const raw = itemText(item).trim();
      if (!raw) return [];
      return [
        {
          role: item.type === "user_message" ? ("user" as const) : ("assistant" as const),
          content: raw,
          itemId: item.id,
        },
      ];
    });
  const latestUser = [...messages].reverse().find((entry) => entry.role === "user")?.content ?? "";
  const latestAssistant =
    [...messages].reverse().find((entry) => entry.role === "assistant")?.content ?? "";
  const decisions = bulletTexts(completed, "plan");
  const results = bulletTexts(completed, "command_execution");
  const workspaceChanges = bulletTexts(completed, "file_change");
  const maxCharacters = input.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const maxRecentMessages = input.maxRecentMessages ?? DEFAULT_RECENT_MESSAGES;
  const selected = messages.slice(-maxRecentMessages);
  let used = 0;
  let redactions = 0;
  let truncated = messages.length > selected.length;
  const take = (value: string, limit: number, fromEnd = false): string => {
    const available = Math.max(0, Math.min(limit, maxCharacters - used));
    if (available === 0) {
      if (value.length > 0) truncated = true;
      return "";
    }
    const content =
      value.length <= available
        ? value
        : fromEnd
          ? value.slice(-available)
          : value.slice(0, available);
    if (content.length < value.length) truncated = true;
    used += content.length;
    return content;
  };
  const task = redactPortableText(latestUser.slice(0, 2_000));
  const state = redactPortableText(latestAssistant.slice(-2_000));
  redactions += task.redactions + state.redactions;
  // Reserve deterministic semantic shares before optional detail lists. Tiny
  // target budgets still retain a task prefix, current-state tail, and the
  // newest completed message instead of allowing any one field to starve all
  // others. Unused shares remain available to later fields.
  const summaryShare = Math.max(1, Math.floor(maxCharacters * 0.2));
  const stateShare = Math.max(1, Math.floor(maxCharacters * 0.2));
  const recentShare = Math.max(1, Math.floor(maxCharacters * 0.4));
  const taskSummary = take(task.text, summaryShare);
  const currentState = take(state.text, stateShare, true);
  const recentBudgetEnd = Math.min(maxCharacters, used + recentShare);
  const recentCompletedMessages = selected
    .reverse()
    .flatMap((message) => {
      const redacted = redactPortableText(message.content);
      redactions += redacted.redactions;
      const remaining = Math.max(0, recentBudgetEnd - used);
      if (remaining === 0) {
        if (redacted.text.length > 0) truncated = true;
        return [];
      }
      const content = take(redacted.text, remaining, true);
      if (!content) return [];
      return [{ ...message, content }];
    })
    .reverse();
  const projectList = (values: readonly string[]) =>
    values.flatMap((value) => {
      const result = redactPortableText(value);
      redactions += result.redactions;
      const content = take(result.text, maxCharacters - used);
      return content ? [content] : [];
    });
  const importantDecisions = projectList(decisions.slice(-12));
  const importantResults = projectList(results.slice(-12));
  const projectedWorkspaceChanges = projectList(workspaceChanges.slice(-20));
  return conversationCheckpointSchema.parse({
    schemaVersion: 1,
    id: input.id ?? `checkpoint:${randomUUID()}`,
    threadId: input.threadId,
    sourceSegmentId: input.sourceSegment.id,
    ...(input.sourceSegment.runtimeSessionId
      ? { sourceRuntimeSessionId: input.sourceSegment.runtimeSessionId }
      : {}),
    ...(input.sourceSegment.nativeSessionRef
      ? { sourceNativeSessionRef: input.sourceSegment.nativeSessionRef }
      : {}),
    createdAt: input.now ?? new Date().toISOString(),
    taskSummary,
    currentState,
    importantDecisions,
    importantResults,
    workspaceChanges: projectedWorkspaceChanges,
    recentCompletedMessages,
    anchors: {
      ...(recentCompletedMessages[0]?.itemId
        ? { firstIncludedItemId: recentCompletedMessages[0].itemId }
        : {}),
      ...(recentCompletedMessages.at(-1)?.itemId
        ? { lastIncludedItemId: recentCompletedMessages.at(-1)!.itemId }
        : {}),
      ...(input.lastCompletedTurnAnchorItemId
        ? { lastCompletedTurnAnchorItemId: input.lastCompletedTurnAnchorItemId }
        : {}),
    },
    projection: {
      policy: "summary-state-results-recent-turns",
      maxCharacters,
      maxRecentMessages,
      truncated,
      redactions,
    },
    provenance: {
      recipeId: input.sourcePlan.recipeId,
      craftPlanId: input.sourcePlan.id,
      modelId: input.sourcePlan.runtimeBinding.modelId,
      harnessKind: input.sourcePlan.runtimeBinding.harnessKind,
    },
  });
}

export function renderCheckpointForTarget(checkpoint: ConversationCheckpoint): string {
  const lines = [
    "[CraftStation portable conversation handoff; this is not a native session resume]",
    `Task summary: ${checkpoint.taskSummary || "Not available"}`,
    `Current state: ${checkpoint.currentState || "Not available"}`,
  ];
  if (checkpoint.importantDecisions.length) {
    lines.push(
      "Important decisions:",
      ...checkpoint.importantDecisions.map((value) => `- ${value}`),
    );
  }
  if (checkpoint.importantResults.length) {
    lines.push("Important results:", ...checkpoint.importantResults.map((value) => `- ${value}`));
  }
  if (checkpoint.workspaceChanges.length) {
    lines.push("Workspace changes:", ...checkpoint.workspaceChanges.map((value) => `- ${value}`));
  }
  if (checkpoint.recentCompletedMessages.length) {
    lines.push(
      "Recent completed messages:",
      ...checkpoint.recentCompletedMessages.map(
        (message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`,
      ),
    );
  }
  return lines.join("\n");
}
