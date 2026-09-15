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
/** Strip `harness:` / `native-harness:` so a stored ref launches as `opencode`. */
export function normalizeRecipeHarnessKind(raw: string | undefined): string {
  return (raw ?? "").replace(/^harness:/u, "").replace(/^native-harness:/u, "");
}

/** Harness kind a saved recipe should launch on (`opencode`, not `harness:opencode`). */
export function recipeLaunchHarnessKind(recipe: StoredRecipe): string {
  return normalizeRecipeHarnessKind(recipe.lastKnownHarness?.harnessKind || recipe.harnessRef);
}

/** Provider/agent kind encoded in an `agent:` / `custom:` material ref. */
export function providerKindFromRecipeRef(ref: string): string | undefined {
  if (ref.startsWith("agent:") || ref.startsWith("custom:")) {
    const head = ref.slice(ref.indexOf(":") + 1).split(":")[0]?.trim();
    return head || undefined;
  }
  return undefined;
}

/**
 * Model id encoded in an `agent:<surface>:<modelId>` material ref. Custom-model
 * refs (`custom:…`) are catalog ids, not launch ids — those stay undefined.
 */
export function modelIdFromRecipeRef(ref: string): string | undefined {
  if (!ref.startsWith("agent:")) return undefined;
  const withoutPrefix = ref.slice("agent:".length);
  const lastColon = withoutPrefix.lastIndexOf(":");
  if (lastColon <= 0) return undefined;
  const modelId = withoutPrefix.slice(lastColon + 1).trim();
  return modelId || undefined;
}

/** Concrete model id a saved recipe should launch, even if lastKnown stored an entry ref. */
export function recipeLaunchModelId(recipe: StoredRecipe): string | undefined {
  const stored = recipe.lastKnownModel?.modelId?.trim();
  if (stored && !stored.startsWith("agent:") && !stored.startsWith("custom:")) return stored;
  return modelIdFromRecipeRef(recipe.modelEntryRef) ?? stored;
}

export function resolveRecipePickerTarget(
  recipe: StoredRecipe,
  providers: readonly ProviderModelMenuProvider[],
  customModels: readonly CustomModel[],
): RecipePickerTarget | undefined {
  const launchKind = recipeLaunchHarnessKind(recipe);
  for (const provider of providers) {
    // A workbench recipe is Harness · Model. The model card may come from
    // another vendor's inventory (Gemini on Antigravity, then OpenCode as
    // Harness). Exact material-id match must not hijack launch onto that
    // vendor — only the recipe's harness family may win here.
    if (
      launchKind &&
      baseAgentKind(provider.kind) !== baseAgentKind(launchKind)
    ) {
      continue;
    }
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
      const family = launchKind || surfaceHead;
      const sameVendor = providers.filter(
        (provider) => baseAgentKind(provider.kind) === baseAgentKind(family),
      );
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
  // 合成台配方是 Harness · 模型 的显式组合（第三方兼容 API / 订阅→CPA→第三方）。
  // 模型不必出现在该 Harness 的原生目录里：只要对应 Harness 还在选择器中，
  // 就按配方启动，由 withPreferredModel 把模型 id 注入能力表。绝不跨厂商凑合。
  const launchModel = recipeLaunchModelId(recipe) ?? custom?.modelId;
  if (!launchKind || !launchModel) return undefined;
  const sameFamily = providers.filter(
    (provider) => baseAgentKind(provider.kind) === baseAgentKind(launchKind),
  );
  if (sameFamily.length === 0) return undefined;
  const host =
    sameFamily.find((provider) => provider.kind === launchKind && provider.accountId === undefined) ??
    sameFamily.find((provider) => provider.kind === launchKind) ??
    sameFamily[0];
  if (!host) return undefined;
  const served = host.capabilities.models.some(
    (model) =>
      model.id === launchModel ||
      model.id.split("/").pop()?.toLowerCase() === launchModel.split("/").pop()?.toLowerCase(),
  );
  return {
    agentKind: host.kind,
    model: launchModel,
    ...(served && host.accountId ? { accountId: host.accountId } : {}),
    ...(host.presentationMode ? { presentationMode: host.presentationMode } : {}),
  };
}
