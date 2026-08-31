import type { NativeHarnessDiagnostic, NativeEventEnvelope } from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { buildOpenCodeNativeDiagnostic, safeMessage } from "./diagnostics";

export interface OpenCodeMappedEvent {
  readonly event?: RuntimeEvent;
  readonly envelope: NativeEventEnvelope;
  readonly diagnostic?: NativeHarnessDiagnostic;
}

export interface OpenCodeEventMapperOptions {
  readonly raw: unknown;
  readonly threadId?: string;
  readonly turnId?: string;
  readonly sequence: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function eventProperties(raw: Record<string, unknown>): Record<string, unknown> {
  const payload = record(raw.payload);
  if (typeof raw.type !== "string" && Object.keys(payload).length > 0) {
    return eventProperties(payload);
  }
  const properties = record(raw.properties);
  if (Object.keys(properties).length > 0) return properties;
  return record(raw.data);
}

/**
 * Strict allowlist for renderer-visible native event envelope payloads.
 * Raw provider payloads, full user prompts, and unknown nested secrets must
 * never pass into the public envelope.
 */
function allowlistedEnvelopePayload(
  type: string,
  rawProps: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  const allowlist = [
    "id",
    "sessionID",
    "messageID",
    "partID",
    "callID",
    "permissionID",
    "type",
    "status",
    "code",
    "field",
    "name",
    "role",
    "deltaLength",
    "textLength",
    "finishReason",
    "action",
  ];
  for (const k of allowlist) {
    const v = rawProps[k];
    if (
      v !== undefined &&
      (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    ) {
      safe[k] = v;
    }
  }
  return safe;
}

function envelope(
  type: string,
  rawProps: Record<string, unknown>,
  sequence: number,
  providerSessionId?: string,
): NativeEventEnvelope {
  return {
    harnessKind: "opencode",
    source: "native",
    nativeType: type,
    ...(providerSessionId ? { providerSessionId } : {}),
    sequence,
    payload: allowlistedEnvelopePayload(type, rawProps),
    receivedAt: new Date().toISOString(),
  };
}

function diagnostic(
  operation: string,
  code: NativeHarnessDiagnostic["code"],
  message: string,
  details?: Record<string, unknown>,
): NativeHarnessDiagnostic {
  return buildOpenCodeNativeDiagnostic({
    code,
    operation,
    message,
    correlationId: "sse:event",
    ...(details ? { details } : {}),
  });
}

function safeQuestionPayload(properties: Record<string, unknown>): {
  summary: string;
  details: Record<string, unknown>;
  options?: { optionId: string; label: string; description?: string }[];
  multiSelect?: boolean;
} {
  const questions = Array.isArray(properties.questions) ? properties.questions : [];
  const projected = questions.slice(0, 16).map((value, questionIndex) => {
    const question = record(value);
    const options = Array.isArray(question.options) ? question.options : [];
    return {
      id: `q${questionIndex}`,
      header:
        typeof question.header === "string"
          ? safeMessage(question.header).slice(0, 120)
          : undefined,
      question:
        typeof question.question === "string"
          ? safeMessage(question.question).slice(0, 500)
          : "Input requested",
      options: options.slice(0, 32).map((optionValue, optionIndex) => {
        const option = record(optionValue);
        return {
          optionId: `q${questionIndex}.${optionIndex}`,
          label:
            typeof option.label === "string"
              ? safeMessage(option.label).slice(0, 120)
              : `Option ${optionIndex + 1}`,
          ...(typeof option.description === "string"
            ? { description: safeMessage(option.description).slice(0, 240) }
            : {}),
        };
      }),
      multiSelect: question.multiple === true,
      custom: question.custom === true,
    };
  });
  const first = projected[0];
  const summary = first?.header ?? first?.question ?? "OpenCode input requested";
  return {
    summary,
    details: {
      userInputForm: { questions: projected },
      ...(record(properties.tool).callID
        ? { tool: allowlistedEnvelopePayload("tool", record(properties.tool)) }
        : {}),
    },
    ...(projected.length === 1 && first ? { options: first.options } : {}),
    ...(projected.some((question) => question.multiSelect) ? { multiSelect: true } : {}),
  };
}

function safePermissionDetails(
  permissionId: string,
  name: string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const resources = Array.isArray(properties.resources)
    ? properties.resources
        .slice(0, 32)
        .filter((value): value is string => typeof value === "string")
        .map((value) => safeMessage(value).slice(0, 500))
    : undefined;
  const source = allowlistedEnvelopePayload("permission-source", record(properties.source));
  return {
    permissionId,
    name,
    ...(resources && resources.length > 0 ? { resources } : {}),
    ...(Object.keys(source).length > 0 ? { source } : {}),
  };
}

export class OpenCodeEventMapperState {
  private readonly messageRoles = new Map<string, string>();
  private readonly partEmittedLengths = new Map<string, number>();

  setMessageRole(messageId: string, role: string): void {
    this.messageRoles.set(messageId, role);
  }

  getMessageRole(messageId?: string): string | undefined {
    return messageId ? this.messageRoles.get(messageId) : undefined;
  }

  getEmittedLength(partId: string): number {
    return this.partEmittedLengths.get(partId) ?? 0;
  }

  advanceEmittedLength(partId: string, deltaLength: number): void {
    const current = this.getEmittedLength(partId);
    this.partEmittedLengths.set(partId, current + deltaLength);
  }

  setEmittedLength(partId: string, totalLength: number): void {
    this.partEmittedLengths.set(partId, totalLength);
  }

  reset(): void {
    this.messageRoles.clear();
    this.partEmittedLengths.clear();
  }
}

const defaultState = new OpenCodeEventMapperState();

export function mapOpenCodeNativeEvent(
  options: OpenCodeEventMapperOptions,
  state: OpenCodeEventMapperState = defaultState,
): OpenCodeMappedEvent {
  const raw = record(options.raw);
  const payload = record(raw.payload);
  const type =
    typeof raw.type === "string"
      ? raw.type
      : typeof payload.type === "string"
        ? payload.type
        : "unknown";
  const properties = eventProperties(raw);
  const sessionID =
    typeof properties.sessionID === "string"
      ? properties.sessionID
      : typeof raw.sessionID === "string"
        ? raw.sessionID
        : undefined;

  const sequence = options.sequence;
  const threadId = options.threadId ?? "thread_default";
  const turnId = options.turnId ?? "turn_default";
  const nativeEnv = envelope(type, properties, sequence, sessionID);

  switch (type) {
    case "session.created":
    case "session.resumed": {
      return {
        event: {
          type: "session.started",
          threadId,
          turnId,
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "session.idle":
    case "session.completed": {
      return {
        event: {
          type: "turn.completed",
          threadId,
          turnId,
          state: "completed",
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "session.aborted": {
      return {
        event: {
          type: "turn.completed",
          threadId,
          turnId,
          state: "interrupted",
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "session.error":
    case "session.next.step.failed":
    case "session.failed": {
      const errorObj = record(properties.error);
      const errorData = record(errorObj.data);
      const message =
        typeof properties.message === "string"
          ? properties.message
          : typeof errorObj.message === "string"
            ? errorObj.message
            : typeof errorData.message === "string"
              ? errorData.message
              : "OpenCode session encountered a runtime error";
      return {
        event: {
          type: "error",
          threadId,
          message: safeMessage(message),
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
        diagnostic: diagnostic(
          "sse.error",
          "NATIVE_EXECUTION_FAILED",
          message,
          allowlistedEnvelopePayload(type, properties),
        ),
      };
    }

    case "message.created":
    case "message.updated": {
      const msg = record(properties.message ?? properties);
      const msgId = typeof msg.id === "string" ? msg.id : undefined;
      const role = typeof msg.role === "string" ? msg.role : undefined;
      if (msgId && role) {
        state.setMessageRole(msgId, role);
      }
      return { envelope: nativeEnv };
    }

    case "message.part.delta": {
      const messageId = typeof properties.messageID === "string" ? properties.messageID : undefined;
      const role = state.getMessageRole(messageId);
      if (role === "user" || role === "system") {
        // User and system inputs must never be emitted as assistant stream deltas
        return { envelope: nativeEnv };
      }
      const partId = typeof properties.partID === "string" ? properties.partID : "part_text";
      const field = typeof properties.field === "string" ? properties.field : "text";
      const delta = typeof properties.delta === "string" ? properties.delta : "";
      if (delta.length > 0) {
        state.advanceEmittedLength(partId, delta.length);
      }
      return {
        event: {
          type: "content.delta",
          threadId,
          itemId: partId,
          stream: field === "reasoning" ? "reasoning_text" : "assistant_text",
          delta,
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "message.part.updated": {
      const part = record(properties.part ?? properties);
      const messageId =
        typeof properties.messageID === "string"
          ? properties.messageID
          : typeof part.messageID === "string"
            ? part.messageID
            : undefined;
      const role = state.getMessageRole(messageId);
      if (role === "user" || role === "system") {
        return { envelope: nativeEnv };
      }
      const partId =
        typeof properties.partID === "string"
          ? properties.partID
          : typeof part.id === "string"
            ? part.id
            : "part_text";
      const partType = typeof part.type === "string" ? part.type : "text";
      const fullText = typeof part.text === "string" ? part.text : "";
      const emitted = state.getEmittedLength(partId);

      if (fullText.length > emitted) {
        const delta = fullText.slice(emitted);
        state.setEmittedLength(partId, fullText.length);
        return {
          event: {
            type: "content.delta",
            threadId,
            itemId: partId,
            stream: partType === "reasoning" ? "reasoning_text" : "assistant_text",
            delta,
            nativeEnvelope: nativeEnv,
          },
          envelope: nativeEnv,
        };
      }
      // If already emitted up to or beyond snapshot length, do not emit duplicate delta
      return { envelope: nativeEnv };
    }

    case "session.next.text.delta": {
      const textId = typeof properties.textID === "string" ? properties.textID : "txt_default";
      const delta = typeof properties.delta === "string" ? properties.delta : "";
      return {
        event: {
          type: "content.delta",
          threadId,
          itemId: textId,
          stream: "assistant_text",
          delta,
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "session.next.reasoning.delta": {
      const reasoningId =
        typeof properties.reasoningID === "string" ? properties.reasoningID : "rsn_default";
      const delta = typeof properties.delta === "string" ? properties.delta : "";
      return {
        event: {
          type: "content.delta",
          threadId,
          itemId: reasoningId,
          stream: "reasoning_text",
          delta,
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "tool.call.started":
    case "session.next.tool.started": {
      const callId =
        typeof properties.callID === "string"
          ? properties.callID
          : typeof properties.toolID === "string"
            ? properties.toolID
            : "call_default";
      const name = typeof properties.name === "string" ? properties.name : "tool";
      return {
        event: {
          type: "item.started",
          threadId,
          itemId: callId,
          itemType: "tool_call",
          payload: { name, status: "running" },
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "tool.call.delta":
    case "session.next.tool.args.delta": {
      const callId =
        typeof properties.callID === "string"
          ? properties.callID
          : typeof properties.toolID === "string"
            ? properties.toolID
            : "call_default";
      const delta = typeof properties.delta === "string" ? properties.delta : "";
      return {
        event: {
          type: "content.delta",
          threadId,
          itemId: callId,
          stream: "command_output",
          delta,
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "tool.call.completed":
    case "session.next.tool.completed": {
      const callId =
        typeof properties.callID === "string"
          ? properties.callID
          : typeof properties.toolID === "string"
            ? properties.toolID
            : "call_default";
      const name = typeof properties.name === "string" ? properties.name : "tool";
      return {
        event: {
          type: "item.completed",
          threadId,
          itemId: callId,
          payload: { name, status: "success" },
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "permission.requested":
    case "permission.opened":
    case "permission.asked":
    case "permission.v2.asked": {
      const permissionId =
        typeof properties.permissionID === "string"
          ? properties.permissionID
          : typeof properties.requestID === "string"
            ? properties.requestID
            : typeof properties.id === "string"
              ? properties.id
              : `req_${sequence}`;
      const name =
        typeof properties.permission === "string"
          ? properties.permission
          : typeof properties.action === "string"
            ? properties.action
            : typeof properties.name === "string"
              ? properties.name
              : "tool_approval";
      return {
        event: {
          type: "request.opened",
          threadId,
          requestId: permissionId,
          requestType: "tool_call_approval",
          payload: {
            summary: `OpenCode permission requested for ${name}`,
            details: safePermissionDetails(permissionId, name, properties),
            options: [
              { optionId: "once", label: "Allow Once" },
              { optionId: "always", label: "Always Allow" },
              { optionId: "reject", label: "Reject" },
            ],
          },
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "question.asked":
    case "question.v2.asked": {
      const requestId =
        typeof properties.id === "string"
          ? properties.id
          : typeof properties.requestID === "string"
            ? properties.requestID
            : `req_${sequence}`;
      return {
        event: {
          type: "request.opened",
          threadId,
          requestId,
          requestType: "tool_user_input",
          payload: safeQuestionPayload(properties),
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "permission.replied":
    case "permission.resolved":
    case "permission.v2.replied":
    case "question.answered":
    case "question.replied":
    case "question.rejected":
    case "question.v2.replied":
    case "question.v2.rejected": {
      const permissionId =
        typeof properties.permissionID === "string"
          ? properties.permissionID
          : typeof properties.requestID === "string"
            ? properties.requestID
            : typeof properties.id === "string"
              ? properties.id
              : `req_${sequence}`;
      const outcome =
        type === "question.rejected" ||
        type === "question.v2.rejected" ||
        properties.action === "reject" ||
        properties.response === "reject"
          ? "declined"
          : type.startsWith("permission.") && properties.reply === "reject"
            ? "declined"
            : type.startsWith("question.")
              ? "answered"
              : "accepted";
      return {
        event: {
          type: "request.resolved",
          threadId,
          requestId: permissionId,
          outcome,
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "session.compaction":
    case "session.context.compacted": {
      return {
        event: {
          type: "context.updated",
          threadId,
          usage: {
            breakdown: [{ id: "compaction", label: "Native Compaction", tokens: 0 }],
          },
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    case "session.usage":
    case "session.stats": {
      const inputTokens = typeof properties.inputTokens === "number" ? properties.inputTokens : 0;
      const outputTokens =
        typeof properties.outputTokens === "number" ? properties.outputTokens : 0;
      return {
        event: {
          type: "usage.spent",
          threadId,
          usage: {
            counterKind: "per-call",
            counter: inputTokens + outputTokens,
            scopeId: sessionID ?? "ses_default",
            epoch: 0,
            sampleId: `sample_${sequence}`,
          },
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
      };
    }

    default: {
      return {
        event: {
          type: "warning",
          threadId,
          message: `Unknown OpenCode event type: ${type}`,
          nativeEnvelope: nativeEnv,
        },
        envelope: nativeEnv,
        diagnostic: diagnostic("sse.unknown-event", "PROTOCOL_MISMATCH", `Unknown event: ${type}`, {
          type,
          sequence,
        }),
      };
    }
  }
}
