import { useMemo } from "react";
import { ArrowRight, RefreshCw, Unlink } from "lucide-react";
import type { AccountView } from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { resolveDisplayedProviders } from "@/renderer/components/providers/usageProviders";
import { buildSelectedModelInventory } from "@/renderer/crafting/selectedModelInventory";
import { useNativeHarnessControlPlane } from "@/renderer/crafting/useNativeHarnessControlPlane";
import { openHarnessConfiguration } from "@/renderer/crafting/openHarnessConfiguration";
import { ProviderBrandBadge } from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";
import { HarnessCliRow } from "./workbench/HarnessCliRow";

/**
 * Provider → default Harness/CLI mapping. Provider ids already equal their
 * native harness kind for most vendors; aliases cover the ones whose CLI kind
 * diverges from the usage-provider id.
 */
const PROVIDER_TO_HARNESS_KIND: Record<string, string> = {
  zai: "zcode",
};

/**
 * Harness map tab (replaces the old "我的配方" tab): a two-column tree pairing
 * every provider channel on the left with its default Harness/CLI on the
 * right. Providers without a native harness stay listed (they run through the
 * compatibility route); harnesses with no provider channel drop into an
 * unlinked group at the bottom.
 */
export function HarnessMapPage(props: {
  accounts: AccountView[];
  customModels: SharedSettings["customModels"];
  configuredProviderIds: readonly string[];
  providerOrder: readonly string[];
}) {
  const {
    visibleEntries,
    loading,
    highlightedKind,
    setHighlightedKind,
    installingKinds,
    refresh,
    install,
  } = useNativeHarnessControlPlane();

  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const hiddenModels = useSharedSettings((state) => state.hiddenModels);
  const shownModels = useSharedSettings((state) => state.shownModels);

  const providers = useMemo(
    () => resolveDisplayedProviders(props.providerOrder, []),
    [props.providerOrder],
  );

  const modelCountByProvider = useMemo(() => {
    const entries = buildSelectedModelInventory({
      agentStatuses,
      wslAgentStatuses,
      hiddenModels,
      shownModels,
      customModels: props.customModels,
      accounts: props.accounts,
      configuredProviderIds: props.configuredProviderIds,
      providerOrder: props.providerOrder,
    });
    const counts = new Map<string, number>();
    for (const entry of entries) {
      counts.set(entry.providerKind, (counts.get(entry.providerKind) ?? 0) + 1);
    }
    return counts;
  }, [
    agentStatuses,
    wslAgentStatuses,
    hiddenModels,
    shownModels,
    props.customModels,
    props.accounts,
    props.configuredProviderIds,
    props.providerOrder,
  ]);

  const accountCountByProvider = useMemo(() => {
    const counts = new Map<string, number>();
    for (const account of props.accounts) {
      counts.set(account.provider, (counts.get(account.provider) ?? 0) + 1);
    }
    return counts;
  }, [props.accounts]);

  const harnessByKind = useMemo(
    () => new Map(visibleEntries.map((entry) => [entry.descriptor.harnessKind, entry])),
    [visibleEntries],
  );

  const harnessFor = (providerId: string): NativeHarnessControlPlaneEntry | undefined =>
    harnessByKind.get(PROVIDER_TO_HARNESS_KIND[providerId] ?? providerId);

  const linkedKinds = useMemo(() => {
    const linked = new Set<string>();
    for (const provider of providers) {
      const entry = harnessFor(provider.id);
      if (entry) linked.add(entry.descriptor.harnessKind);
    }
    return linked;
  }, [providers, harnessByKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const orphanEntries = visibleEntries.filter(
    (entry) => !linkedKinds.has(entry.descriptor.harnessKind),
  );

  const handleShowDetail = (entry: NativeHarnessControlPlaneEntry) => {
    setHighlightedKind(entry.descriptor.harnessKind);
    if (entry.status === "unavailable") return;
    if (entry.status !== "ready") {
      openHarnessConfiguration(entry.descriptor.harnessKind);
    }
  };

  const renderHarnessCell = (entry: NativeHarnessControlPlaneEntry | undefined) =>
    entry ? (
      <HarnessCliRow
        entry={entry}
        highlighted={highlightedKind === entry.descriptor.harnessKind}
        installing={installingKinds.has(entry.descriptor.harnessKind)}
        onInstall={install}
        onShowDetail={handleShowDetail}
      />
    ) : (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/10 px-2.5 py-2 text-[11px] text-neutral-500">
        <Unlink className="size-3.5 shrink-0" />
        暂无原生 Harness —— 走兼容通道
      </div>
    );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3"
      data-testid="harness-map-page"
    >
      <header className="flex shrink-0 items-center justify-between">
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">渠道提供商</h2>
          <span />
          <h2 className="text-sm font-semibold text-foreground">默认 Harness / CLI</h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          title="刷新状态"
          className="ml-3 rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-stretch gap-2"
            data-testid={`harness-map-row-${provider.id}`}
          >
            <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-2">
              <ProviderBrandBadge id={provider.id} label={provider.label} size="compact" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {provider.label}
                </span>
                <span className="mt-0.5 block text-[10px] text-neutral-500">
                  {accountCountByProvider.get(provider.id) ?? 0} 账号 ·{" "}
                  {modelCountByProvider.get(provider.id) ?? 0} 模型
                </span>
              </span>
            </div>
            <div className="flex items-center justify-center text-neutral-600">
              <ArrowRight className="size-3.5" />
            </div>
            {renderHarnessCell(harnessFor(provider.id))}
          </div>
        ))}

        {orphanEntries.length > 0 ? (
          <div className="pt-2">
            <p className="pb-1.5 text-[10px] font-medium text-neutral-500">未关联渠道的 Harness</p>
            <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-stretch gap-2">
              {orphanEntries.map((entry) => (
                <div
                  key={entry.descriptor.id}
                  className="col-start-3"
                  data-testid={`harness-map-orphan-${entry.descriptor.harnessKind}`}
                >
                  {renderHarnessCell(entry)}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
