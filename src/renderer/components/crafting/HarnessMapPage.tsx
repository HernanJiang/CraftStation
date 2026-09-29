import { useMemo } from "react";
import { ArrowRight, RefreshCw, Workflow } from "lucide-react";
import type { AccountView } from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import {
  COMPAT_FALLBACK_HARNESS_KINDS,
  sanitizeCompatFallbackHarness,
} from "@/shared/thirdPartyRouting";
import { COMPATIBILITY_HARNESS_LABELS } from "@/shared/harnessCompatibility";
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

function ProviderCard(props: {
  id: string;
  label: string;
  accountCount: number;
  modelCount: number;
}) {
  const { id, label, accountCount, modelCount } = props;
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-2">
      <ProviderBrandBadge id={id} label={label} size="compact" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-[10px] text-neutral-500">
          {accountCount} 账号 · {modelCount} 模型
        </span>
      </span>
    </div>
  );
}

/**
 * Harness map tab (replaces the old 我的配方 tab): a tree pairing every
 * provider channel the user selected in 管理模型 with its default Harness/CLI.
 * Providers with a native Harness pair row-by-row; providers without one all
 * converge into a single compat trunk node — OpenCode by default, repointable
 * to any custom-base-URL-capable Harness, persisted as the compat routing
 * fallback. Harnesses with no provider channel drop into an unlinked group.
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
  const compatDefaultHarness = useSharedSettings((state) => state.compatDefaultHarness);
  const setCompatDefaultHarness = useSharedSettings((state) => state.setCompatDefaultHarness);
  const compatKind = sanitizeCompatFallbackHarness(compatDefaultHarness);

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

  // Only providers the user actually selected in 管理模型 (≥1 selected model)
  // appear on the left — the map mirrors the model inventory, not the catalog.
  const providers = useMemo(
    () =>
      resolveDisplayedProviders(props.providerOrder, []).filter(
        (provider) => (modelCountByProvider.get(provider.id) ?? 0) > 0,
      ),
    [props.providerOrder, modelCountByProvider],
  );

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

  // Compat providers have no native Harness — they converge on the trunk
  // (the configured compat default, OpenCode until the user repoints it).
  const nativeRows = providers
    .map((provider) => ({ provider, entry: harnessFor(provider.id) }))
    .filter((row) => row.entry !== undefined);
  const compatProviders = providers.filter((provider) => harnessFor(provider.id) === undefined);

  const trunkEntry = harnessByKind.get(compatKind);

  const orphanEntries = useMemo(() => {
    const linked = new Set<string>([
      ...nativeRows.map((row) => row.entry!.descriptor.harnessKind),
      ...(compatProviders.length > 0 ? [compatKind] : []),
    ]);
    return visibleEntries.filter((entry) => !linked.has(entry.descriptor.harnessKind));
  }, [visibleEntries, nativeRows, compatProviders.length, compatKind]);

  const compatCandidates = useMemo(() => {
    const kinds = new Set<string>(COMPAT_FALLBACK_HARNESS_KINDS);
    kinds.add(compatKind);
    return [...kinds];
  }, [compatKind]);

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
    ) : null;

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
        {providers.length === 0 ? (
          <p className="rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] p-6 text-center text-sm text-muted">
            还没有在「管理模型」中选定任何渠道
          </p>
        ) : null}

        {nativeRows.map(({ provider, entry }) => (
          <div
            key={provider.id}
            className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-stretch gap-2"
            data-testid={`harness-map-row-${provider.id}`}
          >
            <ProviderCard
              id={provider.id}
              label={provider.label}
              accountCount={accountCountByProvider.get(provider.id) ?? 0}
              modelCount={modelCountByProvider.get(provider.id) ?? 0}
            />
            <div className="flex items-center justify-center text-neutral-600">
              <ArrowRight className="size-3.5" />
            </div>
            {renderHarnessCell(entry)}
          </div>
        ))}

        {compatProviders.length > 0 ? (
          <div
            className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-stretch gap-2"
            data-testid="harness-map-compat-trunk"
          >
            <div className="flex min-w-0 flex-col gap-2">
              {compatProviders.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  id={provider.id}
                  label={provider.label}
                  accountCount={accountCountByProvider.get(provider.id) ?? 0}
                  modelCount={modelCountByProvider.get(provider.id) ?? 0}
                />
              ))}
            </div>
            {/* Tree connector: one vertical trunk line joining every leaf. */}
            <div className="relative flex items-stretch justify-center" aria-hidden>
              <div className="w-px bg-white/10" />
              {compatProviders.map((provider, index) => (
                <ArrowRight
                  key={provider.id}
                  className="absolute left-0 size-3.5 text-neutral-600"
                  style={{ top: `calc(${((index + 0.5) / compatProviders.length) * 100}% - 7px)` }}
                />
              ))}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 self-stretch rounded-xl border border-accent/25 bg-white/[0.03] px-2.5 py-2">
              <p className="flex items-center gap-1 text-[10px] font-medium text-neutral-500">
                <Workflow className="size-3" />
                兼容默认 Harness（无原生 Harness 的渠道汇聚于此）
              </p>
              {trunkEntry ? renderHarnessCell(trunkEntry) : null}
              <label className="mt-auto flex items-center gap-1.5 text-[10px] text-neutral-500">
                <span className="shrink-0">切换默认</span>
                <select
                  aria-label="兼容默认 Harness"
                  value={compatKind}
                  onChange={(event) => setCompatDefaultHarness(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-1.5 py-1 text-[10px] text-foreground outline-none focus:border-white/25"
                >
                  {compatCandidates.map((kind) => (
                    <option key={kind} value={kind}>
                      {COMPATIBILITY_HARNESS_LABELS[
                        kind as keyof typeof COMPATIBILITY_HARNESS_LABELS
                      ] ?? kind}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}

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
