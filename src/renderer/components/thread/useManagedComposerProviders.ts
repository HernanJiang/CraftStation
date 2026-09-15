import { useMemo } from "react";
import type { AgentStatus, ThreadPresentationMode } from "@/shared/contracts";
import { baseAgentKind } from "@/shared/contracts";
import { getSettingsInstalledAgents } from "@/shared/agentStatus";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { useUsageLoginStateStore } from "@/renderer/state/usageLoginStateStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import {
  isConfiguredComposerAgent,
  resolveConfiguredProviderIds,
} from "@/renderer/crafting/configuredProviders";
import {
  collectCustomModelEfforts,
  mergeCustomModelsIntoCapabilities,
} from "./customModelCatalog";
import { buildProviderModelMenuProviders } from "./buildModelPickerControls";
import { resolveThirdPartyHarnessForModel } from "@/shared/thirdPartyRouting";
import { resolveInitialPresentationMode } from "./threadDraftViewHelpers";
import type { ProviderModelMenuProvider } from "@/renderer/components/common/ProviderModelMenu/parts/buildItems";

/**
 * DeepSeek 原生 Harness 只活在合成台。Auto 目录走 Command Code 等渠道，
 * 启动时再 remap 到 dsh。`includeAgentKind` 必须是 catalog/channel
 *（Command Code），不能是 remap 后的 Harness，否则官方模型行会抢走渠道行。
 */
export function isComposerPickerExcludedAgent(kind: string): boolean {
  const base = baseAgentKind(kind);
  return base === "deepseek" || base === "deepseek-harness";
}

/** Composer model list = 模型管理 selected models for configured channels only. */
export function useManagedComposerProviders(input?: {
  presentationMode?: ThreadPresentationMode;
  includeAgentKind?: string;
}): ProviderModelMenuProvider[] {
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const hiddenModels = useSharedSettings((state) => state.hiddenModels);
  const shownModels = useSharedSettings((state) => state.shownModels);
  const customModels = useSharedSettings((state) => state.customModels);
  const lastPresentationModeByAgent = useSharedSettings(
    (state) => state.lastPresentationModeByAgent,
  );
  const usageAccounts = useUsageAccountsStore((state) => state.accounts);
  const usageAccountsHydrated = useUsageAccountsStore((state) => state.hydrated);
  const storedLogin = useUsageLoginStateStore((state) => state.stored);
  const usageSnapshots = useProviderUsageStore((state) => state.snapshots);
  const presentationMode = input?.presentationMode ?? "gui";
  const includeAgentKind = input?.includeAgentKind;

  const configuredProviderIds = useMemo(
    () =>
      new Set(
        resolveConfiguredProviderIds({
          accounts: usageAccounts,
          storedLogin,
          usageSnapshots,
        }),
      ),
    [usageAccounts, storedLogin, usageSnapshots],
  );

  const usageChannelsReady = usageAccountsHydrated || Object.values(storedLogin).some(Boolean);

  return useMemo(() => {
    const installed = getSettingsInstalledAgents(agentStatuses, wslAgentStatuses).filter(
      (agent) =>
        !isComposerPickerExcludedAgent(agent.kind) ||
        baseAgentKind(includeAgentKind ?? "") === "deepseek",
    );
    const allProviders = buildProviderModelMenuProviders(installed, {
      resolvePresentationMode: (agent: AgentStatus) => {
        const supported = agent.capabilities.presentationModes ?? [
          agent.capabilities.presentationMode,
        ];
        return supported.includes(presentationMode)
          ? presentationMode
          : resolveInitialPresentationMode(agent, lastPresentationModeByAgent);
      },
      hiddenModelsByAgent: hiddenModels,
      shownModelsByAgent: shownModels,
      filterAgent: (agent) => {
        if (presentationMode !== "gui") return true;
        const modes = agent.capabilities.presentationModes ?? [agent.capabilities.presentationMode];
        return modes.includes("gui") || agent.kind === includeAgentKind;
      },
    }).map((provider) => ({
      ...provider,
      capabilities: mergeCustomModelsIntoCapabilities(
        provider.kind,
        provider.capabilities,
        customModels,
      ),
    }));
    const baseProviders = usageChannelsReady
      ? allProviders.filter(
          (provider) =>
            isConfiguredComposerAgent(provider.kind, configuredProviderIds) ||
            provider.kind === includeAgentKind,
        )
      : allProviders;
    const accountGroups = new Map<string, typeof customModels>();
    for (const entry of customModels) {
      if (!entry.accountId) continue;
      accountGroups.set(entry.accountId, [...(accountGroups.get(entry.accountId) ?? []), entry]);
    }
    const accountProviders = [...accountGroups].flatMap(([accountId, models]) => {
      const account = usageAccounts.find((candidate) => candidate.accountId === accountId);
      const label =
        models[0]?.channelLabel ?? account?.providerAccountId ?? account?.label ?? "第三方 API";
      const source =
        allProviders.find(
          (provider) =>
            provider.kind === models[0]?.provider && provider.presentationMode === "gui",
        ) ?? allProviders.find((provider) => provider.kind === models[0]?.provider);
      // 自定义渠道（火山方舟 / Chiral 等 openai-compatible 账号）的模型在首页
      // 必须出现：即使源 adapter 当前不可用（未安装/未登录），也用一个最小
      // 能力面兜底展示，而不是整组丢弃。
      const effectiveSource: ProviderModelMenuProvider = source ?? {
        kind:
          models[0]?.provider ??
          (models[0] ? resolveThirdPartyHarnessForModel(models[0].modelId) : "opencode"),
        label,
        presentationMode: "gui",
        modelPickerKey: `openai-compatible:${accountId}`,
        hiddenModelsKey: `openai-compatible:${accountId}`,
        capabilities: {
          models: [],
          efforts: ["low", "medium", "high"],
          modelEfforts: {},
          defaultEffort: "high",
          modes: ["agent"],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: false,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
          settingDefs: [],
        },
      };
      // 账号绑定的自定义模型若自带思考档位，同样并入能力面（否则这类模型
      // 在选择器里永远没有强度可选）。
      const customEfforts = collectCustomModelEfforts(models);
      return [
        {
          ...effectiveSource,
          label,
          accountId,
          modelPickerKey: `openai-compatible:${accountId}`,
          hiddenModelsKey: `openai-compatible:${accountId}`,
          capabilities: {
            ...effectiveSource.capabilities,
            models: models.map((entry) => ({ id: entry.modelId, label: entry.displayName })),
            ...(customEfforts
              ? {
                  modelEfforts: {
                    ...customEfforts.modelEfforts,
                    ...effectiveSource.capabilities.modelEfforts,
                  },
                  modelDefaultEfforts: {
                    ...customEfforts.modelDefaultEfforts,
                    ...effectiveSource.capabilities.modelDefaultEfforts,
                  },
                }
              : {}),
          },
        },
      ];
    });
    return [...baseProviders, ...accountProviders];
  }, [
    agentStatuses,
    wslAgentStatuses,
    presentationMode,
    lastPresentationModeByAgent,
    hiddenModels,
    shownModels,
    customModels,
    usageAccounts,
    configuredProviderIds,
    includeAgentKind,
    usageChannelsReady,
  ]);
}

export function useConfiguredComposerProviderIds(): Set<string> {
  const usageAccounts = useUsageAccountsStore((state) => state.accounts);
  const storedLogin = useUsageLoginStateStore((state) => state.stored);
  const usageSnapshots = useProviderUsageStore((state) => state.snapshots);
  return useMemo(
    () =>
      new Set(
        resolveConfiguredProviderIds({
          accounts: usageAccounts,
          storedLogin,
          usageSnapshots,
        }),
      ),
    [usageAccounts, storedLogin, usageSnapshots],
  );
}
