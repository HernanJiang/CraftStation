import type { AgentCapability } from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";

export type CustomModel = SharedSettings["customModels"][number];

/** 上下文档位：""＝默认最高；其余为预设档位或用户手填的原始值（如 "200K"、"300000"）。 */
export const CONTEXT_SIZE_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "默认最高" },
  { value: "128K", label: "128K" },
  { value: "256K", label: "256K" },
  { value: "384K", label: "384K" },
  { value: "512K", label: "512K" },
  { value: "1M", label: "1M" },
];

/** 把档位字符串解析为 token 数；无法解析时返回 undefined（＝默认最高）。 */
export function parseContextSizeTokens(value: string | undefined): number | undefined {
  const raw = value?.trim() ?? "";
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = /^(\d+(?:\.\d+)?)\s*(K|M)$/i.exec(raw);
  if (!match || !match[1] || !match[2]) return undefined;
  const base = Number(match[1]);
  return Number.isFinite(base)
    ? base * (match[2].toUpperCase() === "M" ? 1_048_576 : 1024)
    : undefined;
}

/** 稳定的自定义模型 id：同渠道同模型只保留一份。 */
export function customModelId(provider: string, modelId: string, accountId?: string): string {
  return `custom:${provider}:${accountId ? `${accountId}:` : ""}${modelId}`;
}

function contextLabel(value: string): string {
  return CONTEXT_SIZE_PRESETS.find((preset) => preset.value === value)?.label ?? value;
}

/**
 * 把「管理模型」页保存的自定义模型合并进某个 agent 的能力表：
 * 追加 models 条目；为带档位的模型补齐 contextSizes / modelContextSizes。
 * 与内置 model id 冲突的自定义条目跳过（内置优先）。纯函数，供首页模型选择器使用。
 */
export function mergeCustomModelsIntoCapabilities(
  agentKind: string,
  capabilities: AgentCapability,
  customModels: readonly CustomModel[],
): AgentCapability {
  const mine = customModels.filter(
    (model) => model.provider === agentKind && model.accountId === undefined,
  );
  if (mine.length === 0) return capabilities;
  const existing = new Set(capabilities.models.map((model) => model.id));
  const appended = mine
    .filter((model) => !existing.has(model.modelId))
    .map((model) => ({ id: model.modelId, label: model.displayName }));
  if (appended.length === 0) return capabilities;

  const withModels: AgentCapability = {
    ...capabilities,
    models: [...capabilities.models, ...appended],
  };

  const contextValues = [
    ...new Set(mine.map((model) => model.contextSize.trim()).filter((value) => value !== "")),
  ];
  if (contextValues.length === 0) return withModels;

  const baseSizes = withModels.contextSizes ?? [];
  const sizeIds = new Set(baseSizes.map((size) => size.id));
  const extraSizes = contextValues
    .filter((value) => !sizeIds.has(value))
    .map((value) => ({ id: value, label: contextLabel(value) }));

  const modelContextSizes = { ...(withModels.modelContextSizes ?? {}) };
  for (const model of mine) {
    const value = model.contextSize.trim();
    if (value === "") continue;
    const current = modelContextSizes[model.modelId];
    modelContextSizes[model.modelId] = current?.includes(value) ? current : [value];
  }

  return {
    ...withModels,
    contextSizes: [...baseSizes, ...extraSizes],
    modelContextSizes,
  };
}
