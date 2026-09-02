import { useMemo, useState } from "react";
import { Pencil, Search, Trash2 } from "lucide-react";
import type { StoredRecipe } from "@/shared/crafting/workbenchTypes";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { Button } from "@/renderer/components/common";

/**
 * My Recipes page: the "我的配方" first-level tab. Supports viewing, searching,
 * loading a recipe into the workbench, editing the alias, deleting a recipe and
 * showing its current status. Deleting a recipe never deletes the underlying
 * Model/Harness materials or accounts.
 */
export function MyRecipesPage() {
  const recipes = useCraftingWorkbenchStore((state) => state.recipes);
  const loadRecipeToDraft = useCraftingWorkbenchStore((state) => state.loadRecipeToDraft);
  const updateRecipeAlias = useCraftingWorkbenchStore((state) => state.updateRecipeAlias);
  const deleteRecipe = useCraftingWorkbenchStore((state) => state.deleteRecipe);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [aliasDraft, setAliasDraft] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter(
      (r) =>
        r.systemName.toLowerCase().includes(q) || (r.alias?.toLowerCase().includes(q) ?? false),
    );
  }, [recipes, query]);

  const handleLoad = (recipe: StoredRecipe) => {
    loadRecipeToDraft(recipe, "efficient");
    usePanelStore.getState().openModelUsageWorkspace({ tab: "crafting" });
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

  const statusLabel = (recipe: StoredRecipe): { label: string; class: string } => {
    const ui = recipe.compatibility.uiStatus;
    if (ui === "NATIVE") return { label: "原生兼容", class: "text-emerald-400" };
    if (ui === "CRAFTABLE") return { label: "可合成", class: "text-amber-300" };
    return { label: "当前不可运行", class: "text-red-400" };
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3"
      data-testid="my-recipes-page"
    >
      <header className="flex shrink-0 items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">我的配方 · {recipes.length}</h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-neutral-500" />
          <input
            aria-label="搜索配方"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索配方…"
            className="w-56 rounded-lg border border-white/10 bg-black/30 py-1.5 pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-neutral-600 focus:border-white/25"
          />
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] text-xs text-neutral-500">
          没有找到配方
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {filtered.map((recipe) => {
            const status = statusLabel(recipe);
            const editing = editingId === recipe.id;
            return (
              <div
                key={recipe.id}
                className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5"
                data-testid="recipe-row"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {recipe.systemName}
                  </p>
                  {editing ? (
                    <div className="mt-1 flex items-center gap-1.5">
                      <input
                        aria-label="配方别名"
                        value={aliasDraft}
                        onChange={(event) => setAliasDraft(event.target.value)}
                        className="w-56 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-foreground outline-none focus:border-white/25"
                      />
                      <Button size="sm" variant="primary" onPress={() => commitAlias(recipe)}>
                        保存
                      </Button>
                      <Button size="sm" variant="ghost" onPress={() => setEditingId(undefined)}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <p className="truncate text-[11px] text-neutral-500">
                      {recipe.alias ? `${recipe.alias} · ` : ""}
                      {recipe.lastKnownModel?.displayName ?? recipe.modelEntryRef} ·{" "}
                      {recipe.lastKnownHarness?.displayName ?? recipe.harnessRef}
                    </p>
                  )}
                </div>
                <span className={`shrink-0 text-[11px] font-medium ${status.class}`}>
                  {status.label}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button size="sm" variant="ghost" onPress={() => handleLoad(recipe)}>
                    加载
                  </Button>
                  <button
                    type="button"
                    aria-label="编辑别名"
                    onClick={() => beginEditAlias(recipe)}
                    className="rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="删除配方"
                    onClick={() => deleteRecipe(recipe.id)}
                    className="rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
