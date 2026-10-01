import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import type { NativeHarnessDescriptor } from "@/shared/crafting";
import { stripGeminiHarnessNoise } from "@/shared/geminiHarnessNoise";
import { stripKimiHarnessNoise } from "@/shared/kimiHarnessNoise";
import {
  isRetryableCapacityError,
  stripRetryableCapacityNoise,
} from "@/shared/retryableCapacityError";
import { createContextUsageEvent, usageFromProviderRecord } from "@/supervisor/agents/contextUsage";
import type { NativeWireEvent } from "./nativeTransport";
import { redactNativePayload } from "./nativeTransport";

// An embedded echo shorter than this is too easy to produce by chance — a
// lone "\n" or short token appears in any long snapshot and must not cut it.
const MIN_EMBEDDED_ECHO = 8;

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
 * Per-turn mutable state for thinking- and text-run attribution. Some
 * providers emit thinking `step_update` frames without a `step_index`;
 * without extra state every one of those deltas collapses into a single
 * `thought:{turnId}` item anchored at the turn's top, so thoughts that
 * actually arrived *between* tool calls all render as one block above the
 * tools. The state splits the stream into one item per contiguous run: a
 * tool/subagent step or a step of the other kind closes the open run, and the
 * next delta opens a new one at its true timeline position. The same rule
 * applies to `agent_response` narration: agy emits prose deltas interleaved
 * with tool steps, and every stretch must anchor on its own item or the whole
 * answer collapses into one turn-top `item:{turnId}` message.
 */
export interface NativeCanonicalizerTurnState {
  /** Item id of the currently open thinking run, if any. */
  openThoughtItemId: string | undefined;
  /** Thinking runs allocated so far this turn (run 0 keeps the legacy id). */
  thoughtRuns: number;
  /** A non-thinking step arrived since the open run started. */
  interrupted: boolean;
  /** Item id of the currently open assistant-text run, if any. */
  openTextItemId: string | undefined;
  /** Assistant-text runs allocated so far this turn (run 0 keeps the legacy id). */
  textRuns: number;
  /** A tool/subagent/thinking step arrived since the open text run started. */
  textInterrupted: boolean;
}

export function createNativeCanonicalizerTurnState(): NativeCanonicalizerTurnState {
  return {
    openThoughtItemId: undefined,
    thoughtRuns: 0,
    interrupted: false,
    openTextItemId: undefined,
    textRuns: 0,
    textInterrupted: false,
  };
}

/**
 * Offset in `text` just past its `count`-th non-whitespace character, so a
 * whitespace-normalized prefix match can be mapped back to a raw slice point.
 */
function rawIndexAfterNonWhitespace(text: string, count: number): number {
  let seen = 0;
  let index = 0;
  while (index < text.length && seen < count) {
    if (!/\s/.test(text[index]!)) seen += 1;
    index += 1;
  }
  return index;
}

/**
 * Chars sampled next to the embedded echo when checking whether the slice to
 * append re-renders text the stream already showed. Long enough that an
 * accidental hit is implausible, short enough to survive edit points.
 */
const REVISION_EDGE = 24;

/**
 * Removes the already-streamed part of a terminal `result.response` snapshot.
 * Antigravity repeats the complete answer in its closing `result` frame; its
 * step deltas, however, drop the newline separators the snapshot restores, so
 * exact prefix matching misses near-identical echoes. After the exact checks
 * the comparison retries on whitespace-stripped text and maps the cut point
 * back to a raw `response` offset.
 */
export function finalResponseRemainder(streamed: string, response: string): string {
  if (!streamed) return response;
  if (response.startsWith(streamed)) return response.slice(streamed.length);
  if (streamed.endsWith(response)) return "";
  const maxOverlap = Math.min(streamed.length, response.length);
  for (let length = maxOverlap; length >= MIN_EMBEDDED_ECHO; length -= 1) {
    // Below MIN a head/tail "overlap" is more likely a shared markdown char
    // (`*`, `-`, digit) than a real continuation — do not cut the delta.
    if (streamed.endsWith(response.slice(0, length))) return response.slice(length);
  }
  const sqStreamed = streamed.replace(/\s+/g, "");
  const sqResponse = response.replace(/\s+/g, "");
  if (sqResponse === sqStreamed) return "";
  if (sqResponse.startsWith(sqStreamed)) {
    return response.slice(rawIndexAfterNonWhitespace(response, sqStreamed.length));
  }
  const maxSqOverlap = Math.min(sqStreamed.length, sqResponse.length);
  for (let length = maxSqOverlap; length >= MIN_EMBEDDED_ECHO; length -= 1) {
    if (sqStreamed.endsWith(sqResponse.slice(0, length))) {
      return response.slice(rawIndexAfterNonWhitespace(response, length));
    }
  }
  // The replay can sit inside the snapshot instead of at its edges: agy folds
  // queued status lines into its closing `response`, wrapping already-seen
  // text in fresh text ([draft][status echo][final]). Anchor on the longest
  // streamed stretch the snapshot still contains — a suffix match is
  // monotonic in length so binary search finds it; the streamed head is the
  // fallback for replays of older text. Text after the last echo is new, and
  // an echo flush with the end means the new part is what precedes it.
  for (const fromEnd of [true, false]) {
    let lo = MIN_EMBEDDED_ECHO;
    let hi = Math.min(streamed.length, response.length);
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = fromEnd ? streamed.slice(streamed.length - mid) : streamed.slice(0, mid);
      if (response.includes(candidate)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best === 0) continue;
    const seed = fromEnd ? streamed.slice(streamed.length - best) : streamed.slice(0, best);
    const at = response.lastIndexOf(seed);
    const next = response.slice(at + seed.length) || response.slice(0, at);
    // Revision guard: agy can rewrite the answer mid-turn, so a snapshot can
    // carry a re-rendered variant of the same document (same opening, edited
    // or truncated middle). Two tells, either sufficient: the slice about to
    // be appended replays text sitting right next to the echo in the
    // ALREADY-streamed part the seed did not cover, or the slice's own tail
    // is a stretch that part already showed. Both mean "same document" —
    // appending would pile a truncated copy of the answer onto the complete
    // text ("…1. *" mid-token cut). The interleaved-status case keeps
    // working because a status line never reappears inside the new prose.
    const unseen = fromEnd ? streamed.slice(0, streamed.length - best) : streamed.slice(best);
    const headEdge = fromEnd ? unseen.slice(-REVISION_EDGE) : unseen.slice(0, REVISION_EDGE);
    const tailEdge = next.slice(-REVISION_EDGE);
    if (
      next &&
      ((headEdge.length >= MIN_EMBEDDED_ECHO && next.includes(headEdge)) ||
        (tailEdge.length >= MIN_EMBEDDED_ECHO && unseen.includes(tailEdge)))
    ) {
      return "";
    }
    return next;
  }
  return response;
}

function visibleText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return stripRetryableCapacityNoise(
    stripKimiHarnessNoise(stripGeminiHarnessNoise(value) ?? "") ?? "",
  );
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
  const rawKind = recordValue(reason)?.kind;
  // DSH emits snake_case kinds ("max_tokens"); the adapter's terminal-error
  // matcher already normalizes underscores, so the canonicalizer must too —
  // otherwise an underscore kind silently degrades a failed turn to
  // "completed" here while the adapter reports EXECUTION_FAILED.
  const kind = typeof rawKind === "string" ? rawKind.replace(/_/gu, "-") : undefined;
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
      if (thoughtRunState) {
        thoughtRunState.interrupted = true;
        thoughtRunState.textInterrupted = true;
      }
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
    if (thoughtText && thoughtRunState) thoughtRunState.textInterrupted = true;
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
      // The same run rule applies in reverse: agy narrates between tool steps
      // via agent_response deltas, so a text stretch after a tool/thinking
      // step must land on a fresh item or every narration collapses into the
      // turn-top message above all tools.
      let textItemId = `item:${turnId}`;
      if (thoughtRunState) {
        thoughtRunState.interrupted = true;
        if (!thoughtRunState.openTextItemId || thoughtRunState.textInterrupted) {
          if (thoughtRunState.openTextItemId) {
            result.push(
              attach({
                type: "item.completed",
                threadId,
                itemId: thoughtRunState.openTextItemId,
              }),
            );
          }
          textItemId =
            thoughtRunState.textRuns === 0
              ? `item:${turnId}`
              : `item:${turnId}:text-${thoughtRunState.textRuns}`;
          thoughtRunState.textRuns += 1;
          thoughtRunState.openTextItemId = textItemId;
          thoughtRunState.textInterrupted = false;
        } else {
          textItemId = thoughtRunState.openTextItemId;
        }
      }
      result.push(
        attach({
          type: "item.started",
          threadId,
          itemId: textItemId,
          itemType: "assistant_message",
        }),
        attach({
          type: "content.delta",
          threadId,
          itemId: textItemId,
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
    // A snapshot remainder continues the open text run; item/thought closures
    // must hit the open run ids, not just the run-0 ids.
    const responseItemId = thoughtRunState?.openTextItemId ?? `item:${turnId}`;
    const openItemIds = new Set<string>([`item:${turnId}`, `thought:${turnId}`]);
    if (thoughtRunState?.openTextItemId) openItemIds.add(thoughtRunState.openTextItemId);
    if (thoughtRunState?.openThoughtItemId) openItemIds.add(thoughtRunState.openThoughtItemId);
    if (thoughtRunState) {
      thoughtRunState.openTextItemId = undefined;
      thoughtRunState.openThoughtItemId = undefined;
    }
    return [
      ...(response
        ? [
            attach({
              type: "item.started",
              threadId,
              itemId: responseItemId,
              itemType: "assistant_message",
            }),
            attach({
              type: "content.delta",
              threadId,
              itemId: responseItemId,
              stream: "assistant_text",
              delta: response,
            }),
          ]
        : []),
      ...[...openItemIds].map((itemId) =>
        attach({
          type: "item.completed" as const,
          threadId,
          itemId,
        }),
      ),
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
