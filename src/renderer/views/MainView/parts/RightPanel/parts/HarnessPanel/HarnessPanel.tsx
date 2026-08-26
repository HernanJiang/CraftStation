import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Hammer,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  getDefaultCrafter,
  getDefaultRegistry,
  type Component,
  type Item,
  type Recipe,
} from "@/shared/crafting";
import { CraftingRegistrySections } from "@/renderer/components/crafting/CraftingRegistrySections";
import { CraftingGrid } from "@/renderer/components/crafting/CraftingGrid";

/**
 * v0.2.2 — Harness Inspector panel.
 *
 * Shows what the current agent composition is made of: the matched Recipe, the
 * resolved Ingredient slots, and each Item's Components — the read-only
 * "What is running? What components created it?" surface from the Codex-style
 * reconstruction spec. All data comes from the real crafting registry/crafter;
 * nothing here mutates state or launches anything.
 */

function componentDetailLines(component: Component): string[] {
  const record = component as Record<string, unknown>;
  switch (component.kind) {
    case "model_capability": {
      const lines = [`vendor: ${String(record.vendor)}`, `model: ${String(record.modelId)}`];
      if (typeof record.contextWindow === "number") {
        lines.push(`context: ${Math.round(record.contextWindow / 1000)}k`);
      }
      lines.push(`streaming: ${record.supportsStreaming === false ? "off" : "on"}`);
      lines.push(`tool calling: ${record.supportsToolCalling === false ? "off" : "on"}`);
      return lines;
    }
    case "harness_runtime":
      return [
        `harness: ${String(record.harnessKind)}`,
        `execution: ${String(record.executionMode)}`,
        `vendors: ${Array.isArray(record.supportedVendors) ? record.supportedVendors.join(", ") : "-"}`,
      ];
    default:
      return [component.kind];
  }
}

function IngredientSection(props: {
  icon: LucideIcon;
  accentClass: string;
  slotLabel: string;
  resolutionNote: string;
  item: Item | null;
}) {
  const Icon = props.icon;
  return (
    <section className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)]">
      <header className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-2">
        <Icon className={`size-4 shrink-0 ${props.accentClass}`} />
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          {props.slotLabel}
        </span>
      </header>
      {props.item ? (
        <div className="space-y-2 px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {props.item.metadata.name}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted/70">
              v{props.item.metadata.version}
            </span>
          </div>
          <p className="text-[11px] text-muted">{props.resolutionNote}</p>
          <ul className="space-y-1.5">
            {props.item.components.map((component, index) => (
              <li
                key={`${component.kind}-${index}`}
                className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-secondary)] px-2.5 py-1.5"
              >
                <p className="font-mono text-[10px] font-semibold text-foreground/90">
                  {component.kind}
                </p>
                {componentDetailLines(component).map((line) => (
                  <p key={line} className="font-mono text-[10px] text-muted">
                    {line}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="px-3 py-2.5 text-xs text-muted">-</p>
      )}
    </section>
  );
}

function RecipeCard(props: { recipe: Recipe | null; valid: boolean }) {
  const { t } = useLingui();
  const { recipe, valid } = props;
  if (!recipe) {
    return (
      <section className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
          <AlertTriangle className="size-3.5" />
          <Trans>No matching Recipe</Trans>
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Hammer className="size-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {recipe.name}
        </span>
        {valid && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-400">
            <CheckCircle2 className="size-3.5" />
            {recipe.compatibilityStatus}
          </span>
        )}
      </div>
      <p className="mt-1 font-mono text-[10px] text-muted/70">
        {recipe.id} · v{recipe.version}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{recipe.description}</p>
      <p className="sr-only">{t`Recipe`}</p>
    </section>
  );
}

export function HarnessPanel() {
  const registry = useMemo(() => getDefaultRegistry(), []);
  const crafter = useMemo(() => getDefaultCrafter(), []);

  const model = useMemo(() => registry.listItems("model")[0] ?? null, [registry]);
  const harness = useMemo(() => registry.resolveSlot("harness", "auto") ?? null, [registry]);
  const validation = useMemo(
    () => crafter.validate({ slots: { model: model ?? undefined, harness: "auto" } }),
    [crafter, model],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="space-y-3 p-3">
        <CraftingGrid />
        <CraftingRegistrySections />
        <RecipeCard recipe={validation.matchedRecipe ?? null} valid={validation.valid} />

        <IngredientSection
          icon={Cpu}
          accentClass="text-sky-400"
          slotLabel="Model Ingredient"
          resolutionNote="Default selection"
          item={model}
        />
        <IngredientSection
          icon={Layers}
          accentClass="text-emerald-400"
          slotLabel="Harness Ingredient"
          resolutionNote="auto (Deterministic resolution)"
          item={harness}
        />

        <section className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            <Trans>Result Item</Trans>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/90">
            {model?.metadata.name} + {harness?.metadata.name}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            <Trans>Compiled CraftPlan spawns an executable Agent Entity.</Trans>
          </p>
        </section>
      </div>
    </div>
  );
}
