import { FlaskConical, Hammer } from "lucide-react";
import type { CreativeDraft } from "@/shared/crafting/workbenchTypes";
import { Button } from "@/renderer/components/common";

/**
 * Creative Workbench: a three-by-three visual shell plus a Result slot. v1.0.0
 * only persists an independent creative draft and reuses the shared
 * Inventory/Harness panel. The full Pack/Component Recipe Engine is out of
 * scope — this is a future seam.
 */
export function CreativeWorkbenchShell(props: { draft: CreativeDraft; onClear: () => void }) {
  const { draft, onClear } = props;
  const filled = draft.slots.filter(Boolean).length;
  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
      data-testid="creative-workbench"
      aria-label="创造合成台"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <FlaskConical className="size-3.5 text-violet-400" />
        <span className="text-[11px] font-medium text-violet-300">
          创造模式 · Experimental / Coming Soon
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }).map((_, index) => (
          <div
            key={index}
            className="aspect-square flex items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/20 text-[10px] text-neutral-600"
          >
            {index === 4 ? <Hammer className="size-5 text-neutral-600" /> : null}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <span className="truncate text-sm font-medium text-foreground">结果</span>
        <Button variant="ghost" size="sm" onPress={onClear} isDisabled={filled === 0}>
          清空
        </Button>
      </div>
    </section>
  );
}
