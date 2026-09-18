/**
 * Dispatch an ACP `SessionNotification` to zero-or-more canonical events.
 */

import type { ContentBlock, SessionNotification, SessionUpdate } from "@agentclientprotocol/sdk";
import type { CanonicalContentBlock, RuntimeEvent } from "@/shared/contracts";
import {
  createContextUsageEvent,
  isLikelyBillingAggregateUsage,
  usageFromProviderRecord,
} from "../../contextUsage";
import {
  classifySkillCatalogText,
  isSkillCatalogDump,
  shouldHoldSkillCatalogChunk,
} from "@/shared/skillCatalogDump";
import { stripGeminiHarnessNoise } from "@/shared/geminiHarnessNoise";
import { stripKimiHarnessNoise } from "@/shared/kimiHarnessNoise";
import {
  isRetryableCapacityError,
  stripRetryableCapacityNoise,
} from "@/shared/retryableCapacityError";
import { parseAcpAgentMessageApiError } from "../acpUserVisibleErrors";
import {
  classifyToolCallItemType,
  extractAcpTodoWriteSteps,
  isAcpTodoWriteTool,
  parsePlanMarkdownSteps,
} from "./contentExtraction";
import {
  applyTerminalToolCallName,
  buildAcpToolCallPayload,
  buildAcpToolCallUpdatePayload,
  finalizeToolCallPayload,
  findTerminalIdInContent,
  mergeProgressForEmission,
  mergeToolPayload,
} from "./toolCallPayloads";
import { isAcpAskUserQuestionToolCall } from "../acpQuestionPermissions";
import {
  buildSubAgentProgress,
  buildSubAgentProgressEvents,
  extractTaskCompleteSummary,
  getActiveSubAgentForNotification,
  isAcpSubAgentToolCall,
  isTaskCompleteSummary,
  isUpdateTopicTool,
  CRAFTSTATION_ACP_DETACHED_SUBAGENT_ACTIVITY_META_KEY,
  CRAFTSTATION_ACP_DETACHED_SUBAGENT_META_KEY,
  CRAFTSTATION_ACP_NEW_ASSISTANT_ITEM_META_KEY,
  CRAFTSTATION_ACP_SYNTHESIZE_SUBAGENT_RESULT_META_KEY,
  readAcpSubAgentProgressMeta,
  readAcpSubAgentStatusMeta,
  removeActiveSubAgent,
  selectActiveSubAgentForToolCall,
  tagSubAgentChildStarts,
} from "./subagents";
import {
  closeAllOpenContentItems,
  closeOpenContentItems,
  completeOpenContentItem,
  getContentItemState,
  hasOpenContentItems,
  newItemId,
  snapshotOrDelta,
} from "./state";
import type { ActiveAcpSubAgent, AcpMapperState } from "./state";
import {
  mapAcpCanonicalGoalUpdate as mapAcpCommandGoalUpdate,
  readAcpCanonicalGoalUpdate,
} from "./goal";
import { mapAcpCanonicalGoalUpdate } from "./goals";

function acpContentBlockToCanonical(block: ContentBlock): CanonicalContentBlock | undefined {
  if (block.type === "text") {
    return { kind: "text", text: block.text };
  }
  if (block.type === "image") {
    return {
      kind: "image",
      mimeType: block.mimeType ?? "application/octet-stream",
      dataUrl: `data:${block.mimeType ?? "application/octet-stream"};base64,${block.data}`,
    };
  }
  if (block.type === "resource_link") {
    return { kind: "file", path: block.uri.replace(/^file:\/\//, ""), name: block.name };
  }
  return undefined;
}

/**
 * Map a single ACP `SessionNotification` to zero-or-more canonical events.
 * Mutates `state` to track open items.
 */
export function mapAcpSessionUpdate(
  notification: SessionNotification,
  state: AcpMapperState,
): RuntimeEvent[] {
  const update: SessionUpdate = notification.update;
  const events: RuntimeEvent[] = [];
  const { threadId } = state;
  events.push(...mapAcpCanonicalGoalUpdate(update, state));
  let activeSubAgent = getActiveSubAgentForNotification(state, update);
  let pendingSubAgent: ActiveAcpSubAgent | undefined;

  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const parentToolCallId = activeSubAgent?.toolCallId;
      const contentState = getContentItemState(state, parentToolCallId);
      const messageMeta =
        update._meta && typeof update._meta === "object" && !Array.isArray(update._meta)
          ? (update._meta as Record<string, unknown>)
          : undefined;
      if (messageMeta?.[CRAFTSTATION_ACP_NEW_ASSISTANT_ITEM_META_KEY] === true) {
        events.push(...closeAllOpenContentItems(state));
      }
      let content = (update as { content?: ContentBlock }).content;
      const embedded = extractEmbeddedReasoning(update);
      if (embedded.reasoningText) {
        // A few ACP bridges (notably DeepSeek/OpenAI-compatible ones) carry
        // reasoning in agent_message_chunk instead of the standard
        // agent_thought_chunk. Project it onto a reasoning item, using
        // snapshot-vs-delta so cumulative replays do not concatenate twice.
        const reasoningDelta = snapshotOrDelta(contentState.reasoningAccum, embedded.reasoningText);
        if (reasoningDelta) {
          events.push(...completeOpenContentItem(contentState, threadId, "assistant"));
          if (!contentState.openReasoningItemId) {
            contentState.openReasoningItemId = newItemId("reason");
            events.push({
              type: "item.started",
              threadId,
              itemId: contentState.openReasoningItemId,
              itemType: "reasoning",
            });
          }
          events.push({
            type: "content.delta",
            threadId,
            itemId: contentState.openReasoningItemId,
            stream: "reasoning_text",
            delta: reasoningDelta,
          });
          contentState.reasoningAccum = (contentState.reasoningAccum ?? "") + reasoningDelta;
        }
      }
      if (embedded.assistantText !== undefined) {
        content =
          embedded.assistantText.length > 0
            ? { type: "text", text: embedded.assistantText }
            : undefined;
      }
      if (embedded.reasoningOnly) break;
      // Some ACP agents emit a blank text chunk after every tool call — empty
      // for most, newline-only for Factory Droid on DeepSeek models. It is only
      // a stream boundary, not an assistant message; opening an item for it
      // leaves a completed blank row between the tool and the next thought.
      if (content?.type === "text" && content.text.trim().length === 0) {
        // A zero-length chunk is always a no-op. Whitespace is real spacing
        // only once an assistant message is already streaming.
        if (content.text.length === 0 || !contentState.openAssistantItemId) break;
      }
      // Gemini echoes `[MODE_UPDATE] <mode>` as an agent text chunk whenever the
      // session is launched (or switched) into a specific approval mode. The
      // user already chose the mode in the launcher; surfacing the echo as
      // chat noise on every turn is just clutter. Drop it before we open an
      // assistant item so the chat stays clean.
      if (
        !contentState.openAssistantItemId &&
        content?.type === "text" &&
        /^\[MODE_UPDATE\]/.test(content.text)
      ) {
        break;
      }
      // Grok sometimes echoes the local skill catalog as a standalone assistant
      // chunk right before MCP/tool calls. The catalog often streams (header,
      // then ids) so hold prefixes and drop the dump instead of painting it.
      // Never prepend a held dump onto the next real sentence — that leaked
      // the whole catalog into chat and into the following Grok turn.
      if (content?.type === "text" && !contentState.openAssistantItemId) {
        const combined = `${state.pendingSkillCatalogText ?? ""}${content.text}`;
        if (shouldHoldSkillCatalogChunk(combined)) {
          state.pendingSkillCatalogText = combined;
          break;
        }
        if (state.pendingSkillCatalogText) {
          delete state.pendingSkillCatalogText;
        }
      }
      if (content?.type === "text") {
        const withoutHarness = stripKimiHarnessNoise(stripGeminiHarnessNoise(content.text) ?? "");
        if (!withoutHarness) break;
        content = { ...content, text: withoutHarness };
        if (isRetryableCapacityError(content.text)) break;
        if (content.text.split(/\r?\n/).some((line) => isRetryableCapacityError(line))) {
          const stripped = stripRetryableCapacityNoise(content.text);
          if (!stripped) break;
          content = { ...content, text: stripped };
        }
        const apiError = parseAcpAgentMessageApiError(content.text);
        if (apiError) {
          events.push(...closeOpenContentItems(state, parentToolCallId));
          events.push({ type: "error", threadId, message: apiError });
          break;
        }
      }
      // Open an assistant item on first chunk; emit deltas thereafter.
      // Switching from thought → answer always seals the live reasoning item
      // so the next thought round cannot append onto the previous chain, and
      // the next answer cannot glue onto the previous bubble.
      if (content?.type === "text") {
        const assistantDelta = snapshotOrDelta(contentState.assistantAccum, content.text);
        if (!assistantDelta) break;
        events.push(...completeOpenContentItem(contentState, threadId, "reasoning"));
        if (!contentState.openAssistantItemId) {
          events.push(...closeOpenContentItems(state, parentToolCallId));
          contentState.openAssistantItemId = newItemId("asst");
          events.push({
            type: "item.started",
            threadId,
            itemId: contentState.openAssistantItemId,
            itemType: "assistant_message",
          });
        }
        events.push({
          type: "content.delta",
          threadId,
          itemId: contentState.openAssistantItemId,
          stream: "assistant_text",
          delta: assistantDelta,
        });
        contentState.assistantAccum = (contentState.assistantAccum ?? "") + assistantDelta;
        break;
      }
      if (!content) break;
      events.push(...completeOpenContentItem(contentState, threadId, "reasoning"));
      if (!contentState.openAssistantItemId) {
        events.push(...closeOpenContentItems(state, parentToolCallId));
        contentState.openAssistantItemId = newItemId("asst");
        events.push({
          type: "item.started",
          threadId,
          itemId: contentState.openAssistantItemId,
          itemType: "assistant_message",
        });
      }
      const block = acpContentBlockToCanonical(content);
      if (block) {
        events.push({
          type: "item.updated",
          threadId,
          itemId: contentState.openAssistantItemId,
          payload: { content: [block] },
        });
      }
      break;
    }

    case "agent_thought_chunk": {
      if (state.pendingSkillCatalogText) delete state.pendingSkillCatalogText;
      const parentToolCallId = activeSubAgent?.toolCallId;
      const contentState = getContentItemState(state, parentToolCallId);
      const thoughtMeta =
        update._meta && typeof update._meta === "object" && !Array.isArray(update._meta)
          ? (update._meta as Record<string, unknown>)
          : undefined;
      if (thoughtMeta?.[CRAFTSTATION_ACP_NEW_ASSISTANT_ITEM_META_KEY] === true) {
        events.push(...closeAllOpenContentItems(state));
      }
      const thoughtContent = (update as { content?: ContentBlock }).content;
      if (
        thoughtContent?.type === "text" &&
        (isSkillCatalogDump(thoughtContent.text) ||
          classifySkillCatalogText(thoughtContent.text) === "header")
      ) {
        break;
      }
      let thoughtText = thoughtContent?.type === "text" ? thoughtContent.text : "";
      if (thoughtText) {
        const withoutHarness = stripKimiHarnessNoise(stripGeminiHarnessNoise(thoughtText) ?? "");
        if (!withoutHarness) break;
        thoughtText = withoutHarness;
      }
      if (thoughtText && isRetryableCapacityError(thoughtText)) break;
      if (thoughtText.split(/\r?\n/).some((line) => isRetryableCapacityError(line))) {
        const stripped = stripRetryableCapacityNoise(thoughtText);
        if (!stripped) break;
        thoughtText = stripped;
      }
      const thoughtDelta = snapshotOrDelta(contentState.reasoningAccum, thoughtText);
      if (!thoughtDelta) break;
      // A new thought round always seals the live assistant bubble so later
      // answer tokens cannot glue onto the previous paragraph.
      events.push(...completeOpenContentItem(contentState, threadId, "assistant"));
      if (!contentState.openReasoningItemId) {
        contentState.openReasoningItemId = newItemId("reason");
        events.push({
          type: "item.started",
          threadId,
          itemId: contentState.openReasoningItemId,
          itemType: "reasoning",
        });
      }
      events.push({
        type: "content.delta",
        threadId,
        itemId: contentState.openReasoningItemId,
        stream: "reasoning_text",
        delta: thoughtDelta,
      });
      contentState.reasoningAccum = (contentState.reasoningAccum ?? "") + thoughtDelta;
      break;
    }

    case "user_message_chunk": {
      // Intentional skip. The supervisor (or the renderer's optimistic push)
      // already emits a `user_message` item with a stable id at the start of
      // every turn we initiate via `startTurn`. Some ACP servers — Copilot
      // notably — echo the user's prompt back as `user_message_chunk`
      // updates, which the mapper would otherwise turn into a second
      // user_message item with a fresh id (no dedupe target). Dropping the
      // echo keeps the chat free of duplicates without losing data, since
      // the content is identical to what we already painted.
      break;
    }

    case "tool_call": {
      delete state.pendingSkillCatalogText;
      // First seal any open assistant/reasoning so the tool-call surfaces in order.
      events.push(...closeOpenContentItems(state, activeSubAgent?.toolCallId));
      const toolCall = update as {
        toolCallId: string;
        title?: string | null;
        kind?: string | null;
        /** ACP SDK ≥1.3 programmatic tool name (UNSTABLE). */
        name?: string | null;
        status?: "pending" | "in_progress" | "completed" | "failed";
        rawInput?: unknown;
        _meta?: unknown;
        content?: unknown;
        locations?: Array<{ path?: string | null; line?: number | null }> | null;
      };
      if (isAcpAskUserQuestionToolCall(toolCall)) {
        state.suppressedToolCallIds.add(toolCall.toolCallId);
        break;
      }
      // Gemini's `update_topic` is a meta-tool that re-titles the current
      // conversation topic — emitted on nearly every user turn as the model's
      // first action. It's noise in the chat stream (a "thinking" tool that
      // produces no user-facing artifact), so drop it entirely along with its
      // matching `tool_call_update`.
      if (isUpdateTopicTool(toolCall.title, toolCall.kind)) {
        state.suppressedToolCallIds.add(toolCall.toolCallId);
        break;
      }
      // Copilot's `task_complete` is the end-of-turn summary, not a real tool —
      // surface it as an assistant_message so it renders inline with the rest
      // of the response instead of as a collapsed accordion.
      if (isTaskCompleteSummary(toolCall.title, toolCall.kind)) {
        const text = extractTaskCompleteSummary(toolCall.rawInput);
        state.suppressedToolCallIds.add(toolCall.toolCallId);
        if (text) {
          const asstId = newItemId("asst");
          events.push({
            type: "item.started",
            threadId,
            itemId: asstId,
            itemType: "assistant_message",
          });
          events.push({
            type: "content.delta",
            threadId,
            itemId: asstId,
            stream: "assistant_text",
            delta: text,
          });
          events.push({ type: "item.completed", threadId, itemId: asstId });
        }
        break;
      }
      const goalUpdate = readAcpCanonicalGoalUpdate(toolCall.rawInput);
      if (goalUpdate) {
        state.suppressedToolCallIds.add(toolCall.toolCallId);
        events.push(...mapAcpCommandGoalUpdate(state, goalUpdate));
        break;
      }
      // `todo_write` / `todowrite` tool calls carry the same plan data that
      // Claude and OpenCode surface through their plan aggregators. Some ACP
      // agents (Kimi Code) emit these tool calls without a matching `plan`
      // session update, so we extract the steps here to keep the plan dock
      // in sync. The tool row itself is suppressed — the plan item is the
      // visible surface.
      if (isAcpTodoWriteTool(toolCall.title, toolCall.kind, toolCall.name)) {
        state.suppressedToolCallIds.add(toolCall.toolCallId);
        state.suppressedTodoWriteIds.add(toolCall.toolCallId);
        const steps = extractAcpTodoWriteSteps(toolCall.rawInput);
        if (steps.length > 0) {
          events.push(...emitAcpPlanSteps(state, steps, activeSubAgent?.toolCallId));
        }
        break;
      }
      const itemId = newItemId("tool");
      const status =
        toolCall.status === "completed"
          ? "success"
          : toolCall.status === "failed"
            ? "error"
            : "running";
      const itemType = classifyToolCallItemType(toolCall.kind, toolCall.title, toolCall.locations);
      const isSubAgent = isAcpSubAgentToolCall(toolCall);
      if (!isSubAgent) {
        activeSubAgent = selectActiveSubAgentForToolCall(state, toolCall);
      }
      const rawInput =
        toolCall.rawInput &&
        typeof toolCall.rawInput === "object" &&
        !Array.isArray(toolCall.rawInput)
          ? (toolCall.rawInput as Record<string, unknown>)
          : undefined;
      const meta =
        toolCall._meta && typeof toolCall._meta === "object" && !Array.isArray(toolCall._meta)
          ? (toolCall._meta as Record<string, unknown>)
          : undefined;
      const detached =
        isSubAgent &&
        (rawInput?.background === true ||
          rawInput?.run_in_background === true ||
          meta?.[CRAFTSTATION_ACP_DETACHED_SUBAGENT_META_KEY] === true);
      const payload = buildAcpToolCallPayload(
        itemType,
        toolCall,
        status,
        isSubAgent,
        state.resolveTerminalOutput,
        state.resolveTerminalOutputByCommand,
      );
      const terminalId = findTerminalIdInContent((toolCall as { content?: unknown }).content);
      state.toolCallItems.set(toolCall.toolCallId, {
        itemId,
        itemType,
        payload,
        isSubAgent,
        detached,
        ...(terminalId ? { terminalId } : {}),
      });
      events.push({
        type: "item.started",
        threadId,
        itemId,
        itemType,
        payload,
      });
      if (toolCall.status === "completed" || toolCall.status === "failed") {
        events.push({
          type: "item.completed",
          threadId,
          itemId,
          payload: finalizeToolCallPayload(state, {
            itemId,
            itemType,
            payload,
            isSubAgent,
            detached,
            ...(terminalId ? { terminalId } : {}),
          }),
        });
        state.toolCallItems.delete(toolCall.toolCallId);
      }
      if (isSubAgent && toolCall.status !== "completed" && toolCall.status !== "failed") {
        pendingSubAgent = { toolCallId: toolCall.toolCallId, itemId, hasChildActivity: false };
      }
      break;
    }

    case "tool_call_update": {
      const toolCall = update as {
        toolCallId: string;
        title?: string | null;
        kind?: string | null;
        /** ACP SDK ≥1.3 programmatic tool name (UNSTABLE). */
        name?: string | null;
        status?: "pending" | "in_progress" | "completed" | "failed";
        rawInput?: unknown;
        rawOutput?: unknown;
        content?: unknown;
        _meta?: unknown;
        locations?: Array<{ path?: string | null; line?: number | null }> | null;
      };
      if (state.suppressedToolCallIds.has(toolCall.toolCallId)) {
        // `todo_write` tool calls may carry a more complete `rawInput` on the
        // update notification (e.g. after the tool finishes executing). Re-
        // extract plan steps so the dock reflects the final state.
        if (state.suppressedTodoWriteIds.has(toolCall.toolCallId)) {
          const steps = extractAcpTodoWriteSteps(toolCall.rawInput);
          if (steps.length > 0) {
            events.push(...emitAcpPlanSteps(state, steps, activeSubAgent?.toolCallId));
          }
        }
        if (toolCall.status === "completed" || toolCall.status === "failed") {
          state.suppressedToolCallIds.delete(toolCall.toolCallId);
          state.suppressedTodoWriteIds.delete(toolCall.toolCallId);
        }
        break;
      }
      const item = state.toolCallItems.get(toolCall.toolCallId);
      if (!item) break;
      const updateMeta =
        toolCall._meta && typeof toolCall._meta === "object" && !Array.isArray(toolCall._meta)
          ? (toolCall._meta as Record<string, unknown>)
          : undefined;
      const updateRawInput =
        toolCall.rawInput &&
        typeof toolCall.rawInput === "object" &&
        !Array.isArray(toolCall.rawInput)
          ? (toolCall.rawInput as Record<string, unknown>)
          : undefined;
      if (
        updateRawInput?.background === true ||
        updateRawInput?.run_in_background === true ||
        updateMeta?.[CRAFTSTATION_ACP_DETACHED_SUBAGENT_META_KEY] === true
      ) {
        item.detached = true;
      }
      const isTerminal = toolCall.status === "completed" || toolCall.status === "failed";
      const hasTopLevelDetachedReply =
        updateMeta?.[CRAFTSTATION_ACP_DETACHED_SUBAGENT_ACTIVITY_META_KEY] ===
          toolCall.toolCallId && hasOpenContentItems(state);
      const status =
        toolCall.status === "completed"
          ? "success"
          : toolCall.status === "failed"
            ? "error"
            : "running";
      const updateTerminalId = findTerminalIdInContent((toolCall as { content?: unknown }).content);
      if (updateTerminalId) item.terminalId = updateTerminalId;
      const payload = buildAcpToolCallUpdatePayload(
        item,
        toolCall,
        status,
        state.resolveTerminalOutput,
        state.resolveTerminalOutputByCommand,
      );
      const hasOpenSubAgentContent =
        item.isSubAgent &&
        isTerminal &&
        updateMeta?.[CRAFTSTATION_ACP_SYNTHESIZE_SUBAGENT_RESULT_META_KEY] !== true &&
        (hasOpenContentItems(state, activeSubAgent?.toolCallId) || hasTopLevelDetachedReply);
      const subAgentProgress =
        item.isSubAgent && !hasOpenSubAgentContent
          ? buildSubAgentProgress(toolCall, payload, status)
          : undefined;
      const reportedProgress = item.isSubAgent
        ? readAcpSubAgentProgressMeta(toolCall._meta)
        : undefined;
      const progress = {
        ...reportedProgress,
        ...(subAgentProgress?.label
          ? {
              description: subAgentProgress.label,
              ...(subAgentProgress.summary ? { summary: subAgentProgress.summary } : {}),
            }
          : {}),
      };
      const reportedStatus = item.isSubAgent
        ? readAcpSubAgentStatusMeta(toolCall._meta)
        : undefined;
      const metadataPayload = {
        ...(Object.keys(progress).length > 0 ? { progress } : {}),
        ...(reportedStatus ? { subAgentStatus: reportedStatus } : {}),
      };
      const nextPayload =
        Object.keys(metadataPayload).length > 0
          ? mergeToolPayload(payload, metadataPayload)
          : payload;
      if (toolCall.rawInput !== undefined) nextPayload.args = toolCall.rawInput;
      const mergedRaw = mergeToolPayload(item.payload, nextPayload);
      const emittedRaw = mergeProgressForEmission(nextPayload, mergedRaw);
      // On completion, guarantee a name so a bare tool call can't finish hidden.
      const { merged: mergedPayload, emitted: emittedPayload } = isTerminal
        ? applyTerminalToolCallName(mergedRaw, emittedRaw)
        : { merged: mergedRaw, emitted: emittedRaw };
      item.payload = mergedPayload;
      if (isTerminal && item.isSubAgent) {
        if (hasTopLevelDetachedReply) events.push(...closeOpenContentItems(state));
        events.push(...closeOpenContentItems(state, activeSubAgent?.toolCallId));
      }
      const parentEvent: RuntimeEvent = {
        type: isTerminal ? "item.completed" : "item.updated",
        threadId,
        itemId: item.itemId,
        payload: emittedPayload,
      };
      const progressEvents = subAgentProgress?.text
        ? buildSubAgentProgressEvents(state, item, subAgentProgress.text, isTerminal)
        : isTerminal && item.subAgentProgressItemId
          ? [
              {
                type: "item.completed" as const,
                threadId,
                itemId: item.subAgentProgressItemId,
              },
            ]
          : [];
      // Child transcript events must precede the terminal parent event. The
      // runtime router drains buffered children when the parent completes.
      if (isTerminal) {
        events.push(...progressEvents, parentEvent);
      } else {
        events.push(parentEvent, ...progressEvents);
      }
      if (isTerminal) {
        state.toolCallItems.delete(toolCall.toolCallId);
        if (item.isSubAgent) {
          removeActiveSubAgent(state, toolCall.toolCallId);
        }
      }
      break;
    }

    case "plan": {
      const plan = update as {
        entries?: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>;
        content?: {
          entries?: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>;
        };
      };
      const rawEntries = plan.entries ?? plan.content?.entries ?? [];
      const steps = rawEntries.map((entry) => ({ step: entry.content, status: entry.status }));
      events.push(...emitAcpPlanSteps(state, steps, activeSubAgent?.toolCallId));
      break;
    }

    // --- UNSTABLE / experimental plan variants (ACP SDK ≥1.2) ---

    case "plan_update": {
      const planUpdate = update as {
        plan?:
          | {
              type: "items";
              planId?: string;
              entries?: Array<{
                content: string;
                status: "pending" | "in_progress" | "completed";
              }>;
            }
          | { type: "file"; planId?: string; uri?: string }
          | { type: "markdown"; planId?: string; content?: string };
      };
      const content = planUpdate.plan;
      if (!content) break;
      if (content.type === "items") {
        const rawEntries = content.entries ?? [];
        const steps = rawEntries.map((entry) => ({
          step: entry.content,
          status: entry.status,
        }));
        events.push(...emitAcpPlanSteps(state, steps, activeSubAgent?.toolCallId));
      } else if (content.type === "markdown" && typeof content.content === "string") {
        const steps = parsePlanMarkdownSteps(content.content);
        if (steps.length > 0) {
          events.push(...emitAcpPlanSteps(state, steps, activeSubAgent?.toolCallId));
        }
      }
      // `file` variant: the plan lives in a file referenced by URI. The pure
      // mapper has no filesystem access; the session layer would need to
      // resolve the URI and re-emit as `items`. Skipped until a provider
      // actually uses this variant.
      break;
    }

    case "plan_removed": {
      // Complete and clear the open plan item, if any.
      if (state.openPlanItemId) {
        events.push({
          type: "item.completed",
          threadId,
          itemId: state.openPlanItemId,
        });
        delete state.openPlanItemId;
        delete state.openPlanSteps;
      }
      break;
    }

    case "current_mode_update": {
      const modeUpdate = update as { currentModeId?: string };
      if (modeUpdate.currentModeId) {
        events.push({
          type: "warning",
          threadId,
          message: `Mode changed to ${modeUpdate.currentModeId}`,
        });
      }
      break;
    }

    case "usage_update": {
      const raw = update as Record<string, unknown>;
      const meta = raw._meta;
      const nested = raw.usage;
      const merged: Record<string, unknown> = {
        ...raw,
        ...(nested && typeof nested === "object" && !Array.isArray(nested)
          ? (nested as Record<string, unknown>)
          : {}),
        ...(meta && typeof meta === "object" && !Array.isArray(meta)
          ? (meta as Record<string, unknown>)
          : {}),
      };
      // ACP `used` is context occupancy. Promote it to Input when the
      // provider did not send a separate prompt/input counter so the
      // composer panel can show 输入 / 缓存命中率 instead of a blank row.
      if (
        merged.inputTokens === undefined &&
        merged.input_tokens === undefined &&
        merged.prompt_tokens === undefined
      ) {
        const used = merged.used;
        if (typeof used === "number") merged.inputTokens = used;
      }
      const usage = usageFromProviderRecord(merged);
      const event = createContextUsageEvent(threadId, usage);
      if (event) events.push(event);
      const input = usage?.breakdown?.find((entry) => entry.id === "input")?.tokens;
      const output = usage?.breakdown?.find((entry) => entry.id === "output")?.tokens ?? 0;
      if (input !== undefined && input + output > 0) {
        events.push({
          type: "usage.spent",
          threadId,
          usage: {
            counterKind: "per-call",
            counter: input + output,
            scopeId: threadId,
            epoch: 0,
            sampleId: `acp-usage:${threadId}:${input}:${output}`,
          },
        });
      }
      break;
    }

    default:
      // `session_info_update`, `config_option_update`, and
      // `available_commands_update` don't produce chat items — they flow
      // through the session layer's status/config/slash-command channels.
      // Grok occupancy kinds (`tokens_used`, `auto_compact_started`, …) are
      // collected below alongside stream `_meta.totalTokens`.
      break;
  }

  events.push(...mapAcpContextOccupancy(update, state));

  // Consecutive sub-agent starts are ambiguous in ACP: the protocol carries no
  // parent id. Treat them as parallel siblings until the active agent has
  // emitted real child activity; only then is a later launch safely nested.
  if (activeSubAgent && (!pendingSubAgent || activeSubAgent.hasChildActivity)) {
    tagSubAgentChildStarts(events, activeSubAgent, state);
  }
  if (pendingSubAgent) {
    state.activeSubAgents.push(pendingSubAgent);
  }
  return events;
}

/**
 * Grok Build (and a few other ACP CLIs) report window occupancy outside the
 * standard `usage_update` shape:
 *   - `sessionUpdate: "tokens_used" | "auto_compact_started"` with
 *     `tokens_used` + `context_window`
 *   - `_meta.totalTokens` on every thought / tool / message chunk
 * Prompt-response `usage.totalTokens` is a billing aggregate and must not
 * move the context bar (see `isLikelyBillingAggregateUsage`).
 */
const ACP_OCCUPANCY_SESSION_UPDATES = new Set([
  "tokens_used",
  "auto_compact_started",
  "context_usage",
  "contextUsage",
  "token_usage",
  "tokenUsage",
  "usage",
]);

function mapAcpContextOccupancy(update: SessionUpdate, state: AcpMapperState): RuntimeEvent[] {
  const rec = update as unknown as Record<string, unknown>;
  const kind = typeof rec.sessionUpdate === "string" ? rec.sessionUpdate : "";
  if (kind === "usage_update") return [];
  const meta =
    rec._meta && typeof rec._meta === "object" && !Array.isArray(rec._meta)
      ? (rec._meta as Record<string, unknown>)
      : {};
  const occupancyKind = ACP_OCCUPANCY_SESSION_UPDATES.has(kind);
  const source = occupancyKind ? { ...rec, ...meta } : { ...meta };
  if (!occupancyKind && !hasStreamOccupancyMeta(meta)) return [];
  if (isLikelyBillingAggregateUsage(source)) return [];
  const usage = usageFromProviderRecord(source);
  const event = createContextUsageEvent(state.threadId, usage);
  if (!event || event.type !== "context.updated") return [];
  const signature = JSON.stringify(event.usage);
  if (state.lastContextOccupancySignature === signature) return [];
  state.lastContextOccupancySignature = signature;
  return [event];
}

function hasStreamOccupancyMeta(meta: Record<string, unknown>): boolean {
  return [
    "totalTokens",
    "total_tokens",
    "tokens_used",
    "used",
    "context_window",
    "contextWindow",
  ].some((key) => {
    const value = meta[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  });
}

/** Normalize provider-specific thought fields/tags into the ACP reasoning stream. */
function extractEmbeddedReasoning(update: SessionUpdate): {
  reasoningText?: string;
  assistantText?: string;
  reasoningOnly: boolean;
} {
  const raw = update as unknown as Record<string, unknown>;
  const content = raw.content;
  const meta = raw._meta;
  const metaRecord =
    meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : undefined;
  const direct = [
    raw.reasoning_content,
    raw.reasoningContent,
    raw.thought,
    raw.thinking,
    raw.analysis,
  ].find((value) => typeof value === "string" && value.length > 0);
  const markedThought =
    metaRecord &&
    [metaRecord.reasoning, metaRecord.thinking, metaRecord.thought, metaRecord.isThought].some(
      (value) => value === true || typeof value === "string",
    );
  const contentText =
    content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    (content as Record<string, unknown>).type === "text"
      ? String((content as Record<string, unknown>).text ?? "")
      : undefined;
  if (typeof direct === "string") {
    if (contentText && contentText.length > 0 && contentText !== direct) {
      return { reasoningText: direct, assistantText: contentText, reasoningOnly: false };
    }
    return { reasoningText: direct, reasoningOnly: true };
  }
  if (markedThought && contentText) return { reasoningText: contentText, reasoningOnly: true };
  if (!contentText) return { reasoningOnly: false };
  const match =
    /(?:<think(?:ing)?\s*>|<analysis\s*>)([\s\S]*?)(?:<\/(?:think(?:ing)?|analysis)>|$)/i.exec(
      contentText,
    );
  if (!match) return { reasoningOnly: false };
  const reasoningText = match[1] ?? "";
  const assistantText = contentText.replace(match[0], "");
  return { reasoningText, assistantText, reasoningOnly: assistantText.length === 0 };
}

/**
 * Create or update the open plan item from a set of steps. Shared between the
 * ACP `plan` session-update handler and the `todo_write` tool-call handler so
 * both paths produce identical plan lifecycle events.
 */
function emitAcpPlanSteps(
  state: AcpMapperState,
  steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>,
  parentToolCallId?: string,
): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  const { threadId } = state;
  state.openPlanSteps = steps;
  if (!state.openPlanItemId) {
    events.push(...closeOpenContentItems(state, parentToolCallId));
    state.openPlanItemId = newItemId("plan");
    events.push({
      type: "item.started",
      threadId,
      itemId: state.openPlanItemId,
      itemType: "plan",
      payload: { steps },
    });
  } else {
    events.push({
      type: "item.updated",
      threadId,
      itemId: state.openPlanItemId,
      payload: { steps },
    });
  }
  if (steps.length > 0 && steps.every((s) => s.status === "completed")) {
    events.push({
      type: "item.completed",
      threadId,
      itemId: state.openPlanItemId,
      payload: { steps },
    });
    delete state.openPlanItemId;
    delete state.openPlanSteps;
  }
  return events;
}
