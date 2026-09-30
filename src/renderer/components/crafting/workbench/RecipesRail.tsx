import { useState } from "react";
import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import type { StoredRecipe } from "@/shared/crafting/workbenchTypes";
import { ContextMenu } from "@/renderer/components/common/ContextMenu";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { getCurrentProjectId } from "@/renderer/actions/currentProject";
import {
  recipeLaunchHarnessKind,
  recipeLaunchModelId,
} from "@/renderer/crafting/recipePickerTarget";
import { isThirdPartyAccountId } from "@/shared/thirdPartyRouting";

function statusLabel(recipe: StoredRecipe): { label: string; class: string } {
  const ui = recipe.compatibility.uiStatus;
  if (ui === "NATIVE") return { label: "原生兼容", class: "text-emerald-400" };
  if (ui === "CRAFTABLE") return { label: "可合成", class: "text-amber-300" };
  return { label: "当前不可运行", class: "text-red-400" };
}

/**
 * Recipe cards rail: the right column of the "合成台与配方" tab. Loads a recipe
 * back into the draft (through the confirm dialog), fires it into chat, edits
 * the alias and deletes — deleting a recipe never deletes the underlying
 * Model/Harness materials or accounts.
 *
 * `variant="panel"` renders the same list as a bounded card for stacking under
 * the crafting result instead of a full-height side rail.
 */
export function RecipesRail(props: {
  onLoad: (recipe: StoredRecipe) => void;
  variant?: "rail" | "panel";
}) {
  const variant = props.variant ?? "rail";
  const recipes = useCraftingWorkbenchStore((state) => state.recipes);
  const updateRecipeAlias = useCraftingWorkbenchStore((state) => state.updateRecipeAlias);
  const deleteRecipe = useCraftingWorkbenchStore((state) => state.deleteRecipe);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [aliasDraft, setAliasDraft] = useState("");

  /**
   * "Use in chat": stage the recipe as a pending intent and align the project's
   * draft with the recipe's harness/model so the chat composer opens preloaded.
   * It only records the intent — the user still submits the prompt themselves.
   */
  const handleUseInChat = (recipe: StoredRecipe) => {
    const projectId = getCurrentProjectId();
    if (projectId) {
      const project = useAppStore.getState().projects.find((p) => p.id === projectId);
      const draft = project?.lastDraftConfig;
      useAppStore.getState().updateProjectDraftConfig(projectId, {
        ...(draft ?? { model: recipeLaunchModelId(recipe) ?? "" }),
        agentKind: recipeLaunchHarnessKind(recipe),
        model: recipeLaunchModelId(recipe) ?? draft?.model ?? "",
      });
    }
    useCraftingWorkbenchStore.getState().setPendingRecipeIntent({ recipeId: recipe.id });
    if (recipe.providerProfileRef && isThirdPartyAccountId(recipe.providerProfileRef)) {
      useUsageAccountsStore.getState().setNextSessionAccount(recipe.providerProfileRef);
    } else {
      useUsageAccountsStore.getState().clearNextSessionAccount();
    }
    usePanelStore.getState().closeModelUsageDialog();
  };

  const beginEditAlias = (recipe: StoredRecipe) => {
    setEditingId(recipe.id);
    setAliasDraft(recipe.alias ?? "");
  };

  const commitAlias = (recipe: StoredRecipe) => {
    if (aliasDraft.trim() !== recipe.alias)
      updateRecipeAlias(recipe.id, aliasDraft.trim() ? aliasDraft.trim() : undefined);
    setEditingId(undefined);
  };

  return (
    <aside
      className={
        variant === "panel"
          ? "flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/10 bg-black/25"
          : "flex min-h-0 w-72 shrink-0 flex-col border-l border-white/5"
      }
      data-testid="recipes-rail"
      aria-label="配方列表"
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/5 px-3">
        <h3 className="text-xs font-semibold text-neutral-300">配方 · {recipes.length}</h3>
      </header>
      <div
        className={
          variant === "panel"
            ? "flex max-h-56 min-h-0 flex-col gap-1.5 overflow-y-auto p-2"
            : "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
        }
      >
        {recipes.length === 0 ? (
          <p className="p-2 text-[11px] text-neutral-500">还没有保存的配方</p>
        ) : null}
        {recipes.map((recipe) => {
          const status = statusLabel(recipe);
          const editing = editingId === recipe.id;
          const card = (
            <div
              className="rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-2"
              data-testid="recipe-row"
            >
              <p className="truncate text-xs font-medium text-foreground">{recipe.systemName}</p>
              {editing ? (
                <div className="mt-1 flex items-center gap-1">
                  <input
                    aria-label="配方别名"
                    value={aliasDraft}
                    onChange={(event) => setAliasDraft(event.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-foreground outline-none focus:border-white/25"
                  />
                  <button
                    type="button"
                    onClick={() => commitAlias(recipe)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-white/10"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(undefined)}
                    className="shrink-0 rounded px-1 py-0.5 text-[10px] text-neutral-400 hover:bg-white/10"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <p className="mt-0.5 truncate text-[10px] text-neutral-500">
                  {recipe.alias ? `${recipe.alias} · ` : ""}
                  {recipe.lastKnownModel?.displayName ?? recipe.modelEntryRef} ·{" "}
                  {recipe.lastKnownHarness?.displayName ?? recipe.harnessRef}
                </p>
              )}
              <div className="mt-1.5 flex items-center gap-1">
                <span className={`text-[10px] font-medium ${status.class}`}>{status.label}</span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => props.onLoad(recipe)}
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-white/10"
                >
                  加载
                </button>
                <button
                  type="button"
                  aria-label="在聊天中使用"
                  title="在聊天中使用该配方"
                  onClick={() => handleUseInChat(recipe)}
                  className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-emerald-300"
                >
                  <MessageSquarePlus className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="编辑别名"
                  onClick={() => beginEditAlias(recipe)}
                  className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="删除配方"
                  onClick={() => deleteRecipe(recipe.id)}
                  className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-red-400"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          );
          return (
            <ContextMenu
              key={recipe.id}
              items={[{ id: "delete", label: "删除配方", variant: "danger" }]}
              onAction={(key) => {
                if (key === "delete") deleteRecipe(recipe.id);
              }}
            >
              {card}
            </ContextMenu>
          );
        })}
      </div>
    </aside>
  );
}
