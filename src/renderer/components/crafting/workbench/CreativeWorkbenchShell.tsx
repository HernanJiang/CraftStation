import { useState } from "react";
import { ArrowRight, FlaskConical, Hammer, Info } from "lucide-react";
import type { CreativeDraft } from "@/shared/crafting/workbenchTypes";
import { Button } from "@/renderer/components/common";
import { CraftingSlot } from "./CraftingSlot";

/**
 * Creative Workbench: 9 input slots (3×3) → 1 result slot, sized like inventory
 * cards. v1.0 only persists an independent draft; the full Recipe Engine is a
 * future seam.
 */
export function CreativeWorkbenchShell(props: { draft: CreativeDraft; onClear: () => void }) {
  const { draft, onClear } = props;
  const filled = draft.slots.filter(Boolean).length;
  const [focus, setFocus] = useState<number | "result">(0);

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
      <div className="flex items-start gap-4">
        <div className="w-fit shrink-0" data-testid="crafting-grid-3x3">
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 9 }).map((_, index) => (
              <CraftingSlot
                key={index}
                label={`槽 ${index + 1}`}
                filled={Boolean(draft.slots[index])}
                focused={focus === index}
                testId={`crafting-slot-creative-${index}`}
                onClick={() => setFocus(index)}
              />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center justify-center gap-1 self-center px-1">
          <ArrowRight className="size-5 text-neutral-500" aria-hidden="true" />
          <span className="text-[10px] font-semibold text-neutral-500">待放入材料</span>
        </div>

        <CraftingSlot
          label="合成结果"
          focused={focus === "result"}
          icon={<Hammer className="size-4 text-neutral-600" />}
          testId="crafting-result-slot"
          onClick={() => setFocus("result")}
        />

        <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
          <p className="flex items-center gap-1 text-[10px] font-medium text-neutral-500">
            <Info className="size-3" aria-hidden="true" />
            当前物品详情
          </p>
          <p className="mt-1 text-[10px] text-neutral-500">
            {focus === "result"
              ? "放入材料后点击「合成」生成结果。创造模式配方引擎尚未开放。"
              : `槽 ${typeof focus === "number" ? focus + 1 : 1} · 创造模式暂未开放放入材料。`}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onPress={onClear}
          isDisabled={filled === 0}
          data-testid="clear-workbench"
        >
          清空
        </Button>
        <Button size="sm" variant="primary" data-testid="craft-button">
          合成
        </Button>
      </div>
    </section>
  );
}
