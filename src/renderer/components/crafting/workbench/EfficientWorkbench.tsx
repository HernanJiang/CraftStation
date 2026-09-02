import { useState } from "react";
import { ArrowRight, Hammer, Info, Package, SquareDashedMousePointer } from "lucide-react";
import type {
  CapabilityResolution,
  HarnessReference,
  SelectedModelEntry,
} from "@/shared/crafting/workbenchTypes";
import { Button } from "@/renderer/components/common";
import { CraftingSlot } from "./CraftingSlot";

const uiStatusLabel: Record<CapabilityResolution["status"], string> = {
  NATIVE: "原生兼容",
  CRAFTABLE: "可合成",
  IMPOSSIBLE: "不可合成",
};

type FocusSlot = "model" | "harness" | "pack" | "reserved" | "result";

/**
 * Efficient Workbench: 4 input slots (2×2) → status arrow → 1 result slot.
 * Slot size matches the model/harness inventory cards below.
 */
export function EfficientWorkbench(props: {
  model?: SelectedModelEntry | undefined;
  harness?: HarnessReference | undefined;
  resolution?: CapabilityResolution | undefined;
  onCraft: () => void;
  onClear: () => void;
}) {
  const { model, harness, resolution, onCraft, onClear } = props;
  const [focus, setFocus] = useState<FocusSlot>("model");

  const canCraft = resolution?.status === "NATIVE" || resolution?.status === "CRAFTABLE";
  const resultName = model && harness ? `${harness.displayName} · ${model.displayName}` : "";
  const detail = focus === "model" ? modelDetail(model) : harnessDetail(harness);

  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
      data-testid="efficient-workbench"
      aria-label="高效合成台"
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0" data-testid="crafting-grid-2x2">
          <div className="grid grid-cols-2 gap-1.5">
            <CraftingSlot
              label="模型"
              filled={Boolean(model)}
              focused={focus === "model"}
              brandId={model?.providerKind}
              brandLabel={model?.displayName}
              name={model?.displayName}
              testId="crafting-slot-model"
              onClick={() => setFocus("model")}
            />
            <CraftingSlot
              label="Harness"
              filled={Boolean(harness)}
              focused={focus === "harness"}
              brandId={harness?.vendor}
              brandLabel={harness?.displayName}
              name={harness?.displayName}
              testId="crafting-slot-harness"
              onClick={() => setFocus("harness")}
            />
            <CraftingSlot
              label="Pack"
              focused={focus === "pack"}
              icon={<Package className="size-3.5 text-neutral-600" />}
              testId="crafting-slot-pack"
              onClick={() => setFocus("pack")}
            />
            <CraftingSlot
              label="预留"
              focused={focus === "reserved"}
              icon={<SquareDashedMousePointer className="size-3.5 text-neutral-700" />}
              testId="crafting-slot-reserved"
              onClick={() => setFocus("reserved")}
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center justify-center gap-1 self-center px-1">
          <ArrowRight className="size-5 text-neutral-500" aria-hidden="true" />
          <span
            className={`text-[10px] font-semibold leading-tight ${
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
          {resolution?.status === "CRAFTABLE" ? (
            <span className="text-[9px] text-amber-300/70">compatibility layer</span>
          ) : null}
        </div>

        <CraftingSlot
          label="合成结果"
          filled={Boolean(resultName)}
          focused={focus === "result"}
          brandId={harness && model ? harness.vendor : undefined}
          brandLabel={harness?.displayName}
          name={resultName || undefined}
          icon={<Hammer className="size-4 text-neutral-600" />}
          testId="crafting-result-slot"
          onClick={() => setFocus("result")}
        />

        <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
          <p className="flex items-center gap-1 text-[10px] font-medium text-neutral-500">
            <Info className="size-3" aria-hidden="true" />
            当前物品详情
          </p>
          {focus === "result" ? (
            <div className="mt-1 min-w-0">
              <p className="text-xs font-semibold text-foreground">
                {resultName || "尚未生成合成结果"}
              </p>
              <p className="mt-0.5 text-[10px] leading-4 text-neutral-400">
                {canCraft
                  ? "该组合可保存为配方。点击「合成」生成并保存。"
                  : "放入模型与 Harness 后自动判断兼容性。"}
              </p>
            </div>
          ) : focus === "pack" ? (
            <p className="mt-1 text-[10px] text-neutral-500">Pack 槽预留，暂未开放。</p>
          ) : focus === "reserved" ? (
            <p className="mt-1 text-[10px] text-neutral-500">预留组件槽，暂未开放。</p>
          ) : detail ? (
            <div className="mt-1 min-w-0 space-y-0.5">{detail}</div>
          ) : (
            <p className="mt-1 text-[10px] text-neutral-500">
              {focus === "model" ? "尚未放入模型" : "尚未放入 Harness"}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onPress={onClear}
          isDisabled={!model && !harness}
          data-testid="clear-workbench"
        >
          清空
        </Button>
        <Button size="sm" variant="primary" onPress={onCraft} data-testid="craft-button">
          合成
        </Button>
      </div>
    </section>
  );
}

function detailRow(label: string, value?: string) {
  if (!value) return null;
  return (
    <p className="truncate text-[10px] leading-4 text-neutral-400" title={value}>
      <span className="text-neutral-600">{label} · </span>
      {value}
    </p>
  );
}

function modelDetail(model: SelectedModelEntry | undefined) {
  if (!model) return null;
  return (
    <>
      <p className="truncate text-xs font-semibold text-foreground">{model.displayName}</p>
      {detailRow("类型", "模型 Model")}
      {detailRow("厂商", model.providerLabel)}
      {detailRow("来源", model.source === "agent" ? "已安装 Agent 渠道" : "自定义模型")}
      {detailRow("模型 ID", model.modelId)}
      {detailRow("渠道", model.channelLabel)}
      {model.accountId ? detailRow("账号", model.accountId) : null}
      {model.contextSize ? detailRow("上下文", model.contextSize) : null}
      {model.supportsToolCalling !== undefined
        ? detailRow("能力", model.supportsToolCalling ? "工具调用 · 流式输出" : "基础对话")
        : null}
    </>
  );
}

function harnessDetail(harness: HarnessReference | undefined) {
  if (!harness) return null;
  return (
    <>
      <p className="truncate text-xs font-semibold text-foreground">{harness.displayName}</p>
      {detailRow("类型", "Harness 运行时")}
      {detailRow("厂商", harness.vendor)}
      {detailRow("官方", harness.official ? "官方原生接入" : "兼容层接入")}
      {detailRow("状态", harness.status)}
      {harness.version ? detailRow("版本", harness.version) : null}
      {harness.transport ? detailRow("传输", harness.transport) : null}
      {detailRow("Harness ID", harness.harnessItemId)}
    </>
  );
}
