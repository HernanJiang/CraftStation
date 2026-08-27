import { useMemo, useState } from "react";
import { ChevronRight, Cpu, Layers, ScrollText } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { getDefaultRegistry, type Item, type Recipe } from "@/shared/crafting";

/**
 * CraftStation registry inventory sections (Models / Harness Library /
 * Recipes), fed read-only by the real crafting registry.
 *
 * v0.2.1 introduced these in the left sidebar; v0.2.4 moves them into the
 * right Harness Inspector panel: the sidebar now mirrors the Codex layout,
 * and "what can I compose with" lives next to "what is it made of".
 */

type SectionId = "models" | "harnesses" | "recipes";

function ItemRow(props: { item: Item }) {
  const { metadata } = props.item;
  const tooltip = `${metadata.description} -- ${metadata.id} v${metadata.version}`;
  return (
    <div
      className="flex w-full items-center gap-2 rounded-xl px-2 py-1 text-sm text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
      title={tooltip}
    >
      <span className="min-w-0 flex-1 truncate">{metadata.name}</span>
      <span className="shrink-0 font-mono text-[10px] text-muted/70">{metadata.vendor}</span>
    </div>
  );
}

function RecipeRow(props: { recipe: Recipe }) {
  const { recipe } = props;
  return (
    <div
      className="flex w-full items-center gap-2 rounded-xl px-2 py-1 text-sm text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
      title={recipe.description}
    >
      <span className="min-w-0 flex-1 truncate">{recipe.name}</span>
      <span className="shrink-0 font-mono text-[10px] text-amber-500/80">v{recipe.version}</span>
      <span
        className={`shrink-0 font-mono text-[10px] ${
          recipe.compatibilityStatus === "NATIVE" ? "text-emerald-400/90" : "text-muted/70"
        }`}
      >
        {recipe.compatibilityStatus}
      </span>
    </div>
  );
}

export function CraftingRegistrySections() {
  const { t } = useLingui();
  const registry = useMemo(() => getDefaultRegistry(), []);
  const models = useMemo(() => registry.listItems("model"), [registry]);
  const harnesses = useMemo(() => registry.listItems("harness"), [registry]);
  const recipes = useMemo(() => registry.listRecipes(), [registry]);

  const [collapsed, setCollapsed] = useState<Record<SectionId, boolean>>({
    models: true,
    harnesses: true,
    recipes: true,
  });
  const toggle = (id: SectionId) => setCollapsed((current) => ({ ...current, [id]: !current[id] }));

  const sections: {
    id: SectionId;
    label: string;
    icon: typeof Cpu;
    accentClass: string;
    count: number;
  }[] = [
    {
      id: "models",
      label: t`Models`,
      icon: Cpu,
      accentClass: "text-sky-400",
      count: models.length,
    },
    {
      id: "harnesses",
      label: t`Harness Library`,
      icon: Layers,
      accentClass: "text-emerald-400",
      count: harnesses.length,
    },
    {
      id: "recipes",
      label: t`Recipes`,
      icon: ScrollText,
      accentClass: "text-amber-500",
      count: recipes.length,
    },
  ];

  return (
    <section
      aria-label="CraftStation registry"
      className="space-y-0.5 rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-1.5"
    >
      <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted/70">
        <Trans>Registry</Trans>
      </p>
      {sections.map((section) => {
        const Icon = section.icon;
        const isCollapsed = collapsed[section.id];
        return (
          <div key={section.id}>
            <button
              type="button"
              onClick={() => toggle(section.id)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-1.5 rounded-xl px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
            >
              <ChevronRight
                className={`size-3 shrink-0 text-muted/70 transition-transform ${
                  isCollapsed ? "" : "rotate-90"
                }`}
              />
              <Icon className={`size-3.5 shrink-0 ${section.accentClass}`} />
              <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted/60">{section.count}</span>
            </button>
            {!isCollapsed && (
              <div className="ml-4 space-y-0.5 border-l border-[var(--hairline)] pb-1 pl-1.5 pt-0.5">
                {section.id === "models" &&
                  models.map((item) => <ItemRow key={item.id} item={item} />)}
                {section.id === "harnesses" &&
                  harnesses.map((item) => <ItemRow key={item.id} item={item} />)}
                {section.id === "recipes" &&
                  recipes.map((recipe) => <RecipeRow key={recipe.id} recipe={recipe} />)}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
