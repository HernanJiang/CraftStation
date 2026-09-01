import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Hammer, Layers, type LucideIcon } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import {
  getDefaultCrafter,
  getDefaultRegistry,
  type Component,
  type CraftResult,
  type Item,
  type NativeHarnessControlPlaneEntry,
  type Recipe,
} from "@/shared/crafting";
import { readBridge } from "@/renderer/bridge";
import { CraftingRegistrySections } from "@/renderer/components/crafting/CraftingRegistrySections";
import { CraftingGrid } from "@/renderer/components/crafting/CraftingGrid";
import { Button } from "@/renderer/components/common";
import { useAppStore } from "@/renderer/state/appStore";
import { startThreadFromCraft } from "@/renderer/actions/threadLaunchActions";
import { getCurrentProjectId } from "@/renderer/actions/currentProject";
import { resolveProjectLocation } from "@/shared/worktree";

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
  slotLabel: ReactNode;
  resolutionNote: ReactNode;
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

function statusLabel(
  status: NativeHarnessControlPlaneEntry["status"],
  t: ReturnType<typeof useLingui>["t"],
): string {
  switch (status) {
    case "ready":
      return t(msg`Ready`);
    case "not-configured":
      return t(msg`Not configured`);
    case "unavailable":
      return t(msg`Unavailable`);
    case "error":
      return t(msg`Error`);
  }
}

function statusClass(status: NativeHarnessControlPlaneEntry["status"]): string {
  switch (status) {
    case "ready":
      return "text-emerald-400";
    case "error":
      return "text-rose-400";
    case "unavailable":
      return "text-amber-400";
    case "not-configured":
      return "text-muted";
  }
}

function NativeHarnessStatusSection(props: {
  entries: readonly NativeHarnessControlPlaneEntry[];
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
}) {
  const { t } = useLingui();
  return (
    <section
      aria-label={t`Native Harness status`}
      data-testid="native-harness-status"
      className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-3"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            <Trans>Native Harness status</Trans>
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            <Trans>Official runtime and safe diagnostics projection</Trans>
          </p>
        </div>
        <Button
          size="sm"
          variant="tertiary"
          className="h-auto min-h-0 px-2 py-1 text-[10px] text-muted"
          onPress={props.onRefresh}
          isDisabled={props.loading}
        >
          {props.loading ? t`Refreshing…` : t`Refresh`}
        </Button>
      </div>
      {props.error && (
        <p className="mt-2 text-[11px] text-rose-400">
          <Trans>Unable to read Native Harness status.</Trans>
        </p>
      )}
      <div className="mt-2 space-y-1.5">
        {props.entries.map((entry) => (
          <div
            key={entry.descriptor.harnessKind}
            data-testid={`native-harness-${entry.descriptor.harnessKind}`}
            className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-secondary)] px-2.5 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {entry.descriptor.label}
              </span>
              <span className={`text-[11px] font-medium ${statusClass(entry.status)}`}>
                {statusLabel(entry.status, t)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted/80">
              <span>{entry.descriptor.transport}</span>
              <span>·</span>
              <span>{entry.environmentKind}</span>
              {entry.profileConfigured && (
                <span>
                  · <Trans>Authenticated signal</Trans>
                </span>
              )}
            </div>
            {entry.diagnostics.length > 0 && (
              <p className="mt-1 text-[10px] text-muted">
                <span className="font-mono">{entry.diagnostics[0]?.code}</span>
                {" · "}
                {entry.diagnostics[0]?.message}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function HarnessPanel() {
  const { t } = useLingui();
  const registry = getDefaultRegistry();
  const crafter = getDefaultCrafter();

  const currentProjectId = useAppStore(() => getCurrentProjectId());
  const currentProject = useAppStore(
    (state) => state.projects.find((p) => p.id === currentProjectId) ?? state.projects[0],
  );

  const handleCraft = async (result: CraftResult, prompt: string) => {
    if (!currentProject) {
      throw new Error(t(msg`No project selected to launch crafted Agent.`));
    }
    await startThreadFromCraft(currentProject, result, prompt);
  };

  const workspaceLocation = useMemo(
    () =>
      currentProject?.location
        ? resolveProjectLocation(currentProject.location, undefined)
        : undefined,
    [currentProject?.location],
  );
  const workspacePath = workspaceLocation
    ? workspaceLocation.kind === "wsl"
      ? workspaceLocation.linuxPath
      : workspaceLocation.path
    : undefined;

  const [nativeHarnessEntries, setNativeHarnessEntries] = useState<
    NativeHarnessControlPlaneEntry[]
  >([]);
  const [nativeHarnessLoading, setNativeHarnessLoading] = useState(true);
  const [nativeHarnessError, setNativeHarnessError] = useState(false);
  const [modelItems, setModelItems] = useState<Item[]>(() => registry.listItems("model"));
  const [modelInventoryStatus, setModelInventoryStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");

  const model = modelItems[0] ?? null;
  const harness = registry.resolveSlot("harness", "auto") ?? null;
  const validation = crafter.validate({ slots: { model: model ?? undefined, harness: "auto" } });

  const refreshNativeHarnessStatus = async () => {
    setNativeHarnessLoading(true);
    setNativeHarnessError(false);
    try {
      const entries = await readBridge().getNativeHarnessControlPlane({});
      setNativeHarnessEntries(entries);
    } catch {
      setNativeHarnessError(true);
    } finally {
      setNativeHarnessLoading(false);
    }
  };

  useEffect(() => {
    let disposed = false;
    const refreshCraftingModelInventory = async () => {
      // Fail closed while switching projects: never leave the previous official
      // OpenAI snapshot selectable during a new discovery request.
      registry.refreshCodexModels([]);
      setModelItems(registry.listItems("model"));
      setModelInventoryStatus("loading");
      if (!workspaceLocation) {
        setModelInventoryStatus("unavailable");
        return;
      }
      try {
        const inventory = await readBridge().getCraftingModelInventory({
          projectLocation: workspaceLocation,
        });
        if (disposed) return;
        registry.refreshCodexModels(inventory.status === "ready" ? inventory.models : []);
        setModelItems(registry.listItems("model"));
        setModelInventoryStatus(inventory.status);
      } catch {
        if (disposed) return;
        registry.refreshCodexModels([]);
        setModelItems(registry.listItems("model"));
        setModelInventoryStatus("unavailable");
      }
    };

    void refreshNativeHarnessStatus();
    void refreshCraftingModelInventory();
    const unsubscribe = readBridge().onSupervisorEvent((event) => {
      if (
        event.type === "agent-detected" ||
        event.type === "agent-status-updated" ||
        event.type === "windows-agent-statuses" ||
        event.type === "usage-accounts"
      ) {
        void refreshNativeHarnessStatus();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [registry, workspaceLocation]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="space-y-3 p-3">
        <NativeHarnessStatusSection
          entries={nativeHarnessEntries}
          loading={nativeHarnessLoading}
          error={nativeHarnessError}
          onRefresh={() => void refreshNativeHarnessStatus()}
        />
        <section
          aria-label={t`Models`}
          data-testid="crafting-model-inventory-status"
          className="flex items-center justify-between rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 text-xs"
        >
          <span className="text-muted">
            <Trans>Models</Trans>
          </span>
          <span
            className={
              modelInventoryStatus === "ready"
                ? "text-emerald-400"
                : modelInventoryStatus === "unavailable"
                  ? "text-amber-400"
                  : "text-muted"
            }
          >
            {modelInventoryStatus === "ready"
              ? t`Ready`
              : modelInventoryStatus === "unavailable"
                ? t`Unavailable`
                : t`Refreshing…`}
          </span>
        </section>
        <CraftingGrid workspace={workspacePath} models={modelItems} onCraft={handleCraft} />
        <CraftingRegistrySections models={modelItems} />
        <RecipeCard recipe={validation.matchedRecipe ?? null} valid={validation.valid} />

        <IngredientSection
          icon={Cpu}
          accentClass="text-sky-400"
          slotLabel={<Trans>Model Ingredient</Trans>}
          resolutionNote={<Trans>Default selection</Trans>}
          item={model}
        />
        <IngredientSection
          icon={Layers}
          accentClass="text-emerald-400"
          slotLabel={<Trans>Harness Ingredient</Trans>}
          resolutionNote={<Trans>auto (Deterministic resolution)</Trans>}
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
