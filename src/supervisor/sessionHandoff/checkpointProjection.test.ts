import { describe, expect, it } from "vitest";

import type { CraftPlan } from "@/shared/crafting";
import type { RuntimeSegment } from "@/shared/sessionHandoff";
import { projectConversationCheckpoint, renderCheckpointForTarget } from "./checkpointProjection";

const plan: CraftPlan = {
  id: "plan-source",
  recipeId: "recipe-source",
  resultItemId: "result-source",
  ingredients: {},
  runtimeBinding: {
    harnessKind: "codex",
    modelId: "gpt-test",
    vendor: "openai",
    runtimeAdapterId: "codex-native-runtime",
  },
  createdAt: "2026-08-31T00:00:00.000Z",
};

const segment: RuntimeSegment = {
  id: "segment-thread-1-1",
  threadId: "thread-1",
  ordinal: 0,
  bindingEpoch: 1,
  status: "active",
  craftPlanId: plan.id,
  recipeId: plan.recipeId,
  resultItemId: plan.resultItemId,
  runtimeBinding: plan.runtimeBinding,
  runtimeSessionId: "runtime-source",
  nativeSessionRef: "native-source",
  createdAt: "2026-08-31T00:00:00.000Z",
  activatedAt: "2026-08-31T00:00:00.000Z",
};

function message(
  id: string,
  type: "user_message" | "assistant_message" | "reasoning",
  text: string,
) {
  return {
    id,
    type,
    state: "completed" as const,
    payload: { content: [{ kind: "text", text }] },
    streams: {},
  };
}

describe("ConversationCheckpoint projection", () => {
  it("is deterministic, source-traceable, allowlisted, and secret-safe", () => {
    const input = {
      threadId: "thread-1",
      sourceSegment: segment,
      sourcePlan: plan,
      now: "2026-08-31T01:00:00.000Z",
      id: "checkpoint-fixed",
      maxCharacters: 500,
      items: [
        message(
          "user-1",
          "user_message",
          "Fix the handoff. api_key=sk-abcdefghijklmnop\nMust preserve the original goal.",
        ),
        message("reasoning-1", "reasoning", "hidden chain of thought must never leave"),
        {
          id: "request-1",
          type: "pending_request",
          state: "started" as const,
          payload: { requestId: "provider-handle", authorization: "Bearer abcdefghijklmnop" },
          streams: {},
        },
        message("assistant-1", "assistant_message", "Implemented the safe boundary."),
      ],
    };

    const first = projectConversationCheckpoint(input);
    const second = projectConversationCheckpoint(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      sourceSegmentId: segment.id,
      sourceRuntimeSessionId: "runtime-source",
      sourceNativeSessionRef: "native-source",
      provenance: {
        recipeId: plan.recipeId,
        craftPlanId: plan.id,
        modelId: "gpt-test",
        harnessKind: "codex",
      },
      taskFacts: {
        goalItemId: "user-1",
        constraints: [{ itemId: "user-1", text: "Must preserve the original goal." }],
      },
    });
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("sk-abcdefghijklmnop");
    expect(serialized).not.toContain("hidden chain of thought");
    expect(serialized).not.toContain("provider-handle");
    expect(serialized).toContain("[REDACTED]");
    expect(renderCheckpointForTarget(first)).toContain("this is not a native session resume");
  });

  it("enforces the configured character budget across every portable text field", () => {
    const checkpoint = projectConversationCheckpoint({
      threadId: "thread-1",
      sourceSegment: segment,
      sourcePlan: plan,
      now: "2026-08-31T01:00:00.000Z",
      id: "checkpoint-budget",
      maxCharacters: 120,
      maxRecentMessages: 8,
      items: [
        message("user-1", "user_message", `TASK-${"u".repeat(180)}`),
        {
          id: "plan-1",
          type: "plan",
          state: "completed",
          payload: { steps: [{ status: "completed", step: `DECISION-${"d".repeat(180)}` }] },
          streams: {},
        },
        {
          id: "command-1",
          type: "command_execution",
          state: "completed",
          payload: { command: `RESULT-${"r".repeat(180)}`, exitCode: 0 },
          streams: {},
        },
        message("assistant-1", "assistant_message", `STATE-${"a".repeat(180)}`),
      ],
    });

    const portableCharacters = [
      checkpoint.taskSummary,
      checkpoint.currentState,
      ...checkpoint.importantDecisions,
      ...checkpoint.importantResults,
      ...checkpoint.workspaceChanges,
      ...checkpoint.recentCompletedMessages.map((entry) => entry.content),
      ...(checkpoint.taskFacts?.constraints.map((entry) => entry.text) ?? []),
      ...(checkpoint.taskFacts?.pendingUserAsks.map((entry) => entry.text) ?? []),
      ...(checkpoint.taskFacts?.blockers.map((entry) => entry.text) ?? []),
      ...(checkpoint.taskFacts?.criticalFiles.map((entry) => entry.path) ?? []),
    ].reduce((total, value) => total + value.length, 0);

    expect(portableCharacters).toBeLessThanOrEqual(120);
    expect(checkpoint.projection.truncated).toBe(true);
    expect(checkpoint.anchors.lastIncludedItemId).toBe("assistant-1");
  });

  it("keeps the original goal, verified file anchors, blockers, and unanswered user asks", () => {
    const checkpoint = projectConversationCheckpoint({
      threadId: "thread-1",
      sourceSegment: segment,
      sourcePlan: plan,
      now: "2026-08-31T01:00:00.000Z",
      id: "checkpoint-facts",
      maxCharacters: 2_000,
      items: [
        message("user-goal", "user_message", "Implement durable workflow recovery."),
        message("assistant-progress", "assistant_message", "The persistence module is ready."),
        {
          id: "file-1",
          type: "file_change",
          state: "completed",
          payload: { path: "src/main/workflows/runIndex.ts", changeKind: "create" },
          streams: {},
        },
        {
          id: "error-1",
          type: "error",
          state: "completed",
          payload: { message: "Live runtime could not be reattached." },
          streams: {},
        },
        message("user-pending", "user_message", "Also keep the stop reason."),
      ],
    });

    expect(checkpoint.taskSummary).toBe("Implement durable workflow recovery.");
    expect(checkpoint.taskFacts).toMatchObject({
      goalItemId: "user-goal",
      pendingUserAsks: [{ itemId: "user-pending", text: "Also keep the stop reason." }],
      blockers: [{ itemId: "error-1", text: "Live runtime could not be reattached." }],
      criticalFiles: [{ itemId: "file-1", path: "src/main/workflows/runIndex.ts" }],
    });
    const rendered = renderCheckpointForTarget(checkpoint);
    expect(rendered).toContain("Pending user asks:");
    expect(rendered).toContain("Critical files:");
  });
});
