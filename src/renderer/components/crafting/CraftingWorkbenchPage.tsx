import { useEffect, useMemo, useState } from "react";
import type { AccountView } from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
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
import { ModelsInventory } from "./workbench/ModelsInventory";
import { HarnessInventory } from "./workbench/HarnessInventory";
import { ComponentsInventory } from "./workbench/ComponentsInventory";
import { EfficientWorkbench } from "./workbench/EfficientWorkbench";
import { CreativeWorkbenchShell } from "./workbench/CreativeWorkbenchShell";
import { HarnessCliPanel } from "./workbench/HarnessCliPanel";
import { SharedInspector } from "./workbench/SharedInspector";
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
  const loadRecipeToDraft = useCraftingWorkbenchStore((state) => state.loadRecipeToDraft);
  const setInspector = useCraftingWorkbenchStore((state) => state.setInspector);
  const selectedInspectorRef = useCraftingWorkbenchStore((state) => state.selectedInspectorRef);
  const recipes = useCraftingWorkbenchStore((state) => state.recipes);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveDupCount, setSaveDupCount] = useState(0);
  const [saveSystemName, setSaveSystemName] = useState("");
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadRecipeId, setLoadRecipeId] = useState<string | undefined>(undefined);
  const [nativeEntries, setNativeEntries] = useState<NativeHarnessControlPlaneEntry[]>([]);
  const [nativeLoading, setNativeLoading] = useState(true);
  const [highlightedKind, setHighlightedKind] = useState<string | undefined>(undefined);

  // Enter the requested mode once when opened from a chat entry.
  useEffect(() => {
    if (entryMode && entryMode !== mode) setMode(entryMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryMode]);

  const refreshHarness = async () => {
    setNativeLoading(true);
    try {
      const entries = await readBridge().getNativeHarnessControlPlane({});
      setNativeEntries(entries);
    } finally {
      setNativeLoading(false);
    }
  };
  useEffect(() => {
    void refreshHarness();
    const unsubscribe = readBridge().onSupervisorEvent((event) => {
      if (
        event.type === "agent-detected" ||
        event.type === "agent-status-updated" ||
        event.type === "windows-agent-statuses" ||
        event.type === "wsl-agent-statuses"
      ) {
        void refreshHarness();
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelEntries = useMemo(
    () =>
      buildSelectedModelInventory({
        agentStatuses,
        wslAgentStatuses,
        hiddenModels,
        customModels,
        accounts,
        configuredProviderIds,
        providerOrder,
      }),
    [
      agentStatuses,
      wslAgentStatuses,
      hiddenModels,
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
      return;
    }
    setEfficientHarness(ref.harnessItemId);
    setInspector(ref.harnessItemId);
  };

  const handleCraft = () => {
    // Compatibility remains visible as a diagnostic state, but is not an
    // executable/saveable recipe until the target runtime path is verified.
    if (!resolution || resolution.status !== "NATIVE") return;
    const name =
      selectedModel && selectedHarness
        ? `${selectedHarness.displayName} · ${selectedModel.displayName}`
        : "";
    const { duplicateCount } = saveRecipe({
      modelEntryRef: efficientDraft.modelEntryRef ?? "",
      harnessRef: efficientDraft.harnessRef ?? "",
      modelName: selectedModel?.displayName ?? "Model",
      harnessName: selectedHarness?.displayName ?? "Harness",
      resolution,
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

  const inspectorModel = selectedInspectorRef
    ? findSelectedModelEntry(modelEntries, selectedInspectorRef)
    : undefined;
  const inspectorHarness = selectedInspectorRef
    ? findHarnessReference(harnessEntries, selectedInspectorRef)
    : undefined;

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
            {m === "efficient" ? "高效合成台" : "创造合成台"}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        {/* Main workbench area */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
          {mode === "efficient" ? (
            <EfficientWorkbench
              model={selectedModel}
              harness={selectedHarness}
              resolution={resolution}
              onCraft={handleCraft}
              onClear={clearEfficientDraft}
            />
          ) : (
            <CreativeWorkbenchShell draft={creativeDraft} onClear={clearCreativeDraft} />
          )}

          {/* Inventory */}
          <div className="grid shrink-0 grid-cols-3 gap-3 border-t border-white/5 pt-3">
            <ModelsInventory
              entries={modelEntries}
              selectedEntryId={efficientDraft.modelEntryRef}
              onSelect={handleSelectModel}
              onAdd={openModelsTab}
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
            />
            <ComponentsInventory onSelect={() => setInspector(undefined)} />
          </div>

          {/* Lower section: quick list + inspector */}
          <div className="grid shrink-0 grid-cols-2 gap-3">
            <MyRecipesQuickList
              recipes={recipes}
              onLoad={handleLoadRecipe}
              onViewAll={() => usePanelStore.getState().openModelUsageWorkspace({ tab: "recipes" })}
            />
            <SharedInspector model={inspectorModel} harness={inspectorHarness} />
          </div>
        </div>

        {/* Right Harness/CLI panel */}
        <HarnessCliPanel
          entries={nativeEntries}
          loading={nativeLoading}
          highlightedKind={highlightedKind}
          onRefresh={() => void refreshHarness()}
          onShowDetail={(entry) => {
            setHighlightedKind(entry.descriptor.harnessKind);
            setInspector(entry.descriptor.harnessKind);
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
