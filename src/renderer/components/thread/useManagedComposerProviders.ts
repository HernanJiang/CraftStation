import { useMemo } from "react";
import type { AgentStatus, ThreadPresentationMode } from "@/shared/contracts";
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
import { mergeCustomModelsIntoCapabilities } from "./customModelCatalog";
import { buildProviderModelMenuProviders } from "./buildModelPickerControls";
import { resolveInitialPresentationMode } from "./threadDraftViewHelpers";
import type { ProviderModelMenuProvider } from "@/renderer/components/common/ProviderModelMenu/parts/buildItems";

/** Composer model list = 模型管理 selected models for configured channels only. */
export function useManagedComposerProviders(input?: {
  presentationMode?: ThreadPresentationMode;
  includeAgentKind?: string;
}): ProviderModelMenuProvider[] {
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const hiddenModels = useSharedSettings((state) => state.hiddenModels);
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
    const installed = getSettingsInstalledAgents(agentStatuses, wslAgentStatuses);
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
      const source =
        allProviders.find(
          (provider) =>
            provider.kind === models[0]?.provider && provider.presentationMode === "gui",
        ) ?? allProviders.find((provider) => provider.kind === models[0]?.provider);
      if (!source) return [];
      const account = usageAccounts.find((candidate) => candidate.accountId === accountId);
      const label =
        models[0]?.channelLabel ?? account?.providerAccountId ?? account?.label ?? "第三方 API";
      return [
        {
          ...source,
          label,
          accountId,
          modelPickerKey: `openai-compatible:${accountId}`,
          hiddenModelsKey: `openai-compatible:${accountId}`,
          capabilities: {
            ...source.capabilities,
            models: models.map((entry) => ({ id: entry.modelId, label: entry.displayName })),
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
