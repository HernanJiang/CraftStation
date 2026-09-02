import type { Thread } from "@/shared/contracts";
import type {
  ThreadContextCapsule,
  ThreadContextSelection,
  ThreadRuntimeProvenance,
} from "@/shared/threadCollaboration";
import { THREAD_COLLABORATION_CONTEXT_BUDGET_CHARS } from "@/shared/threadCollaboration";

export interface RuntimeProvenanceResolver {
  resolve(
    thread: Thread,
  ): Partial<
    Pick<
      ThreadRuntimeProvenance,
      "craftPlanId" | "entityId" | "segmentId" | "runtimeEpoch" | "agentMcpSupported"
    >
  >;
}

export interface ThreadContextProjection {
  project(selection: ThreadContextSelection): ThreadContextCapsule | null;
}

/** Base v0.10 resolver: reports only durable facts already owned by the thread. */
export function resolveThreadRuntimeProvenance(
  thread: Thread,
  optional?: RuntimeProvenanceResolver,
): ThreadRuntimeProvenance {
  const binding = thread.compositionProvenance?.runtimeBinding;
  return {
    threadId: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    modelId: binding?.modelId ?? thread.config.model,
    harnessId: binding?.harnessKind ?? thread.agentKind,
    ...(thread.compositionProvenance?.recipeId
      ? { recipeId: thread.compositionProvenance.recipeId }
      : {}),
    ...(thread.sessionRef?.providerSessionId
      ? { nativeSessionId: thread.sessionRef.providerSessionId }
      : {}),
    ...(thread.worktreePath ? { worktreePath: thread.worktreePath } : {}),
    // UI collaboration is always available through the control plane. Agent
    // MCP support is a stronger claim: only an optional runtime resolver that
    // observed the effective launch may set it true. Durable Thread rows do not
    // retain enough information to prove that app-controls was injected (or
    // accepted by an ACP peer), so the base resolver must fail closed.
    agentMcpSupported: false,
    ...(optional?.resolve(thread) ?? {}),
  };
}

const REDACTION_RULES: readonly [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, "Bearer [REDACTED_TOKEN]"],
  [
    /(api[_ -]?key|access[_ -]?token|password|cookie|secret|client[_ -]?secret)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED]",
  ],
  [
    /<(?:hidden[_ -]?reasoning|chain[_ -]?of[_ -]?thought|cot)>[\s\S]*?<\/(?:hidden[_ -]?reasoning|chain[_ -]?of[_ -]?thought|cot)>/gi,
    "[REDACTED_HIDDEN_REASONING]",
  ],
];

export class BoundedThreadContextProjection implements ThreadContextProjection {
  project(selection: ThreadContextSelection): ThreadContextCapsule | null {
    if (!selection) return null;
    const parts: Array<{ kind: ThreadContextCapsule["sourceKinds"][number]; text: string }> = [];
    for (const text of selection.selectedMessages ?? []) {
      parts.push({ kind: "selected-message", text });
    }
    if (selection.summary) parts.push({ kind: "summary", text: selection.summary });
    if (selection.state) parts.push({ kind: "state", text: selection.state });
    for (const text of selection.recentCompletedTurns ?? []) {
      parts.push({ kind: "recent-turn", text });
    }
    if (parts.length === 0) return null;

    const original = parts.map(({ kind, text }) => `[${kind}]\n${text}`).join("\n\n");
    let redactedText = original;
    for (const [pattern, replacement] of REDACTION_RULES) {
      redactedText = redactedText.replace(pattern, replacement);
    }
    const text = redactedText.slice(0, THREAD_COLLABORATION_CONTEXT_BUDGET_CHARS);
    return {
      kind: "portable-context",
      text,
      sourceKinds: [...new Set(parts.map(({ kind }) => kind))],
      redacted: redactedText !== original || text.length < redactedText.length,
      originalChars: original.length,
    };
  }
}

export function redactCollaborationDiagnostic(value: unknown): string {
  return redactCollaborationText(value instanceof Error ? value.message : String(value), 2_000);
}

/** Redact portable user-visible text before it enters the durable exchange ledger. */
export function redactCollaborationText(text: string, maxChars = 50_000): string {
  let redacted = text;
  for (const [pattern, replacement] of REDACTION_RULES) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted.slice(0, maxChars);
}
