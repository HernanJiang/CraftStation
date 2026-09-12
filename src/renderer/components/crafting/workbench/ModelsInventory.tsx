import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { SelectedModelEntry } from "@/shared/crafting/workbenchTypes";
import {
  brandIdForVendorKind,
  ProviderBrandBadge,
} from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";

/**
 * Models Inventory: square slots, one per user-selected model material. Only
 * models the user has actively made visible in the "管理模型" roster appear here
 * — never the full Crafting Registry catalog.
 *
 * The current selection summary stays pinned on top; candidates scroll below.
 */
export function ModelsInventory(props: {
  entries: readonly SelectedModelEntry[];
  selectedEntryId?: string | undefined;
  onSelect: (entry: SelectedModelEntry) => void;
  onAdd: () => void;
  /** Pinned current-selection summary row (first row of the column). */
  summary?: ReactNode | undefined;
}) {
  const { entries, selectedEntryId, onSelect, onAdd, summary } = props;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-testid="models-inventory"
      aria-label="模型背包"
    >
      <header className="flex shrink-0 items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-neutral-300">模型</h3>
        <span className="text-[10px] text-neutral-500">{entries.length}</span>
      </header>
      {summary ? <div className="shrink-0">{summary}</div> : null}
      <div
        className="grid min-h-0 flex-1 grid-cols-4 content-start gap-1.5 overflow-y-auto pr-1"
        data-testid="models-inventory-grid"
      >
        {entries.map((entry) => {
          const selected = entry.entryId === selectedEntryId;
          return (
            <button
              key={entry.entryId}
              type="button"
              aria-pressed={selected}
              title={`${entry.displayName} · ${entry.modelId}\n${entry.providerLabel} · ${entry.channelLabel}`}
              onClick={() => onSelect(entry)}
              className={`aspect-square flex flex-col items-center justify-center gap-1 rounded-lg border p-1 text-center transition-colors ${
                selected
                  ? "border-accent/70 bg-white/10"
                  : "border-white/10 bg-white/[0.04] hover:bg-white/10"
              }`}
            >
              <ProviderBrandBadge
                id={brandIdForVendorKind(entry.providerKind)}
                label={entry.providerLabel}
                size="card"
              />
              <span className="w-full truncate text-[9px] leading-tight text-neutral-300">
                {entry.displayName}
              </span>
              <span
                className="w-full truncate text-[8px] leading-tight text-neutral-500"
                title={entry.channelLabel}
              >
                {entry.channelLabel}
              </span>
              <span className="w-full truncate text-[8px] leading-tight text-neutral-500">
                {entry.channelLabel}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAdd}
          title="前往管理模型"
          className="aspect-square flex items-center justify-center rounded-lg border border-dashed border-white/15 text-neutral-500 transition-colors hover:border-white/30 hover:text-white"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </section>
  );
}
