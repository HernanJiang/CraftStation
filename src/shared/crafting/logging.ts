export interface CraftingLogEvent {
  phase: "resolve" | "validate" | "compile" | "runtime" | "recovery";
  operation: string;
  status: "started" | "success" | "skipped" | "degraded" | "failed";
  correlationId?: string | undefined;
  recipeId?: string | undefined;
  modelId?: string | undefined;
  harnessKind?: string | undefined;
  entityId?: string | undefined;
  sessionId?: string | undefined;
  threadId?: string | undefined;
  details?: Record<string, unknown> | undefined;
  error?:
    | {
        code: string;
        message: string;
        remediation?: string | undefined;
      }
    | undefined;
}

export function logCraftingEvent(event: CraftingLogEvent): void {
  const timestamp = new Date().toISOString();
  const correlation = event.correlationId ? ` [corr:${event.correlationId}]` : "";
  const prefix = `[crafting:${event.phase}:${event.operation}]${correlation} status=${event.status}`;

  const payload: Record<string, unknown> = {
    timestamp,
    ...event,
  };

  if (event.status === "failed") {
    console.error(prefix, JSON.stringify(payload));
  } else if (event.status === "degraded" || event.status === "skipped") {
    console.warn(prefix, JSON.stringify(payload));
  } else {
    console.info(prefix, JSON.stringify(payload));
  }
}
