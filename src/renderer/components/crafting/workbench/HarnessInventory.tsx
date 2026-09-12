import { Download, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import type { HarnessReference } from "@/shared/crafting/workbenchTypes";
import {
  brandIdForVendorKind,
  ProviderBrandBadge,
} from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";
import { isHarnessSelectable } from "@/renderer/crafting/harnessInventory";
import { findCliUpdateForAgentKind, useUpdateStore } from "@/renderer/state/updateStore";

/**
 * Harness Inventory: square slots for installed harnesses. Ready harnesses are
 * selectable; installed-but-abnormal harnesses are shown greyed and not
 * selectable (clicking them opens the inspector/diagnostic instead).
 *
 * The current selection summary stays pinned on top; candidates scroll below.
 */
export function HarnessInventory(props: {
  entries: readonly HarnessReference[];
  selectedRef?: string | undefined;
  onSelect: (ref: HarnessReference) => void;
  onAdd: () => void;
  /** Pinned current-selection summary row (first row of the column). */
  summary?: ReactNode | undefined;
}) {
  const { entries, selectedRef, onSelect, onAdd, summary } = props;
  const { t } = useLingui();
  const availableCliUpdates = useUpdateStore((s) => s.availableCliUpdates);
  const updateFor = (ref: HarnessReference) =>
    findCliUpdateForAgentKind(availableCliUpdates, ref.harnessKind);
  const selectable = entries.filter(isHarnessSelectable);
  const abnormal = entries.filter((ref) => !isHarnessSelectable(ref));
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-testid="harness-inventory"
      aria-label="Harness 背包"
    >
      <header className="flex shrink-0 items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-neutral-300">Harness</h3>
        <span className="text-[10px] text-neutral-500">{entries.length}</span>
      </header>
      {summary ? <div className="shrink-0">{summary}</div> : null}
      <div
        className="grid min-h-0 flex-1 grid-cols-4 content-start gap-1.5 overflow-y-auto pr-1"
        data-testid="harness-inventory-grid"
      >
        {selectable.map((ref) => {
          const selected = ref.harnessItemId === selectedRef;
          const availableUpdate = updateFor(ref);
          return (
            <button
              key={ref.harnessItemId}
              type="button"
              aria-pressed={selected}
              title={
                availableUpdate
                  ? `${ref.displayName} · ${ref.version ?? "?"}\n${ref.transport ?? ""}\n${t`Update available: v${availableUpdate.version} → v${availableUpdate.latest}`}`
                  : `${ref.displayName} · ${ref.version ?? "?"}\n${ref.transport ?? ""}`
              }
              onClick={() => onSelect(ref)}
              className={`relative aspect-square flex flex-col items-center justify-center gap-1 rounded-lg border p-1 text-center transition-colors ${
                selected
                  ? "border-accent/70 bg-white/10"
                  : "border-white/10 bg-white/[0.04] hover:bg-white/10"
              }`}
            >
              {availableUpdate ? (
                <span
                  className="absolute top-1 right-1 flex items-center rounded-full bg-amber-400/20 p-0.5 text-amber-300"
                  aria-label={t`Update available`}
                >
                  <Download className="size-2.5" />
                </span>
              ) : null}
              <ProviderBrandBadge
                id={brandIdForVendorKind(ref.vendor)}
                label={ref.displayName}
                size="card"
              />
              <span className="w-full truncate text-[9px] leading-tight text-neutral-300">
                {ref.displayName}
              </span>
            </button>
          );
        })}
        {abnormal.map((ref) => (
          <button
            key={ref.harnessItemId}
            type="button"
            title={`${ref.displayName} · 状态：${ref.status}\n点击配置`}
            onClick={() => onSelect(ref)}
            className="aspect-square flex flex-col items-center justify-center gap-1 rounded-lg border border-amber-500/30 bg-black/30 p-1 text-center opacity-60 transition-colors hover:opacity-90"
          >
            <ProviderBrandBadge
              id={brandIdForVendorKind(ref.vendor)}
              label={ref.displayName}
              size="card"
            />
            <span className="w-full truncate text-[9px] leading-tight text-neutral-400">
              {ref.displayName}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={onAdd}
          title="前往 Harness/CLI 面板"
          className="aspect-square flex items-center justify-center rounded-lg border border-dashed border-white/15 text-neutral-500 transition-colors hover:border-white/30 hover:text-white"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </section>
  );
}
