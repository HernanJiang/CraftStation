import { useState } from "react";
import { ArrowRight, Hammer, Info, Package, SquareDashedMousePointer } from "lucide-react";
import type {
  CapabilityResolution,
  HarnessReference,
  SelectedModelEntry,
} from "@/shared/crafting/workbenchTypes";
import { ProviderBrandBadge } from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";
import { Button } from "@/renderer/components/common";

const uiStatusLabel: Record<CapabilityResolution["status"], string> = {
  NATIVE: "原生兼容",
  CRAFTABLE: "可合成",
  IMPOSSIBLE: "不可合成",
};

type FocusSlot = "model" | "harness" | "result";

/**
 * Efficient Workbench: a compact 4x4 crafting grid → status arrow → one result
 * slot. Model and Harness are the real semantic slots (v1.0); Pack and the
 * remaining cells stay reserved placeholders. Clicking a placed slot focuses
 * its details in the side panel.
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

  // Materials are placed bottom-left so the 4x4 reads like a Minecraft
  // crafting grid; only model (bottom-left) and harness (bottom-right) accept
  // items. Pack keeps its reserved slot; every other cell is inert.
  const canCraft = resolution?.status === "NATIVE" || resolution?.status === "CRAFTABLE";
  const resultName = model && harness ? `${harness.displayName} · ${model.displayName}` : "";

  const cellClass =
    "size-9 flex items-center justify-center rounded-lg border border-white/10 bg-black/25 text-neutral-600";
  const slotClass =
    "size-9 relative flex items-center justify-center rounded-lg border transition-colors";
  const emptySlotClass = "border-dashed border-white/15 bg-white/[0.02]";
  const filledSlotClass = "border-white/25 bg-white/[0.06] hover:border-white/40";
  const focusedRing = "ring-1 ring-accent/70";

  const focusModel = () => setFocus("model");
  const focusHarness = () => setFocus("harness");

  const detail = focus === "model" ? modelDetail(model) : harnessDetail(harness);

  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
      data-testid="efficient-workbench"
      aria-label="高效合成台"
    >
      <div className="flex items-start gap-4">
        {/* Compact 4x4 crafting grid */}
        <div className="shrink-0" data-testid="crafting-grid-4x4">
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={`cell-${index}`} className={cellClass} aria-hidden="true" />
            ))}
            {/* Row 4: model | harness | pack | reserved */}
            <button
              type="button"
              onClick={focusModel}
              title={model ? `模型 · ${model.displayName}` : "选择模型"}
              className={`${slotClass} ${model ? filledSlotClass : emptySlotClass} ${
                focus === "model" ? focusedRing : ""
              }`}
              data-testid="crafting-slot-model"
            >
              {model ? (
                <ProviderBrandBadge id={model.providerKind} label={model.displayName} size="row" />
              ) : (
                <span className="text-[9px] text-neutral-600">模型</span>
              )}
            </button>
            <button
              type="button"
              onClick={focusHarness}
              title={harness ? `Harness · ${harness.displayName}` : "选择 Harness"}
              className={`${slotClass} ${harness ? filledSlotClass : emptySlotClass} ${
                focus === "harness" ? focusedRing : ""
              }`}
              data-testid="crafting-slot-harness"
            >
              {harness ? (
                <ProviderBrandBadge id={harness.vendor} label={harness.displayName} size="row" />
              ) : (
                <span className="text-[9px] text-neutral-600">Harness</span>
              )}
            </button>
            <div
              className={`${slotClass} ${emptySlotClass}`}
              title="Pack · 预留槽"
              aria-disabled="true"
            >
              <Package className="size-3.5 text-neutral-600" />
            </div>
            <div
              className={`${slotClass} ${emptySlotClass}`}
              title="预留组件槽 · 暂未开放"
              aria-disabled="true"
            >
              <SquareDashedMousePointer className="size-3.5 text-neutral-700" />
            </div>
          </div>
        </div>

        {/* Status arrow */}
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

        {/* Result slot */}
        <button
          type="button"
          onClick={() => setFocus("result")}
          title={resultName || "合成结果"}
          className={`${slotClass} size-12 shrink-0 flex-col gap-0.5 rounded-xl border ${
            resultName ? filledSlotClass : emptySlotClass
          } ${focus === "result" ? focusedRing : ""}`}
          data-testid="crafting-result-slot"
        >
          {model && harness ? (
            <>
              <ProviderBrandBadge id={harness.vendor} label={harness.displayName} size="row" />
              <span className="w-20 truncate text-[8px] leading-tight text-neutral-400">
                {model.displayName}
              </span>
            </>
          ) : (
            <Hammer className="size-4 text-neutral-600" />
          )}
        </button>

        {/* Side details of the focused item */}
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
          ) : detail ? (
            <div className="mt-1 min-w-0 space-y-0.5">{detail}</div>
          ) : (
            <p className="mt-1 text-[10px] text-neutral-500">
              {focus === "model" ? "尚未放入模型" : "尚未放入 Harness"}
            </p>
          )}
        </div>
      </div>

      {/* Craft controls */}
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
