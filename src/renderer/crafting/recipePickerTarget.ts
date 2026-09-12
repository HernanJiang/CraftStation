import { baseAgentKind } from "@/shared/contracts";
import { providerMenuKey } from "@/renderer/components/common/ProviderModelMenu/parts/providerIdentity";
import type { ProviderModelMenuProvider } from "@/renderer/components/common/ProviderModelMenu/parts/buildItems";
import type { CustomModel } from "@/renderer/components/thread/customModelCatalog";
import { agentModelEntryId } from "@/renderer/crafting/selectedModelInventory";
import type { StoredRecipe } from "@/shared/crafting/workbenchTypes";

export interface RecipePickerTarget {
  agentKind: string;
  model: string;
  accountId?: string;
  presentationMode?: "gui" | "terminal";
}

/**
 * Resolve a saved recipe to a homepage model-picker selection
 * (`{agentKind, model, ...}` as accepted by the provider-model `onChange`).
 *
 * - Agent-surface recipes (`agent:<surfaceKey>:<modelId>`) resolve by exact
 *   entry-id match against the picker's live providers, so renames/rebinds
 *   in 管理模型 stay consistent.
 * - Custom-model recipes resolve through the custom-model catalog back to
 *   the provider surface currently serving that model id.
 * - Returns undefined when the underlying model is gone: the recipe stays
 *   manageable in 管理模型 → 我的配方 but is skipped in the picker instead
 *   of launching a dead selection.
 */
export function resolveRecipePickerTarget(
  recipe: StoredRecipe,
  providers: readonly ProviderModelMenuProvider[],
  customModels: readonly CustomModel[],
): RecipePickerTarget | undefined {
  for (const provider of providers) {
    for (const model of provider.capabilities.models) {
      if (agentModelEntryId(providerMenuKey(provider), model.id) === recipe.modelEntryRef) {
        return {
          agentKind: provider.kind,
          model: model.id,
          ...(provider.accountId ? { accountId: provider.accountId } : {}),
          ...(provider.presentationMode ? { presentationMode: provider.presentationMode } : {}),
        };
      }
    }
  }
  // 回退：配方存的是旧 surface key（账号重绑/运行时变体变化后对不上），
  // 按“基础厂商 + 模型 id”模糊匹配，保证已勾选的配方总能在模型列表出现。
  // 关键：只在同厂商内匹配。跨厂商按模型 id 硬凑会把配方劫持到别的渠道
  //（如 OpenCode 的 Gemini 配方被 Antigravity 同名模型吃掉）；同厂商的确
  // 没有该模型时宁可返回 undefined（管理页仍可管理），也不张冠李戴。
  if (recipe.modelEntryRef.startsWith("agent:")) {
    const withoutPrefix = recipe.modelEntryRef.slice("agent:".length);
    const lastColon = withoutPrefix.lastIndexOf(":");
    if (lastColon > 0) {
      const modelId = withoutPrefix.slice(lastColon + 1);
      const surfaceHead = withoutPrefix.slice(0, lastColon).split(":")[0] ?? "";
      const sameVendor = providers.filter(
        (provider) => baseAgentKind(provider.kind) === baseAgentKind(surfaceHead),
      );
      // 同厂商都不存在时直接放弃，不跨厂商凑合。
      if (sameVendor.length === 0) return undefined;
      const normalizedWanted = modelId.split("/").pop()?.toLowerCase() ?? modelId;
      for (const provider of sameVendor) {
        const model =
          provider.capabilities.models.find((candidate) => candidate.id === modelId) ??
          provider.capabilities.models.find(
            (candidate) => candidate.id.split("/").pop()?.toLowerCase() === normalizedWanted,
          );
        if (!model) continue;
        return {
          agentKind: provider.kind,
          model: model.id,
          ...(provider.accountId ? { accountId: provider.accountId } : {}),
          ...(provider.presentationMode ? { presentationMode: provider.presentationMode } : {}),
        };
      }
    }
  }
  const custom = customModels.find((entry) => entry.id === recipe.modelEntryRef);
  if (custom) {
    // A custom model is a channel-bound material. Matching by model id alone
    // is unsafe because the same Gemini id can be served by OpenCode and
    // Antigravity at the same time. Keep both the provider family and account
    // identity in the lookup so a saved recipe cannot be hijacked by the first
    // provider that happens to expose the same model string.
    const host = providers.find((provider) => {
      if (baseAgentKind(provider.kind) !== baseAgentKind(custom.provider)) return false;
      if (custom.accountId !== undefined && provider.accountId !== custom.accountId) return false;
      if (custom.accountId === undefined && provider.accountId !== undefined) return false;
      return provider.capabilities.models.some(
        (model) =>
          model.id === custom.modelId ||
          model.id.split("/").pop()?.toLowerCase() === custom.modelId.split("/").pop()?.toLowerCase(),
      );
    });
    if (host) {
      const accountId = host.accountId ?? custom.accountId;
      return {
        agentKind: host.kind,
        model: custom.modelId,
        ...(accountId !== undefined ? { accountId } : {}),
        ...(host.presentationMode ? { presentationMode: host.presentationMode } : {}),
      };
    }
  }
  return undefined;
}
