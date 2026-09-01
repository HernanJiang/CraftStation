import type { AgentEventEnvelope } from "@/shared/contracts";

/**
 * Set `CRAFTSTATION_HOOK_DEBUG=1` (any truthy value except `0`) to print
 * supervisor-side traces for manual testing: L1/L2 spawn mode, each hook
 * envelope, WSL bridge bring-up, and unroutable events.
 */
export function isCraftStationHookDebug(): boolean {
  const v = process.env.CRAFTSTATION_HOOK_DEBUG;
  return Boolean(v && v !== "0");
}

export function hookDebugSpawn(summary: Record<string, unknown>): void {
  if (!isCraftStationHookDebug()) return;
  console.log("[supervisor] hook-debug: spawn status-detection", summary);
}

export function hookDebugEnvelope(
  source: "hook-ingress" | "wsl-bridge",
  envelope: AgentEventEnvelope,
): void {
  if (!isCraftStationHookDebug()) return;
  const agentNativeEvent =
    envelope.extra && typeof envelope.extra.agentNativeEvent === "string"
      ? envelope.extra.agentNativeEvent
      : undefined;
  console.log(`[supervisor] hook-debug: envelope ← ${source}`, {
    threadId: envelope.threadId,
    sessionId: envelope.sessionId,
    intent: envelope.intent,
    ...(agentNativeEvent ? { claudeHookEvent: agentNativeEvent } : {}),
    agentKind: envelope.agentKind,
    ts: envelope.ts,
  });
}

export function hookDebugRouted(
  threadId: string,
  intent: AgentEventEnvelope["intent"],
  stateChange: { status: string; attention: string } | null,
): void {
  if (!isCraftStationHookDebug()) return;
  console.log(
    stateChange
      ? "[supervisor] hook-debug: routed → apply state"
      : "[supervisor] hook-debug: routed → bookkeeping (no status change)",
    {
      threadId,
      intent,
      ...(stateChange ? { stateChange } : {}),
    },
  );
}
