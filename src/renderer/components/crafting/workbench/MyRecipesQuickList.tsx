import { ArrowRight, PackageOpen } from "lucide-react";
import type { StoredRecipe } from "@/shared/crafting/workbenchTypes";

/**
 * My Recipes quick list: the reusable user recipes, shown under the inventory
 * beside the Inspector. Clicking a recipe loads it into the Workbench draft —
 * it never runs it immediately.
 */
export function MyRecipesQuickList(props: {
  recipes: readonly StoredRecipe[];
  onLoad: (recipe: StoredRecipe) => void;
  onViewAll: () => void;
}) {
  const { recipes, onLoad, onViewAll } = props;
  const recent = [...recipes].slice(-5).reverse();
  return (
    <section
      className="flex min-h-0 flex-col gap-2"
      data-testid="my-recipes-quick-list"
      aria-label="我的配方快速列表"
    >
      <header className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-neutral-300">我的配方</h3>
        <button
          type="button"
          onClick={onViewAll}
          className="flex items-center gap-1 text-[10px] text-neutral-400 hover:text-white"
        >
          查看全部 <ArrowRight className="size-3" />
        </button>
      </header>
      {recent.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] text-neutral-500">
          还没有保存的配方
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 overflow-y-auto pr-1">
          {recent.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              onClick={() => onLoad(recipe)}
              title={recipe.systemName}
              className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07]"
            >
              <PackageOpen className="size-4 shrink-0 text-amber-300" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {recipe.systemName}
                </span>
                {recipe.alias ? (
                  <span className="block truncate text-[10px] text-neutral-500">
                    {recipe.alias}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
