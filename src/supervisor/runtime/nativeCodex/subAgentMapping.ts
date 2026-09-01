import type { RuntimeEvent, ToolCallPayload } from "@/shared/contracts/runtimeEvent";

interface NativeCodexChild {
  parentItemId: string;
  resultText: string;
}

/**
 * Narrow app-server collaboration router owned by the Native Codex runtime.
 * It projects only provider-issued child identities and never creates a child
 * unless an official collabAgentToolCall or subAgentActivity names it.
 */
export class NativeCodexSubAgentRouter {
  private readonly children = new Map<string, NativeCodexChild>();
  private readonly parentPayloads = new Map<string, ToolCallPayload>();
  private readonly completedParentItemIds = new Set<string>();

  constructor(private readonly localThreadId: string) {}

  observeMainEvents(events: RuntimeEvent[], params: Record<string, unknown>): RuntimeEvent[] {
    const item = readRecord(params.item);
    if (!item) return events;

    const started = events.find(
      (event): event is Extract<RuntimeEvent, { type: "item.started" }> =>
        event.type === "item.started" && isSubAgentPayload(event.payload),
    );
    if (started) {
      this.parentPayloads.set(started.itemId, started.payload as ToolCallPayload);
      for (const childThreadId of readStringArray(
        item.receiverThreadIds ?? item.receiver_thread_ids,
      )) {
        this.children.set(childThreadId, { parentItemId: started.itemId, resultText: "" });
      }
      return events;
    }

    if (item.type === "collabAgentToolCall" && isSpawnAgent(item.tool)) {
      const parentItemId = readNonEmptyString(item.id);
      if (!parentItemId) return events;
      const receiverThreadIds = readStringArray(item.receiverThreadIds ?? item.receiver_thread_ids);
      for (const childThreadId of receiverThreadIds) {
        if (!this.children.has(childThreadId)) {
          this.children.set(childThreadId, { parentItemId, resultText: "" });
        }
      }
      const currentPayload = this.parentPayloads.get(parentItemId);
      if (currentPayload && receiverThreadIds.length > 0) {
        this.parentPayloads.set(parentItemId, {
          ...currentPayload,
          args: {
            ...(readRecord(currentPayload.args) ?? {}),
            receiverThreadIds,
          },
          progress: {
            ...(readRecord(currentPayload.progress) ?? {}),
            stepCount: receiverThreadIds.length,
          },
        });
      }
      if (this.completedParentItemIds.has(parentItemId)) {
        return events.filter(
          (event) => !(event.type === "item.completed" && event.itemId === parentItemId),
        );
      }
      if (this.hasActiveChild(parentItemId)) {
        return events.map((event) =>
          event.type === "item.completed" && event.itemId === parentItemId
            ? {
                type: "item.updated" as const,
                threadId: this.localThreadId,
                itemId: parentItemId,
                payload: this.parentPayloads.get(parentItemId) ?? {
                  name: "spawnAgent",
                  status: "running",
                  isSubAgent: true,
                },
              }
            : event,
        );
      }
      if (
        events.some((event) => event.type === "item.completed" && event.itemId === parentItemId)
      ) {
        this.completedParentItemIds.add(parentItemId);
      }
      return events;
    }

    if (item.type === "collabAgentToolCall") {
      const receiverThreadIds = readStringArray(item.receiverThreadIds ?? item.receiver_thread_ids);
      const agentStates = readRecord(item.agentsStates ?? item.agents_states);
      const parentCompletions: RuntimeEvent[] = [];
      for (const childThreadId of receiverThreadIds) {
        const child = this.children.get(childThreadId);
        if (!child || this.completedParentItemIds.has(child.parentItemId)) continue;
        const completion = readAgentCompletion(agentStates?.[childThreadId]);
        if (!completion) continue;
        const current = this.parentPayloads.get(child.parentItemId);
        const payload: ToolCallPayload = {
          ...(current ?? { name: "spawnAgent", status: "running", isSubAgent: true }),
          status: completion.failed ? "error" : "success",
          ...(completion.result ? { result: completion.result } : {}),
        };
        this.parentPayloads.set(child.parentItemId, payload);
        this.completedParentItemIds.add(child.parentItemId);
        this.children.delete(childThreadId);
        parentCompletions.push({
          type: "item.completed",
          threadId: this.localThreadId,
          itemId: child.parentItemId,
          payload,
        });
      }
      return [...events, ...parentCompletions];
    }

    if (item.type !== "subAgentActivity" || item.kind !== "started") return events;
    const childThreadId = readNonEmptyString(item.agentThreadId);
    if (!childThreadId) return events;
    const existing = this.children.get(childThreadId);
    if (existing) return events;
    const providerItemId = readNonEmptyString(item.id) ?? `subagent:${childThreadId}`;
    const description = readAgentDescription(item.agentPath);
    const payload: ToolCallPayload = {
      name: "spawnAgent",
      status: "running",
      isSubAgent: true,
      args: {
        ...(description ? { description } : {}),
        receiverThreadIds: [childThreadId],
      },
      progress: { ...(description ? { description } : {}), stepCount: 0 },
    };
    this.children.set(childThreadId, { parentItemId: providerItemId, resultText: "" });
    this.parentPayloads.set(providerItemId, payload);
    return [
      {
        type: "item.started",
        threadId: this.localThreadId,
        itemId: providerItemId,
        itemType: "tool_call",
        payload,
      },
    ];
  }

  routeChildNotification(
    method: string,
    params: Record<string, unknown>,
  ): RuntimeEvent[] | undefined {
    const childThreadId = readNotificationThreadId(params);
    if (!childThreadId || childThreadId === this.localThreadId) return undefined;
    const child = this.children.get(childThreadId);
    if (!child) return [];

    const item = readRecord(params.item);
    const itemId = readNonEmptyString(item?.id) ?? readNonEmptyString(params.itemId);
    if (method === "item/started" && itemId) {
      const itemType = item?.type === "agentMessage" ? "assistant_message" : "tool_call";
      return [
        {
          type: "item.started",
          threadId: this.localThreadId,
          itemId,
          itemType,
          parentItemId: child.parentItemId,
          ...(itemType === "assistant_message" ? { payload: { content: [] } } : {}),
        },
      ];
    }

    if (method === "item/agentMessage/delta" && itemId) {
      const delta = readNonEmptyString(params.delta);
      if (!delta) return [];
      child.resultText += delta;
      return [
        {
          type: "content.delta",
          threadId: this.localThreadId,
          itemId,
          stream: "assistant_text",
          delta,
        },
      ];
    }

    if (method === "item/completed" && itemId) {
      const text = readNonEmptyString(item?.text);
      if (text) child.resultText = text;
      return [{ type: "item.completed", threadId: this.localThreadId, itemId }];
    }

    if (method === "turn/completed") {
      if (this.completedParentItemIds.has(child.parentItemId)) {
        this.children.delete(childThreadId);
        return [];
      }
      const current = this.parentPayloads.get(child.parentItemId);
      const state = readTurnStatus(params);
      const payload: ToolCallPayload = {
        ...(current ?? { name: "spawnAgent", status: "running", isSubAgent: true }),
        status: state === "failed" || state === "interrupted" ? "error" : "success",
        ...(child.resultText.trim() ? { result: child.resultText.trim() } : {}),
      };
      this.parentPayloads.set(child.parentItemId, payload);
      this.completedParentItemIds.add(child.parentItemId);
      this.children.delete(childThreadId);
      return [
        {
          type: "item.completed",
          threadId: this.localThreadId,
          itemId: child.parentItemId,
          payload,
        },
      ];
    }

    return [];
  }

  private hasActiveChild(parentItemId: string): boolean {
    return [...this.children.values()].some((child) => child.parentItemId === parentItemId);
  }
}

function isSubAgentPayload(payload: unknown): boolean {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).isSubAgent === true,
  );
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(readNonEmptyString).filter((item): item is string => item !== undefined)
    : [];
}

function readNotificationThreadId(params: Record<string, unknown>): string | undefined {
  const direct = readNonEmptyString(params.threadId);
  if (direct) return direct;
  const thread = readRecord(params.thread);
  return readNonEmptyString(thread?.id);
}

function readTurnStatus(params: Record<string, unknown>): string | undefined {
  return readNonEmptyString(readRecord(params.turn)?.status);
}

function readAgentDescription(value: unknown): string | undefined {
  const path = readNonEmptyString(value);
  return path?.split(/[\\/]/u).filter(Boolean).at(-1)?.replace(/[_-]+/gu, " ");
}

function readAgentCompletion(value: unknown): { failed: boolean; result?: string } | undefined {
  const state = readRecord(value);
  if (!state) return undefined;
  const completed = readNonEmptyString(state.completed);
  if (completed) return { failed: false, result: completed };
  const failed = readNonEmptyString(state.failed ?? state.errored ?? state.error);
  if (failed) return { failed: true, result: failed };
  return undefined;
}

function isSpawnAgent(value: unknown): boolean {
  const tool = readNonEmptyString(value);
  return tool?.replace(/[._/\s-]+/gu, "").toLowerCase() === "spawnagent";
}
