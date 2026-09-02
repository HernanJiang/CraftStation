import { Plus } from "lucide-react";
import type { SelectedModelEntry } from "@/shared/crafting/workbenchTypes";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";

/**
 * Models Inventory: square slots, one per user-selected model material. Only
 * models the user has actively made visible in the "管理模型" roster appear here
 * — never the full Crafting Registry catalog.
 */
export function ModelsInventory(props: {
  entries: readonly SelectedModelEntry[];
  selectedEntryId?: string | undefined;
  onSelect: (entry: SelectedModelEntry) => void;
  onAdd: () => void;
}) {
  const { entries, selectedEntryId, onSelect, onAdd } = props;
  return (
    <section
      className="flex min-h-0 flex-col gap-2"
      data-testid="models-inventory"
      aria-label="模型背包"
    >
      <header className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-neutral-300">模型</h3>
        <span className="text-[10px] text-neutral-500">{entries.length}</span>
      </header>
      <div className="grid grid-cols-4 gap-1.5 overflow-y-auto pr-1">
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
              <ProviderIcon
                kind={entry.providerKind}
                fallbackLabel={entry.providerLabel}
                className="size-6 shrink-0"
              />
              <span className="w-full truncate text-[9px] leading-tight text-neutral-300">
                {entry.displayName}
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
