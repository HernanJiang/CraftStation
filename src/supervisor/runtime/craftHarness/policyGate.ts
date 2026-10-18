import {
  evaluateCraftPolicy,
  type CraftPolicyDecision,
  type CraftPolicyLayers,
} from "@/shared/crafting/craftPolicy";

export type PolicyBindMode = "reset" | "keep";

interface BoundPolicy {
  layers: CraftPolicyLayers;
  toolCalls: number;
  spentUsd: number;
}

/**
 * 按线程记住三层策略。未绑定的线程直接放行。
 * 花费上限只有在 recordUsd 之后才会触发；当前没有美元上报者。
 */
export class PolicyGate {
  private readonly threads = new Map<string, BoundPolicy>();

  bind(threadId: string, layers: CraftPolicyLayers, mode: PolicyBindMode = "reset"): void {
    const previous = this.threads.get(threadId);
    const keep = mode === "keep" && previous !== undefined;
    this.threads.set(threadId, {
      layers,
      toolCalls: keep ? previous.toolCalls : 0,
      spentUsd: keep ? previous.spentUsd : 0,
    });
  }

  /**
   * 允许和先问都计入工具次数，拒绝不计入。
   * 这样「先问」不能绕过次数上限。
   */
  decide(threadId: string, input: { shell: boolean }): CraftPolicyDecision {
    const state = this.threads.get(threadId);
    if (!state) return { action: "allow" };
    const decision = evaluateCraftPolicy({
      layers: state.layers,
      toolCalls: state.toolCalls,
      spentUsd: state.spentUsd,
      shell: input.shell,
    });
    if (decision.action !== "deny") state.toolCalls += 1;
    return decision;
  }

  recordUsd(threadId: string, usd: number): void {
    const state = this.threads.get(threadId);
    if (!state || !Number.isFinite(usd) || usd <= 0) return;
    state.spentUsd += usd;
  }

  clear(threadId: string): void {
    this.threads.delete(threadId);
  }

  reset(): void {
    this.threads.clear();
  }
}

export const policyGate = new PolicyGate();

export function isShellToolCall(
  toolCall: { kind?: unknown; rawInput?: unknown } | null | undefined,
): boolean {
  if (!toolCall) return false;
  if (toolCall.kind === "execute") return true;
  const raw = toolCall.rawInput;
  if (!raw || typeof raw !== "object") return false;
  return typeof (raw as { command?: unknown }).command === "string";
}
