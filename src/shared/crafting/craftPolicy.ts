import { z } from "zod";

/**
 * Craft-Harness 外层策略。不进入 Agent 循环，也不读取厂商权限弹窗的文案。
 * 花费只认已经记入的美元；这里不把 token 折算成价格。
 */
export const maxCostUsdSchema = z.number().finite().positive();

export const craftPolicyLimitsSchema = z.object({
  maxCostUsd: maxCostUsdSchema.optional(),
  maxToolCalls: z.number().int().positive().optional(),
  askBeforeShell: z.boolean().optional(),
});
export type CraftPolicyLimits = z.infer<typeof craftPolicyLimitsSchema>;

export type CraftPolicyLayerName = "session" | "recipe" | "global";

export interface CraftPolicyLayers {
  session?: CraftPolicyLimits | undefined;
  recipe?: CraftPolicyLimits | undefined;
  global?: CraftPolicyLimits | undefined;
}

export type CraftPolicyDecision =
  | { action: "allow" }
  | { action: "ask" }
  | {
      action: "deny";
      layer: CraftPolicyLayerName;
      limit: "maxCostUsd" | "maxToolCalls";
      cap: number;
      message: string;
    };

const LAYER_ORDER: readonly CraftPolicyLayerName[] = ["session", "recipe", "global"];

const LAYER_LABEL: Record<CraftPolicyLayerName, string> = {
  session: "当次会话",
  recipe: "Recipe",
  global: "全局",
};

function tightest(
  layers: CraftPolicyLayers,
  limit: "maxCostUsd" | "maxToolCalls",
): { layer: CraftPolicyLayerName; cap: number } | undefined {
  let best: { layer: CraftPolicyLayerName; cap: number } | undefined;
  for (const layer of LAYER_ORDER) {
    const cap = layers[layer]?.[limit];
    if (cap == null || !(cap > 0)) continue;
    if (!best || cap < best.cap) best = { layer, cap };
  }
  return best;
}

function denyMessage(
  limit: "maxCostUsd" | "maxToolCalls",
  layer: CraftPolicyLayerName,
  cap: number,
): string {
  if (limit === "maxToolCalls") {
    return `工具调用次数已达到${LAYER_LABEL[layer]}上限（${cap} 次），这一步已停止。`;
  }
  return `花费已达到${LAYER_LABEL[layer]}上限（${cap} 美元），这一步已停止。`;
}

/**
 * 数字上限取各层里最紧的一个，并列时当次会话优先。任一层拒绝即停。
 * `askBeforeShell: true` 在任一层出现都要先问；某一层的 false 取消不了另一层的 true。
 */
export function evaluateCraftPolicy(input: {
  layers: CraftPolicyLayers;
  toolCalls: number;
  spentUsd: number;
  shell: boolean;
}): CraftPolicyDecision {
  const toolCap = tightest(input.layers, "maxToolCalls");
  if (toolCap && input.toolCalls >= toolCap.cap) {
    return {
      action: "deny",
      layer: toolCap.layer,
      limit: "maxToolCalls",
      cap: toolCap.cap,
      message: denyMessage("maxToolCalls", toolCap.layer, toolCap.cap),
    };
  }
  const spendCap = tightest(input.layers, "maxCostUsd");
  if (spendCap && input.spentUsd >= spendCap.cap) {
    return {
      action: "deny",
      layer: spendCap.layer,
      limit: "maxCostUsd",
      cap: spendCap.cap,
      message: denyMessage("maxCostUsd", spendCap.layer, spendCap.cap),
    };
  }
  const askBeforeShell = LAYER_ORDER.some((layer) => input.layers[layer]?.askBeforeShell === true);
  if (input.shell && askBeforeShell) return { action: "ask" };
  return { action: "allow" };
}

/** 计划任务配置里的当次花费上限。没有则不挂会话层。 */
export function scheduleSessionPolicy(config: {
  maxCostUsd?: number | null | undefined;
}): CraftPolicyLimits | undefined {
  if (typeof config.maxCostUsd !== "number" || !(config.maxCostUsd > 0)) return undefined;
  return { maxCostUsd: config.maxCostUsd };
}

export function withScheduleSessionPolicy<T extends object>(
  plan: T,
  config: { maxCostUsd?: number | null | undefined },
): T {
  const sessionPolicy = scheduleSessionPolicy(config);
  if (!sessionPolicy) return plan;
  return { ...plan, sessionPolicy } as T;
}
