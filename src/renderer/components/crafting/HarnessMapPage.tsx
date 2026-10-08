import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Workflow } from "lucide-react";
import type { AccountView } from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import type { SelectedModelEntry } from "@/shared/crafting/workbenchTypes";
import {
  COMPAT_FALLBACK_HARNESS_KINDS,
  channelInfoFromCustomModels,
  isThirdPartyAccountId,
  resolveAutoModelBinding,
  sanitizeCompatFallbackHarness,
} from "@/shared/thirdPartyRouting";
import { COMPATIBILITY_HARNESS_LABELS } from "@/shared/harnessCompatibility";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { buildSelectedModelInventory } from "@/renderer/crafting/selectedModelInventory";
import { useNativeHarnessControlPlane } from "@/renderer/crafting/useNativeHarnessControlPlane";
import { openHarnessConfiguration } from "@/renderer/crafting/openHarnessConfiguration";
import {
  ProviderBrandBadge,
  brandEdgeColor,
} from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";
import { HarnessCliRow, harnessStatusMeta } from "./workbench/HarnessCliRow";
import { useLingui } from "@lingui/react/macro";

/**
 * Provider → default Harness/CLI mapping. Provider ids already equal their
 * native harness kind for most vendors; aliases cover the ones whose CLI kind
 * diverges from the usage-provider id.
 */
const PROVIDER_TO_HARNESS_KIND: Record<string, string> = {
  zai: "zcode",
};

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "model";
}

/** Channel identity: third-party accounts are their own channel, otherwise the provider. */
function channelKeyFor(entry: SelectedModelEntry): string {
  return entry.accountId ?? entry.providerKind;
}

interface ModelHarnessRow {
  entry: SelectedModelEntry;
  index: number;
  channelKey: string;
  /** Actual spawn Harness after per-model routing (matches launch binding). */
  finalKind: string;
  finalEntry: NativeHarnessControlPlaneEntry | undefined;
  reason: string;
  /** Single-line badge for the compact model node; full text stays in `reason`. */
  reasonShort: string;
}

interface ChannelNode {
  key: string;
  providerKind: string;
  label: string;
  accountCount: number;
  rows: ModelHarnessRow[];
}

interface GraphEdge {
  key: string;
  layer: "provider-model" | "model-harness";
  rowIndex: number;
  from: string;
  to: string;
  /** Source channel brand accent — one chain keeps one color end to end. */
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type HoverTarget =
  | { type: "channel"; id: string }
  | { type: "model"; id: number }
  | { type: "harness"; id: string };

const GRAPH_GRID_COLS = "grid-cols-[minmax(0,0.95fr)_3rem_minmax(0,1.05fr)_3rem_minmax(0,1.15fr)]";

/**
 * Harness map tab (replaces the old 我的配方 tab): a three-layer node graph
 * crossing 渠道 → 模型 → 最终 Harness.
 *
 * - Layer 1 渠道 → 模型: one channel fans out to all of its models (a channel
 *   is a provider, or one third-party account bound to its own channel).
 * - Layer 2 模型 → Harness: each model points at the Harness that will
 *   actually spawn it — the same `resolveAutoModelBinding` the composer uses
 *   (native pairing, third-party `resolveThirdPartyHarnessForModel` by model
 *   family, DeepSeek auto-remap), falling back to the compat trunk when the
 *   resolved Harness has no control plane entry. Many models may converge on
 *   one Harness, so layer-2 lines freely cross.
 *
 * Hovering any node highlights its full chain across both layers. Harnesses
 * with no model channel drop into an unlinked group below the graph.
 */
export function HarnessMapPage(props: {
  accounts: AccountView[];
  customModels: SharedSettings["customModels"];
  configuredProviderIds: readonly string[];
  providerOrder: readonly string[];
}) {
  const { t } = useLingui();
  const {
    visibleEntries,
    loading,
    highlightedKind,
    setHighlightedKind,
    installingKinds,
    refresh,
    install,
  } = useNativeHarnessControlPlane();

  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const hiddenModels = useSharedSettings((state) => state.hiddenModels);
  const shownModels = useSharedSettings((state) => state.shownModels);
  const compatDefaultHarness = useSharedSettings((state) => state.compatDefaultHarness);
  const setCompatDefaultHarness = useSharedSettings((state) => state.setCompatDefaultHarness);
  const compatKind = sanitizeCompatFallbackHarness(compatDefaultHarness);

  // Every model the user actually selected in 管理模型 — the map mirrors the
  // model inventory, not the catalog.
  const inventory = useMemo(
    () =>
      buildSelectedModelInventory({
        agentStatuses,
        wslAgentStatuses,
        hiddenModels,
        shownModels,
        customModels: props.customModels,
        accounts: props.accounts,
        configuredProviderIds: props.configuredProviderIds,
        providerOrder: props.providerOrder,
      }),
    [
      agentStatuses,
      wslAgentStatuses,
      hiddenModels,
      shownModels,
      props.customModels,
      props.accounts,
      props.configuredProviderIds,
      props.providerOrder,
    ],
  );

  const harnessByKind = useMemo(
    () => new Map(visibleEntries.map((entry) => [entry.descriptor.harnessKind, entry])),
    [visibleEntries],
  );

  // Harness kinds considered installed for per-model routing: everything the
  // control plane knows except `unavailable` rows.
  const installedKinds = useMemo(
    () =>
      visibleEntries
        .filter((entry) => entry.status !== "unavailable")
        .map((entry) => entry.descriptor.harnessKind),
    [visibleEntries],
  );

  const accountCountByChannel = useMemo(() => {
    const counts = new Map<string, number>();
    for (const account of props.accounts) {
      const key = account.accountId;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      counts.set(account.provider, (counts.get(account.provider) ?? 0) + 1);
    }
    return counts;
  }, [props.accounts]);

  // Per-model final Harness — the same binding the composer launch uses, so
  // the graph never disagrees with what actually spawns.
  const modelRows = useMemo<ModelHarnessRow[]>(() => {
    const order = new Map(props.providerOrder.map((id, position) => [id, position]));
    return inventory
      .map((entry, index) => {
        const binding = resolveAutoModelBinding(
          {
            agentKind: entry.providerKind,
            model: entry.modelId,
            ...(entry.accountId ? { accountId: entry.accountId } : {}),
          },
          installedKinds,
          channelInfoFromCustomModels(props.customModels, entry.accountId, entry.modelId),
          compatKind,
        );
        const resolvedKind = PROVIDER_TO_HARNESS_KIND[binding.harnessId] ?? binding.harnessId;
        const nativeKind = PROVIDER_TO_HARNESS_KIND[entry.providerKind] ?? entry.providerKind;
        let finalKind = resolvedKind;
        let reason: string;
        let reasonShort: string;
        if (!harnessByKind.has(finalKind)) {
          finalKind = compatKind;
          reason = t`无原生 Harness · 兼容默认`;
          reasonShort = t`兼容默认`;
        } else if (isThirdPartyAccountId(entry.accountId)) {
          reason = t`第三方渠道 · 按模型路由`;
          reasonShort = t`按模型路由`;
        } else if (finalKind !== nativeKind) {
          reason = t`Auto 接管（${nativeKind} → ${finalKind}）`;
          reasonShort = t`接管`;
        } else {
          reason = t`原生`;
          reasonShort = t`原生`;
        }
        return {
          entry,
          index,
          channelKey: channelKeyFor(entry),
          finalKind,
          finalEntry: harnessByKind.get(finalKind),
          reason,
          reasonShort,
        };
      })
      .sort((a, b) => {
        const orderA = order.get(a.entry.providerKind) ?? Number.MAX_SAFE_INTEGER;
        const orderB = order.get(b.entry.providerKind) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        if (a.entry.providerKind !== b.entry.providerKind) {
          return a.entry.providerKind.localeCompare(b.entry.providerKind);
        }
        return a.entry.displayName.localeCompare(b.entry.displayName);
      });
  }, [
    inventory,
    installedKinds,
    props.customModels,
    props.providerOrder,
    compatKind,
    harnessByKind,
    t,
  ]);

  // Layer-1 nodes: one per channel, in first-appearance order.
  const channels = useMemo<ChannelNode[]>(() => {
    const order: ChannelNode[] = [];
    const byKey = new Map<string, ChannelNode>();
    for (const row of modelRows) {
      let node = byKey.get(row.channelKey);
      if (!node) {
        node = {
          key: row.channelKey,
          providerKind: row.entry.providerKind,
          label: row.entry.channelLabel,
          accountCount:
            accountCountByChannel.get(row.channelKey) ??
            accountCountByChannel.get(row.entry.providerKind) ??
            0,
          rows: [],
        };
        byKey.set(row.channelKey, node);
        order.push(node);
      }
      node.rows.push(row);
    }
    return order;
  }, [modelRows, accountCountByChannel]);

  // Layer-3 nodes: one per resolved Harness, in first-appearance order.
  const harnessNodes = useMemo(() => {
    const order: {
      kind: string;
      entry: NativeHarnessControlPlaneEntry;
      rows: ModelHarnessRow[];
    }[] = [];
    const byKind = new Map<string, (typeof order)[number]>();
    for (const row of modelRows) {
      if (!row.finalEntry) continue;
      let node = byKind.get(row.finalKind);
      if (!node) {
        node = { kind: row.finalKind, entry: row.finalEntry, rows: [] };
        byKind.set(row.finalKind, node);
        order.push(node);
      }
      node.rows.push(row);
    }
    return order;
  }, [modelRows]);

  const trunkEntry = harnessByKind.get(compatKind);

  const orphanEntries = useMemo(() => {
    const linked = new Set<string>();
    for (const row of modelRows) {
      if (harnessByKind.has(row.finalKind)) linked.add(row.finalKind);
    }
    return visibleEntries.filter((entry) => !linked.has(entry.descriptor.harnessKind));
  }, [visibleEntries, modelRows, harnessByKind]);

  const compatCandidates = useMemo(() => {
    const kinds = new Set<string>(COMPAT_FALLBACK_HARNESS_KINDS);
    kinds.add(compatKind);
    return [...kinds];
  }, [compatKind]);

  const handleShowDetail = (entry: NativeHarnessControlPlaneEntry) => {
    setHighlightedKind(entry.descriptor.harnessKind);
    if (entry.status === "unavailable") return;
    if (entry.status !== "ready") {
      openHarnessConfiguration(entry.descriptor.harnessKind);
    }
  };

  // ── Crossing edge geometry ──────────────────────────────────────────────
  // Nodes live in three static stacks inside one relative content box; edges
  // are an SVG overlay sized to that box. offsetTop/offsetLeft of every node
  // resolve against the content box (no intermediate positioned ancestors),
  // so curves stay glued to their nodes across scroll and resize.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const channelNodeRefs = useRef(new Map<string, HTMLDivElement>());
  const modelNodeRefs = useRef(new Map<number, HTMLDivElement>());
  const harnessNodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<HoverTarget | null>(null);

  const recomputeEdges = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    setCanvasSize({ width: content.scrollWidth, height: content.scrollHeight });
    const centerY = (el: HTMLElement) => el.offsetTop + el.offsetHeight / 2;
    const next: GraphEdge[] = [];
    for (const row of modelRows) {
      const color = brandEdgeColor(row.entry.providerKind);
      const channelEl = channelNodeRefs.current.get(row.channelKey);
      const modelEl = modelNodeRefs.current.get(row.index);
      const harnessEl = harnessNodeRefs.current.get(row.finalKind);
      if (channelEl && modelEl) {
        next.push({
          key: `pm-${row.index}`,
          layer: "provider-model",
          rowIndex: row.index,
          from: row.channelKey,
          to: `model-${row.index}`,
          color,
          x1: channelEl.offsetLeft + channelEl.offsetWidth,
          y1: centerY(channelEl),
          x2: modelEl.offsetLeft,
          y2: centerY(modelEl),
        });
      }
      if (modelEl && harnessEl) {
        next.push({
          key: `mh-${row.index}`,
          layer: "model-harness",
          rowIndex: row.index,
          from: `model-${row.index}`,
          to: row.finalKind,
          color,
          x1: modelEl.offsetLeft + modelEl.offsetWidth,
          y1: centerY(modelEl),
          x2: harnessEl.offsetLeft,
          y2: centerY(harnessEl),
        });
      }
    }
    setEdges(next);
  }, [modelRows]);

  useLayoutEffect(() => {
    recomputeEdges();
  }, [recomputeEdges]);

  useEffect(() => {
    // Paint after mount (badges/fonts can shift rows), then track resizes.
    const frame = requestAnimationFrame(() => recomputeEdges());
    const content = contentRef.current;
    if (typeof ResizeObserver === "undefined" || !content) return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(() => recomputeEdges());
    observer.observe(content);
    window.addEventListener("resize", recomputeEdges);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", recomputeEdges);
    };
  }, [recomputeEdges]);

  const rowsByIndex = useMemo(() => new Map(modelRows.map((row) => [row.index, row])), [modelRows]);

  const isEdgeActive = useCallback(
    (edge: GraphEdge): boolean => {
      if (!hover) return false;
      const row = rowsByIndex.get(edge.rowIndex);
      if (!row) return false;
      if (hover.type === "channel") return row.channelKey === hover.id;
      if (hover.type === "model") return edge.rowIndex === hover.id;
      return row.finalKind === hover.id;
    },
    [hover, rowsByIndex],
  );

  const isChannelActive = useCallback(
    (key: string): boolean => {
      if (!hover) return true;
      if (hover.type === "channel") return hover.id === key;
      if (hover.type === "model") return rowsByIndex.get(hover.id)?.channelKey === key;
      return modelRows.some((row) => row.channelKey === key && row.finalKind === hover.id);
    },
    [hover, rowsByIndex, modelRows],
  );

  const isModelActive = useCallback(
    (index: number): boolean => {
      if (!hover) return true;
      if (hover.type === "model") return hover.id === index;
      const row = rowsByIndex.get(index);
      if (!row) return false;
      if (hover.type === "channel") return row.channelKey === hover.id;
      return row.finalKind === hover.id;
    },
    [hover, rowsByIndex],
  );

  const isHarnessActive = useCallback(
    (kind: string): boolean => {
      if (!hover) return true;
      if (hover.type === "harness") return hover.id === kind;
      if (hover.type === "model") return rowsByIndex.get(hover.id)?.finalKind === kind;
      return modelRows.some((row) => row.finalKind === kind && row.channelKey === hover.id);
    },
    [hover, rowsByIndex, modelRows],
  );

  const edgePath = (edge: GraphEdge): string => {
    const dx = Math.min(48, Math.max(16, (edge.x2 - edge.x1) / 2));
    return (
      `M ${edge.x1} ${edge.y1} C ${edge.x1 + dx} ${edge.y1}, ${edge.x2 - dx} ${edge.y2}, ` +
      `${edge.x2} ${edge.y2}`
    );
  };

  const marketplace =
    orphanEntries.length > 0 ? (
      <section className="space-y-2" data-testid="harness-marketplace">
        <h3 className="pt-1 text-[10px] font-medium text-neutral-500">{t`Harness 市场`}</h3>
        {orphanEntries.map((entry) => (
          <div
            key={entry.descriptor.id}
            data-testid={`harness-map-orphan-${entry.descriptor.harnessKind}`}
            onMouseEnter={() => setHover({ type: "harness", id: entry.descriptor.harnessKind })}
            onMouseLeave={() => setHover(null)}
            className={`min-w-0 transition-opacity ${isHarnessActive(entry.descriptor.harnessKind) ? "" : "opacity-30"}`}
          >
            <HarnessCliRow
              entry={entry}
              highlighted={highlightedKind === entry.descriptor.harnessKind}
              installing={installingKinds.has(entry.descriptor.harnessKind)}
              onInstall={install}
              onShowDetail={handleShowDetail}
            />
          </div>
        ))}
      </section>
    ) : null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-3"
      data-testid="harness-map-page"
    >
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        <header className="sticky top-0 z-10 bg-[var(--surface)] py-1">
          <div className="relative">
            <div className={`grid min-w-0 ${GRAPH_GRID_COLS} items-center gap-2`}>
              <h2 className="text-sm font-semibold text-foreground">
                {t`渠道`}{" "}
                <span className="ml-1 text-[10px] font-normal text-neutral-500">
                  {t`${channels.length} 个`}
                </span>
              </h2>
              <span />
              <h2 className="text-sm font-semibold text-foreground">
                {t`模型`}{" "}
                <span className="ml-1 text-[10px] font-normal text-neutral-500">
                  {t`${modelRows.length} 个`}
                </span>
              </h2>
              <span />
              <h2 className="truncate pr-10 text-sm font-semibold text-foreground">
                {t`最终 Harness / CLI`}{" "}
                <span className="ml-1 text-[10px] font-normal text-neutral-500">
                  {t`${harnessNodes.length} 个`}
                </span>
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              title={t`刷新状态`}
              className="absolute right-0 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {modelRows.length === 0 ? (
          <>
            <p className="rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] p-6 text-center text-sm text-muted">
              {t`还没有在「管理模型」中选定任何模型`}
            </p>
            {marketplace}
          </>
        ) : (
          <div ref={contentRef} className="relative">
            <svg
              className="pointer-events-none absolute left-0 top-0"
              width={canvasSize.width}
              height={canvasSize.height}
              aria-hidden
            >
              {edges.map((edge) => {
                const active = isEdgeActive(edge);
                return (
                  <g key={edge.key}>
                    <path
                      d={edgePath(edge)}
                      fill="none"
                      stroke={edge.color}
                      strokeOpacity={active ? 0.95 : 0.32}
                      strokeWidth={active ? 2 : 1.25}
                      data-testid={`harness-map-edge-${edge.key}`}
                      data-layer={edge.layer}
                      data-from={edge.from}
                      data-to={edge.to}
                    />
                    <circle
                      cx={edge.x1}
                      cy={edge.y1}
                      r={2.5}
                      fill={edge.color}
                      fillOpacity={active ? 0.95 : 0.32}
                    />
                    <circle
                      cx={edge.x2}
                      cy={edge.y2}
                      r={2.5}
                      fill={edge.color}
                      fillOpacity={active ? 0.95 : 0.32}
                    />
                  </g>
                );
              })}
            </svg>
            <div className={`grid ${GRAPH_GRID_COLS} items-start gap-2`}>
              <div className="flex min-w-0 flex-col gap-2">
                {channels.map((channel) => (
                  <div
                    key={channel.key}
                    ref={(el) => {
                      if (el) channelNodeRefs.current.set(channel.key, el);
                      else channelNodeRefs.current.delete(channel.key);
                    }}
                    data-testid={`harness-map-provider-${slugify(channel.key)}`}
                    onMouseEnter={() => setHover({ type: "channel", id: channel.key })}
                    onMouseLeave={() => setHover(null)}
                    className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-opacity ${
                      isChannelActive(channel.key)
                        ? "border-white/5 bg-white/[0.03]"
                        : "border-white/5 bg-white/[0.03] opacity-30"
                    }`}
                  >
                    <ProviderBrandBadge
                      id={channel.providerKind}
                      label={channel.label}
                      size="compact"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-xs font-medium text-foreground"
                        title={channel.label}
                      >
                        {channel.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-neutral-500">
                        {t`${channel.accountCount} 账号 · ${channel.rows.length} 模型`}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div aria-hidden />
              <div className="flex min-w-0 flex-col gap-1">
                {modelRows.map((row) => (
                  <div
                    key={`${row.entry.entryId}::${row.index}`}
                    ref={(el) => {
                      if (el) modelNodeRefs.current.set(row.index, el);
                      else modelNodeRefs.current.delete(row.index);
                    }}
                    data-testid={`harness-map-model-node-${slugify(row.entry.providerKind)}-${slugify(row.entry.modelId)}-${row.index}`}
                    onMouseEnter={() => setHover({ type: "model", id: row.index })}
                    onMouseLeave={() => setHover(null)}
                    title={`${row.entry.displayName}\n${row.entry.modelId}\n${row.reason}`}
                    className={`flex h-7 min-w-0 items-center gap-1.5 rounded-lg border px-2.5 transition-opacity ${
                      isModelActive(row.index)
                        ? "border-white/5 bg-white/[0.03]"
                        : "border-white/5 bg-white/[0.03] opacity-30"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                      {row.entry.displayName}
                    </span>
                    <span className="shrink-0 text-[10px] leading-none text-neutral-600">
                      {row.reasonShort}
                    </span>
                  </div>
                ))}
              </div>
              <div aria-hidden />
              <div className="flex min-w-0 flex-col gap-2">
                {harnessNodes.map((node) => (
                  <div
                    key={node.kind}
                    ref={(el) => {
                      if (el) harnessNodeRefs.current.set(node.kind, el);
                      else harnessNodeRefs.current.delete(node.kind);
                    }}
                    data-testid={`harness-map-harness-node-${node.kind}`}
                    onMouseEnter={() => setHover({ type: "harness", id: node.kind })}
                    onMouseLeave={() => setHover(null)}
                    className={`min-w-0 transition-opacity ${
                      isHarnessActive(node.kind) ? "" : "opacity-30"
                    }`}
                  >
                    <HarnessCliRow
                      entry={node.entry}
                      highlighted={highlightedKind === node.kind}
                      installing={installingKinds.has(node.kind)}
                      metaSuffix={t`${node.rows.length} 个模型`}
                      onInstall={install}
                      onShowDetail={handleShowDetail}
                    />
                  </div>
                ))}
                {marketplace}
              </div>
            </div>
          </div>
        )}

        <div
          className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-accent/25 bg-white/[0.03] px-2.5 py-2"
          data-testid="harness-map-compat-trunk"
        >
          <p className="flex items-center gap-1 text-[10px] font-medium text-neutral-500">
            <Workflow className="size-3" />
            {t`兼容默认 Harness（无原生 Harness 的渠道与第三方模型回退到此；上图连线已按该设置实时路由）`}
          </p>
          {trunkEntry
            ? (() => {
                const TrunkStatusIcon = harnessStatusMeta[trunkEntry.status].icon;
                return (
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-400">
                    <TrunkStatusIcon
                      className={`size-3.5 ${harnessStatusMeta[trunkEntry.status].class}`}
                    />
                    <span className="truncate">
                      {trunkEntry.descriptor.label} ·{" "}
                      {t(harnessStatusMeta[trunkEntry.status].label)}
                    </span>
                  </span>
                );
              })()
            : null}
          <label className="mt-auto flex items-center gap-1.5 text-[10px] text-neutral-500">
            <span className="shrink-0">{t`切换默认`}</span>
            <select
              aria-label={t`兼容默认 Harness`}
              value={compatKind}
              onChange={(event) => setCompatDefaultHarness(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-1.5 py-1 text-[10px] text-foreground outline-none focus:border-white/25"
            >
              {compatCandidates.map((kind) => (
                <option key={kind} value={kind}>
                  {COMPATIBILITY_HARNESS_LABELS[
                    kind as keyof typeof COMPATIBILITY_HARNESS_LABELS
                  ] ?? kind}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
