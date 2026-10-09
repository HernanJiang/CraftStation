import { ArrowRight } from "lucide-react";
import type {
  CapabilityResolution,
  HarnessReference,
  SelectedModelEntry,
} from "@/shared/crafting/workbenchTypes";
import { Button } from "@/renderer/components/common";
import { shortHarnessName } from "@/renderer/crafting/harnessInventory";
import { CraftingSlot } from "./CraftingSlot";
import { msg as linguiMsg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";

const uiStatusLabel: Record<CapabilityResolution["status"], MessageDescriptor> = {
  NATIVE: linguiMsg`原生可合成`,
  CRAFTABLE: linguiMsg`兼容桥可合成`,
  IMPOSSIBLE: linguiMsg`不可合成`,
};

/**
 * 合成台：Minecraft 九宫格合成隐喻 —— 左侧 3×3 输入格 → 箭头 → 右侧结果格，
 * 下方是真正的主操作区（清空次按钮 + 合成主按钮）。
 * 槽位 1/2 为模型 / Harness；兼容桥（CLIProxyAPI）是隐形基础设施，需要时由
 * 合成台自动拉起，不再占用组件槽位。NATIVE（直连官方运行时）与 CRAFTABLE
 * （兼容桥可启动或已运行，spawn 时再拉起 sidecar）可执行；IMPOSSIBLE
 * 显示真实原因，绝不伪造可执行态。
 */
export function EfficientWorkbench(props: {
  model?: SelectedModelEntry | undefined;
  harness?: HarnessReference | undefined;
  resolution?: CapabilityResolution | undefined;
  onCraft: () => void;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const { model, harness, resolution, onCraft, onClear } = props;

  // NATIVE, CRAFTABLE, and CPA-missing (install-on-craft) are executable.
  const canCraft =
    resolution?.status === "NATIVE" ||
    resolution?.status === "CRAFTABLE" ||
    resolution?.diagnostics.some((entry) => entry.code === "CPA_NOT_INSTALLED");
  const craftLabel = resolution?.diagnostics.some((entry) => entry.code === "CPA_NOT_INSTALLED")
    ? t`安装并合成`
    : t`合成`;
  const resultName = model && harness ? `${harness.displayName} · ${model.displayName}` : "";
  const reason =
    resolution?.status !== "NATIVE" && resolution?.status !== "CRAFTABLE"
      ? (resolution?.diagnostics[0]?.message ?? "")
      : "";

  return (
    <section
      className="craftstation-workbench-table min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
      data-testid="efficient-workbench"
      aria-label={t`合成台`}
    >
      <div className="craftstation-workbench-slots flex items-center gap-3">
        <div
          className="craftstation-workbench-grid grid grid-cols-3 content-start gap-2"
          data-testid="crafting-grid-3x3"
        >
          <CraftingSlot
            label={t`模型`}
            filled={Boolean(model)}
            brandId={model?.providerKind}
            brandLabel={model?.displayName}
            name={model?.displayName}
            testId="crafting-slot-model"
          />
          <CraftingSlot
            label="Harness"
            filled={Boolean(harness)}
            brandId={harness?.vendor}
            brandLabel={harness?.displayName}
            name={harness ? shortHarnessName(harness.displayName) : undefined}
            title={harness ? `Harness · ${harness.displayName}` : undefined}
            testId="crafting-slot-harness"
          />
          <CraftingSlot label={t`组件`} testId="crafting-slot-component" />
          {[4, 5, 6, 7, 8, 9].map((slot) => (
            <CraftingSlot key={slot} label={t`预留`} testId={`crafting-slot-reserved-${slot}`} />
          ))}
        </div>

        <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-1">
          <ArrowRight className="size-5 text-neutral-500" aria-hidden="true" />
          <span
            className={`max-w-24 text-center text-[10px] font-semibold leading-tight ${
              resolution?.status === "NATIVE"
                ? "text-emerald-400"
                : resolution?.status === "CRAFTABLE"
                  ? "text-amber-300"
                  : "text-neutral-500"
            }`}
            data-testid="compatibility-status"
          >
            {resolution ? t(uiStatusLabel[resolution.status]) : t`待放入材料`}
          </span>
          {reason ? (
            <span
              className="max-w-28 text-center text-[9px] leading-tight text-neutral-500"
              data-testid="compatibility-reason"
              title={reason}
            >
              {reason}
            </span>
          ) : null}
        </div>

        <CraftingSlot
          label={t`合成结果`}
          filled={Boolean(resultName)}
          status={
            resolution?.status === "NATIVE"
              ? "native"
              : resolution?.status === "CRAFTABLE"
                ? "craftable"
                : undefined
          }
          brandId={harness && model ? harness.vendor : undefined}
          brandLabel={harness?.displayName}
          name={resultName || undefined}
          testId="crafting-result-slot"
        />
      </div>

      <div className="mt-3 grid grid-cols-[1fr_2fr] gap-2">
        <Button
          variant="ghost"
          size="md"
          onPress={onClear}
          isDisabled={!model && !harness}
          data-testid="clear-workbench"
          className="h-12"
        >
          {t`清空`}
        </Button>
        <Button
          size="lg"
          variant="primary"
          onPress={onCraft}
          isDisabled={!canCraft}
          data-testid="craft-button"
          className="h-12 font-semibold"
        >
          {craftLabel}
        </Button>
      </div>
    </section>
  );
}
