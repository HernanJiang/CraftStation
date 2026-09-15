/**
 * Command Code native model ids (`vendor/model` or un-namespaced Anthropic/
 * OpenAI ids). Catalog rows sometimes stamp the channel as `commandcode/<leaf>`;
 * resolve back to these ids by exact lookup — never invent a vendor.
 */

import { modelProviderPrefix, stripModelProviderPrefix } from "./harnessCompatibility";

export const COMMANDCODE_NATIVE_MODEL_IDS = [
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-flash-vision-exp",
  "deepseek/deepseek-v4-flash-fast",
  "deepseek/deepseek-v4.1-pro",
  "deepseek/deepseek-v4.1-flash",
  "deepseek/deepseek-v4.1-flash-vision-exp",
  "deepseek/deepseek-v4.1-flash-fast",
  "moonshotai/kimi-k3",
  "moonshotai/kimi-k2.7-code",
  "moonshotai/kimi-k2.7-code-highspeed",
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.5",
  "z-ai/glm-5.3-flash",
  "zai-org/glm-5.3",
  "zai-org/glm-5.2",
  "zai-org/glm-5.2-fast",
  "zai-org/glm-5.1",
  "zai-org/glm-5",
  "minimaxai/minimax-m3",
  "minimaxai/minimax-m2.7",
  "minimaxai/minimax-m2.5",
  "xiaomi/mimo-v2.5-pro",
  "xiaomi/mimo-v2.5",
  "qwen/qwen3.8-max-0902",
  "qwen/qwen3.8-max",
  "qwen/qwen3.8-27b",
  "qwen/qwen3.8-flash",
  "qwen/qwen3.7-max",
  "qwen/qwen3.7-plus",
  "qwen/qwen3.7-flash",
  "qwen/qwen3.6-max-preview",
  "qwen/qwen3.6-plus",
  "meituan/longcat-2.0:free",
  "stepfun/step-3.7-flash",
  "stepfun/step-3.5-flash",
  "tencent/hy3-paid",
  "tencent/hy4-preview",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "thinkingmachines/inkling",
  "thinkingmachines/inkling-small",
  "poolside/laguna-s-2.1-free",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-haiku-4-5",
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.4-mini",
  "google/gemini-3.8-flash",
  "google/gemini-3.7-flash",
  "google/gemini-3.6-flash",
  "google/gemini-3.5-flash",
  "google/gemini-3.5-flash-lite",
  "google/gemini-3.1-flash-lite",
  "sakana/fugu-ultra",
  "meta/muse-spark-1.1",
  "meta/muse-spark-1.2",
  "meta/muse-spark-1.2-contributor",
  "meta/muse-spark-1.3",
  "meta/muse-spark-1.3-contributor",
  "xai/grok-4.5",
  "xai/grok-4.6",
] as const;

const NATIVE_SET = new Set<string>(COMMANDCODE_NATIVE_MODEL_IDS);

function nativeIdForLeaf(leaf: string): string | undefined {
  if (NATIVE_SET.has(leaf)) return leaf;
  const matches = COMMANDCODE_NATIVE_MODEL_IDS.filter(
    (id) => id === leaf || id.endsWith(`/${leaf}`),
  );
  if (matches.length === 1) return matches[0];
  const exactLeaf = matches.filter((id) => id.slice(id.lastIndexOf("/") + 1) === leaf);
  if (exactLeaf.length === 1) return exactLeaf[0];
  return undefined;
}

/**
 * Map a catalog-stamped Command Code id back to the CLI/API native id.
 * Unknown leaves are returned as the stripped remainder — never a guessed vendor.
 */
export function resolveCommandCodeNativeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  if (NATIVE_SET.has(trimmed)) return trimmed;
  const channel = modelProviderPrefix(trimmed)?.trim().toLowerCase();
  if (channel !== "commandcode") return trimmed;
  const rest = stripModelProviderPrefix(trimmed);
  if (!rest) return trimmed;
  return nativeIdForLeaf(rest) ?? rest;
}
