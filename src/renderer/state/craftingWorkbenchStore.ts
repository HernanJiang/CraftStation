import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createDbStorage } from "./dbStorage";
import type { CapabilityMode } from "@/shared/crafting/types";
import type {
  CapabilityResolution,
  CreativeDraft,
  EfficientDraft,
  PendingRecipeIntent,
  StoredRecipe,
  WorkbenchMode,
} from "@/shared/crafting/workbenchTypes";
import {
  composeRecipeSystemName,
  EMPTY_CREATIVE_DRAFT,
  EMPTY_EFFICIENT_DRAFT,
  storedRecipeId,
} from "@/shared/crafting/workbenchTypes";

const STORE_KEY = "craftstation-crafting-workbench-v1";
const STORE_VERSION = 1;

interface CraftingWorkbenchActions {
  setMode: (mode: WorkbenchMode) => void;
  /** Set/clear the Model material in the efficient draft and invalidate resolution. */
  setEfficientModel: (modelEntryRef?: string) => void;
  /** Set/clear the Harness material in the efficient draft and invalidate resolution. */
  setEfficientHarness: (harnessRef?: string) => void;
  clearEfficientDraft: () => void;
  clearCreativeDraft: () => void;
  /** Attach a freshly computed resolution keyed to the current draft identity. */
  attachResolution: (mode: WorkbenchMode, resolution: CapabilityResolution) => void;
  setInspector: (ref?: string) => void;
  saveRecipe: (input: {
    alias?: string;
    modelEntryRef: string;
    harnessRef: string;
    modelName: string;
    harnessName: string;
    resolution: CapabilityResolution;
    providerProfileRef?: string;
    authRef?: string;
    runtimeProfileRef?: string;
  }) => { recipe: StoredRecipe; duplicateCount: number };
  updateRecipeAlias: (id: string, alias?: string) => void;
  deleteRecipe: (id: string) => void;
  /** Toggle homepage model-picker visibility for a saved recipe. */
  setRecipeHomepageVisible: (id: string, visible: boolean) => void;
  /** Load a recipe's materials into the current-mode draft (replacing it). */
  loadRecipeToDraft: (recipe: StoredRecipe, mode: WorkbenchMode) => void;
  setPendingRecipeIntent: (intent?: PendingRecipeIntent) => void;
  clearPendingRecipeIntent: () => void;
  /** v1.2 capability resolution policy selected from the composer craft switch. */
  setCapabilityMode: (mode: CapabilityMode) => void;
  /**
   * CLIProxyAPI helper item for compatibility routes (gateway-direct /
   * cpa-translate). Singleton by design: `ensureCliProxyApiItem` reuses the
   * existing entry (present + selected) instead of creating duplicates, and
   * native routes must clear the selection via `clearCliProxyApiSelection`.
   */
  ensureCliProxyApiItem: () => void;
  clearCliProxyApiSelection: () => void;
}

export interface CliProxyApiHelperState {
  present: boolean;
  selected: boolean;
}

export interface CraftingWorkbenchStore extends CraftingWorkbenchActions {
  lastWorkbenchMode: WorkbenchMode;
  efficientDraft: EfficientDraft;
  creativeDraft: CreativeDraft;
  recipes: StoredRecipe[];
  selectedInspectorRef?: string | undefined;
  pendingRecipeIntent?: PendingRecipeIntent | undefined;
  capabilityMode: CapabilityMode;
  cpaHelper: CliProxyApiHelperState;
}

function invalidate(draft: EfficientDraft): EfficientDraft {
  return {
    modelEntryRef: draft.modelEntryRef,
    harnessRef: draft.harnessRef,
    packRef: draft.packRef,
    reservedSlot: true,
    providerProfileRef: draft.providerProfileRef,
    runtimeProfileRef: draft.runtimeProfileRef,
  };
}

export const useCraftingWorkbenchStore = create<CraftingWorkbenchStore>()(
  persist(
    (set, get) => ({
      lastWorkbenchMode: "efficient",
      efficientDraft: EMPTY_EFFICIENT_DRAFT,
      creativeDraft: EMPTY_CREATIVE_DRAFT,
      recipes: [],
      selectedInspectorRef: undefined,
      pendingRecipeIntent: undefined,
      capabilityMode: "auto",
      cpaHelper: { present: false, selected: false },

      setMode: (mode) =>
        set((state) => (state.lastWorkbenchMode === mode ? {} : { lastWorkbenchMode: mode })),

      setCapabilityMode: (capabilityMode) => set({ capabilityMode }),

      setEfficientModel: (modelEntryRef) =>
        set((state) => ({
          efficientDraft: {
            ...invalidate(state.efficientDraft),
            modelEntryRef,
          },
        })),

      setEfficientHarness: (harnessRef) =>
        set((state) => ({
          efficientDraft: {
            ...invalidate(state.efficientDraft),
            harnessRef,
          },
        })),

      clearEfficientDraft: () => set({ efficientDraft: EMPTY_EFFICIENT_DRAFT }),

      clearCreativeDraft: () => set({ creativeDraft: EMPTY_CREATIVE_DRAFT }),

      attachResolution: (mode, resolution) =>
        set((state) => {
          if (mode === "efficient") {
            return {
              efficientDraft: {
                ...state.efficientDraft,
                resolution,
                resolutionKey: resolution.resolutionKey,
              },
            };
          }
          return {
            creativeDraft: {
              ...state.creativeDraft,
              resolution,
              resolutionKey: resolution.resolutionKey,
            },
          };
        }),

      setInspector: (ref) =>
        set((state) => (state.selectedInspectorRef === ref ? {} : { selectedInspectorRef: ref })),

      saveRecipe: (input) => {
        const { alias, modelEntryRef, harnessRef, modelName, harnessName, resolution } = input;
        const id = storedRecipeId(modelEntryRef, harnessRef);
        const now = new Date().toISOString();
        const existing = get().recipes.filter((recipe) => recipe.modelEntryRef === modelEntryRef);
        const duplicateCount = existing.length;
        const recipe: StoredRecipe = {
          id,
          version: "1.0.0",
          systemName: composeRecipeSystemName(harnessName, modelName),
          ...(alias?.trim() ? { alias: alias.trim() } : {}),
          modelEntryRef,
          harnessRef,
          ...(input.providerProfileRef ? { providerProfileRef: input.providerProfileRef } : {}),
          ...(input.authRef ? { authRef: input.authRef } : {}),
          ...(input.runtimeProfileRef ? { runtimeProfileRef: input.runtimeProfileRef } : {}),
          compatibility: {
            uiStatus: resolution.status,
            ...(resolution.internalStatus ? { internalStatus: resolution.internalStatus } : {}),
            ...(resolution.adapterId ? { adapterId: resolution.adapterId } : {}),
            ...(resolution.adapterVersion ? { adapterVersion: resolution.adapterVersion } : {}),
          },
          createdAt: now,
          updatedAt: now,
          lastKnownModel: {
            displayName: modelName,
            modelId: resolution.modelEntryRef,
            providerLabel: resolution.modelEntryRef,
          },
          lastKnownHarness: {
            displayName: harnessName,
            harnessKind: harnessRef,
          },
        };
        // Replace-by-same-component keeps the recipe list free of duplicates for the
        // same material pair while still allowing multiple aliases under different refs.
        // Preserve homepage visibility across re-saves.
        set((state) => ({
          recipes: state.recipes.some((r) => r.id === id)
            ? state.recipes.map((r) =>
                r.id === id
                  ? { ...recipe, ...(r.homepageVisible ? { homepageVisible: true } : {}) }
                  : r,
              )
            : [...state.recipes, recipe],
        }));
        return { recipe, duplicateCount };
      },

      updateRecipeAlias: (id, alias) =>
        set((state) => ({
          recipes: state.recipes.map((recipe) =>
            recipe.id === id
              ? {
                  ...recipe,
                  ...(alias?.trim() ? { alias: alias.trim() } : { alias: undefined }),
                  updatedAt: new Date().toISOString(),
                }
              : recipe,
          ),
        })),

      deleteRecipe: (id) =>
        set((state) => ({ recipes: state.recipes.filter((recipe) => recipe.id !== id) })),

      setRecipeHomepageVisible: (id, visible) => {
        const now = new Date().toISOString();
        set((state) => ({
          recipes: state.recipes.map((recipe) => {
            if (recipe.id !== id) return recipe;
            const next: StoredRecipe = { ...recipe, updatedAt: now };
            if (visible) next.homepageVisible = true;
            else delete next.homepageVisible;
            return next;
          }),
        }));
      },

      loadRecipeToDraft: (recipe, mode) =>
        set(() => {
          if (mode === "efficient") {
            return {
              efficientDraft: {
                reservedSlot: true,
                modelEntryRef: recipe.modelEntryRef,
                harnessRef: recipe.harnessRef,
                ...(recipe.providerProfileRef
                  ? { providerProfileRef: recipe.providerProfileRef }
                  : {}),
                ...(recipe.runtimeProfileRef
                  ? { runtimeProfileRef: recipe.runtimeProfileRef }
                  : {}),
              },
            };
          }
          return {
            creativeDraft: EMPTY_CREATIVE_DRAFT,
          };
        }),

      setPendingRecipeIntent: (intent) => set({ pendingRecipeIntent: intent }),

      clearPendingRecipeIntent: () => set({ pendingRecipeIntent: undefined }),

      ensureCliProxyApiItem: () =>
        set((state) =>
          state.cpaHelper.present && state.cpaHelper.selected
            ? {}
            : { cpaHelper: { present: true, selected: true } },
        ),

      clearCliProxyApiSelection: () =>
        set((state) =>
          state.cpaHelper.selected ? { cpaHelper: { ...state.cpaHelper, selected: false } } : {},
        ),
    }),
    {
      name: STORE_KEY,
      version: STORE_VERSION,
      storage: createDbStorage(),
    },
  ),
);
