import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { SelectedModelEntry } from "@/shared/crafting/workbenchTypes";
import {
  brandIdForVendorKind,
  ProviderBrandBadge,
} from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";
import { INVENTORY_GRID_CLASS, InventorySlot } from "./InventorySlot";
import { useLingui } from "@lingui/react/macro";

/**
 * Models Inventory: square slots, one per user-selected model material. Only
 * models the user has actively made visible in the 管理模型 roster appear here
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
  const { t } = useLingui();
  const { entries, selectedEntryId, onSelect, onAdd, summary } = props;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
      data-testid="models-inventory"
      aria-label={t`模型背包`}
    >
      <header className="flex shrink-0 items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-neutral-300">{t`模型`}</h3>
        <span className="rounded-full bg-white/5 px-1.5 py-px text-[10px] text-neutral-400">
          {entries.length}
        </span>
      </header>
      {summary ? <div className="shrink-0">{summary}</div> : null}
      <div
        className={`${INVENTORY_GRID_CLASS} min-h-0 flex-1 overflow-y-auto pr-1`}
        data-testid="models-inventory-grid"
      >
        {entries.map((entry) => (
          <InventorySlot
            key={entry.entryId}
            name={entry.displayName}
            subLabel={entry.channelLabel}
            visual={
              <ProviderBrandBadge
                id={brandIdForVendorKind(entry.providerKind)}
                label={entry.providerLabel}
                size="compact"
              />
            }
            selected={entry.entryId === selectedEntryId}
            title={`${entry.displayName} · ${entry.modelId}\n${entry.providerLabel} · ${entry.channelLabel}`}
            onClick={() => onSelect(entry)}
          />
        ))}
        <InventorySlot
          tone="dashed"
          name={t`添加`}
          title={t`前往管理模型`}
          visual={<Plus className="size-4" />}
          onClick={onAdd}
        />
      </div>
    </section>
  );
}
