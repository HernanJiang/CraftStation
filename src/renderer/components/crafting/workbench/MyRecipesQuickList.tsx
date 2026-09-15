import { ArrowRight, PackageOpen, Trash2 } from "lucide-react";
import type { StoredRecipe } from "@/shared/crafting/workbenchTypes";
import { ContextMenu } from "@/renderer/components/common/ContextMenu";

/**
 * My Recipes quick list: the reusable user recipes, shown under the inventory
 * beside the Inspector. Clicking a recipe loads it into the Workbench draft —
 * it never runs it immediately.
 */
export function MyRecipesQuickList(props: {
  recipes: readonly StoredRecipe[];
  onLoad: (recipe: StoredRecipe) => void;
  onViewAll: () => void;
  onDelete?: (recipe: StoredRecipe) => void;
  /** Max recipes to show (default 5 recent). Pass a large number for a full list. */
  limit?: number | undefined;
}) {
  const { recipes, onLoad, onViewAll, onDelete, limit = 5 } = props;
  const recent = [...recipes].slice(-limit).reverse();
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
        // 单个配方占满整列宽度，不留一半空白。
        <div
          className={`grid gap-2 overflow-y-auto pr-1 ${
            recent.length === 1 ? "grid-cols-1" : "grid-cols-2"
          }`}
        >
          {recent.map((recipe) => {
            const row = (
              <div
                key={recipe.id}
                className="flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.03] pr-1 transition-colors hover:bg-white/[0.07]"
              >
                <button
                  type="button"
                  onClick={() => onLoad(recipe)}
                  title={recipe.systemName}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
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
                {onDelete ? (
                  <button
                    type="button"
                    aria-label={`删除配方 ${recipe.systemName}`}
                    title="删除配方"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(recipe);
                    }}
                    className="shrink-0 rounded-md p-1.5 text-neutral-500 hover:bg-white/10 hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
            );
            if (!onDelete) return row;
            return (
              <ContextMenu
                key={recipe.id}
                items={[{ id: "delete", label: "删除配方", variant: "danger" }]}
                onAction={(key) => {
                  if (key === "delete") onDelete(recipe);
                }}
              >
                {row}
              </ContextMenu>
            );
          })}
        </div>
      )}
    </section>
  );
}
