import { Plus } from "lucide-react";

/**
 * Components Inventory: a reserved seam for future Component/Pack materials
 * (Context, Tool Policy, Permission, Memory, Compaction, Sandbox, etc.). v1.0.0
 * renders the grid shape but no component is craftable yet.
 */
export function ComponentsInventory(props: { onSelect: () => void }) {
  return (
    <section
      className="flex min-h-0 flex-col gap-2"
      data-testid="components-inventory"
      aria-label="组件背包"
    >
      <header className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-neutral-300">组件</h3>
        <span className="text-[10px] text-neutral-500">0</span>
      </header>
      <div className="grid grid-cols-4 gap-1.5 overflow-y-auto pr-1">
        {Array.from({ length: 11 }).map((_, index) => (
          <div
            key={index}
            className="aspect-square flex items-center justify-center rounded-lg border border-dashed border-white/5 text-[9px] text-neutral-600"
          >
            —
          </div>
        ))}
        <button
          type="button"
          onClick={props.onSelect}
          title="组件背包 · 暂未开放"
          className="aspect-square flex items-center justify-center rounded-lg border border-dashed border-white/15 text-neutral-500 transition-colors hover:border-white/30 hover:text-white"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </section>
  );
}
