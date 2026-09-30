import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { HarnessReference } from "@/shared/crafting/workbenchTypes";
import {
  brandIdForVendorKind,
  ProviderBrandBadge,
} from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";
import { isHarnessSelectable, shortHarnessName } from "@/renderer/crafting/harnessInventory";
import { INVENTORY_GRID_CLASS, InventorySlot } from "./InventorySlot";

/**
 * Harness Inventory: square slots for installed harnesses. Ready harnesses are
 * selectable; installed-but-abnormal harnesses are shown greyed and not
 * selectable (clicking them opens the inspector/diagnostic instead).
 *
 * The current selection summary stays pinned on top; candidates scroll below.
 * CLI update/install affordances deliberately stay out of these cards — they
 * live on the Harness map tab; the bench is for picking, not maintaining.
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
  const selectable = entries.filter(isHarnessSelectable);
  const abnormal = entries.filter((ref) => !isHarnessSelectable(ref));
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
      data-testid="harness-inventory"
      aria-label="Harness 背包"
    >
      <header className="flex shrink-0 items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-neutral-300">Harness</h3>
        <span className="rounded-full bg-white/5 px-1.5 py-px text-[10px] text-neutral-400">
          {entries.length}
        </span>
      </header>
      {summary ? <div className="shrink-0">{summary}</div> : null}
      <div
        className={`${INVENTORY_GRID_CLASS} min-h-0 flex-1 overflow-y-auto pr-1`}
        data-testid="harness-inventory-grid"
      >
        {selectable.map((ref) => (
          <InventorySlot
            key={ref.harnessItemId}
            name={shortHarnessName(ref.displayName)}
            visual={
              <ProviderBrandBadge
                id={brandIdForVendorKind(ref.vendor)}
                label={ref.displayName}
                size="compact"
              />
            }
            selected={ref.harnessItemId === selectedRef}
            title={`${ref.displayName} · ${ref.version ?? "?"}\n${ref.transport ?? ""}`}
            onClick={() => onSelect(ref)}
          />
        ))}
        {abnormal.map((ref) => (
          <InventorySlot
            key={ref.harnessItemId}
            name={shortHarnessName(ref.displayName)}
            visual={
              <ProviderBrandBadge
                id={brandIdForVendorKind(ref.vendor)}
                label={ref.displayName}
                size="compact"
              />
            }
            tone="warning"
            muted={true}
            title={`${ref.displayName} · 状态：${ref.status}\n点击配置`}
            onClick={() => onSelect(ref)}
          />
        ))}
        <InventorySlot
          tone="dashed"
          name="添加"
          title="前往 Harness/CLI 面板"
          visual={<Plus className="size-4" />}
          onClick={onAdd}
        />
      </div>
    </section>
  );
}
