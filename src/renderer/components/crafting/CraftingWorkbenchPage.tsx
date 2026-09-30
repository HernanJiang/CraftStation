import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@heroui/react";
import type { AccountView } from "@/shared/contracts";
import { friendlyError } from "@/shared/messages";
import type { SharedSettings } from "@/shared/settings";
import type {
  CapabilityResolution,
  HarnessReference,
  SelectedModelEntry,
  StoredRecipe,
} from "@/shared/crafting/workbenchTypes";
import { readBridge } from "@/renderer/bridge";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  buildSelectedModelInventory,
  findSelectedModelEntry,
} from "@/renderer/crafting/selectedModelInventory";
import { buildHarnessInventory, findHarnessReference } from "@/renderer/crafting/harnessInventory";
import { openHarnessConfiguration } from "@/renderer/crafting/openHarnessConfiguration";
import { useNativeHarnessControlPlane } from "@/renderer/crafting/useNativeHarnessControlPlane";
import { ModelsInventory } from "./workbench/ModelsInventory";
import { HarnessInventory } from "./workbench/HarnessInventory";
import { ComponentsRail } from "./workbench/ComponentsRail";
import { EfficientWorkbench } from "./workbench/EfficientWorkbench";
import { RecipesRail } from "./workbench/RecipesRail";
import { RecipeSaveDialog } from "./workbench/RecipeSaveDialog";
import { RecipeLoadConfirmDialog } from "./workbench/RecipeLoadConfirmDialog";

/**
 * Crafting Workbench page: the "合成台与配方" first-level tab of the
 * model-usage workspace. The workbench is a single 3×3 Minecraft-style grid
 * (model / harness / component ingredients plus reserved slots), the
 * three-column inventory and a right rail of saved-recipe cards.
 * Harness/CLI channels moved to the dedicated Harness map tab. The single
 * Workbench store is the only source of draft/recipe state.
 */
export function CraftingWorkbenchPage(props: {
  accounts: AccountView[];
  customModels: SharedSettings["customModels"];
  onUpdateCustomModels: (next: SharedSettings["customModels"]) => void;
  configuredProviderIds: readonly string[];
  providerOrder: readonly string[];
}) {
  const { accounts, customModels, configuredProviderIds, providerOrder } = props;

  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const hiddenModels = useSharedSettings((state) => state.hiddenModels);
  const shownModels = useSharedSettings((state) => state.shownModels);

  const efficientDraft = useCraftingWorkbenchStore((state) => state.efficientDraft);
  const setEfficientModel = useCraftingWorkbenchStore((state) => state.setEfficientModel);
  const setEfficientHarness = useCraftingWorkbenchStore((state) => state.setEfficientHarness);
  const clearEfficientDraft = useCraftingWorkbenchStore((state) => state.clearEfficientDraft);
  const attachResolution = useCraftingWorkbenchStore((state) => state.attachResolution);
  const saveRecipe = useCraftingWorkbenchStore((state) => state.saveRecipe);
  const loadRecipeToDraft = useCraftingWorkbenchStore((state) => state.loadRecipeToDraft);
  const setInspector = useCraftingWorkbenchStore((state) => state.setInspector);
  const recipes = useCraftingWorkbenchStore((state) => state.recipes);
  const cpaHelper = useCraftingWorkbenchStore((state) => state.cpaHelper);
  const ensureCliProxyApiItem = useCraftingWorkbenchStore((state) => state.ensureCliProxyApiItem);
  const clearCliProxyApiSelection = useCraftingWorkbenchStore(
    (state) => state.clearCliProxyApiSelection,
  );

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveDupCount, setSaveDupCount] = useState(0);
  const [saveSystemName, setSaveSystemName] = useState("");
  const [pendingSave, setPendingSave] = useState<Parameters<typeof saveRecipe>[0]>();
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadRecipeId, setLoadRecipeId] = useState<string | undefined>(undefined);
  const [crafting, setCrafting] = useState(false);

  // Native harness control plane (cached paint + scoped revalidation +
  // supervisor events + install) is shared with the Harness map tab.
  const { entries: nativeEntries, setHighlightedKind } = useNativeHarnessControlPlane();

  const modelEntries = useMemo(
    () =>
      buildSelectedModelInventory({
        agentStatuses,
        wslAgentStatuses,
        hiddenModels,
        shownModels,
        customModels,
        accounts,
        configuredProviderIds,
        providerOrder,
      }),
    [
      agentStatuses,
      wslAgentStatuses,
      hiddenModels,
      shownModels,
      customModels,
      accounts,
      configuredProviderIds,
      providerOrder,
    ],
  );
  const harnessEntries = useMemo(() => buildHarnessInventory(nativeEntries), [nativeEntries]);

  const selectedModel = findSelectedModelEntry(modelEntries, efficientDraft.modelEntryRef);
  const selectedHarness = findHarnessReference(harnessEntries, efficientDraft.harnessRef);
  const resolution = efficientDraft.resolution;
  // Compatibility routes (gateway-direct / cpa-translate) require the
  // CLIProxyAPI helper: ensure it is present + selected exactly then.
  // Native routes must NOT auto-select CPA.
  const cpaRequired = resolution?.source === "compatibility-layer";
  useEffect(() => {
    if (cpaRequired) ensureCliProxyApiItem();
    else clearCliProxyApiSelection();
  }, [cpaRequired, ensureCliProxyApiItem, clearCliProxyApiSelection]);

  // Auto-start the bridge the moment CPA is auto-selected as a component:
  // subscription→API conversion needs a running sidecar, not another manual
  // click. Only starts when the binary is already installed — a missing
  // binary stays on the manual install path (no silent downloads). Guarded
  // per resolution key, so a manual stop afterwards always wins.
  const autoBridgeAttemptedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!cpaRequired || !cpaHelper.selected || !resolution || resolution.status !== "CRAFTABLE") {
      return;
    }
    if (autoBridgeAttemptedKey.current === resolution.resolutionKey) return;
    autoBridgeAttemptedKey.current = resolution.resolutionKey;
    void (async () => {
      try {
        const status = await readBridge().getCompatibilityBridgeStatus({});
        if (!status.running && status.installed === true) {
          await readBridge().startCompatibilityBridge({});
        }
      } catch (error) {
        autoBridgeAttemptedKey.current = null;
        toast.danger(friendlyError(error));
      }
    })();
  }, [cpaRequired, cpaHelper.selected, resolution]);

  const emptyResolution = (key: string, msg: string): CapabilityResolution => ({
    resolutionKey: key,
    createdAt: new Date().toISOString(),
    status: "IMPOSSIBLE",
    internalStatus: "UNAVAILABLE",
    source: "unavailable",
    modelEntryRef: efficientDraft.modelEntryRef ?? "",
    harnessRef: efficientDraft.harnessRef ?? "",
    capabilities: [],
    diagnostics: [
      {
        code: "RUNTIME_UNAVAILABLE",
        phase: "readiness",
        message: msg,
        remediation: "请安装/配置所选 Harness，或更换可用的模型/Harness 组合",
      },
    ],
  });

  // Recompute compatibility whenever the current efficient composition changes.
  useEffect(() => {
    if (!efficientDraft.modelEntryRef || !efficientDraft.harnessRef) {
      attachResolution(
        "efficient",
        emptyResolution(
          `none:${efficientDraft.modelEntryRef ?? ""}:${efficientDraft.harnessRef ?? ""}`,
          "缺少模型或 Harness 组件",
        ),
      );
      return;
    }
    let cancelled = false;
    void readBridge()
      .resolveCraftingCompatibility({
        modelEntryRef: efficientDraft.modelEntryRef,
        harnessRef: efficientDraft.harnessRef,
        ...(efficientDraft.providerProfileRef
          ? { providerProfileRef: efficientDraft.providerProfileRef }
          : {}),
        ...(efficientDraft.runtimeProfileRef
          ? { runtimeProfileRef: efficientDraft.runtimeProfileRef }
          : {}),
      })
      .then((res) => {
        if (!cancelled) attachResolution("efficient", res);
      })
      .catch(() => {
        if (!cancelled)
          attachResolution(
            "efficient",
            emptyResolution(
              `error:${efficientDraft.modelEntryRef}:${efficientDraft.harnessRef}`,
              "兼容性解析失败",
            ),
          );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    efficientDraft.modelEntryRef,
    efficientDraft.harnessRef,
    efficientDraft.providerProfileRef,
    efficientDraft.runtimeProfileRef,
  ]);

  const handleSelectModel = (entry: SelectedModelEntry) => {
    setEfficientModel(entry.entryId);
    setInspector(entry.entryId);
  };

  const handleSelectHarness = (ref: HarnessReference) => {
    if (ref.status !== "ready") {
      setInspector(ref.harnessItemId);
      setHighlightedKind(ref.harnessKind);
      openHarnessConfiguration(ref.harnessKind);
      return;
    }
    setEfficientHarness(ref.harnessItemId);
    setInspector(ref.harnessItemId);
  };

  const persistCraftedRecipe = (nextResolution: CapabilityResolution) => {
    const name =
      selectedModel && selectedHarness
        ? `${selectedHarness.displayName} · ${selectedModel.displayName}`
        : "";
    setPendingSave({
      modelEntryRef: efficientDraft.modelEntryRef ?? "",
      harnessRef: efficientDraft.harnessRef ?? "",
      modelName: selectedModel?.displayName ?? "Model",
      harnessName: selectedHarness?.displayName ?? "Harness",
      resolution: nextResolution,
      ...(selectedModel?.modelId ? { modelId: selectedModel.modelId } : {}),
      ...(selectedHarness?.harnessKind ? { harnessKind: selectedHarness.harnessKind } : {}),
      ...(selectedModel?.providerLabel ? { providerLabel: selectedModel.providerLabel } : {}),
      ...(efficientDraft.providerProfileRef
        ? { providerProfileRef: efficientDraft.providerProfileRef }
        : {}),
      ...(efficientDraft.runtimeProfileRef
        ? { runtimeProfileRef: efficientDraft.runtimeProfileRef }
        : {}),
    });
    setSaveDupCount(
      recipes.filter(
        (recipe) =>
          recipe.modelEntryRef === efficientDraft.modelEntryRef &&
          recipe.harnessRef === efficientDraft.harnessRef,
      ).length,
    );
    setSaveSystemName(name);
    setSaveOpen(true);
  };

  const handleCraft = () => {
    if (!resolution) return;
    const cpaMissing = resolution.diagnostics.some((entry) => entry.code === "CPA_NOT_INSTALLED");
    if (resolution.status !== "NATIVE" && resolution.status !== "CRAFTABLE" && !cpaMissing) return;
    if (!cpaMissing && resolution.status !== "CRAFTABLE") {
      persistCraftedRecipe(resolution);
      return;
    }
    if (resolution.status === "NATIVE") {
      persistCraftedRecipe(resolution);
      return;
    }
    if (crafting) return;
    setCrafting(true);
    void (async () => {
      try {
        await readBridge().ensureCompatibilityBridge({});
        const next = await readBridge().resolveCraftingCompatibility({
          modelEntryRef: efficientDraft.modelEntryRef ?? "",
          harnessRef: efficientDraft.harnessRef ?? "",
          ...(efficientDraft.providerProfileRef
            ? { providerProfileRef: efficientDraft.providerProfileRef }
            : {}),
          ...(efficientDraft.runtimeProfileRef
            ? { runtimeProfileRef: efficientDraft.runtimeProfileRef }
            : {}),
        });
        attachResolution("efficient", next);
        if (next.status !== "NATIVE" && next.status !== "CRAFTABLE") {
          toast.danger(next.diagnostics[0]?.message ?? "CLIProxyAPI 启动后仍无法合成");
          return;
        }
        persistCraftedRecipe(next);
      } catch (error) {
        toast.danger(friendlyError(error));
      } finally {
        setCrafting(false);
      }
    })();
  };

  const handleConfirmSave = (alias?: string) => {
    if (
      !pendingSave ||
      (pendingSave.resolution.status !== "NATIVE" && pendingSave.resolution.status !== "CRAFTABLE")
    )
      return;
    saveRecipe({ ...pendingSave, ...(alias ? { alias } : {}) });
    setPendingSave(undefined);
    setSaveOpen(false);
  };

  const handleLoadRecipe = (recipe: StoredRecipe) => {
    const hasDraft = Boolean(efficientDraft.modelEntryRef || efficientDraft.harnessRef);
    if (hasDraft) {
      setLoadRecipeId(recipe.id);
      setLoadOpen(true);
    } else {
      loadRecipeToDraft(recipe, "efficient");
    }
  };

  const confirmLoad = () => {
    if (!loadRecipeId) return;
    const recipe = recipes.find((r) => r.id === loadRecipeId);
    if (recipe) loadRecipeToDraft(recipe, "efficient");
    setLoadOpen(false);
    setLoadRecipeId(undefined);
  };

  const loadRecipeSystemName = loadRecipeId
    ? (recipes.find((r) => r.id === loadRecipeId)?.systemName ?? "")
    : "";

  const openModelsTab = () => usePanelStore.getState().openModelUsageWorkspace({ tab: "models" });

  const resultName =
    selectedModel && selectedHarness
      ? `${selectedHarness.displayName} · ${selectedModel.displayName}`
      : "";
  const resolutionReason =
    resolution && resolution.status !== "NATIVE" && resolution.status !== "CRAFTABLE"
      ? (resolution.diagnostics[0]?.message ?? "")
      : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3" data-testid="crafting-workbench-page">
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        {/* Main workbench area */}
        <div className="flex min-h-0 min-w-0 shrink flex-col gap-3">
          {/* 顶部：合成台（主视觉） | 紧凑结果详情 */}
          <div className="grid shrink-0 grid-cols-[max-content_minmax(14rem,22rem)] items-stretch gap-3">
            <EfficientWorkbench
              model={selectedModel}
              harness={selectedHarness}
              resolution={resolution}
              onCraft={handleCraft}
              onClear={clearEfficientDraft}
            />

            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <div
                className="min-w-0 shrink-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                data-testid="crafting-result-detail"
                aria-label="合成结果详情"
              >
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-medium text-neutral-500">合成结果</p>
                  {resolution ? (
                    <span
                      className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
                        resolution.status === "NATIVE"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : resolution.status === "CRAFTABLE"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-white/5 text-neutral-400"
                      }`}
                    >
                      {resolution.status === "NATIVE"
                        ? "原生可合成"
                        : resolution.status === "CRAFTABLE"
                          ? "兼容桥可合成"
                          : "不可合成"}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-xs font-semibold text-foreground">
                  {resultName || "尚未放入模型与 Harness"}
                </p>
                {resolutionReason ? (
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-neutral-400">
                    {resolutionReason}
                  </p>
                ) : null}
                {selectedModel ? (
                  <p className="mt-1 truncate text-[10px] text-neutral-500">
                    模型 · {selectedModel.displayName}（{selectedModel.modelId}）
                  </p>
                ) : null}
                {selectedHarness ? (
                  <p className="truncate text-[10px] text-neutral-500">
                    Harness · {selectedHarness.displayName}（{selectedHarness.status}）
                  </p>
                ) : null}
              </div>
              <RecipesRail variant="panel" onLoad={handleLoadRecipe} />
            </div>
          </div>

          {/* 下方两列：填满剩余高度，各列内部滚动，不截断在半页 */}
          <div
            className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden"
            data-testid="crafting-inventory-columns"
          >
            <ModelsInventory
              entries={modelEntries}
              selectedEntryId={efficientDraft.modelEntryRef}
              onSelect={handleSelectModel}
              onAdd={openModelsTab}
              summary={
                selectedModel ? (
                  <div
                    className="rounded-lg border border-accent/40 bg-white/[0.05] px-2 py-1.5"
                    data-testid="models-selection-summary"
                  >
                    <p className="truncate text-[11px] font-semibold text-foreground">
                      {selectedModel.displayName}
                    </p>
                    <p className="truncate text-[9px] text-neutral-500">
                      {selectedModel.modelId} · {selectedModel.channelLabel}
                    </p>
                  </div>
                ) : (
                  <div
                    className="rounded-lg border border-dashed border-white/10 px-2 py-1.5 text-[10px] text-neutral-600"
                    data-testid="models-selection-summary"
                  >
                    未选择模型
                  </div>
                )
              }
            />
            <HarnessInventory
              entries={harnessEntries}
              selectedRef={efficientDraft.harnessRef}
              onSelect={handleSelectHarness}
              onAdd={() => usePanelStore.getState().openModelUsageWorkspace({ tab: "harnesses" })}
              summary={
                selectedHarness ? (
                  <div
                    className="rounded-lg border border-accent/40 bg-white/[0.05] px-2 py-1.5"
                    data-testid="harness-selection-summary"
                  >
                    <p className="truncate text-[11px] font-semibold text-foreground">
                      {selectedHarness.displayName}
                    </p>
                    <p className="truncate text-[9px] text-neutral-500">
                      {selectedHarness.harnessKind} · {selectedHarness.status}
                    </p>
                  </div>
                ) : (
                  <div
                    className="rounded-lg border border-dashed border-white/10 px-2 py-1.5 text-[10px] text-neutral-600"
                    data-testid="harness-selection-summary"
                  >
                    未选择 Harness
                  </div>
                )
              }
            />
          </div>
        </div>

        {/* Right ingredients rail */}
        <aside
          className="flex min-h-0 min-w-[22rem] flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3"
          aria-label="原料栏"
        >
          <ComponentsRail />
        </aside>
      </div>

      <RecipeSaveDialog
        open={saveOpen}
        systemName={saveSystemName}
        resolution={pendingSave?.resolution ?? resolution ?? ({} as CapabilityResolution)}
        duplicateCount={saveDupCount}
        onClose={() => {
          setSaveOpen(false);
          setPendingSave(undefined);
        }}
        onSave={handleConfirmSave}
      />
      <RecipeLoadConfirmDialog
        open={loadOpen}
        systemName={loadRecipeSystemName}
        onCancel={() => setLoadOpen(false)}
        onConfirm={confirmLoad}
      />
    </div>
  );
}
