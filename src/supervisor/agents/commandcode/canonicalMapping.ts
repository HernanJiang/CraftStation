import type { RuntimeEvent, TurnState } from "@/shared/contracts";
import type { NativeWireEvent } from "@/supervisor/runtime/nativeHarness/nativeTransport";

export interface CommandCodeMapperState {
  assistantItemId?: string;
  reasoningItemId?: string;
  streamedAssistantText: string;
  streamedReasoningText: string;
  openTools: Map<string, string>;
  sessionId?: string;
  lastError?: string;
  receivedResult: boolean;
  resultState?: TurnState;
}

export interface CommandCodeMappedResult {
  events: RuntimeEvent[];
  sessionId?: string;
  resultState?: TurnState;
  errorMessage?: string;
}

export function createCommandCodeMapperState(): CommandCodeMapperState {
  return {
    streamedAssistantText: "",
    streamedReasoningText: "",
    openTools: new Map(),
    receivedResult: false,
  };
}

export function unwrapCommandCodeFrame(event: NativeWireEvent): {
  type: string;
  payload: Record<string, unknown>;
} {
  if (event.type === "event") {
    const nested = event.payload.event;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>;
      if (typeof record.type === "string") return { type: record.type, payload: record };
    }
  }
  return { type: event.type, payload: event.payload };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function errorMessageFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  const record = recordValue(value);
  if (!record) return undefined;
  const message = record.message;
  return typeof message === "string" && message.trim() ? message : undefined;
}

function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result
      .map((block) => {
        const record = recordValue(block);
        if (record?.type === "text" && typeof record.text === "string") return record.text;
        return "";
      })
      .join("");
  }
  if (result == null) return "";
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function assistantItemId(turnId: string): string {
  return `assistant:${turnId}`;
}

function reasoningItemId(turnId: string): string {
  return `reasoning:${turnId}`;
}

function toolItemId(toolCallId: string): string {
  return `tool:${toolCallId}`;
}

function ensureAssistantStarted(
  events: RuntimeEvent[],
  threadId: string,
  turnId: string,
  state: CommandCodeMapperState,
): string {
  if (state.assistantItemId) return state.assistantItemId;
  const itemId = assistantItemId(turnId);
  state.assistantItemId = itemId;
  events.push({ type: "item.started", threadId, itemId, itemType: "assistant_message" });
  return itemId;
}

function ensureReasoningStarted(
  events: RuntimeEvent[],
  threadId: string,
  turnId: string,
  state: CommandCodeMapperState,
): string {
  if (state.reasoningItemId) return state.reasoningItemId;
  const itemId = reasoningItemId(turnId);
  state.reasoningItemId = itemId;
  events.push({ type: "item.started", threadId, itemId, itemType: "reasoning" });
  return itemId;
}

function ensureToolStarted(
  events: RuntimeEvent[],
  threadId: string,
  state: CommandCodeMapperState,
  toolCallId: string,
  toolName: string,
  extra?: Record<string, unknown>,
): string {
  const itemId = toolItemId(toolCallId);
  if (state.openTools.has(itemId)) {
    if (Object.keys(extra ?? {}).length > 0) {
      events.push({
        type: "item.updated",
        threadId,
        itemId,
        payload: { name: toolName, status: "running", ...extra },
      });
    }
    return itemId;
  }
  state.openTools.set(itemId, toolName);
  events.push({
    type: "item.started",
    threadId,
    itemId,
    itemType: "tool_call",
    payload: { name: toolName, status: "running", ...extra },
  });
  return itemId;
}

function completeOpenTools(
  events: RuntimeEvent[],
  threadId: string,
  state: CommandCodeMapperState,
  status: "success" | "error",
): void {
  for (const [itemId, name] of state.openTools) {
    events.push({
      type: "item.completed",
      threadId,
      itemId,
      payload: { name, status },
    });
  }
  state.openTools.clear();
}

function usageEvents(
  threadId: string,
  turnId: string,
  payload: Record<string, unknown>,
  sessionId: string | undefined,
  sampleId: string,
): RuntimeEvent[] {
  const usage = recordValue(payload.usage) ?? payload;
  const inputTokens =
    numberValue(usage.inputTokens) ??
    numberValue(usage.input_tokens) ??
    numberValue(usage.input) ??
    0;
  const outputTokens =
    numberValue(usage.outputTokens) ??
    numberValue(usage.output_tokens) ??
    numberValue(usage.output) ??
    0;
  if (inputTokens + outputTokens === 0) return [];
  return [
    {
      type: "usage.spent",
      threadId,
      usage: {
        counterKind: "per-call",
        counter: inputTokens + outputTokens,
        scopeId: sessionId ?? threadId,
        epoch: 0,
        sampleId,
        turnId,
      },
    },
  ];
}

function appendAssistantRemainder(
  events: RuntimeEvent[],
  threadId: string,
  turnId: string,
  state: CommandCodeMapperState,
  finalText: string,
): void {
  if (!finalText) return;
  const remainder = remainderAfter(state.streamedAssistantText, finalText);
  if (!remainder) return;
  const itemId = ensureAssistantStarted(events, threadId, turnId, state);
  state.streamedAssistantText += remainder;
  events.push({
    type: "content.delta",
    threadId,
    itemId,
    stream: "assistant_text",
    delta: remainder,
  });
}

export function remainderAfter(streamed: string, response: string): string {
  if (!streamed) return response;
  if (response.startsWith(streamed)) return response.slice(streamed.length);
  if (streamed.endsWith(response)) return "";
  const maxOverlap = Math.min(streamed.length, response.length);
  for (let length = maxOverlap; length > 0; length -= 1) {
    if (streamed.endsWith(response.slice(0, length))) return response.slice(length);
  }
  return response;
}

export function mapCommandCodeFrame(input: {
  threadId: string;
  turnId: string;
  event: NativeWireEvent;
  state: CommandCodeMapperState;
}): CommandCodeMappedResult {
  const { threadId, turnId, event, state } = input;
  const { type, payload } = unwrapCommandCodeFrame(event);
  const events: RuntimeEvent[] = [];

  if (type === "run_start") {
    const sessionId = stringField(payload, "sessionId");
    if (sessionId) state.sessionId = sessionId;
    events.push({ type: "session.started", threadId, turnId });
    return { events, ...(sessionId ? { sessionId } : {}) };
  }

  if (type === "text_delta") {
    const delta = stringField(payload, "delta", "text") ?? "";
    if (!delta) return { events };
    const itemId = ensureAssistantStarted(events, threadId, turnId, state);
    state.streamedAssistantText += delta;
    events.push({
      type: "content.delta",
      threadId,
      itemId,
      stream: "assistant_text",
      delta,
    });
    return { events };
  }

  if (type === "thinking_start") {
    ensureReasoningStarted(events, threadId, turnId, state);
    return { events };
  }

  if (type === "thinking_delta") {
    const delta = stringField(payload, "delta", "text") ?? "";
    if (!delta) return { events };
    const itemId = ensureReasoningStarted(events, threadId, turnId, state);
    state.streamedReasoningText += delta;
    events.push({
      type: "content.delta",
      threadId,
      itemId,
      stream: "reasoning_text",
      delta,
    });
    return { events };
  }

  if (type === "thinking_end") {
    const text = stringField(payload, "text") ?? "";
    if (text && !state.streamedReasoningText) {
      const itemId = ensureReasoningStarted(events, threadId, turnId, state);
      events.push({
        type: "content.delta",
        threadId,
        itemId,
        stream: "reasoning_text",
        delta: text,
      });
    }
    if (state.reasoningItemId) {
      events.push({ type: "item.completed", threadId, itemId: state.reasoningItemId });
      delete state.reasoningItemId;
    }
    return { events };
  }

  if (type === "tool_queued" || type === "tool_running") {
    const toolCallId = stringField(payload, "toolCallId", "id");
    const toolName = stringField(payload, "toolName", "name") ?? "tool";
    if (!toolCallId) return { events };
    const extra: Record<string, unknown> = {};
    if (payload.input !== undefined) extra.args = payload.input;
    const description = stringField(payload, "description");
    if (description) extra.progress = { description };
    ensureToolStarted(events, threadId, state, toolCallId, toolName, extra);
    return { events };
  }

  if (type === "tool_completed" || type === "tool_errored" || type === "tool_denied") {
    const toolCallId = stringField(payload, "toolCallId", "id");
    const toolName = stringField(payload, "toolName", "name") ?? "tool";
    if (!toolCallId) return { events };
    const itemId = ensureToolStarted(events, threadId, state, toolCallId, toolName);
    const failed = type !== "tool_completed";
    const resultText = toolResultText(payload.result);
    const errorText =
      errorMessageFrom(payload.error) ?? (type === "tool_denied" ? "Permission denied" : undefined);
    events.push({
      type: "item.completed",
      threadId,
      itemId,
      payload: {
        name: toolName,
        status: failed ? "error" : "success",
        ...(resultText ? { result: resultText } : {}),
        ...(errorText ? { error: errorText } : {}),
      },
    });
    state.openTools.delete(itemId);
    return { events };
  }

  if (type === "run_error") {
    const message = errorMessageFrom(payload.error) ?? errorMessageFrom(payload);
    if (message) state.lastError = message;
    return { events };
  }

  if (type === "interrupted") {
    completeOpenTools(events, threadId, state, "error");
    if (state.assistantItemId) {
      events.push({ type: "item.completed", threadId, itemId: state.assistantItemId });
    }
    if (state.reasoningItemId) {
      events.push({ type: "item.completed", threadId, itemId: state.reasoningItemId });
    }
    events.push({ type: "turn.completed", threadId, turnId, state: "interrupted" });
    state.receivedResult = true;
    state.resultState = "interrupted";
    return { events, resultState: "interrupted" };
  }

  if (type === "result") {
    const subtype = stringField(payload, "subtype") ?? "";
    const sessionId = stringField(payload, "sessionId");
    if (sessionId) state.sessionId = sessionId;
    const finalText = stringField(payload, "finalText") ?? "";
    const errorMessage =
      errorMessageFrom(payload.error) ??
      state.lastError ??
      (subtype === "error" ? "Command Code headless run failed." : undefined);
    appendAssistantRemainder(events, threadId, turnId, state, finalText);
    completeOpenTools(events, threadId, state, subtype === "error" ? "error" : "success");
    if (state.assistantItemId) {
      events.push({ type: "item.completed", threadId, itemId: state.assistantItemId });
    }
    if (state.reasoningItemId) {
      events.push({ type: "item.completed", threadId, itemId: state.reasoningItemId });
    }
    events.push(
      ...usageEvents(threadId, turnId, payload, state.sessionId, `${turnId}:${event.sequence}`),
    );
    const resultState: TurnState =
      subtype === "error" ? "failed" : subtype === "max_turns" ? "completed" : "completed";
    if (subtype === "max_turns") {
      events.push({
        type: "warning",
        threadId,
        message: "Command Code stopped because it hit the headless max-turns cap.",
      });
    }
    if (resultState === "failed" && errorMessage) {
      events.push({ type: "error", threadId, message: errorMessage });
    }
    events.push({ type: "turn.completed", threadId, turnId, state: resultState });
    state.receivedResult = true;
    state.resultState = resultState;
    if (errorMessage) state.lastError = errorMessage;
    return {
      events,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      resultState,
      ...(errorMessage && resultState === "failed" ? { errorMessage } : {}),
    };
  }

  return { events };
}
