import { ArrowRight, Hammer, Package, SquareDashedMousePointer } from "lucide-react";
import type {
  CapabilityResolution,
  SelectedModelEntry,
  HarnessReference,
} from "@/shared/crafting/workbenchTypes";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { Button } from "@/renderer/components/common";

const uiStatusLabel: Record<CapabilityResolution["status"], string> = {
  NATIVE: "原生兼容",
  CRAFTABLE: "可合成",
  IMPOSSIBLE: "不可合成",
};

/**
 * Efficient Workbench: a four-cell material area (Model · Harness · Pack ·
 * Reserved) feeding a compatibility status and a Recipe output. Model and
 * Harness are the only real semantic slots in v1.0.0.
 */
export function EfficientWorkbench(props: {
  model?: SelectedModelEntry | undefined;
  harness?: HarnessReference | undefined;
  resolution?: CapabilityResolution | undefined;
  onCraft: () => void;
  onClear: () => void;
}) {
  const { model, harness, resolution, onCraft, onClear } = props;
  const canCraft = resolution?.status === "NATIVE" || resolution?.status === "CRAFTABLE";
  const resultName = model && harness ? `${harness.displayName} · ${model.displayName}` : "";

  const slotClass =
    "aspect-square flex min-h-0 flex-col items-center justify-center gap-1.5 rounded-xl border p-1 text-center transition-colors";
  const emptySlotClass = "border-dashed border-white/15 bg-white/[0.02] text-neutral-600";
  const filledSlotClass = "border-white/20 bg-white/[0.05]";

  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
      data-testid="efficient-workbench"
      aria-label="高效合成台"
    >
      <div className="grid grid-cols-2 gap-2">
        {/* Model slot */}
        <div className={`${slotClass} ${model ? filledSlotClass : emptySlotClass}`} title="模型">
          {model ? (
            <>
              <ProviderIcon
                kind={model.providerKind}
                fallbackLabel={model.providerLabel}
                className="size-7 shrink-0"
              />
              <span className="w-full truncate text-[10px] text-foreground">
                {model.displayName}
              </span>
              <span className="w-full truncate text-[8px] text-neutral-500" title={model.modelId}>
                {model.modelId}
              </span>
            </>
          ) : (
            <span className="text-[10px] text-neutral-500">选择模型</span>
          )}
        </div>

        {/* Harness slot */}
        <div
          className={`${slotClass} ${harness ? filledSlotClass : emptySlotClass}`}
          title="Harness"
        >
          {harness ? (
            <>
              <ProviderIcon
                kind={harness.vendor}
                fallbackLabel={harness.displayName}
                className="size-7 shrink-0"
              />
              <span className="w-full truncate text-[10px] text-foreground">
                {harness.displayName}
              </span>
              <span className="w-full truncate text-[8px] text-neutral-500">
                {harness.version ?? ""}
              </span>
            </>
          ) : (
            <span className="text-[10px] text-neutral-500">选择 Harness</span>
          )}
        </div>

        {/* Pack slot (reserved) */}
        <div className={`${slotClass} ${emptySlotClass}`} title="Pack · 预留槽">
          <Package className="size-4 text-neutral-600" />
          <span className="text-[10px] text-neutral-600">Pack</span>
        </div>

        {/* Reserved slot */}
        <div
          className={`${slotClass} ${emptySlotClass}`}
          title="预留组件槽 · 暂未开放"
          aria-disabled="true"
        >
          <SquareDashedMousePointer className="size-4 text-neutral-700" />
          <span className="text-[9px] text-neutral-700">+</span>
        </div>
      </div>

      {/* Compatibility status */}
      <div
        className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2"
        data-testid="compatibility-status"
      >
        <div className="flex min-w-0 items-center gap-2">
          <ArrowRight className="size-4 shrink-0 text-neutral-500" />
          <span
            className={`text-xs font-semibold ${
              resolution?.status === "NATIVE"
                ? "text-emerald-400"
                : resolution?.status === "CRAFTABLE"
                  ? "text-amber-300"
                  : "text-red-400"
            }`}
          >
            {resolution ? uiStatusLabel[resolution.status] : "尚未选择完整组合"}
          </span>
        </div>
        {resolution?.status === "CRAFTABLE" ? (
          <span className="shrink-0 text-[10px] text-amber-300/80">
            通过 CraftStation compatibility layer
          </span>
        ) : null}
      </div>

      {/* Recipe output */}
      <div
        className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
        data-testid="recipe-output"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Hammer className="size-4 shrink-0 text-amber-300" />
          <span className="truncate text-sm font-medium text-foreground">
            {resultName || "组合配方"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onPress={onClear}
            isDisabled={!model && !harness}
            data-testid="clear-workbench"
          >
            清空
          </Button>
          <Button size="sm" onPress={onCraft} isDisabled={!canCraft} data-testid="craft-button">
            合成
          </Button>
        </div>
      </div>
    </section>
  );
}
