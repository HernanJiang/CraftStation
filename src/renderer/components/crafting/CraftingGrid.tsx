import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Box,
  CheckCircle2,
  Cpu,
  Grip,
  Hammer,
  Layers,
  PackageOpen,
  Puzzle,
  ScrollText,
  Sparkles,
} from "lucide-react";
import {
  type CraftContext,
  type CraftResult,
  type Item,
  type SlotSelection,
  getDefaultCrafter,
  getDefaultRegistry,
} from "@/shared/crafting";

export interface CraftingGridProps {
  workspace?: string | undefined;
  onCraft?: ((result: CraftResult, prompt: string) => void | Promise<void>) | undefined;
  disabled?: boolean | undefined;
}

type InventoryFilter = "all" | "model" | "harness" | "component" | "recipe";
type IngredientSlot = "model" | "harness";

const FILTERS: Array<{ id: InventoryFilter; label: string; icon: typeof Box }> = [
  { id: "all", label: "全部", icon: PackageOpen },
  { id: "model", label: "模型", icon: Cpu },
  { id: "harness", label: "Harness", icon: Layers },
  { id: "component", label: "组件", icon: Puzzle },
  { id: "recipe", label: "配方", icon: ScrollText },
];

function componentLines(item: Item): string[] {
  return item.components.flatMap((component) => {
    const record = component as Record<string, unknown>;
    if (component.kind === "model_capability") {
      return [
        `上下文 ${typeof record.contextWindow === "number" ? `${Math.round(record.contextWindow / 1000)}k` : "-"}`,
        `流式输出 ${record.supportsStreaming === false ? "关闭" : "开启"}`,
        `工具调用 ${record.supportsToolCalling === false ? "关闭" : "开启"}`,
      ];
    }
    if (component.kind === "harness_runtime") {
      return [
        `Runtime ${String(record.executionMode ?? "-")}`,
        `支持厂商 ${Array.isArray(record.supportedVendors) ? record.supportedVendors.join(", ") : "-"}`,
      ];
    }
    return [component.kind];
  });
}

function InventoryItem(props: { item: Item; selected: boolean; onSelect: () => void }) {
  const Icon = props.item.kind === "model" ? Cpu : Layers;
  const tooltip = [
    props.item.metadata.name,
    `厂商：${props.item.metadata.vendor}`,
    `版本：${props.item.metadata.version}`,
    ...componentLines(props.item),
  ].join("\n");
  return (
    <button
      type="button"
      draggable
      title={tooltip}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/craftstation-item", props.item.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={props.onSelect}
      className={`group relative aspect-square min-h-[74px] rounded-xl border p-2 text-left transition-all ${
        props.selected
          ? "border-amber-400/60 bg-amber-400/10 shadow-[inset_0_0_0_1px_rgba(251,191,36,.12)]"
          : "border-[var(--hairline)] bg-[var(--surface-secondary)] hover:-translate-y-0.5 hover:border-[var(--hairline-strong)] hover:bg-[var(--row-hover)]"
      }`}
    >
      <Grip className="absolute right-1.5 top-1.5 size-3 text-muted/35 opacity-0 transition-opacity group-hover:opacity-100" />
      <span className="flex size-7 items-center justify-center rounded-lg bg-[var(--content-background)] text-amber-300">
        <Icon className="size-4" />
      </span>
      <span className="mt-2 block truncate text-[11px] font-semibold text-foreground">
        {props.item.metadata.name}
      </span>
      <span className="block truncate text-[9px] uppercase tracking-wide text-muted">
        {props.item.metadata.vendor} · v{props.item.metadata.version}
      </span>
    </button>
  );
}

function IngredientSlotView(props: {
  kind: IngredientSlot;
  item: Item | undefined;
  onDropItem: (id: string) => void;
}) {
  const Icon = props.kind === "model" ? Cpu : Layers;
  const label = props.kind === "model" ? "模型槽" : "Harness 槽";
  return (
    <div
      data-testid={`${props.kind}-slot`}
      data-crafting-slot=""
      title={
        props.item ? [props.item.metadata.name, ...componentLines(props.item)].join("\n") : label
      }
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const id = event.dataTransfer.getData("application/craftstation-item");
        if (id) props.onDropItem(id);
      }}
      className="craftstation-mc-slot flex size-[52px] flex-col items-center justify-center rounded-lg border border-white/10 text-center"
    >
      {props.item ? (
        <>
          <span className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
            <Icon className="size-4" />
          </span>
          <span className="mt-0.5 max-w-[46px] truncate text-[8px] font-semibold text-foreground">
            {props.kind === "model" ? "MODEL" : "HARNESS"}
          </span>
        </>
      ) : (
        <>
          <span className="flex size-8 items-center justify-center rounded-lg border border-dashed border-muted/35 text-muted/35">
            <Icon className="size-4" />
          </span>
          <span className="sr-only">{label}</span>
        </>
      )}
    </div>
  );
}

export const CraftingGrid: React.FC<CraftingGridProps> = ({
  workspace,
  onCraft,
  disabled = false,
}) => {
  const registry = useMemo(() => getDefaultRegistry(), []);
  const crafter = useMemo(() => getDefaultCrafter(), []);
  const availableModels = useMemo(() => registry.listItems("model"), [registry]);
  const availableHarnesses = useMemo(() => registry.listItems("harness"), [registry]);
  const recipes = useMemo(() => registry.listRecipes(), [registry]);

  const [selectedModelId, setSelectedModelId] = useState(
    availableModels[0]?.id ?? "openai:gpt-5.3-codex",
  );
  const [harnessSelection, setHarnessSelection] = useState<"auto" | string>("auto");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [prompt, setPrompt] = useState("");
  const [isCrafting, setIsCrafting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedModel = registry.getItem(selectedModelId);
  const selectedHarnessItem: SlotSelection =
    harnessSelection === "auto" ? "auto" : registry.getItem(harnessSelection);
  const resolvedHarness = registry.resolveSlot("harness", selectedHarnessItem);
  const validation = crafter.validate({
    slots: { model: selectedModel, harness: selectedHarnessItem },
  });

  const visibleItems = [...availableModels, ...availableHarnesses].filter((item) =>
    filter === "all"
      ? true
      : filter === "model" || filter === "harness"
        ? item.kind === filter
        : false,
  );

  function chooseItem(item: Item) {
    if (item.kind === "model") setSelectedModelId(item.id);
    if (item.kind === "harness") setHarnessSelection(item.id);
  }

  function dropInto(slot: IngredientSlot, id: string) {
    const item = registry.getItem(id);
    if (!item || item.kind !== slot) return;
    chooseItem(item);
  }

  async function handleCraft() {
    if (!validation.valid || disabled || isCrafting) return;
    setIsCrafting(true);
    setErrorMessage(null);
    try {
      const context: CraftContext = { workspace };
      const result = crafter.compile(
        { slots: { model: selectedModel, harness: selectedHarnessItem } },
        context,
      );
      if (!result.success) {
        setErrorMessage(
          result.errors?.map((error) => error.message).join("; ") ?? "Crafting compilation failed",
        );
        return;
      }
      if (onCraft) await onCraft(result, prompt);
      else
        console.info(
          "[Feature Pending Implementation] Spawn crafted Agent Entity",
          result.craftPlan?.id,
        );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCrafting(false);
    }
  }

  return (
    <div
      data-testid="crafting-grid"
      className="flex min-h-0 w-full flex-col gap-3 rounded-[20px] border border-[var(--hairline)] bg-[var(--surface)] p-3 text-foreground"
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/12 text-amber-300">
            <Hammer className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Agent 合成台</h2>
            <p className="truncate text-[10px] text-muted">原料 → Recipe → 产物 Item → Entity</p>
          </div>
        </div>
        <span className="rounded-full bg-[var(--surface-secondary)] px-2 py-1 font-mono text-[9px] text-muted">
          3×3 GRID
        </span>
      </header>

      <div className="grid grid-cols-[172px_24px_minmax(88px,1fr)] items-center justify-center gap-3 rounded-[18px] bg-[var(--content-background)] p-3">
        <div className="grid grid-cols-3 gap-2">
          <IngredientSlotView
            kind="model"
            item={selectedModel}
            onDropItem={(id) => dropInto("model", id)}
          />
          <div
            data-crafting-slot=""
            className="craftstation-mc-slot flex size-[52px] items-center justify-center rounded-lg border border-white/10 text-muted/25"
          >
            <Cpu className="size-4" strokeDasharray="2 3" />
          </div>
          <div
            data-crafting-slot=""
            className="craftstation-mc-slot flex size-[52px] items-center justify-center rounded-lg border border-white/10 text-muted/25"
          >
            <Puzzle className="size-4" strokeDasharray="2 3" />
          </div>
          <div
            data-crafting-slot=""
            className="craftstation-mc-slot flex size-[52px] items-center justify-center rounded-lg border border-white/10 text-muted/25"
          >
            <Sparkles className="size-4" strokeDasharray="2 3" />
          </div>
          <IngredientSlotView
            kind="harness"
            item={resolvedHarness}
            onDropItem={(id) => dropInto("harness", id)}
          />
          <span className="sr-only">Resolved: {resolvedHarness?.metadata.name ?? "None"}</span>
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              data-crafting-slot=""
              className="craftstation-mc-slot flex size-[52px] items-center justify-center rounded-lg border border-white/10 text-muted/25"
            >
              {index % 2 === 0 ? (
                <Puzzle className="size-4" strokeDasharray="2 3" />
              ) : (
                <Layers className="size-4" strokeDasharray="2 3" />
              )}
            </div>
          ))}
        </div>

        <ArrowRight
          className={`size-6 transition-all ${
            validation.valid ? "craftstation-recipe-arrow text-amber-300" : "text-muted/25"
          }`}
        />

        <div
          data-testid="recipe-preview"
          className="flex min-w-0 flex-col items-center justify-center text-center"
        >
          {validation.valid && validation.matchedRecipe ? (
            <>
              <button
                type="button"
                disabled={disabled || isCrafting}
                onClick={() => void handleCraft()}
                title="点击装配并 Spawn Agent Entity"
                className="craftstation-result-slot flex size-[68px] items-center justify-center rounded-xl border border-amber-400/45 bg-amber-400/7 text-amber-300 transition-transform hover:scale-[1.03] disabled:cursor-not-allowed"
              >
                <Box className="size-7" />
              </button>
              <strong className="mt-2 max-w-[150px] truncate text-[10px]">
                {validation.matchedRecipe.name}
              </strong>
              <span className="mt-1 max-w-[150px] truncate text-[9px] text-muted">
                {selectedModel?.metadata.name} + {resolvedHarness?.metadata.name}
              </span>
              <span className="sr-only">
                Produces: {selectedModel?.metadata.name} + {resolvedHarness?.metadata.name}
              </span>
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[8px] font-semibold text-emerald-300">
                <CheckCircle2 className="size-2.5" />
                {validation.matchedRecipe.compatibilityStatus}
              </span>
            </>
          ) : (
            <>
              <span className="craftstation-result-slot flex size-[68px] items-center justify-center rounded-xl border border-[var(--hairline)] bg-[var(--surface-secondary)]">
                <AlertTriangle className="size-6 text-muted/40" />
              </span>
              <span className="mt-2 text-[10px] text-muted">组合无效</span>
            </>
          )}
        </div>
      </div>

      <section className="min-h-0 rounded-[18px] border border-[var(--hairline)] bg-[var(--content-background)] p-3">
        <div className="no-scrollbar flex gap-1 overflow-x-auto pb-2">
          {FILTERS.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[10px] transition-colors ${filter === entry.id ? "bg-[var(--row-active)] text-foreground" : "text-muted hover:bg-[var(--row-hover)]"}`}
              >
                <Icon className="size-3.5" />
                {entry.label}
              </button>
            );
          })}
        </div>
        {filter === "recipe" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {recipes.map((recipe) => (
              <button
                key={recipe.id}
                type="button"
                title={recipe.description}
                onClick={() => {
                  const recipeModel = availableModels.find(
                    (model) =>
                      recipe.modelVendors?.includes(model.metadata.vendor) ??
                      recipe.requirements.model?.allowedVendors?.includes(model.metadata.vendor),
                  );
                  if (recipeModel) setSelectedModelId(recipeModel.id);
                  setHarnessSelection(recipe.harnessItemId ?? "auto");
                }}
                className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-secondary)] p-3 text-left hover:bg-[var(--row-hover)]"
              >
                <ScrollText className="size-4 text-amber-300" />
                <span className="mt-2 block text-xs font-semibold">{recipe.name}</span>
                <span className="text-[9px] text-muted">
                  一键填充 Ingredients · {recipe.compatibilityStatus}
                </span>
              </button>
            ))}
          </div>
        ) : filter === "component" ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...availableModels, ...availableHarnesses]
              .flatMap((item) =>
                item.components.map((component, index) => ({
                  id: `${item.id}:${index}`,
                  name: component.kind,
                  owner: item.metadata.name,
                })),
              )
              .map((component) => (
                <div
                  key={component.id}
                  title={`${component.name}\nOwner: ${component.owner}`}
                  className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-secondary)] p-2"
                >
                  <Puzzle className="size-4 text-violet-300" />
                  <span className="mt-2 block truncate text-[10px] font-semibold">
                    {component.name}
                  </span>
                  <span className="block truncate text-[9px] text-muted">{component.owner}</span>
                </div>
              ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {visibleItems.map((item) => (
              <InventoryItem
                key={item.id}
                item={item}
                selected={item.id === selectedModelId || item.id === resolvedHarness?.id}
                onSelect={() => chooseItem(item)}
              />
            ))}
          </div>
        )}
      </section>

      <select
        data-testid="model-select"
        className="sr-only"
        value={selectedModelId}
        onChange={(event) => setSelectedModelId(event.target.value)}
      >
        {availableModels.map((item) => (
          <option key={item.id} value={item.id}>
            {item.metadata.name} ({item.metadata.vendor})
          </option>
        ))}
      </select>
      <select
        data-testid="harness-select"
        className="sr-only"
        value={harnessSelection}
        onChange={(event) => setHarnessSelection(event.target.value)}
      >
        <option value="auto">auto（确定性 Codex）</option>
        {availableHarnesses.map((item) => (
          <option key={item.id} value={item.id}>
            {item.metadata.name} ({item.metadata.vendor})
          </option>
        ))}
      </select>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="craft-prompt-input"
          data-testid="craft-prompt-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="初始任务描述（可选）"
          className="min-w-0 flex-1 rounded-xl border border-[var(--hairline)] bg-[var(--content-background)] px-3 py-2 text-xs outline-none focus:border-amber-400/50"
        />
        <button
          type="button"
          data-testid="craft-button"
          onClick={() => void handleCraft()}
          disabled={!validation.valid || disabled || isCrafting}
          className="flex h-9 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-neutral-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-[var(--surface-secondary)] disabled:text-muted"
        >
          <Sparkles className="size-4" />
          {isCrafting ? "正在合成 Agent..." : "合成并启动 Agent"}
        </button>
      </div>
      {errorMessage ? (
        <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{errorMessage}</p>
      ) : null}
    </div>
  );
};
