import { Plus } from "lucide-react";
import type { HarnessReference } from "@/shared/crafting/workbenchTypes";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { isHarnessSelectable } from "@/renderer/crafting/harnessInventory";

/**
 * Harness Inventory: square slots for installed harnesses. Ready harnesses are
 * selectable; installed-but-abnormal harnesses are shown greyed and not
 * selectable (clicking them opens the inspector/diagnostic instead).
 */
export function HarnessInventory(props: {
  entries: readonly HarnessReference[];
  selectedRef?: string | undefined;
  onSelect: (ref: HarnessReference) => void;
  onAdd: () => void;
}) {
  const { entries, selectedRef, onSelect, onAdd } = props;
  const selectable = entries.filter(isHarnessSelectable);
  const abnormal = entries.filter((ref) => !isHarnessSelectable(ref));
  return (
    <section
      className="flex min-h-0 flex-col gap-2"
      data-testid="harness-inventory"
      aria-label="Harness 背包"
    >
      <header className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-neutral-300">Harness</h3>
        <span className="text-[10px] text-neutral-500">{entries.length}</span>
      </header>
      <div className="grid grid-cols-4 gap-1.5 overflow-y-auto pr-1">
        {selectable.map((ref) => {
          const selected = ref.harnessItemId === selectedRef;
          return (
            <button
              key={ref.harnessItemId}
              type="button"
              aria-pressed={selected}
              title={`${ref.displayName} · ${ref.version ?? "?"}\n${ref.transport ?? ""}`}
              onClick={() => onSelect(ref)}
              className={`aspect-square flex flex-col items-center justify-center gap-1 rounded-lg border p-1 text-center transition-colors ${
                selected
                  ? "border-accent/70 bg-white/10"
                  : "border-white/10 bg-white/[0.04] hover:bg-white/10"
              }`}
            >
              <ProviderIcon
                kind={ref.vendor}
                fallbackLabel={ref.displayName}
                className="size-6 shrink-0"
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
            title={`${ref.displayName} · 状态：${ref.status}\n点击查看诊断`}
            onClick={() => onSelect(ref)}
            className="aspect-square flex flex-col items-center justify-center gap-1 rounded-lg border border-amber-500/30 bg-black/30 p-1 text-center opacity-60 transition-colors hover:opacity-90"
          >
            <ProviderIcon
              kind={ref.vendor}
              fallbackLabel={ref.displayName}
              className="size-6 shrink-0"
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
