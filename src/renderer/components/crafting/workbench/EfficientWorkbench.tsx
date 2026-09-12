import { ArrowRight } from "lucide-react";
import type {
  CapabilityResolution,
  HarnessReference,
  SelectedModelEntry,
} from "@/shared/crafting/workbenchTypes";
import { Button } from "@/renderer/components/common";
import { CraftingSlot } from "./CraftingSlot";

const uiStatusLabel: Record<CapabilityResolution["status"], string> = {
  NATIVE: "原生可合成",
  CRAFTABLE: "兼容桥可合成",
  IMPOSSIBLE: "不可合成",
};

/**
 * 合成台：Minecraft 四格合成隐喻 —— 左侧 2×2 输入格 → 箭头 → 右侧结果格，
 * 下方是真正的主操作区（清空次按钮 + 合成主按钮）。
 * NATIVE（直连官方运行时）与 CRAFTABLE（运行中的 CLIProxyAPI 兼容桥已验证，
 * executionRoute 保证 CRAFTABLE 只在桥就绪时出现）可执行；IMPOSSIBLE 显示
 * 真实原因，绝不伪造可执行态。
 */
export function EfficientWorkbench(props: {
  model?: SelectedModelEntry | undefined;
  harness?: HarnessReference | undefined;
  resolution?: CapabilityResolution | undefined;
  /**
   * CLIProxyAPI helper for compatibility routes. Shown only when the current
   * resolution requires the gateway/translator; native routes pass nothing
   * and must never auto-select CPA.
   */
  cpa?: { required: boolean; selected: boolean } | undefined;
  onCraft: () => void;
  onClear: () => void;
}) {
  const { model, harness, resolution, cpa, onCraft, onClear } = props;

  // NATIVE and bridge-verified CRAFTABLE are executable. CRAFTABLE can only
  // arise while the Compatibility Bridge reports running (the resolver fails
  // closed otherwise), and spawn re-verifies the served-model contract.
  const canCraft = resolution?.status === "NATIVE" || resolution?.status === "CRAFTABLE";
  const resultName = model && harness ? `${harness.displayName} · ${model.displayName}` : "";
  const reason =
    resolution?.status !== "NATIVE" && resolution?.status !== "CRAFTABLE"
      ? (resolution?.diagnostics[0]?.message ?? "")
      : "";

  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
      data-testid="efficient-workbench"
      aria-label="合成台"
    >
      <div className="flex items-center gap-3">
        <div
          className="grid shrink-0 grid-cols-2 content-start gap-2"
          data-testid="crafting-grid-2x2"
        >
          <CraftingSlot
            label="模型"
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
            name={harness?.displayName}
            testId="crafting-slot-harness"
          />
          <CraftingSlot label="组件" testId="crafting-slot-pack" />
          <CraftingSlot label="预留" testId="crafting-slot-reserved" />
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
            {resolution ? uiStatusLabel[resolution.status] : "待放入材料"}
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
          {cpa?.required ? (
            <span className="text-[9px] text-sky-300/80" data-testid="cpa-helper-row">
              {cpa.selected ? "CLIProxyAPI · 已自动选中" : "CLIProxyAPI · 按需"}
            </span>
          ) : null}
        </div>

        <CraftingSlot
          label="合成结果"
          filled={Boolean(resultName)}
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
          清空
        </Button>
        <Button
          size="lg"
          variant="primary"
          onPress={onCraft}
          isDisabled={!canCraft}
          data-testid="craft-button"
          className="h-12 font-semibold"
        >
          合成
        </Button>
      </div>
    </section>
  );
}
