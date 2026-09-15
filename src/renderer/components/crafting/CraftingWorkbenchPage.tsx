import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@heroui/react";
import type { AccountView } from "@/shared/contracts";
import { friendlyError } from "@/shared/messages";
import type { SharedSettings } from "@/shared/settings";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import type {
  CapabilityResolution,
  HarnessReference,
  SelectedModelEntry,
  StoredRecipe,
} from "@/shared/crafting/workbenchTypes";
import { readBridge } from "@/renderer/bridge";
import { runNativeAgentInstall } from "@/renderer/actions/installNativeAgent";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { currentWslDistros } from "@/renderer/utils/acpRegistryAuth";
import {
  buildSelectedModelInventory,
  findSelectedModelEntry,
} from "@/renderer/crafting/selectedModelInventory";
import {
  buildHarnessInventory,
  findHarnessReference,
  isRetiredHarnessKind,
  NATIVE_HARNESS_AGENT_KINDS,
} from "@/renderer/crafting/harnessInventory";
import { openHarnessConfiguration } from "@/renderer/crafting/openHarnessConfiguration";
import { ModelsInventory } from "./workbench/ModelsInventory";
import { HarnessInventory } from "./workbench/HarnessInventory";
import { ComponentsInventory } from "./workbench/ComponentsInventory";
import { EfficientWorkbench } from "./workbench/EfficientWorkbench";
import { CreativeWorkbenchShell } from "./workbench/CreativeWorkbenchShell";
import { HarnessCliPanel } from "./workbench/HarnessCliPanel";
import { MyRecipesQuickList } from "./workbench/MyRecipesQuickList";
import { RecipeSaveDialog } from "./workbench/RecipeSaveDialog";
import { RecipeLoadConfirmDialog } from "./workbench/RecipeLoadConfirmDialog";

/**
 * Crafting Workbench page: the "合成台" first-level tab of the model-usage
 * workspace. It composes the two workbench modes, the three-column inventory,
 * the shared inspector, the My Recipes quick list and the right Harness/CLI
 * panel. The single Workbench store is the only source of draft/recipe state.
 */
export function CraftingWorkbenchPage(props: {
  accounts: AccountView[];
  customModels: SharedSettings["customModels"];
  onUpdateCustomModels: (next: SharedSettings["customModels"]) => void;
  configuredProviderIds: readonly string[];
  providerOrder: readonly string[];
  entryMode?: "efficient" | "creative" | undefined;
}) {
  const { accounts, customModels, configuredProviderIds, providerOrder, entryMode } = props;

  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const hiddenModels = useSharedSettings((state) => state.hiddenModels);
  const shownModels = useSharedSettings((state) => state.shownModels);

  const mode = useCraftingWorkbenchStore((state) => state.lastWorkbenchMode);
  const setMode = useCraftingWorkbenchStore((state) => state.setMode);
  const efficientDraft = useCraftingWorkbenchStore((state) => state.efficientDraft);
  const creativeDraft = useCraftingWorkbenchStore((state) => state.creativeDraft);
  const setEfficientModel = useCraftingWorkbenchStore((state) => state.setEfficientModel);
  const setEfficientHarness = useCraftingWorkbenchStore((state) => state.setEfficientHarness);
  const clearEfficientDraft = useCraftingWorkbenchStore((state) => state.clearEfficientDraft);
  const clearCreativeDraft = useCraftingWorkbenchStore((state) => state.clearCreativeDraft);
  const attachResolution = useCraftingWorkbenchStore((state) => state.attachResolution);
  const saveRecipe = useCraftingWorkbenchStore((state) => state.saveRecipe);
  const updateRecipeAlias = useCraftingWorkbenchStore((state) => state.updateRecipeAlias);
  const deleteRecipe = useCraftingWorkbenchStore((state) => state.deleteRecipe);
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
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadRecipeId, setLoadRecipeId] = useState<string | undefined>(undefined);
  const [nativeEntries, setNativeEntries] = useState<NativeHarnessControlPlaneEntry[]>([]);
  const [nativeLoading, setNativeLoading] = useState(true);
  const [highlightedKind, setHighlightedKind] = useState<string | undefined>(undefined);
  const [crafting, setCrafting] = useState(false);
  const [installingKinds, setInstallingKinds] = useState<ReadonlySet<string>>(() => new Set());

  // Enter the requested mode once when opened from a chat entry.
  useEffect(() => {
    if (entryMode && entryMode !== mode) setMode(entryMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryMode]);

  // Projection read only. The control plane reshapes already-detected
  // AgentStatuses — it never probes the machine, so supervisor detection
  // events re-read this without re-triggering detection (no event loop).
  const readControlPlane = useCallback(async () => {
    try {
      const entries = await readBridge().getNativeHarnessControlPlane({});
      setNativeEntries(entries);
    } catch {
      // Keep the previous projection; the next detection event retries.
    }
  }, []);

  // Open and manual refresh: run real scoped agent detection first (this
  // invalidates the executable-path cache and re-reads PATH supervisor-side,
  // so a CLI installed while CraftStation was running is found without a
  // restart), then project the fresh statuses into the control plane.
  const refreshHarness = useCallback(async () => {
    setNativeLoading(true);
    try {
      await readBridge().refreshAgentStatuses(currentWslDistros(), {
        agentKinds: [...NATIVE_HARNESS_AGENT_KINDS],
      });
      await readControlPlane();
    } finally {
      setNativeLoading(false);
    }
  }, [readControlPlane]);
  useEffect(() => {
    void refreshHarness();
    const unsubscribe = readBridge().onSupervisorEvent((event) => {
      if (
        event.type === "agent-detected" ||
        event.type === "agent-status-updated" ||
        event.type === "windows-agent-statuses" ||
        event.type === "wsl-agent-statuses"
      ) {
        void readControlPlane();
      }
    });
    return unsubscribe;
  }, [refreshHarness, readControlPlane]);

  const handleInstallHarness = useCallback(
    (entry: NativeHarnessControlPlaneEntry) => {
      const kind = entry.descriptor.harnessKind;
      setInstallingKinds((current) => new Set(current).add(kind));
      const finish = () =>
        setInstallingKinds((current) => {
          if (!current.has(kind)) return current;
          const next = new Set(current);
          next.delete(kind);
          return next;
        });
      const opened = runNativeAgentInstall({
        agentKind: kind,
        label: entry.descriptor.label,
        onComplete: (ok) => {
          if (!ok) {
            finish();
            return;
          }
          // The shared install action already refreshed agent statuses; the
          // fresh detection events re-read the control plane, but read it once
          // more here so the row settles even if an event was missed.
          void readControlPlane().finally(finish);
        },
      });
      if (!opened) finish();
    },
    [readControlPlane],
  );

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
  // Retired catalogue entries (e.g. DeepSeek API Runtime) stay out of the
  // sidebar list as well; the runtime remains for saved recipes/threads.
  const visibleNativeEntries = useMemo(
    () => nativeEntries.filter((entry) => !isRetiredHarnessKind(entry.descriptor.harnessKind)),
    [nativeEntries],
  );

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
    const { duplicateCount } = saveRecipe({
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
    setSaveDupCount(duplicateCount);
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
    const target = [...recipes].reverse().find((r) => r.systemName === saveSystemName);
    if (target && alias) updateRecipeAlias(target.id, alias);
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
      {/* Workbench mode tabs */}
      <div className="flex shrink-0 items-center gap-1">
        {(["efficient", "creative"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === m ? "bg-white/10 text-white" : "text-neutral-400 hover:text-white"
            }`}
          >
            {m === "efficient" ? "合成" : "创造合成台"}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        {/* Main workbench area */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
          {mode === "efficient" ? (
            <>
              {/* 顶部：合成台（主视觉） | 紧凑结果详情 | 已有配方 */}
              <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <EfficientWorkbench
                  model={selectedModel}
                  harness={selectedHarness}
                  resolution={resolution}
                  cpa={cpaRequired ? { required: true, selected: cpaHelper.selected } : undefined}
                  onCraft={handleCraft}
                  onClear={clearEfficientDraft}
                />

                <div
                  className="min-w-0 rounded-2xl border border-white/10 bg-black/25 px-3 py-2"
                  data-testid="crafting-result-detail"
                  aria-label="合成结果详情"
                >
                  <p className="text-[10px] font-medium text-neutral-500">合成结果</p>
                  <p className="mt-0.5 truncate text-xs font-semibold text-foreground">
                    {resultName || "尚未放入模型与 Harness"}
                  </p>
                  {resolution ? (
                    <p
                      className={`mt-0.5 text-[10px] font-semibold ${
                        resolution.status === "NATIVE"
                          ? "text-emerald-400"
                          : resolution.status === "CRAFTABLE"
                            ? "text-amber-300"
                            : "text-neutral-500"
                      }`}
                    >
                      {resolution.status === "NATIVE"
                        ? "原生可合成"
                        : resolution.status === "CRAFTABLE"
                          ? "兼容桥可合成"
                          : "不可合成"}
                    </p>
                  ) : null}
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

                <div className="flex max-h-80 min-h-0 min-w-0 flex-col overflow-y-auto pr-1">
                  <MyRecipesQuickList
                    recipes={recipes}
                    limit={100}
                    onLoad={handleLoadRecipe}
                    onDelete={(recipe) => deleteRecipe(recipe.id)}
                    onViewAll={() =>
                      usePanelStore.getState().openModelUsageWorkspace({ tab: "recipes" })
                    }
                  />
                </div>
              </div>

              {/* 下方三列：填满剩余高度，各列内部滚动，不截断在半页 */}
              <div
                className="grid min-h-0 flex-1 grid-cols-3 gap-3 overflow-hidden border-t border-white/5 pt-3"
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
                  onAdd={() => {
                    document
                      .querySelector('[data-testid="harness-cli-panel"]')
                      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }}
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
                <ComponentsInventory
                  onSelect={() => setInspector(undefined)}
                  summary={
                    <div
                      className="rounded-lg border border-dashed border-white/10 px-2 py-1.5 text-[10px] text-neutral-600"
                      data-testid="components-selection-summary"
                    >
                      暂无已选组件（可选）
                    </div>
                  }
                />
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <CreativeWorkbenchShell draft={creativeDraft} onClear={clearCreativeDraft} />
            </div>
          )}
        </div>

        {/* Right Harness/CLI panel */}
        <HarnessCliPanel
          entries={visibleNativeEntries}
          loading={nativeLoading}
          highlightedKind={highlightedKind}
          installingKinds={installingKinds}
          onRefresh={() => void refreshHarness()}
          onInstall={handleInstallHarness}
          onShowDetail={(entry) => {
            setHighlightedKind(entry.descriptor.harnessKind);
            setInspector(entry.descriptor.harnessKind);
            if (entry.status !== "ready") {
              openHarnessConfiguration(entry.descriptor.harnessKind);
            }
          }}
        />
      </div>

      <RecipeSaveDialog
        open={saveOpen}
        systemName={saveSystemName}
        resolution={resolution ?? ({} as CapabilityResolution)}
        duplicateCount={saveDupCount}
        onClose={() => setSaveOpen(false)}
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
