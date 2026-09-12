import type { AgentStatus } from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import { getSettingsInstalledAgents } from "@/shared/agentStatus";
import { resolveHiddenModelIds } from "@/shared/agentSelection";
import { expandAgentToVisibilityProviders } from "@/renderer/components/thread/buildModelPickerControls";
import {
  providerMenuKey,
  providerVisibilityKey,
} from "@/renderer/components/common/ProviderModelMenu/parts/providerIdentity";
import { resolveDisplayedProviders } from "@/renderer/components/providers/usageProviders";
import type { SelectedModelEntry } from "@/shared/crafting/workbenchTypes";

/**
 * Stable model-material identity for an installed agent surface.
 *
 * The provider surface key already distinguishes provider kind, presentation
 * mode, runtime variant and (via the channel suffix) account/channel. We keep
 * that full surface in the id so two surfaces that differ only in account or
 * channel are distinct materials — a bare modelId is never enough.
 */
export function agentModelEntryId(providerSurfaceKey: string, modelId: string): string {
  return `agent:${providerSurfaceKey}:${modelId}`;
}

/**
 * Build the user's selectable Model inventory for the Workbench, reusing the
 * exact same sources as the "管理模型" page:
 *   - installed agent surfaces (AgentStatus + hiddenModels)
 *   - custom models (SharedSettings.customModels), including account-bound
 *     OpenAI-compatible models saved under provider = "codex".
 *
 * The Workbench must NOT read `getDefaultRegistry().listItems("model")`.
 */
export function buildSelectedModelInventory(input: {
  agentStatuses: AgentStatus[];
  wslAgentStatuses: AgentStatus[];
  hiddenModels: SharedSettings["hiddenModels"];
  shownModels?: SharedSettings["shownModels"];
  customModels: SharedSettings["customModels"];
  accounts: ReadonlyArray<{ accountId: string }>;
  configuredProviderIds: readonly string[];
  providerOrder: readonly string[];
}): SelectedModelEntry[] {
  const {
    agentStatuses,
    wslAgentStatuses,
    hiddenModels,
    shownModels,
    customModels,
    accounts,
    configuredProviderIds,
    providerOrder,
  } = input;

  const configuredProviders = new Set(configuredProviderIds);
  const providerLabels = new Map(
    resolveDisplayedProviders(providerOrder, []).map((p) => [p.id, p.label]),
  );

  const installed = getSettingsInstalledAgents(agentStatuses, wslAgentStatuses);
  const agentEntries: SelectedModelEntry[] = installed
    .flatMap(expandAgentToVisibilityProviders)
    .filter((provider) => configuredProviders.has(provider.kind))
    .flatMap((provider) => {
      const surfaceKey = providerVisibilityKey(provider);
      const hidden = new Set(
        resolveHiddenModelIds(provider.capabilities, hiddenModels[surfaceKey], shownModels?.[surfaceKey]),
      );
      return provider.capabilities.models
        .filter((model) => model.id !== "auto" && !hidden.has(model.id))
        .map((model) => {
          const entry: SelectedModelEntry = {
            entryId: agentModelEntryId(providerMenuKey(provider), model.id),
            source: "agent",
            providerKind: provider.kind,
            providerSurfaceKey: surfaceKey,
            providerLabel: provider.label,
            channelLabel: provider.label,
            modelId: model.id,
            displayName: model.label,
            ...(provider.presentationMode ? { presentationMode: provider.presentationMode } : {}),
            ...(provider.runtimeVariant ? { runtimeVariant: provider.runtimeVariant } : {}),
          };
          return entry;
        });
    });

  const activeAccountIds = new Set(accounts.map((account) => account.accountId));
  const customEntries: SelectedModelEntry[] = customModels
    .filter((model) =>
      model.accountId
        ? activeAccountIds.has(model.accountId)
        : configuredProviders.has(model.provider),
    )
    .map((model) => {
      const channelLabel =
        model.channelLabel ?? providerLabels.get(model.provider) ?? model.provider;
      const entry: SelectedModelEntry = {
        entryId: model.id,
        source: "custom",
        providerKind: model.provider,
        providerSurfaceKey: model.provider,
        providerLabel: channelLabel,
        channelLabel,
        modelId: model.modelId,
        displayName: model.displayName,
        ...(model.accountId ? { accountId: model.accountId } : {}),
        ...(model.contextSize ? { contextSize: model.contextSize } : {}),
        capabilitySource: "custom",
      };
      return entry;
    });

  return [...agentEntries, ...customEntries];
}

/** Find one selectable model by entryId. */
export function findSelectedModelEntry(
  entries: readonly SelectedModelEntry[],
  entryId: string | undefined,
): SelectedModelEntry | undefined {
  if (!entryId) return undefined;
  return entries.find((entry) => entry.entryId === entryId);
}
