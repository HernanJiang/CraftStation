import type { JsonRpcNotification } from "./types";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
interface UsageScope {
  scopeId: string;
  epoch: number;
  lastCounter: number | undefined;
  freshPending: boolean;
}

export interface EventMappingContext {
  threadId: string;
  turnId?: string;
  activeItemIds?: Set<string>;
  usageScope?: UsageScope;
  usageScopeFresh?: boolean;
  accountId?: string;
}

export function mapCodexNotificationToRuntimeEvents(
  notification: JsonRpcNotification,
  context: EventMappingContext,
): RuntimeEvent[] {
  const method = notification.method;
  const params = (notification.params ?? {}) as Record<string, any>;
  const events: RuntimeEvent[] = [];
  const threadId = params.threadId || context.threadId;

  switch (method) {
    case "turn/started": {
      const turnId = params.turn?.id || params.turnId || context.turnId || `turn:${Date.now()}`;
      context.turnId = turnId;
      events.push({
        type: "turn.started",
        threadId,
        turnId,
      });
      break;
    }

    case "item/started": {
      const item = params.item ?? {};
      const itemId = item.id || params.itemId || `item:${Date.now()}`;
      const itemType = item.type || params.itemType || "assistant_message";
      context.activeItemIds?.add(itemId);

      // Translate item types if necessary
      let canonicalType: string = itemType;
      if (itemType === "agentMessage") canonicalType = "assistant_message";
      else if (itemType === "userMessage") canonicalType = "user_message";
      else if (itemType === "commandExecution") canonicalType = "command_execution";
      else if (itemType === "fileChange") canonicalType = "file_change";
      else if (itemType === "mcpToolCall") canonicalType = "mcp_tool_call";
      else if (itemType === "dynamicToolCall") canonicalType = "dynamic_tool_call";
      else if (itemType === "webSearch") canonicalType = "web_search";

      events.push({
        type: "item.started",
        threadId,
        itemId,
        itemType: (canonicalType as any) || "assistant_message",
        ...(item.payload || params.payload ? { payload: item.payload ?? params.payload } : {}),
      });
      break;
    }

    case "item/agentMessage/delta":
    case "agentMessage/delta":
    case "content/delta": {
      const itemId = params.itemId || "";
      const delta = params.delta || "";
      events.push({
        type: "content.delta",
        threadId,
        itemId,
        stream: "assistant_text",
        delta,
      });
      break;
    }

    case "item/reasoning/textDelta":
    case "reasoning/textDelta": {
      const itemId = params.itemId || "";
      const delta = params.delta || "";
      events.push({
        type: "content.delta",
        threadId,
        itemId,
        stream: "reasoning_text",
        delta,
      });
      break;
    }

    case "command/execution/outputDelta":
    case "command/exec/outputDelta": {
      const itemId = params.itemId || "";
      const delta = params.delta || params.deltaBase64 || "";
      events.push({
        type: "content.delta",
        threadId,
        itemId,
        stream: "command_output",
        delta,
      });
      break;
    }

    case "item/updated": {
      const item = params.item ?? {};
      const itemId = item.id || params.itemId || "";
      events.push({
        type: "item.updated",
        threadId,
        itemId,
        payload: item.payload ?? params.payload ?? {},
      });
      break;
    }

    case "item/completed": {
      const item = params.item ?? {};
      const itemId = item.id || params.itemId || "";
      context.activeItemIds?.delete(itemId);
      events.push({
        type: "item.completed",
        threadId,
        itemId,
        ...(item.payload || params.payload ? { payload: item.payload ?? params.payload } : {}),
      });
      break;
    }

    case "thread/tokenUsage/updated":
    case "tokenUsage/updated": {
      const counter = readCumulativeTokenTotal(params);
      if (counter !== undefined) {
        context.usageScope ??= {
          scopeId: threadId,
          epoch: 0,
          lastCounter: undefined,
          freshPending: context.usageScopeFresh !== false,
        };
        if (
          context.usageScope.lastCounter !== undefined &&
          counter < context.usageScope.lastCounter
        ) {
          context.usageScope.epoch += 1;
          context.usageScope.lastCounter = undefined;
          context.usageScope.freshPending = false;
        }
        context.usageScope.lastCounter = counter;
        const fresh = context.usageScope.freshPending;
        context.usageScope.freshPending = false;
        events.push({
          type: "usage.spent",
          threadId,
          usage: {
            counterKind: "cumulative",
            counter,
            scopeId: context.usageScope.scopeId,
            epoch: context.usageScope.epoch,
            ...(fresh ? { fresh: true } : {}),
            sampleId: `${context.usageScope.scopeId}:${context.usageScope.epoch}:${counter}`,
            turnId: context.turnId,
            occurredAt: Date.now(),
            ...(context.accountId ? { accountId: context.accountId } : {}),
          },
        });
      }
      break;
    }

    case "thread/compacted":
    case "context/compacted":
    case "compaction/completed": {
      events.push({
        type: "thread.compacted",
        threadId,
        ...(params.summary ? { summary: params.summary as string } : {}),
      } as any);
      break;
    }

    case "turn/completed": {
      const turn = params.turn ?? {};
      const turnId = turn.id || params.turnId || context.turnId || `turn:${Date.now()}`;
      let state: "completed" | "interrupted" | "failed" = "completed";
      if (turn.status === "interrupted" || params.state === "interrupted") state = "interrupted";
      else if (turn.status === "failed" || params.state === "failed") state = "failed";

      if (turn.error?.message) {
        events.push({
          type: "error",
          threadId,
          message: turn.error.message,
        });
      }

      events.push({
        type: "turn.completed",
        threadId,
        turnId,
        state,
      });
      break;
    }

    default: {
      // Preserve unknown/experimental notifications as custom events
      events.push({
        type: "custom",
        threadId,
        name: `codex:${method}`,
        payload: params,
      } as any);
      break;
    }
  }

  return events;
}

function readCumulativeTokenTotal(params: Record<string, unknown>): number | undefined {
  const tokenUsage = readRecord(params.tokenUsage);
  const currentTotal = readTokenTotal(readRecord(tokenUsage?.total));
  if (currentTotal !== undefined) return currentTotal;

  const legacy = readRecord(params.token_usage) ?? tokenUsage;
  const legacyTotal = readTokenTotal(
    readRecord(legacy?.total) ??
      readRecord(legacy?.totalTokenUsage) ??
      readRecord(legacy?.total_token_usage),
  );
  if (legacyTotal !== undefined) return legacyTotal;

  const info = readRecord(params.info);
  return readTokenTotal(readRecord(info?.total_token_usage) ?? readRecord(info?.totalTokenUsage));
}

function readTokenTotal(value: Record<string, unknown> | undefined): number | undefined {
  if (!value) return undefined;
  const explicit = value.totalTokens ?? value.total_tokens;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    return Math.trunc(explicit);
  }
  const componentValues: unknown[] = [
    value.inputTokens,
    value.input_tokens,
    value.outputTokens,
    value.output_tokens,
    value.reasoningTokens,
    value.reasoning_tokens,
    value.cachedInputTokens,
    value.cached_input_tokens,
    value.cacheReadTokens,
    value.cache_read_tokens,
    value.cachedWriteTokens,
    value.cacheWriteTokens,
    value.cache_write_tokens,
  ];
  if (!componentValues.some((item) => typeof item === "number" && Number.isFinite(item))) {
    return undefined;
  }
  return componentValues.reduce<number>(
    (sum, item) =>
      sum + (typeof item === "number" && Number.isFinite(item) && item >= 0 ? Math.trunc(item) : 0),
    0,
  );
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
