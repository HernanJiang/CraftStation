import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import type { NativeHarnessDescriptor } from "@/shared/crafting";
import { stripGeminiHarnessNoise } from "@/shared/geminiHarnessNoise";
import {
  isRetryableCapacityError,
  stripRetryableCapacityNoise,
} from "@/shared/retryableCapacityError";
import { createContextUsageEvent, usageFromProviderRecord } from "@/supervisor/agents/contextUsage";
import type { NativeWireEvent } from "./nativeTransport";
import { redactNativePayload } from "./nativeTransport";

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function antigravityEventPayload(event: NativeWireEvent): Record<string, unknown> {
  const nested = recordValue(event.payload[event.type]);
  return nested ?? event.payload;
}

function firstString(candidates: unknown[]): string | undefined {
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

function textFrom(payload: Record<string, unknown>): string | undefined {
  // `response` on a step_update is the full snapshot, not a delta. Using it
  // here re-appends the whole answer (plus harness receipts) at wrap-up.
  return firstString([payload.text_delta, payload.delta, payload.text]);
}

function thinkingFrom(payload: Record<string, unknown>): string | undefined {
  return firstString([
    payload.thinking_delta,
    payload.thinkingDelta,
    payload.thought_delta,
    payload.thoughtDelta,
    payload.reasoning_delta,
    payload.reasoningDelta,
    payload.thinking,
    payload.thought,
  ]);
}

function isThinkingStep(stepType: string): boolean {
  return /^(?:thinking|thought|agent_thought|reasoning)$/i.test(stepType);
}

/**
 * Per-turn mutable state for thinking-run attribution. Some providers emit
 * thinking `step_update` frames without a `step_index`; without extra state
 * every one of those deltas collapses into a single `thought:{turnId}` item
 * anchored at the turn's top, so thoughts that actually arrived *between*
 * tool calls all render as one block above the tools. The state splits the
 * stream into one item per contiguous thinking run: a tool/subagent step or
 * assistant text closes the open run, and the next thinking delta opens a new
 * one at its true timeline position.
 */
export interface NativeCanonicalizerTurnState {
  /** Item id of the currently open thinking run, if any. */
  openThoughtItemId: string | undefined;
  /** Thinking runs allocated so far this turn (run 0 keeps the legacy id). */
  thoughtRuns: number;
  /** A non-thinking step arrived since the open run started. */
  interrupted: boolean;
}

export function createNativeCanonicalizerTurnState(): NativeCanonicalizerTurnState {
  return { openThoughtItemId: undefined, thoughtRuns: 0, interrupted: false };
}

function visibleText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return stripRetryableCapacityNoise(stripGeminiHarnessNoise(value) ?? "");
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isTerminalToolState(state: string): boolean {
  return ["DONE", "COMPLETED", "SUCCESS", "FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(
    state,
  );
}

function dshEvent(event: NativeWireEvent): {
  type: string;
  payload: Record<string, unknown>;
  providerSessionId?: string;
} {
  if (event.type === "session.event") {
    const params = recordValue(event.payload.params) ?? event.payload;
    const native = recordValue(params?.event) ?? recordValue(event.payload.event);
    if (native && typeof native.type === "string") {
      return {
        type: native.type,
        payload: recordValue(native.data) ?? {},
        ...(typeof params?.sessionId === "string" ? { providerSessionId: params.sessionId } : {}),
      };
    }
    return { type: event.type, payload: params ?? event.payload };
  }
  if (event.type === "session.status") {
    const params = recordValue(event.payload.params) ?? event.payload;
    return {
      type: event.type,
      payload: params ?? event.payload,
      ...(typeof params?.sessionId === "string" ? { providerSessionId: params.sessionId } : {}),
    };
  }
  return { type: event.type, payload: event.payload };
}

function turnState(reason: unknown): "completed" | "failed" | "interrupted" | "cancelled" {
  const kind = recordValue(reason)?.kind;
  if (kind === "cancelled") return "cancelled";
  if (kind === "interrupted" || kind === "aborted") return "interrupted";
  if (kind === "error" || kind === "failed" || kind === "max-tokens" || kind === "blocked")
    return "failed";
  return "completed";
}

function usageEvent(
  threadId: string,
  turnId: string,
  correlationId: string,
  sequence: number,
  providerSessionId: string | undefined,
  usage: Record<string, unknown> | undefined,
): RuntimeEvent[] {
  if (!usage) return [];
  const inputTokens =
    numberValue(usage.inputTokens) ??
    numberValue(usage.input_tokens) ??
    numberValue(usage.prompt_tokens) ??
    0;
  const outputTokens =
    numberValue(usage.outputTokens) ??
    numberValue(usage.output_tokens) ??
    numberValue(usage.completion_tokens) ??
    0;
  const events: RuntimeEvent[] = [];
  if (inputTokens + outputTokens > 0) {
    events.push({
      type: "usage.spent",
      threadId,
      usage: {
        counterKind: "per-call",
        counter: inputTokens + outputTokens,
        scopeId: providerSessionId ?? threadId,
        epoch: 0,
        sampleId: `${correlationId}:${sequence}`,
        turnId,
      },
    });
  }
  const context = createContextUsageEvent(threadId, usageFromProviderRecord(usage));
  if (context) events.push(context);
  return events;
}

export function canonicalizeNativeEvent(input: {
  descriptor: NativeHarnessDescriptor;
  threadId: string;
  turnId: string;
  correlationId: string;
  event: NativeWireEvent;
  /** Per-turn mutable state; required to split step-less thinking into runs. */
  thoughtRunState?: NativeCanonicalizerTurnState;
}): RuntimeEvent[] {
  const { descriptor, threadId, turnId, correlationId, event, thoughtRunState } = input;
  const native =
    descriptor.harnessKind === "deepseek"
      ? dshEvent(event)
      : { type: event.type, payload: antigravityEventPayload(event) };
  const { type: nativeType, payload, providerSessionId } = native;
  const envelope = {
    harnessKind: descriptor.harnessKind,
    source: "native" as const,
    nativeType,
    ...(providerSessionId ? { providerSessionId } : {}),
    sequence: event.sequence,
    correlationId,
    receivedAt: new Date().toISOString(),
    payload: redactNativePayload(payload),
  };
  const attach = (runtimeEvent: RuntimeEvent): RuntimeEvent => ({
    ...runtimeEvent,
    nativeEnvelope: envelope,
  });

  if (nativeType === "init") return [attach({ type: "session.started", threadId, turnId })];
  if (nativeType === "step_update") {
    const result: RuntimeEvent[] = [];
    const stepType = typeof payload.step_type === "string" ? payload.step_type : "";
    const conversationId = String(payload.conversation_id ?? threadId);
    const stepKey =
      payload.step_index !== undefined && payload.step_index !== null
        ? String(payload.step_index)
        : undefined;
    if (stepType === "tool" || stepType === "subagent") {
      if (thoughtRunState) thoughtRunState.interrupted = true;
      const stepIndex = String(payload.step_index ?? event.sequence);
      const itemId = `${stepType}:${conversationId}:${stepIndex}`;
      const state = String(payload.state ?? "").toUpperCase();
      const toolInfo = recordValue(payload.tool_info);
      const name =
        typeof payload.tool_name === "string"
          ? payload.tool_name
          : typeof toolInfo?.name === "string"
            ? toolInfo.name
            : stepType === "subagent"
              ? "Antigravity subagent"
              : "Antigravity tool";
      const toolParameters = recordValue(toolInfo?.parameters);
      const toolOutput = toolInfo?.output ?? payload.output;
      const toolError = toolInfo?.error ?? payload.error;
      const mcpServerName =
        name === "call_mcp_tool" && typeof toolParameters?.ServerName === "string"
          ? toolParameters.ServerName
          : undefined;
      const mcpToolName =
        name === "call_mcp_tool" && typeof toolParameters?.ToolName === "string"
          ? toolParameters.ToolName
          : undefined;
      const toolFailed = ["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(state);
      const itemPayload = {
        name,
        status: isTerminalToolState(state)
          ? toolFailed || toolError !== undefined
            ? ("error" as const)
            : ("success" as const)
          : ("running" as const),
        ...(toolParameters ? { args: toolParameters } : {}),
        ...(toolOutput !== undefined ? { result: toolOutput } : {}),
        ...(toolError !== undefined ? { error: toolError } : {}),
        ...(stepType === "subagent" ? { isSubAgent: true } : {}),
        ...(mcpServerName ? { mcpServerName } : {}),
        ...(mcpToolName ? { mcpToolName } : {}),
      };
      if (isTerminalToolState(state)) {
        result.push(
          attach({
            type: "item.started",
            threadId,
            itemId,
            itemType: "tool_call",
            payload: { ...itemPayload, status: "running" },
          }),
          attach({ type: "item.completed", threadId, itemId, payload: itemPayload }),
        );
      } else {
        result.push(
          attach({
            type: "item.started",
            threadId,
            itemId,
            itemType: "tool_call",
            payload: itemPayload,
          }),
        );
      }
    }
    const thinkingStep = isThinkingStep(stepType);
    let thoughtItemId: string;
    if (stepKey) {
      thoughtItemId = `thought:${conversationId}:${stepKey}`;
    } else if (!thoughtRunState) {
      // Legacy collapse: without turn state there is no way to attribute
      // step-less thinking to contiguous runs.
      thoughtItemId = `thought:${turnId}`;
    } else {
      if (thoughtRunState.openThoughtItemId && !thoughtRunState.interrupted) {
        thoughtItemId = thoughtRunState.openThoughtItemId;
      } else {
        // Close the run that tools/text interrupted so its block ends at its
        // real position, then anchor the continuation here.
        if (thoughtRunState.openThoughtItemId) {
          result.push(
            attach({
              type: "item.completed",
              threadId,
              itemId: thoughtRunState.openThoughtItemId,
            }),
          );
        }
        thoughtItemId =
          thoughtRunState.thoughtRuns === 0
            ? `thought:${turnId}`
            : `thought:${turnId}:${thoughtRunState.thoughtRuns}`;
        thoughtRunState.thoughtRuns += 1;
        thoughtRunState.openThoughtItemId = thoughtItemId;
        thoughtRunState.interrupted = false;
      }
    }
    const thoughtText = visibleText(
      thinkingFrom(payload) ?? (thinkingStep ? textFrom(payload) : undefined),
    );
    if (thoughtText) {
      result.push(
        attach({
          type: "item.started",
          threadId,
          itemId: thoughtItemId,
          itemType: "reasoning",
        }),
        attach({
          type: "content.delta",
          threadId,
          itemId: thoughtItemId,
          stream: "reasoning_text",
          delta: thoughtText,
        }),
      );
    }
    if (thinkingStep && isTerminalToolState(String(payload.state ?? "").toUpperCase())) {
      result.push(attach({ type: "item.completed", threadId, itemId: thoughtItemId }));
      if (thoughtRunState && thoughtRunState.openThoughtItemId === thoughtItemId) {
        thoughtRunState.openThoughtItemId = undefined;
      }
    }
    const text =
      !thinkingStep && stepType === "agent_response" ? visibleText(textFrom(payload)) : undefined;
    if (text) {
      // Visible assistant text also closes the open thinking run: a thought
      // that arrives after prose belongs after it in the timeline.
      if (thoughtRunState) thoughtRunState.interrupted = true;
      result.push(
        attach({
          type: "item.started",
          threadId,
          itemId: `item:${turnId}`,
          itemType: "assistant_message",
        }),
        attach({
          type: "content.delta",
          threadId,
          itemId: `item:${turnId}`,
          stream: "assistant_text",
          delta: text,
        }),
      );
    }
    const stepUsage = recordValue(payload.usage);
    if (stepUsage) {
      result.push(
        ...usageEvent(
          threadId,
          turnId,
          correlationId,
          event.sequence,
          providerSessionId,
          stepUsage,
        ).map(attach),
      );
    }
    // `agy` emits a DONE step_update for the user_input step before it emits
    // the assistant_response step. The terminal `result` envelope is the
    // authoritative turn boundary; completing on any DONE step would resolve
    // the CraftSession before the assistant text arrives.
    return result;
  }
  if (nativeType === "result") {
    const resultPayload = recordValue(payload.result) ?? payload;
    const status = String(resultPayload.status ?? payload.status ?? "").toUpperCase();
    const response = visibleText(
      typeof resultPayload.response === "string"
        ? resultPayload.response
        : typeof payload.response === "string"
          ? payload.response
          : undefined,
    );
    const failed = new Set(["ERROR", "FAILED", "FAILURE", "AUTH_REQUIRED", "BLOCKED"]);
    const cancelled = new Set(["CANCELLED", "CANCELED", "INTERRUPTED"]);
    const state = failed.has(status)
      ? ("failed" as const)
      : cancelled.has(status)
        ? ("cancelled" as const)
        : ("completed" as const);
    const rawError = resultPayload.error ?? payload.error;
    const providerError =
      typeof rawError === "string"
        ? rawError
        : rawError && typeof rawError === "object" && !Array.isArray(rawError)
          ? String((rawError as Record<string, unknown>).message ?? "Native provider error.")
          : undefined;
    const failedMessage = providerError ?? `Native provider returned status ${status || "ERROR"}.`;
    return [
      ...(response
        ? [
            attach({
              type: "item.started",
              threadId,
              itemId: `item:${turnId}`,
              itemType: "assistant_message",
            }),
            attach({
              type: "content.delta",
              threadId,
              itemId: `item:${turnId}`,
              stream: "assistant_text",
              delta: response,
            }),
          ]
        : []),
      attach({
        type: "item.completed",
        threadId,
        itemId: `item:${turnId}`,
      }),
      attach({
        type: "item.completed",
        threadId,
        itemId: `thought:${turnId}`,
      }),
      ...(state === "failed" && !isRetryableCapacityError(failedMessage)
        ? [
            attach({
              type: "error",
              threadId,
              message: failedMessage,
            }),
          ]
        : []),
      attach({
        type: "turn.completed",
        threadId,
        turnId,
        state,
      }),
    ];
  }
  if (nativeType === "turn/start") return [attach({ type: "turn.started", threadId, turnId })];
  if (nativeType === "assistant/chunk") {
    const chunk = recordValue(payload.chunk) ?? payload;
    const chunkType = typeof chunk.type === "string" ? chunk.type : "";
    if (chunkType === "reasoning-delta" || chunkType === "text-delta") {
      const text = visibleText(typeof chunk.text === "string" ? chunk.text : undefined);
      if (!text) return [];
      return [
        attach({
          type: "content.delta",
          threadId,
          itemId: `item:${turnId}`,
          stream: chunkType === "reasoning-delta" ? "reasoning_text" : "assistant_text",
          delta: text,
        }),
      ];
    }
    if (chunkType === "block-start") {
      return [
        attach({
          type: "item.started",
          threadId,
          itemId: `item:${turnId}:${String(chunk.index ?? 0)}`,
          itemType: chunk.blockType === "reasoning" ? "reasoning" : "assistant_message",
        }),
      ];
    }
    if (chunkType === "block-end") {
      const block = recordValue(chunk.block);
      return [
        attach({
          type: "item.completed",
          threadId,
          itemId: `item:${turnId}:${String(chunk.index ?? 0)}`,
          payload: block?.type === "reasoning" ? { kind: "reasoning" } : { kind: "text" },
        }),
      ];
    }
    if (chunkType === "usage")
      return usageEvent(
        threadId,
        turnId,
        correlationId,
        event.sequence,
        providerSessionId,
        recordValue(chunk.usage),
      ).map(attach);
    return [];
  }
  if (nativeType === "assistant/message")
    return usageEvent(
      threadId,
      turnId,
      correlationId,
      event.sequence,
      providerSessionId,
      recordValue(payload.usage),
    ).map(attach);
  if (nativeType === "tool/call") {
    const callId = String(payload.callId ?? payload.id ?? `tool-${event.sequence}`);
    return [
      attach({
        type: "item.started",
        threadId,
        itemId: `tool:${callId}`,
        itemType: "tool_call",
        payload: { name: typeof payload.name === "string" ? payload.name : "native tool" },
      }),
    ];
  }
  if (nativeType === "tool/result") {
    const callId = String(payload.callId ?? payload.id ?? `tool-${event.sequence}`);
    return [attach({ type: "item.completed", threadId, itemId: `tool:${callId}` })];
  }
  if (nativeType === "turn/end") {
    const state = turnState(payload.reason);
    return [
      ...(state === "failed"
        ? [
            attach({
              type: "error",
              threadId,
              message: "Native provider reported a failed turn.",
            }),
          ]
        : []),
      attach({ type: "turn.completed", threadId, turnId, state }),
    ];
  }
  if (nativeType === "session.status") {
    return String(payload.status ?? "") === "running"
      ? [attach({ type: "session.started", threadId, turnId })]
      : [];
  }
  if (descriptor.harnessKind === "antigravity" && /permission|question|input/iu.test(nativeType)) {
    return [
      attach({
        type: "warning",
        threadId,
        message:
          "Antigravity stream-json does not expose an interactive permission or question reply channel.",
      }),
    ];
  }
  if (/permission|question|input/iu.test(nativeType)) {
    const requestId = String(payload.requestId ?? payload.callId ?? `request-${event.sequence}`);
    const requestType = /permission/iu.test(nativeType) ? "tool_call_approval" : "tool_user_input";
    return [
      attach({
        type: "request.opened",
        threadId,
        requestId,
        requestType,
        payload: {
          summary:
            typeof payload.summary === "string"
              ? payload.summary
              : "Native provider requires input.",
        },
      }),
    ];
  }
  if (nativeType === "stderr" || nativeType === "error") {
    const raw = firstString([payload.message, payload.error, payload.text, payload.response]);
    if (raw && !visibleText(raw)) return [];
    return [
      attach({
        type: "error",
        threadId,
        message: visibleText(raw) ?? "Native provider reported an execution error.",
      }),
    ];
  }
  return [
    attach({
      type: "warning",
      threadId,
      message: `Unknown native event '${nativeType}' was preserved for diagnostics.`,
    }),
  ];
}
