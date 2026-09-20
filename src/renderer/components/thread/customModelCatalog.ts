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

/**
 * 各渠道实测思考强度档位（2026-09 实采：Codex/Grok/Kimi/Antigravity/
 * OpenCode/Command Code 上报值）。自定义模型对话框用它做一键预设，
 * 用户也可手写任意档位（各厂商文档为准）。
 */
export const VENDOR_EFFORT_PRESETS: Readonly<Record<string, { tiers: string[]; def: string }>> = {
  codex: { tiers: ["low", "medium", "high", "xhigh", "max", "ultra"], def: "high" },
  grok: { tiers: ["xhigh", "high", "medium", "low"], def: "xhigh" },
  kimi: { tiers: ["low", "high", "max"], def: "high" },
  antigravity: { tiers: ["Low", "Medium", "High"], def: "High" },
  opencode: {
    tiers: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "thinking"],
    def: "high",
  },
  commandcode: { tiers: ["low", "medium", "high", "xhigh", "max"], def: "high" },
};

export const DEFAULT_EFFORT_PRESET = { tiers: ["low", "medium", "high"], def: "high" };

export function effortPresetForProvider(provider: string): { tiers: string[]; def: string } {
  return VENDOR_EFFORT_PRESETS[provider] ?? DEFAULT_EFFORT_PRESET;
}

/** 解析逗号分隔的手写档位（去空、去重、保序）。 */
export function parseEffortTiers(input: string): string[] {
  const seen = new Set<string>();
  for (const part of input.split(/[,，、\s]+/)) {
    const tier = part.trim();
    if (tier && !seen.has(tier)) seen.add(tier);
  }
  return [...seen];
}

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
 * 追加 models 条目；为带档位的模型补齐 contextSizes / modelContextSizes；
 * 为自带思考档位的模型补齐 modelEfforts / modelDefaultEfforts。
 * 与内置 model id 冲突的自定义条目跳过（内置优先）。纯函数，供首页模型选择器使用。
 *
 * 渠道绑定条目（带 accountId，不进公共 models 列表）同样贡献档位与上下文：
 * 否则渠道模型的思考强度下拉永远出不来——档位只认 capabilities，
 * 而 capabilities 之前把这类条目整个丢掉了。
 */
export function mergeCustomModelsIntoCapabilities(
  agentKind: string,
  capabilities: AgentCapability,
  customModels: readonly CustomModel[],
): AgentCapability {
  const mine = customModels.filter((model) => model.provider === agentKind);
  if (mine.length === 0) return capabilities;
  const existing = new Set(capabilities.models.map((model) => model.id));
  const appended = mine
    .filter((model) => model.accountId === undefined && !existing.has(model.modelId))
    .map((model) => ({ id: model.modelId, label: model.displayName }));
  const withModels: AgentCapability =
    appended.length === 0
      ? capabilities
      : {
          ...capabilities,
          models: [...capabilities.models, ...appended],
        };
  const customEfforts = collectCustomModelEfforts(mine);

  const contextValues = [
    ...new Set(mine.map((model) => model.contextSize.trim()).filter((value) => value !== "")),
  ];
  const noContextWork = contextValues.length === 0;
  const noEffortWork = !customEfforts;
  if (noContextWork && noEffortWork) return withModels;

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
    // 自定义档位与内置档位合并（内置同名优先，自定义只补缺）。
    ...(customEfforts
      ? {
          modelEfforts: { ...customEfforts.modelEfforts, ...withModels.modelEfforts },
          modelDefaultEfforts: {
            ...customEfforts.modelDefaultEfforts,
            ...withModels.modelDefaultEfforts,
          },
        }
      : {}),
  };
}

/**
 * 自定义模型的思考档位合并：有档位的条目写入 modelEfforts（显示强度
 * 下拉），带默认值的写入 modelDefaultEfforts。返回 undefined 表示无事可做。
 */
export function collectCustomModelEfforts(
  models: readonly CustomModel[],
):
  | { modelEfforts: Record<string, string[]>; modelDefaultEfforts?: Record<string, string> }
  | undefined {
  const modelEfforts: Record<string, string[]> = {};
  const modelDefaultEfforts: Record<string, string> = {};
  for (const model of models) {
    const tiers = (model.efforts ?? []).map((tier) => tier.trim()).filter(Boolean);
    if (tiers.length === 0) continue;
    modelEfforts[model.modelId] = [...new Set(tiers)];
    const def = model.defaultEffort?.trim();
    if (def && tiers.includes(def)) modelDefaultEfforts[model.modelId] = def;
  }
  if (Object.keys(modelEfforts).length === 0) return undefined;
  return {
    modelEfforts,
    ...(Object.keys(modelDefaultEfforts).length > 0 ? { modelDefaultEfforts } : {}),
  };
}
