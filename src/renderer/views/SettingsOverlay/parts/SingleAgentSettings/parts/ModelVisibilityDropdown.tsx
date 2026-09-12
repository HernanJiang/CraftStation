import { Trans, useLingui } from "@lingui/react/macro";
import type { ProviderModelMenuProvider } from "@/renderer/components/common/ProviderModelMenu";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { resolveHiddenModelIds } from "@/shared/agentSelection";
import { ModelVisibilityPopover } from "../../ModelVisibilityPopover";

export function ModelVisibilityDropdown(props: {
  settingsKey: string;
  provider: ProviderModelMenuProvider;
  /**
   * Include the provider label in the row title. Set when the agent expands
   * to multiple visibility providers (e.g. Cursor's terminal + GUI model
   * surfaces) so sibling rows stay distinguishable.
   */
  showProviderLabel?: boolean;
}) {
  const { t } = useLingui();
  const { settingsKey, provider } = props;
  const hiddenIds = useSharedSettings((state) => state.hiddenModels[settingsKey]);
  const shownIds = useSharedSettings((state) => state.shownModels?.[settingsKey]);
  const setHiddenModels = useSharedSettings((state) => state.setHiddenModels);
  const setShownModels = useSharedSettings((state) => state.setShownModels);
  const effectiveHiddenIds = resolveHiddenModelIds(provider.capabilities, hiddenIds, shownIds);

  return (
    <div className="group flex items-center justify-between gap-4 border-b border-border/10 py-2 last:border-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-sm font-medium text-foreground">
          {props.showProviderLabel ? t`Visible ${provider.label} models` : t`Visible models`}
        </p>
        <p className="line-clamp-1 text-[11px] text-muted transition-all group-hover:line-clamp-none">
          <Trans>Toggle models off to hide them from the selector.</Trans>
        </p>
      </div>
      <ModelVisibilityPopover
        providers={[{ ...provider, hiddenModelsKey: settingsKey }]}
        hiddenIdsByKey={{ [settingsKey]: effectiveHiddenIds }}
        onHiddenIdsChange={(_key, next) => {
          // Keep the shown set in sync so curated-discovery channels treat the
          // remaining visible models as explicitly selected.
          const nextHidden = new Set(next);
          const shown = new Set(
            (shownIds ?? []).filter((id) => nextHidden.has(id) === false),
          );
          for (const model of provider.capabilities.models) {
            if (!nextHidden.has(model.id) && model.id !== "auto") shown.add(model.id);
          }
          setHiddenModels(settingsKey, next);
          setShownModels(settingsKey, [...shown]);
        }}
        listAriaLabel={t`Visible models`}
        summaryKind="visible"
        triggerClassName="min-w-[4.5rem] tabular-nums"
      />
    </div>
  );
}
