import { Trans, useLingui } from "@lingui/react/macro";
import { statusToMenuProvider } from "@/renderer/components/common/ProviderModelMenu";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type { CrossagentRoutingProviderEntry } from "@/shared/crossagentRanking";
import {
  globalVisibleCrossagentCapabilities,
  presentedCrossagentCapabilities,
} from "@/shared/crossagentVisibility";
import { ModelVisibilityPopover } from "../ModelVisibilityPopover";

/**
 * The single Own-Subagents-only visibility control: one popover checklist over
 * every eligible provider and its models. Unchecking a provider pauses it
 * (skipped by Own Subagents until re-checked); unchecking a model hides it from
 * Own Subagents without touching the global composer visibility.
 */
export function OwnSubagentsProviderModelFilter(props: {
  providers: CrossagentRoutingProviderEntry[];
}) {
  const { t } = useLingui();
  const statuses = useAgentStatusesStore((s) => s.agentStatuses);
  const disabledAgents = useSharedSettings((s) => s.disabledAgents);
  const hiddenModels = useSharedSettings((s) => s.hiddenModels);
  const ownSubagentHiddenModels = useSharedSettings((s) => s.ownSubagentHiddenModels);
  const ownSubagentPausedProviders = useSharedSettings((s) => s.ownSubagentPausedProviders);
  const setOwnSubagentHiddenModels = useSharedSettings((s) => s.setOwnSubagentHiddenModels);
  const setOwnSubagentProviderPaused = useSharedSettings((s) => s.setOwnSubagentProviderPaused);

  const menuProviders = props.providers.flatMap((entry) => {
    const status = statuses.find((candidate) => candidate.kind === entry.kind);
    if (!status) return [];
    return [
      {
        ...statusToMenuProvider(status),
        // `ownSubagentHiddenModels` is keyed by plain agent kind (see
        // `filterCrossagentCapabilities`), so pin the popover's persistence key
        // to it rather than letting it derive a surface-qualified one.
        hiddenModelsKey: entry.kind,
        capabilities: globalVisibleCrossagentCapabilities(
          entry.kind,
          entry.execution,
          presentedCrossagentCapabilities(entry.execution, status.capabilities),
          { disabledAgents, hiddenModels },
        ),
      },
    ];
  });
  if (menuProviders.length === 0) return null;

  const ariaLabel = t`Own Subagents auto-selection`;
  return (
    <ModelVisibilityPopover
      providers={menuProviders}
      hiddenIdsByKey={ownSubagentHiddenModels}
      onHiddenIdsChange={(key, next) => setOwnSubagentHiddenModels(key, next)}
      providerToggle={{
        uncheckedKinds: ownSubagentPausedProviders,
        onCheckedChange: (kind, checked) => setOwnSubagentProviderPaused(kind, !checked),
      }}
      triggerLabel={<Trans>Auto-selection</Trans>}
      listAriaLabel={ariaLabel}
      summaryKind="usable"
      footer={
        <Trans>
          Unchecked providers and models are excluded from automatic Own Subagents routing, but
          remain available for manual agent threads.
        </Trans>
      }
      compactTriggerCount
      triggerAriaLabel={ariaLabel}
      triggerClassName="shrink-0 tabular-nums"
    />
  );
}
